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
import { normalizeUrlPath } from '../../_shared/url-path-normalizer.js'

const EXCLUDE_DIRS = new Set(['__pycache__', '.git', 'node_modules', 'venv', '.venv', 'env'])
const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options'])

async function findPyFiles(repoRoot: string): Promise<string[]> {
  const results: string[] = []
  async function recurse(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null)
    if (entries === null) return
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name)) await recurse(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.py')) {
        results.push(fullPath)
      }
    }
  }
  await recurse(repoRoot)
  return results
}

function extractStringValue(node: Parser.SyntaxNode): string | undefined {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child !== null && child.type === 'string_content') return child.text
  }
  return undefined
}

function getDynamicSegmentType(urlPath: string): DynamicSegmentType {
  if (urlPath.includes(':')) return 'dynamic'
  return 'static'
}

function getFirstStringArg(callNode: Parser.SyntaxNode): { value: string; row: number; col: number } | undefined {
  const argList = callNode.child(1)
  if (argList === null) return undefined
  for (let i = 0; i < argList.childCount; i++) {
    const arg = argList.child(i)
    if (arg !== null && arg.type === 'string') {
      const val = extractStringValue(arg)
      if (val !== undefined) return { value: val, row: arg.startPosition.row, col: arg.startPosition.column }
    }
  }
  return undefined
}

function getKeywordArg(argList: Parser.SyntaxNode, keyName: string): string | undefined {
  for (let i = 0; i < argList.childCount; i++) {
    const arg = argList.child(i)
    if (arg === null || arg.type !== 'keyword_argument') continue
    const nameNode = arg.child(0)
    const valueNode = arg.child(2)
    if (nameNode !== null && nameNode.text === keyName && valueNode !== null && valueNode.type === 'string') {
      return extractStringValue(valueNode)
    }
  }
  return undefined
}

// Pass 1 data structures
interface ApiRouterDef {
  varName: string
  prefix: string  // '' if APIRouter() without prefix
}

interface ImportEntry {
  localName: string     // local variable name (or alias)
  sourceModule: string  // dotted module: 'routers.users'
  originalName?: string // from X import Y as Z → Y
}

interface IncludeRouterCall {
  routerObj: string   // attribute: obj part ('users') or identifier ('users_router')
  routerAttr: string | undefined // attribute: attr part ('router'), undefined if identifier
  prefix: string
}

interface FileAnalysis {
  routerDefs: ApiRouterDef[]
  imports: ImportEntry[]
  includeRouterCalls: IncludeRouterCall[]
  decoratedRoutes: DecoratedRoute[]
}

interface DecoratedRoute {
  routerVar: string  // 'router', 'app', etc.
  httpMethod: string
  pathArg: string
  row: number
  col: number
}

