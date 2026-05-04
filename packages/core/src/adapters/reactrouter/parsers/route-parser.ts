import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Project, SyntaxKind } from 'ts-morph'
import {
  createRouteNode,
  createComponentNode,
  createEdge,
  makeNodeId,
  makeEdgeId,
  type RouteNode,
  type ComponentNode,
  type IREdge,
  type DynamicSegmentType,
  type Provenance,
  type NodeId,
} from '@codebase-viz/types'

const EXCLUDE_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.vite'])

async function findTsxFiles(repoRoot: string): Promise<string[]> {
  const results: string[] = []
  async function recurse(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null)
    if (entries === null) return
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name)) await recurse(path.join(dir, entry.name))
      } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts') || entry.name.endsWith('.jsx') || entry.name.endsWith('.js'))) {
        if (!entry.name.endsWith('.d.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.test.tsx')) {
          results.push(path.join(dir, entry.name))
        }
      }
    }
  }
  await recurse(repoRoot)
  return results
}

function normalizePath(rawPath: string): { urlPath: string; dynamicSegmentType: DynamicSegmentType } {
  const urlPath = rawPath.startsWith('/') ? rawPath : '/' + rawPath
  const dynamicSegmentType: DynamicSegmentType = urlPath.includes(':') ? 'dynamic' : 'static'
  return { urlPath, dynamicSegmentType }
}

interface RouteEntry {
  path: string
  elementComponent?: string
  children?: RouteEntry[]
}

interface FlatRouteItem {
  urlPath: string
  dynamicSegmentType: DynamicSegmentType
  elementComponent?: string
}

function extractRoutesFromArray(arrayNode: import('ts-morph').Node): RouteEntry[] {
  const entries: RouteEntry[] = []
  if (!arrayNode.isKind(SyntaxKind.ArrayLiteralExpression)) return entries

  for (const el of arrayNode.asKindOrThrow(SyntaxKind.ArrayLiteralExpression).getElements()) {
    if (!el.isKind(SyntaxKind.ObjectLiteralExpression)) continue
    const obj = el.asKindOrThrow(SyntaxKind.ObjectLiteralExpression)

    const pathProp = obj.getProperty('path')
    if (!pathProp?.isKind(SyntaxKind.PropertyAssignment)) continue
    const pathInit = pathProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
    if (!pathInit?.isKind(SyntaxKind.StringLiteral)) continue
    const routePath = pathInit.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue()

    const entry: RouteEntry = { path: routePath }

    // Extract element JSX component name
    const elementProp = obj.getProperty('element')
    if (elementProp?.isKind(SyntaxKind.PropertyAssignment)) {
      const elementInit = elementProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
      if (elementInit?.isKind(SyntaxKind.JsxSelfClosingElement)) {
        const tagName = elementInit.asKindOrThrow(SyntaxKind.JsxSelfClosingElement).getTagNameNode().getText()
        if (tagName.charAt(0) === tagName.charAt(0).toUpperCase() && tagName.charAt(0) !== tagName.charAt(0).toLowerCase()) {
          entry.elementComponent = tagName
        }
      } else if (elementInit?.isKind(SyntaxKind.JsxElement)) {
        const tagName = elementInit.asKindOrThrow(SyntaxKind.JsxElement).getOpeningElement().getTagNameNode().getText()
        if (tagName.charAt(0) === tagName.charAt(0).toUpperCase() && tagName.charAt(0) !== tagName.charAt(0).toLowerCase()) {
          entry.elementComponent = tagName
        }
      }
    }

    const childrenProp = obj.getProperty('children')
    if (childrenProp?.isKind(SyntaxKind.PropertyAssignment)) {
      const childInit = childrenProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
      if (childInit !== undefined) entry.children = extractRoutesFromArray(childInit)
    }

    entries.push(entry)
  }

  return entries
}

function flattenRoutes(entries: RouteEntry[], parentPath = ''): string[] {
  const paths: string[] = []
  for (const entry of entries) {
    const combined = entry.path === '' ? parentPath : (parentPath + '/' + entry.path).replace('//', '/')
    const normalized = combined === '' ? '/' : combined
    paths.push(normalized)
    if (entry.children !== undefined && entry.children.length > 0) {
      paths.push(...flattenRoutes(entry.children, normalized))
    }
  }
  return paths
}

