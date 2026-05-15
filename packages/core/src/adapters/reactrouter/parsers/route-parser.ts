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
  lazyModuleSpec?: string
  children?: RouteEntry[]
}

interface FlatRouteItem {
  urlPath: string
  dynamicSegmentType: DynamicSegmentType
  elementComponent?: string
  lazyModuleSpec?: string
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

    // Component: ComponentName (React Router v6.4+ data API)
    if (entry.elementComponent === undefined) {
      const componentProp = obj.getProperty('Component')
      if (componentProp?.isKind(SyntaxKind.PropertyAssignment)) {
        const init = componentProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
        if (init?.isKind(SyntaxKind.Identifier)) {
          const name = init.getText()
          if (name[0] !== undefined && name[0] !== name[0].toLowerCase()) {
            entry.elementComponent = name
          }
        }
      }
    }

    // lazy: () => import('./path') (React Router v6.4+ lazy loading)
    if (entry.elementComponent === undefined) {
      const lazyProp = obj.getProperty('lazy')
      if (lazyProp?.isKind(SyntaxKind.PropertyAssignment)) {
        const init = lazyProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
        if (init !== undefined) {
          const m = init.getText().match(/import\(['"`]([^'"`]+)['"`]\)/)
          if (m !== null) {
            entry.lazyModuleSpec = m[1]!
            entry.elementComponent = path.basename(m[1]!, path.extname(m[1]!))
          }
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
    if (entry.lazyModuleSpec !== undefined) item.lazyModuleSpec = entry.lazyModuleSpec
    result.push(item)
    if (entry.children !== undefined && entry.children.length > 0) {
      result.push(...flattenRoutesEnriched(entry.children, normalized))
    }
  }
  return result
}

// --- JSX <Routes> helpers ---

function getJsxAttrString(
  attrs: import('ts-morph').JsxAttributeLike[],
  attrName: string,
): string | undefined {
  for (const a of attrs) {
    if (!a.isKind(SyntaxKind.JsxAttribute)) continue
    const jxa = a.asKindOrThrow(SyntaxKind.JsxAttribute)
    if (jxa.getNameNode().getText() !== attrName) continue
    const init = jxa.getInitializer()
    if (init?.isKind(SyntaxKind.StringLiteral)) return init.getLiteralValue()
  }
  return undefined
}

function hasJsxAttrFlag(
  attrs: import('ts-morph').JsxAttributeLike[],
  attrName: string,
): boolean {
  return attrs.some(
    a => a.isKind(SyntaxKind.JsxAttribute) && a.asKindOrThrow(SyntaxKind.JsxAttribute).getNameNode().getText() === attrName,
  )
}

function extractJsxElementComponent(
  attrs: import('ts-morph').JsxAttributeLike[],
): string | undefined {
  for (const a of attrs) {
    if (!a.isKind(SyntaxKind.JsxAttribute)) continue
    const jxa = a.asKindOrThrow(SyntaxKind.JsxAttribute)
    if (jxa.getNameNode().getText() !== 'element') continue
    const init = jxa.getInitializer()
    if (!init?.isKind(SyntaxKind.JsxExpression)) continue
    const expr = init.asKindOrThrow(SyntaxKind.JsxExpression).getExpression()
    if (expr?.isKind(SyntaxKind.JsxSelfClosingElement)) {
      const tag = expr.asKindOrThrow(SyntaxKind.JsxSelfClosingElement).getTagNameNode().getText()
      if (tag[0] !== undefined && tag[0] !== tag[0].toLowerCase()) return tag
    } else if (expr?.isKind(SyntaxKind.JsxElement)) {
      const tag = expr.asKindOrThrow(SyntaxKind.JsxElement).getOpeningElement().getTagNameNode().getText()
      if (tag[0] !== undefined && tag[0] !== tag[0].toLowerCase()) return tag
    }
  }
  return undefined
}

interface JsxRouteRaw {
  routePath: string
  elementComponent: string | undefined
  line: number
  inferenceChain?: string[]
}

// v1.1.6 T1: JsxExpression child를 resolve하기 위한 컨텍스트. 1-hop 추적용.
interface ResolverCtx {
  sourceFile: import('ts-morph').SourceFile
  project: import('ts-morph').Project
  importMap: Map<string, string>
  routerDir: string
  unresolved: string[]
}

// v1.1.6 T1: JsxExpression {identifier} → 1-hop으로 식별자가 가리키는 JSX 자식들을 수집.
// Case A: 동일 파일 const 변수 (array literal of JSX 또는 .map() 결과)
// Case B: named/default import → 모듈 파일 추가 후 export default/named의 array literal 또는 fragment
// 재귀 불가 (depth=1 hard limit, Less is More).
function resolveIdentifierToJsxChildren(
  identifierName: string,
  parentPath: string,
  ctx: ResolverCtx,
): JsxRouteRaw[] {
  // Case A: 동일 파일 const 변수
  const varDecls = ctx.sourceFile.getVariableDeclarations()
  const varDecl = varDecls.find(v => v.getName() === identifierName)
  if (varDecl !== undefined) {
    const init = varDecl.getInitializer()
    if (init !== undefined) {
      // A-1: 직접 JSX array literal
      if (init.isKind(SyntaxKind.ArrayLiteralExpression)) {
        const jsxChildren = init.asKindOrThrow(SyntaxKind.ArrayLiteralExpression).getElements()
          .filter(el => el.isKind(SyntaxKind.JsxElement) || el.isKind(SyntaxKind.JsxSelfClosingElement)) as import('ts-morph').JsxChild[]
        return extractJsxRouteChildren(jsxChildren, parentPath, ctx)
      }
      // A-2: .map() call → RouteEntry 배열 → JsxRouteRaw 변환 (inferred)
      if (init.isKind(SyntaxKind.CallExpression)) {
        const call = init.asKindOrThrow(SyntaxKind.CallExpression)
        const callee = call.getExpression()
        if (callee.isKind(SyntaxKind.PropertyAccessExpression)) {
          const propAccess = callee.asKindOrThrow(SyntaxKind.PropertyAccessExpression)
          if (propAccess.getName() === 'map') {
            const target = propAccess.getExpression()
            if (target.isKind(SyntaxKind.Identifier)) {
              const dataVar = varDecls.find(v => v.getName() === target.getText())
              const dataInit = dataVar?.getInitializer()
              if (dataInit !== undefined && dataInit.isKind(SyntaxKind.ArrayLiteralExpression)) {
                const entries = extractRoutesFromArray(dataInit)
                return entries.map(e => ({
                  routePath: e.path,
                  elementComponent: e.elementComponent,
                  line: call.getStartLineNumber(),
                  inferenceChain: [`${target.getText()} 배열의 path 프로퍼티를 정적 평가`],
                }))
              }
            }
          }
        }
      }
    }
  }
  // Case B: named/default import → 1-hop 파일 추가
  const moduleSpec = ctx.importMap.get(identifierName)
  if (moduleSpec === undefined || !moduleSpec.startsWith('.')) {
    ctx.unresolved.push(identifierName)
    return []
  }
  const absBase = path.resolve(ctx.routerDir, moduleSpec)
  let importedAbsPath: string | undefined
  for (const ext of ['.tsx', '.ts', '.jsx', '.js']) {
    const candidate = absBase + ext
    let importedSf = ctx.project.getSourceFile(candidate)
    if (importedSf === undefined) {
      try { importedSf = ctx.project.addSourceFileAtPath(candidate) } catch { continue }
    }
    if (importedSf !== undefined) { importedAbsPath = candidate; break }
  }
  if (importedAbsPath === undefined) {
    ctx.unresolved.push(identifierName)
    return []
  }
  const importedSf = ctx.project.getSourceFile(importedAbsPath)!
  // export const X = <>...</> 또는 export const X = [<Route../>, ...] 패턴 검색.
  // `export const X = ( <>...</> )` 같이 ParenthesizedExpression으로 감싸진 경우도 unwrap.
  const unwrapParen = (n: import('ts-morph').Node): import('ts-morph').Node => {
    let cur = n
    while (cur.isKind(SyntaxKind.ParenthesizedExpression)) {
      const inner = cur.asKindOrThrow(SyntaxKind.ParenthesizedExpression).getExpression()
      if (inner === undefined) break
      cur = inner
    }
    return cur
  }
  for (const exportedDecl of importedSf.getVariableDeclarations()) {
    if (exportedDecl.getName() !== identifierName) continue
    if (!exportedDecl.isExported() && exportedDecl.getName() !== identifierName) continue
    const initRaw = exportedDecl.getInitializer()
    if (initRaw === undefined) continue
    const init = unwrapParen(initRaw)
    if (init.isKind(SyntaxKind.JsxFragment)) {
      return extractJsxRouteChildren(init.asKindOrThrow(SyntaxKind.JsxFragment).getJsxChildren(), parentPath, ctx)
    }
    if (init.isKind(SyntaxKind.JsxElement)) {
      return extractJsxRouteChildren([init as import('ts-morph').JsxChild], parentPath, ctx)
    }
    if (init.isKind(SyntaxKind.JsxSelfClosingElement)) {
      return extractJsxRouteChildren([init as import('ts-morph').JsxChild], parentPath, ctx)
    }
    if (init.isKind(SyntaxKind.ArrayLiteralExpression)) {
      const jsxChildren = init.asKindOrThrow(SyntaxKind.ArrayLiteralExpression).getElements()
        .filter(el => el.isKind(SyntaxKind.JsxElement) || el.isKind(SyntaxKind.JsxSelfClosingElement)) as import('ts-morph').JsxChild[]
      return extractJsxRouteChildren(jsxChildren, parentPath, ctx)
    }
  }
  // export default <>...</>
  for (const exportAssign of importedSf.getExportAssignments()) {
    const expr = exportAssign.getExpression()
    if (expr.isKind(SyntaxKind.JsxFragment)) {
      return extractJsxRouteChildren(expr.asKindOrThrow(SyntaxKind.JsxFragment).getJsxChildren(), parentPath, ctx)
    }
    if (expr.isKind(SyntaxKind.JsxElement)) {
      return extractJsxRouteChildren([expr as import('ts-morph').JsxChild], parentPath, ctx)
    }
  }
  ctx.unresolved.push(identifierName)
  return []
}

function extractJsxRouteChildren(
  children: import('ts-morph').JsxChild[],
  parentPath: string,
  ctx?: ResolverCtx,
): JsxRouteRaw[] {
  const results: JsxRouteRaw[] = []
  for (const child of children) {
    let tagName: string | undefined
    let attrs: import('ts-morph').JsxAttributeLike[] = []
    let nested: import('ts-morph').JsxChild[] = []
    let line = 1

    if (child.isKind(SyntaxKind.JsxElement)) {
      const el = child.asKindOrThrow(SyntaxKind.JsxElement)
      tagName = el.getOpeningElement().getTagNameNode().getText()
      attrs = el.getOpeningElement().getAttributes()
      nested = el.getJsxChildren()
      line = el.getStartLineNumber()
    } else if (child.isKind(SyntaxKind.JsxSelfClosingElement)) {
      const el = child.asKindOrThrow(SyntaxKind.JsxSelfClosingElement)
      tagName = el.getTagNameNode().getText()
      attrs = el.getAttributes()
      line = el.getStartLineNumber()
    } else if (child.isKind(SyntaxKind.JsxExpression) && ctx !== undefined) {
      // v1.1.6 T1: {identifier} 형태 → resolveIdentifierToJsxChildren로 1-hop 추적
      const expr = child.asKindOrThrow(SyntaxKind.JsxExpression).getExpression()
      if (expr !== undefined && expr.isKind(SyntaxKind.Identifier)) {
        results.push(...resolveIdentifierToJsxChildren(expr.getText(), parentPath, ctx))
      }
      continue
    }

    if (tagName !== 'Route') continue

    const isIndex = hasJsxAttrFlag(attrs, 'index')
    const pathAttr = getJsxAttrString(attrs, 'path')
    const elementComponent = extractJsxElementComponent(attrs)

    let routePath: string
    if (isIndex) {
      routePath = parentPath || '/'
    } else if (pathAttr !== undefined && pathAttr !== '') {
      if (pathAttr === '*') {
        routePath = parentPath ? `${parentPath}/*` : '/*'
      } else {
        const seg = pathAttr.startsWith('/') ? pathAttr : `/${pathAttr}`
        routePath = `${parentPath}${seg}`.replace(/\/+/g, '/') || '/'
      }
    } else {
      routePath = parentPath || '/'
    }

    results.push({ routePath, elementComponent, line })

    if (nested.length > 0) {
      results.push(...extractJsxRouteChildren(nested, routePath, ctx))
    }
  }
  return results
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
  const jsxRouterFiles: string[] = []
  for (const f of allFiles) {
    const content = await fs.readFile(f, 'utf-8').catch(() => '')
    if (content.includes('createBrowserRouter') || content.includes('createHashRouter') || content.includes('createMemoryRouter')) {
      routerFiles.push(f)
    } else if (content.includes('<Routes')) {
      jsxRouterFiles.push(f)
    }
  }
  if (routerFiles.length === 0 && jsxRouterFiles.length === 0) return { routeNodes: [], componentNodes: [], rendersEdges: [] }

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
        const { urlPath, dynamicSegmentType, elementComponent, lazyModuleSpec } = flat
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
          const moduleSpec = importMap.get(elementComponent) ?? lazyModuleSpec
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

                // 컴포넌트 파일 내부 import 추적 → sub-component renders 엣지
                let compSf = project.getSourceFile(compAbsPath)
                if (compSf === undefined) {
                  try { compSf = project.addSourceFileAtPath(compAbsPath) } catch { /* skip */ }
                }
                if (compSf !== undefined) {
                  for (const imp of compSf.getImportDeclarations()) {
                    const spec = imp.getModuleSpecifierValue()
                    if (!spec.startsWith('.')) continue
                    const subBase = path.resolve(path.dirname(compAbsPath), spec)
                    let subAbsPath: string | undefined
                    for (const ext of ['.tsx', '.ts', '.jsx', '.js']) {
                      try { await fs.access(subBase + ext); subAbsPath = subBase + ext; break } catch { /* skip */ }
                    }
                    if (subAbsPath === undefined) continue
                    const subRelPath = path.relative(repoRoot, subAbsPath).replace(/\\/g, '/')
                    let subNodeId = seenCompFiles.get(subRelPath)
                    if (subNodeId === undefined) {
                      const subName = path.basename(subAbsPath, path.extname(subAbsPath))
                      const subNode = createComponentNode({
                        id: makeNodeId('component', subRelPath, subName),
                        name: subName,
                        filePath: subRelPath,
                        runtime: 'client',
                        provenance: { file: compRelPath, line: 1, adapter: 'react-router@0.1', analyzerVersion },
                        confidence: 'verified',
                      })
                      componentNodes.push(subNode)
                      seenCompFiles.set(subRelPath, subNode.id)
                      subNodeId = subNode.id
                    }
                    const subEdgeId = makeEdgeId('renders', compNodeId, subNodeId)
                    if (!rendersEdges.some(e => e.id === subEdgeId)) {
                      rendersEdges.push(createEdge({
                        id: subEdgeId,
                        from: compNodeId,
                        to: subNodeId,
                        kind: 'renders',
                        provenance: { file: compRelPath, line: 1, adapter: 'react-router@0.1', analyzerVersion },
                        confidence: 'verified',
                      }))
                    }
                  }
                }
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

  if (jsxRouterFiles.length > 0) {
    const jsxProject = new Project({
      compilerOptions: { target: 99, allowJs: true, strict: false, jsx: 4 },
      skipAddingFilesFromTsConfig: true,
    })
    for (const f of jsxRouterFiles) jsxProject.addSourceFileAtPath(f)

    // Pass 1: build import maps + detect sub-router files (referenced via element prop)
    // v1.1.6 T1: named import도 수집 (이전 버전은 default import만 수집 → {MobileRoutes} 등 누락)
    const fileImportMaps2 = new Map<string, Map<string, string>>()
    for (const sf of jsxProject.getSourceFiles()) {
      const imap = new Map<string, string>()
      for (const decl of sf.getImportDeclarations()) {
        const di = decl.getDefaultImport()
        if (di !== undefined) imap.set(di.getText(), decl.getModuleSpecifierValue())
        for (const ni of decl.getNamedImports()) {
          imap.set(ni.getName(), decl.getModuleSpecifierValue())
        }
      }
      fileImportMaps2.set(sf.getFilePath(), imap)
    }

    const subRouterParentPaths2 = new Map<string, string>()
    const unresolvedExprs: string[] = []
    for (const sf of jsxProject.getSourceFiles()) {
      const routerDir2 = path.dirname(sf.getFilePath())
      const importMap2 = fileImportMaps2.get(sf.getFilePath()) ?? new Map()
      const ctx2: ResolverCtx = { sourceFile: sf, project: jsxProject, importMap: importMap2, routerDir: routerDir2, unresolved: unresolvedExprs }
      for (const jsxEl of sf.getDescendantsOfKind(SyntaxKind.JsxElement)) {
        if (jsxEl.getOpeningElement().getTagNameNode().getText() !== 'Routes') continue
        for (const item of extractJsxRouteChildren(jsxEl.getJsxChildren(), '', ctx2)) {
          if (item.elementComponent === undefined) continue
          const moduleSpec2 = importMap2.get(item.elementComponent)
          if (moduleSpec2 === undefined || !moduleSpec2.startsWith('.')) continue
          const absBase2 = path.resolve(routerDir2, moduleSpec2)
          for (const ext of ['.tsx', '.ts', '.jsx', '.js']) {
            const candidate = absBase2 + ext
            if (jsxProject.getSourceFile(candidate) !== undefined && !subRouterParentPaths2.has(candidate)) {
              subRouterParentPaths2.set(candidate, normalizePath(item.routePath).urlPath)
              break
            }
          }
        }
      }
    }

    // Pass 2: process each file with its correct parentPath
    for (const sourceFile of jsxProject.getSourceFiles()) {
      const filePath = sourceFile.getFilePath()
      const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')
      const routerDir = path.dirname(filePath)
      const parentPath = subRouterParentPaths2.get(filePath) ?? ''
      const importMap = fileImportMaps2.get(filePath) ?? new Map()
      const ctx: ResolverCtx = { sourceFile, project: jsxProject, importMap, routerDir, unresolved: unresolvedExprs }

      for (const jsxEl of sourceFile.getDescendantsOfKind(SyntaxKind.JsxElement)) {
        const tagName = jsxEl.getOpeningElement().getTagNameNode().getText()
        if (tagName !== 'Routes') continue

        const rawItems = extractJsxRouteChildren(jsxEl.getJsxChildren(), parentPath, ctx)
        for (const item of rawItems) {
          const { urlPath, dynamicSegmentType } = normalizePath(item.routePath)
          const provenance: Provenance = {
            file: relPath,
            line: item.line,
            adapter: 'react-router@0.1',
            analyzerVersion,
          }
          const confField = item.inferenceChain !== undefined
            ? { confidence: 'inferred' as const, inferenceChain: item.inferenceChain }
            : { confidence: 'verified' as const }

          const routeNode = createRouteNode({
            id: makeNodeId('route', relPath, urlPath),
            path: urlPath,
            filePath: relPath,
            routeFileKind: 'page',
            dynamicSegmentType,
            isGroupRoute: false,
            renderingMode: 'CSR',
            provenance,
            ...confField,
          })
          routeNodes.push(routeNode)

          if (item.elementComponent !== undefined) {
            const moduleSpec = importMap.get(item.elementComponent)
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
                    id: makeNodeId('component', compRelPath, item.elementComponent),
                    name: item.elementComponent,
                    filePath: compRelPath,
                    runtime: 'client',
                    provenance: { file: relPath, line: item.line, adapter: 'react-router@0.1', analyzerVersion },
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
                  provenance: { file: relPath, line: item.line, adapter: 'react-router@0.1', analyzerVersion },
                  confidence: 'verified',
                }))
              }
            }
          }
        }
      }
    }
    if (unresolvedExprs.length > 0) {
      const unique = Array.from(new Set(unresolvedExprs))
      process.stderr.write(`[react-router] ${unique.length} route references could not be resolved: ${unique.join(', ')}\n`)
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
  const jsxRouterFiles: string[] = []
  for (const f of allFiles) {
    const content = await fs.readFile(f, 'utf-8').catch(() => '')
    if (content.includes('createBrowserRouter') || content.includes('createHashRouter') || content.includes('createMemoryRouter')) {
      routerFiles.push(f)
    } else if (content.includes('<Routes')) {
      jsxRouterFiles.push(f)
    }
  }
  if (routerFiles.length === 0 && jsxRouterFiles.length === 0) return []

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

  if (jsxRouterFiles.length > 0) {
    const jsxProject = new Project({
      compilerOptions: { target: 99, allowJs: true, strict: false, jsx: 4 },
      skipAddingFilesFromTsConfig: true,
    })
    for (const f of jsxRouterFiles) jsxProject.addSourceFileAtPath(f)

    // Pass 1: build import maps + detect sub-router files (referenced via element prop)
    // v1.1.6 T1: named import도 수집
    const fileImportMaps = new Map<string, Map<string, string>>()
    for (const sf of jsxProject.getSourceFiles()) {
      const imap = new Map<string, string>()
      for (const decl of sf.getImportDeclarations()) {
        const di = decl.getDefaultImport()
        if (di !== undefined) imap.set(di.getText(), decl.getModuleSpecifierValue())
        for (const ni of decl.getNamedImports()) {
          imap.set(ni.getName(), decl.getModuleSpecifierValue())
        }
      }
      fileImportMaps.set(sf.getFilePath(), imap)
    }

    const subRouterParentPaths = new Map<string, string>()
    const unresolvedExprs: string[] = []
    for (const sf of jsxProject.getSourceFiles()) {
      const routerDir = path.dirname(sf.getFilePath())
      const importMap = fileImportMaps.get(sf.getFilePath()) ?? new Map()
      const ctx: ResolverCtx = { sourceFile: sf, project: jsxProject, importMap, routerDir, unresolved: unresolvedExprs }
      for (const jsxEl of sf.getDescendantsOfKind(SyntaxKind.JsxElement)) {
        if (jsxEl.getOpeningElement().getTagNameNode().getText() !== 'Routes') continue
        for (const item of extractJsxRouteChildren(jsxEl.getJsxChildren(), '', ctx)) {
          if (item.elementComponent === undefined) continue
          const moduleSpec = importMap.get(item.elementComponent)
          if (moduleSpec === undefined || !moduleSpec.startsWith('.')) continue
          const absBase = path.resolve(routerDir, moduleSpec)
          for (const ext of ['.tsx', '.ts', '.jsx', '.js']) {
            const candidate = absBase + ext
            if (jsxProject.getSourceFile(candidate) !== undefined && !subRouterParentPaths.has(candidate)) {
              subRouterParentPaths.set(candidate, normalizePath(item.routePath).urlPath)
              break
            }
          }
        }
      }
    }

    // Pass 2: process each file with its correct parentPath
    for (const sourceFile of jsxProject.getSourceFiles()) {
      const filePath = sourceFile.getFilePath()
      const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')
      const parentPath = subRouterParentPaths.get(filePath) ?? ''
      const importMap = fileImportMaps.get(filePath) ?? new Map()
      const routerDir = path.dirname(filePath)
      const ctx: ResolverCtx = { sourceFile, project: jsxProject, importMap, routerDir, unresolved: unresolvedExprs }

      for (const jsxEl of sourceFile.getDescendantsOfKind(SyntaxKind.JsxElement)) {
        const tagName = jsxEl.getOpeningElement().getTagNameNode().getText()
        if (tagName !== 'Routes') continue

        const rawItems = extractJsxRouteChildren(jsxEl.getJsxChildren(), parentPath, ctx)
        for (const item of rawItems) {
          const { urlPath, dynamicSegmentType } = normalizePath(item.routePath)
          const provenance: Provenance = {
            file: relPath,
            line: item.line,
            adapter: 'react-router@0.1',
            analyzerVersion,
          }
          const confField = item.inferenceChain !== undefined
            ? { confidence: 'inferred' as const, inferenceChain: item.inferenceChain }
            : { confidence: 'verified' as const }
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
              ...confField,
            }),
          )
        }
      }
    }
    if (unresolvedExprs.length > 0) {
      const unique = Array.from(new Set(unresolvedExprs))
      process.stderr.write(`[react-router] ${unique.length} route references could not be resolved: ${unique.join(', ')}\n`)
    }
  }

  return routes
}