function analyzeFile(rootNode: Parser.SyntaxNode): FileAnalysis {
  const routerDefs: ApiRouterDef[] = []
  const imports: ImportEntry[] = []
  const includeRouterCalls: IncludeRouterCall[] = []
  const decoratedRoutes: DecoratedRoute[] = []

  function walk(node: Parser.SyntaxNode): void {
    // import_from_statement: from X import Y, Z  or  from X import Y as Z
    if (node.type === 'import_from_statement') {
      let moduleParts = ''
      let pastImport = false

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child === null) continue

        if (child.text === 'import' && !pastImport) {
          pastImport = true
          continue
        }

        if (!pastImport && (child.type === 'dotted_name' || child.type === 'relative_import')) {
          moduleParts = child.text.replace(/^\.+/, '')
        }

        if (pastImport) {
          if (child.type === 'identifier' || child.type === 'dotted_name') {
            imports.push({ localName: child.text, sourceModule: `${moduleParts}.${child.text}` })
          } else if (child.type === 'aliased_import') {
            const nameNode = child.child(0)
            const aliasNode = child.child(2)
            if (nameNode !== null) {
              const originalName = nameNode.text
              const localName = aliasNode !== null ? aliasNode.text : originalName
              imports.push({ localName, sourceModule: moduleParts, originalName })
            }
          }
        }
      }
      return
    }

    // expression_statement: router = APIRouter(...)  OR  app.include_router(...)
    if (node.type === 'expression_statement') {
      const inner = node.child(0)
      if (inner === null) { return }

      // router = APIRouter(prefix='...')
      if (inner.type === 'assignment') {
        const left = inner.child(0)
        const right = inner.child(2)
        if (
          left !== null && left.type === 'identifier' &&
          right !== null && right.type === 'call'
        ) {
          const func = right.child(0)
          if (func !== null && func.text === 'APIRouter') {
            const argList = right.child(1)
            let prefix = ''
            if (argList !== null) {
              prefix = getKeywordArg(argList, 'prefix') ?? ''
            }
            routerDefs.push({ varName: left.text, prefix })
          }
        }
      }

      // app.include_router(X, prefix='...')
      if (inner.type === 'call') {
        const func = inner.child(0)
        if (func !== null && func.type === 'attribute') {
          const attrName = func.child(2)
          if (attrName !== null && attrName.text === 'include_router') {
            const argList = inner.child(1)
            if (argList !== null) {
              const firstArg = argList.namedChild(0)
              const prefix = getKeywordArg(argList, 'prefix') ?? ''
              if (firstArg !== null && firstArg.type === 'attribute') {
                const routerObj = firstArg.child(0)?.text ?? ''
                const routerAttr = firstArg.child(2)?.text
                includeRouterCalls.push({ routerObj, routerAttr, prefix })
              } else if (firstArg !== null && firstArg.type === 'identifier') {
                includeRouterCalls.push({ routerObj: firstArg.text, routerAttr: undefined, prefix })
              }
            }
          }
        }
      }

      return
    }

    // decorated_definition: @router.get('/path') def fn(): ...
    if (node.type === 'decorated_definition') {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child === null || child.type !== 'decorator') continue
        for (let j = 0; j < child.childCount; j++) {
          const callNode = child.child(j)
          if (callNode === null || callNode.type !== 'call') continue
          const func = callNode.child(0)
          if (func === null || func.type !== 'attribute') continue
          const objNode = func.child(0)
          const methodNode = func.child(2)
          if (objNode === null || methodNode === null) continue
          if (!HTTP_METHODS.has(methodNode.text)) continue
          const pathArg = getFirstStringArg(callNode)
          if (pathArg === undefined) continue
          decoratedRoutes.push({
            routerVar: objNode.text,
            httpMethod: methodNode.text,
            pathArg: pathArg.value,
            row: pathArg.row,
            col: pathArg.col,
          })
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child !== null) walk(child)
    }
  }

  walk(rootNode)
  return { routerDefs, imports, includeRouterCalls, decoratedRoutes }
}

// Resolve import entry to a relative file path. Returns undefined if can't resolve.
function resolveImportToRelPath(
  localName: string,
  imports: ImportEntry[],
  pyFilesSet: Set<string>,
  repoRoot: string,
): string | undefined {
  const imp = imports.find(i => i.localName === localName)
  if (imp === undefined) return undefined

  // sourceModule might be 'routers.users' (from 'from routers import users' → sourceModule='routers.users')
  // or 'routers' (from 'from routers import users as u' → sourceModule='routers', originalName='users')
  let modulePath = imp.sourceModule.replace(/\./g, '/')
  const candidates = [
    modulePath + '.py',
    modulePath + '/__init__.py',
  ]
  for (const c of candidates) {
    if (pyFilesSet.has(path.join(repoRoot, c))) return c
  }
  // fallback: 'routers/users.py' from imp.originalName
  if (imp.originalName !== undefined) {
    const modWithOrig = imp.sourceModule.replace(/\./g, '/') + '/' + imp.originalName + '.py'
    if (pyFilesSet.has(path.join(repoRoot, modWithOrig))) return modWithOrig
  }
  return undefined
}