function flattenRoutesEnriched(entries: RouteEntry[], parentPath = ''): FlatRouteItem[] {
  const result: FlatRouteItem[] = []
  for (const entry of entries) {
    const combined = entry.path === '' ? parentPath : (parentPath + '/' + entry.path).replace('//', '/')
    const normalized = combined === '' ? '/' : combined
    const dynamicSegmentType: DynamicSegmentType = normalized.includes(':') ? 'dynamic' : 'static'
    const item: FlatRouteItem = { urlPath: normalized, dynamicSegmentType }
    if (entry.elementComponent !== undefined) item.elementComponent = entry.elementComponent
    result.push(item)
    if (entry.children !== undefined && entry.children.length > 0) {
      result.push(...flattenRoutesEnriched(entry.children, normalized))
    }
  }
  return result
}

export interface ReactRouterFullResult {
  routeNodes: RouteNode[]
  componentNodes: ComponentNode[]
  rendersEdges: IREdge[]
}

export async function parseReactRouterFull(
  repoRoot: string,
  analyzerVersion: string,
): Promise<ReactRouterFullResult> {
  const allFiles = await findTsxFiles(repoRoot)
  if (allFiles.length === 0) return { routeNodes: [], componentNodes: [], rendersEdges: [] }

  const routerFiles: string[] = []
  for (const f of allFiles) {
    const content = await fs.readFile(f, 'utf-8').catch(() => '')
    if (content.includes('createBrowserRouter') || content.includes('createHashRouter') || content.includes('createMemoryRouter')) {
      routerFiles.push(f)
    }
  }
  if (routerFiles.length === 0) return { routeNodes: [], componentNodes: [], rendersEdges: [] }

  const project = new Project({
    compilerOptions: { target: 99, allowJs: true, strict: false, jsx: 4 },
    skipAddingFilesFromTsConfig: true,
  })
  for (const f of routerFiles) project.addSourceFileAtPath(f)

  const routeNodes: RouteNode[] = []
  const componentNodes: ComponentNode[] = []
  const rendersEdges: IREdge[] = []
  const seenCompFiles = new Map<string, NodeId>()

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath()
    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')
    const routerDir = path.dirname(filePath)

    const importMap = new Map<string, string>()
    for (const importDecl of sourceFile.getImportDeclarations()) {
      const defaultImport = importDecl.getDefaultImport()
      if (defaultImport !== undefined) {
        importMap.set(defaultImport.getText(), importDecl.getModuleSpecifierValue())
      }
    }

    for (const callExpr of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const calleeName = callExpr.getExpression().getText()
      if (calleeName !== 'createBrowserRouter' && calleeName !== 'createHashRouter' && calleeName !== 'createMemoryRouter') continue

      const args = callExpr.getArguments()
      if (args.length === 0) continue

      let routesArrayNode: import('ts-morph').Node | undefined
      const firstArg = args[0]!
      if (firstArg.isKind(SyntaxKind.ArrayLiteralExpression)) {
        routesArrayNode = firstArg
      } else if (firstArg.isKind(SyntaxKind.Identifier)) {
        const varDecls = sourceFile.getVariableDeclarations()
        const varDecl = varDecls.find(v => v.getName() === firstArg.getText())
        routesArrayNode = varDecl?.getInitializer()
      }

      if (routesArrayNode === undefined) continue

      const routeEntries = extractRoutesFromArray(routesArrayNode)
      const enrichedFlat = flattenRoutesEnriched(routeEntries)

      for (const flat of enrichedFlat) {
        const { urlPath, dynamicSegmentType, elementComponent } = flat
        const provenance: Provenance = {
          file: relPath,
          line: callExpr.getStartLineNumber(),
          adapter: 'react-router@0.1',
          analyzerVersion,
        }

        const routeNode = createRouteNode({
          id: makeNodeId('route', relPath, urlPath),
          path: urlPath,
          filePath: relPath,
          routeFileKind: 'page',
          dynamicSegmentType,
          isGroupRoute: false,
          renderingMode: 'CSR',
          provenance,
          confidence: 'verified',
        })
        routeNodes.push(routeNode)

        if (elementComponent !== undefined) {
          const moduleSpec = importMap.get(elementComponent)
          if (moduleSpec !== undefined && moduleSpec.startsWith('.')) {
            const absBase = path.resolve(routerDir, moduleSpec)
            let compAbsPath: string | undefined
            for (const ext of ['.tsx', '.ts', '.jsx', '.js']) {
              try {
                await fs.access(absBase + ext)
                compAbsPath = absBase + ext
                break
              } catch { /* try next extension */ }
            }
            if (compAbsPath !== undefined) {
              const compRelPath = path.relative(repoRoot, compAbsPath).replace(/\\/g, '/')
              let compNodeId = seenCompFiles.get(compRelPath)
              if (compNodeId === undefined) {
                const compNode = createComponentNode({
                  id: makeNodeId('component', compRelPath, elementComponent),
                  name: elementComponent,
                  filePath: compRelPath,
                  runtime: 'client',
                  provenance: { file: relPath, line: callExpr.getStartLineNumber(), adapter: 'react-router@0.1', analyzerVersion },
                  confidence: 'verified',
                })
                componentNodes.push(compNode)
                seenCompFiles.set(compRelPath, compNode.id)
                compNodeId = compNode.id
              }
              rendersEdges.push(createEdge({
                id: makeEdgeId('renders', routeNode.id, compNodeId),
                from: routeNode.id,
                to: compNodeId,
                kind: 'renders',
                provenance: { file: relPath, line: callExpr.getStartLineNumber(), adapter: 'react-router@0.1', analyzerVersion },
                confidence: 'verified',
              }))
            }
          }
        }
      }
    }
  }

  return { routeNodes, componentNodes, rendersEdges }
}

