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

async function findPyFiles(repoRoot: string): Promise<string[]> {
  const results: string[] = []
  async function recurse(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null)
    if (entries === null) return
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name)) await recurse(path.join(dir, entry.name))
      } else if (entry.isFile() && entry.name.endsWith('.py')) {
        results.push(path.join(dir, entry.name))
      }
    }
  }
  await recurse(repoRoot)
  return results
}

function extractStringContent(node: Parser.SyntaxNode): string | undefined {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child !== null && child.type === 'string_content') return child.text
  }
  return undefined
}

function normalizePath(raw: string): { urlPath: string; dynamicSegmentType: DynamicSegmentType } {
  const normalized = raw
    .replace(/<\w+:(\w+)>/g, ':$1')
    .replace(/<(\w+)>/g, ':$1')
    .replace(/\/+$/, '')
  const urlPath = normalized.startsWith('/') ? normalized : '/' + normalized
  return {
    urlPath,
    dynamicSegmentType: urlPath.includes(':') ? 'dynamic' : 'static',
  }
}

function getStringArg(argList: Parser.SyntaxNode): string | undefined {
  for (let i = 0; i < argList.childCount; i++) {
    const arg = argList.child(i)
    if (arg !== null && arg.type === 'string') {
      return extractStringContent(arg)
    }
  }
  return undefined
}

interface BlueprintDef {
  varName: string
  urlPrefix: string
}

export async function parseFlaskRoutes(
  repoRoot: string,
  analyzerVersion: string,
): Promise<RouteNode[]> {
  const pyFiles = await findPyFiles(repoRoot)
  const parser = await createPythonParser()
  const routes: RouteNode[] = []

  for (const filePath of pyFiles) {
    const source = await fs.readFile(filePath, 'utf-8').catch(() => null)
    if (source === null) continue
    if (!source.includes('@app.route') && !source.includes('.route(') && !source.includes('Blueprint')) continue

    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')
    const tree = parser.parse(source)

    // Pass 1: collect Blueprint definitions and register_blueprint calls
    const blueprints = new Map<string, BlueprintDef>()
    const blueprintPrefixes = new Map<string, string>() // varName → final prefix

    for (let i = 0; i < tree.rootNode.childCount; i++) {
      const node = tree.rootNode.child(i)
      if (node === null) continue

      if (node.type === 'expression_statement') {
        const assign = node.child(0)
        if (assign?.type === 'assignment') {
          const left = assign.childForFieldName('left')
          const right = assign.childForFieldName('right')
          if (left?.type === 'identifier' && right?.type === 'call') {
            const func = right.childForFieldName('function')
            if (func?.text === 'Blueprint') {
              const argList = right.childForFieldName('arguments')
              if (argList !== null) {
                for (let j = 0; j < argList.childCount; j++) {
                  const kwarg = argList.child(j)
                  if (kwarg?.type === 'keyword_argument') {
                    const key = kwarg.child(0)
                    const val = kwarg.child(2)
                    if (key?.text === 'url_prefix' && val?.type === 'string') {
                      const prefix = extractStringContent(val) ?? ''
                      blueprints.set(left.text, { varName: left.text, urlPrefix: prefix })
                    }
                  }
                }
                if (!blueprints.has(left.text)) {
                  blueprints.set(left.text, { varName: left.text, urlPrefix: '' })
                }
              }
            }
          }
        }
      }

      if (node.type === 'expression_statement') {
        const call = node.child(0)
        if (call?.type === 'call') {
          const func = call.childForFieldName('function')
          if (func?.type === 'attribute' && func.lastChild?.text === 'register_blueprint') {
            const argList = call.childForFieldName('arguments')
            if (argList !== null) {
              let bpVarName: string | undefined
              let prefix: string | undefined
              for (let j = 0; j < argList.childCount; j++) {
                const arg = argList.child(j)
                if (arg?.type === 'identifier') bpVarName = arg.text
                if (arg?.type === 'keyword_argument') {
                  const key = arg.child(0)
                  const val = arg.child(2)
                  if (key?.text === 'url_prefix' && val?.type === 'string') {
                    prefix = extractStringContent(val) ?? ''
                  }
                }
              }
              if (bpVarName !== undefined && prefix !== undefined) {
                blueprintPrefixes.set(bpVarName, prefix)
              }
            }
          }
        }
      }
    }

    // Resolve final blueprint prefixes
    for (const [varName, def] of blueprints) {
      const overridePrefix = blueprintPrefixes.get(varName)
      blueprints.set(varName, {
        ...def,
        urlPrefix: overridePrefix ?? def.urlPrefix,
      })
    }

    // Pass 2: collect decorated routes
    for (let i = 0; i < tree.rootNode.childCount; i++) {
      const node = tree.rootNode.child(i)
      if (node === null || node.type !== 'decorated_definition') continue

      let routePath: string | undefined
      let ownerBpVar: string | undefined

      for (let j = 0; j < node.childCount; j++) {
        const child = node.child(j)
        if (child === null || child.type !== 'decorator') continue

        const expr = child.child(1)
        if (expr === null) continue

        let funcName: string | undefined
        let argList: Parser.SyntaxNode | undefined
        let callerName: string | undefined

        if (expr.type === 'call') {
          const func = expr.childForFieldName('function')
          argList = expr.childForFieldName('arguments') ?? undefined
          if (func?.type === 'attribute') {
            callerName = func.child(0)?.text
            funcName = func.lastChild?.text
          } else if (func?.type === 'identifier') {
            funcName = func.text
          }
        }

        if (funcName !== 'route' || argList === undefined) continue

        const rawPath = getStringArg(argList)
        if (rawPath === undefined) continue
        routePath = rawPath
        if (callerName !== undefined && blueprints.has(callerName)) {
          ownerBpVar = callerName
        }
      }

      if (routePath === undefined) continue

      const prefix = ownerBpVar !== undefined ? (blueprints.get(ownerBpVar)?.urlPrefix ?? '') : ''
      const combined = (prefix + routePath).replace(/\/\//g, '/') || '/'
      const { urlPath, dynamicSegmentType } = normalizePath(combined)

      const defNode = node.lastChild
      if (defNode === null) continue

      const provenance = astToProvenance(
        relPath,
        defNode.startPosition,
        'flask@0.1',
        analyzerVersion,
      )

      const nodeId = makeNodeId('route', relPath, urlPath)
      const base = {
        id: nodeId,
        path: urlPath,
        filePath: relPath,
        routeFileKind: 'page' as const,
        dynamicSegmentType,
        isGroupRoute: false,
        renderingMode: 'SSR' as const,
        provenance,
      }
      routes.push(
        ownerBpVar !== undefined
          ? createRouteNode({ ...base, confidence: 'inferred', inferenceChain: [`flask: Blueprint prefix '${prefix}' from register_blueprint`] })
          : createRouteNode({ ...base, confidence: 'verified' }),
      )
    }
  }

  return routes
}
