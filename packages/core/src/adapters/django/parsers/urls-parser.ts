import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type Parser from 'web-tree-sitter'
import {
  createRouteNode,
  makeNodeId,
  astToProvenance,
  type RouteNode,
  type DynamicSegmentType,
} from '@codebase-viz/types'
import { createPythonParser } from '../../_shared/tree-sitter-loader.js'

const EXCLUDE_DIRS = new Set(['__pycache__', '.git', 'node_modules', 'venv', '.venv', 'env'])

async function findUrlFiles(repoRoot: string): Promise<string[]> {
  const results: string[] = []
  async function recurse(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null)
    if (entries === null) return
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name)) await recurse(fullPath)
      } else if (entry.isFile() && entry.name === 'urls.py') {
        results.push(fullPath)
      }
    }
  }
  await recurse(repoRoot)
  return results
}

function normalizeDjangoPattern(pattern: string): { urlPath: string; dynamicSegmentType: DynamicSegmentType } {
  const normalized = pattern
    .replace(/<\w+:(\w+)>/g, ':$1')
    .replace(/<(\w+)>/g, ':$1')
    .replace(/\/+$/, '')
  const urlPath = normalized.startsWith('/') ? normalized : '/' + normalized
  const dynamicSegmentType: DynamicSegmentType = urlPath.includes(':') ? 'dynamic' : 'static'
  return { urlPath, dynamicSegmentType }
}

function extractStringValue(node: Parser.SyntaxNode): string | undefined {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child !== null && child.type === 'string_content') return child.text
  }
  if (node.type === 'concatenated_string') {
    let result = ''
    for (let i = 0; i < node.childCount; i++) {
      const part = node.child(i)
      if (part !== null && part.type === 'string') {
        const val = extractStringValue(part)
        if (val !== undefined) result += val
      }
    }
    return result || undefined
  }
  return undefined
}

function isIncludeCall(node: Parser.SyntaxNode): boolean {
  if (node.type !== 'call') return false
  const func = node.child(0)
  return func !== null && func.text === 'include'
}

function extractIncludeModuleName(includeCallNode: Parser.SyntaxNode): string | undefined {
  const argList = includeCallNode.child(1)
  if (argList === null) return undefined
  for (let i = 0; i < argList.childCount; i++) {
    const arg = argList.child(i)
    if (arg !== null && arg.type === 'string') return extractStringValue(arg)
  }
  return undefined
}

function moduleNameToRelPath(moduleName: string): string {
  return moduleName.replace(/\./g, '/') + '.py'
}

function composePrefixedPath(prefixRaw: string, routePath: string): string {
  const prefix = '/' + prefixRaw.replace(/^\//, '').replace(/\/$/, '')
  if (routePath === '/' || routePath === '') return prefix
  return prefix + routePath
}

interface IncludeEntry {
  prefix: string
  moduleName: string
  row: number
}

interface FileData {
  directRoutes: RouteNode[]
  includes: IncludeEntry[]
}

function extractAll(
  rootNode: Parser.SyntaxNode,
  relPath: string,
  analyzerVersion: string,
): FileData {
  const directRoutes: RouteNode[] = []
  const includes: IncludeEntry[] = []

  function walk(node: Parser.SyntaxNode): void {
    if (node.type === 'call') {
      const func = node.child(0)
      if (func !== null && (func.text === 'path' || func.text === 're_path')) {
        const args = node.child(1)
        if (args !== null && args.type === 'argument_list') {
          const firstArg = args.namedChild(0)
          const secondArg = args.namedChild(1)
          if (
            firstArg !== null &&
            (firstArg.type === 'string' || firstArg.type === 'concatenated_string')
          ) {
            if (secondArg !== null && isIncludeCall(secondArg)) {
              const moduleName = extractIncludeModuleName(secondArg)
              const prefix = extractStringValue(firstArg)
              if (moduleName !== undefined && prefix !== undefined) {
                includes.push({ prefix, moduleName, row: node.startPosition.row })
              }
              return
            } else if (secondArg !== null) {
              const rawPattern = extractStringValue(firstArg)
              if (rawPattern !== undefined && rawPattern !== '') {
                const { urlPath, dynamicSegmentType } = normalizeDjangoPattern(rawPattern)
                if (urlPath !== '/') {
                  directRoutes.push(
                    createRouteNode({
                      id: makeNodeId('route', relPath, urlPath),
                      path: urlPath,
                      filePath: relPath,
                      routeFileKind: 'page',
                      dynamicSegmentType,
                      isGroupRoute: false,
                      renderingMode: 'SSR',
                      provenance: astToProvenance(
                        relPath,
                        { row: node.startPosition.row, column: node.startPosition.column },
                        'django@0.1',
                        analyzerVersion,
                      ),
                      confidence: 'verified',
                    }),
                  )
                }
              }
            }
          }
        }
        return
      }
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child !== null) walk(child)
    }
  }

  walk(rootNode)
  return { directRoutes, includes }
}

export async function parseUrls(
  repoRoot: string,
  analyzerVersion = 'codebase-viz@0.1.0',
): Promise<RouteNode[]> {
  const urlFiles = await findUrlFiles(repoRoot)
  if (urlFiles.length === 0) return []

  const parser = await createPythonParser()

  // Pass 1: 모든 urls.py → fileMap
  const fileMap = new Map<string, FileData>()
  for (const absPath of urlFiles) {
    const source = await fs.readFile(absPath, 'utf-8').catch(() => null)
    if (source === null) continue
    const relPath = path.relative(repoRoot, absPath).replace(/\\/g, '/')
    const tree = parser.parse(source)
    fileMap.set(relPath, extractAll(tree.rootNode, relPath, analyzerVersion))
  }

  // Pass 2: 포함(include)된 파일 목록 계산 → 루트 파일에서 시작해 재귀 수집
  const includedFiles = new Set<string>()
  for (const data of fileMap.values()) {
    for (const inc of data.includes) {
      includedFiles.add(moduleNameToRelPath(inc.moduleName))
    }
  }

  const result: RouteNode[] = []
  const visited = new Set<string>()

  function collect(relPath: string, prefixStack: string[]): void {
    if (visited.has(relPath)) return
    visited.add(relPath)

    const data = fileMap.get(relPath)
    if (data === undefined) return

    for (const route of data.directRoutes) {
      if (prefixStack.length === 0) {
        result.push(route)
      } else {
        const composedPath = composePrefixedPath(prefixStack.join(''), route.path)
        const dynamicSegmentType: DynamicSegmentType = composedPath.includes(':') ? 'dynamic' : 'static'
        result.push(
          createRouteNode({
            id: makeNodeId('route', route.filePath, `${composedPath}:include`),
            path: composedPath,
            filePath: route.filePath,
            routeFileKind: route.routeFileKind,
            dynamicSegmentType,
            isGroupRoute: route.isGroupRoute,
            renderingMode: route.renderingMode,
            provenance: route.provenance,
            confidence: 'inferred',
            inferenceChain: [
              `cross-file include() prefix='${prefixStack.join('')}' → ${relPath}`,
            ],
          }),
        )
      }
    }

    for (const inc of data.includes) {
      const targetRelPath = moduleNameToRelPath(inc.moduleName)
      collect(targetRelPath, [...prefixStack, inc.prefix])
    }
  }

  for (const relPath of fileMap.keys()) {
    if (!includedFiles.has(relPath)) {
      collect(relPath, [])
    }
  }

  return result
}