export async function parseReactRoutes(
  repoRoot: string,
  analyzerVersion: string,
): Promise<RouteNode[]> {
  const allFiles = await findTsxFiles(repoRoot)
  if (allFiles.length === 0) return []

  const routerFiles: string[] = []
  for (const f of allFiles) {
    const content = await fs.readFile(f, 'utf-8').catch(() => '')
    if (content.includes('createBrowserRouter') || content.includes('createHashRouter') || content.includes('createMemoryRouter')) {
      routerFiles.push(f)
    }
  }
  if (routerFiles.length === 0) return []

  const project = new Project({
    compilerOptions: { target: 99, allowJs: true, strict: false, jsx: 4 },
    skipAddingFilesFromTsConfig: true,
  })
  for (const f of routerFiles) project.addSourceFileAtPath(f)

  const routes: RouteNode[] = []

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath()
    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')

    for (const callExpr of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const calleeName = callExpr.getExpression().getText()
      if (calleeName !== 'createBrowserRouter' && calleeName !== 'createHashRouter' && calleeName !== 'createMemoryRouter') continue

      const args = callExpr.getArguments()
      if (args.length === 0) continue

      let routesArrayNode: import('ts-morph').Node | undefined
      const firstArg = args[0]!
      if (firstArg.isKind(SyntaxKind.ArrayLiteralExpression)) {
        routesArrayNode = firstArg
      } else if (firstArg.isKind(SyntaxKind.Identifier)) {
        const varDecls = sourceFile.getVariableDeclarations()
        const varDecl = varDecls.find(v => v.getName() === firstArg.getText())
        routesArrayNode = varDecl?.getInitializer()
      }

      if (routesArrayNode === undefined) continue

      const routeEntries = extractRoutesFromArray(routesArrayNode)
      const flatPaths = flattenRoutes(routeEntries)

      for (const rawPath of flatPaths) {
        const { urlPath, dynamicSegmentType } = normalizePath(rawPath)
        const provenance: Provenance = {
          file: relPath,
          line: callExpr.getStartLineNumber(),
          adapter: 'react-router@0.1',
          analyzerVersion,
        }

        routes.push(
          createRouteNode({
            id: makeNodeId('route', relPath, urlPath),
            path: urlPath,
            filePath: relPath,
            routeFileKind: 'page',
            dynamicSegmentType,
            isGroupRoute: false,
            renderingMode: 'CSR',
            provenance,
            confidence: 'verified',
          }),
        )
      }
    }
  }

  return routes
}