function buildRoutesFromDecorated(
  decoratedRoutes: DecoratedRoute[],
  routerDefs: ApiRouterDef[],
  relPath: string,
  analyzerVersion: string,
): RouteNode[] {
  const routerPrefixMap = new Map<string, string>()
  for (const def of routerDefs) {
    routerPrefixMap.set(def.varName, def.prefix)
  }

  const routes: RouteNode[] = []
  for (const dr of decoratedRoutes) {
    const apiRouterPrefix = routerPrefixMap.get(dr.routerVar) ?? ''
    const rawPath = apiRouterPrefix !== '' ? apiRouterPrefix + dr.pathArg : dr.pathArg
    const urlPath = normalizeUrlPath(rawPath)
    routes.push(
      createRouteNode({
        id: makeNodeId('route', relPath, `${urlPath}:${dr.httpMethod}`),
        path: urlPath,
        filePath: relPath,
        routeFileKind: 'page',
        dynamicSegmentType: getDynamicSegmentType(urlPath),
        isGroupRoute: false,
        renderingMode: 'SSR',
        provenance: astToProvenance(relPath, { row: dr.row, column: dr.col }, 'fastapi@0.1', analyzerVersion),
        confidence: 'verified',
      }),
    )
  }
  return routes
}

export async function parseDecorators(
  repoRoot: string,
  analyzerVersion = 'codebase-viz@0.1.0',
): Promise<RouteNode[]> {
  const pyFiles = await findPyFiles(repoRoot)
  if (pyFiles.length === 0) return []

  const pyFilesSet = new Set(pyFiles)
  const parser = await createPythonParser()

  // Pass 1: 모든 파일 분석
  const fileMap = new Map<string, { analysis: FileAnalysis; relPath: string }>()
  for (const absPath of pyFiles) {
    const source = await fs.readFile(absPath, 'utf-8').catch(() => null)
    if (source === null) continue
    const relPath = path.relative(repoRoot, absPath).replace(/\\/g, '/')
    const tree = parser.parse(source)
    const analysis = analyzeFile(tree.rootNode)
    fileMap.set(absPath, { analysis, relPath })
  }

  // Pass 2: 각 파일의 intra-file decorated routes (APIRouter prefix 합성 포함)
  const fileRoutes = new Map<string, RouteNode[]>()
  for (const [absPath, { analysis, relPath }] of fileMap) {
    const routes = buildRoutesFromDecorated(analysis.decoratedRoutes, analysis.routerDefs, relPath, analyzerVersion)
    fileRoutes.set(absPath, routes)
  }

  // Pass 3: include_router() cross-file prefix 합성
  const allRoutes: RouteNode[] = []
  const included = new Set<string>()

  for (const [absPath, { analysis, relPath }] of fileMap) {
    for (const inc of analysis.includeRouterCalls) {
      // resolve: routerObj is the imported module name or identifier
      const targetRelPath = resolveImportToRelPath(inc.routerObj, analysis.imports, pyFilesSet, repoRoot)
      if (targetRelPath === undefined) continue

      const targetAbsPath = path.join(repoRoot, targetRelPath)
      const targetRoutes = fileRoutes.get(targetAbsPath)
      if (targetRoutes === undefined || targetRoutes.length === 0) continue

      included.add(targetAbsPath)

      for (const route of targetRoutes) {
        const composedPath = normalizeUrlPath(inc.prefix + route.path)
        const inferenceTag = `include_router(${inc.routerObj}${inc.routerAttr ? '.' + inc.routerAttr : ''}, prefix='${inc.prefix}') from ${relPath}`
        allRoutes.push(
          createRouteNode({
            id: makeNodeId('route', route.filePath, `${composedPath}:${inc.prefix}:include_router`),
            path: composedPath,
            filePath: route.filePath,
            routeFileKind: route.routeFileKind,
            dynamicSegmentType: getDynamicSegmentType(composedPath),
            isGroupRoute: route.isGroupRoute,
            renderingMode: route.renderingMode,
            provenance: route.provenance,
            confidence: 'inferred',
            inferenceChain: [inferenceTag],
          }),
        )
      }
    }
  }

  // collect routes from files not include-resolved (direct routes)
  // include_router'd files: skip their direct routes (they appear via composed prefix)
  for (const [absPath, routes] of fileRoutes) {
    if (!included.has(absPath)) {
      allRoutes.push(...routes)
    }
  }

  return allRoutes
}
