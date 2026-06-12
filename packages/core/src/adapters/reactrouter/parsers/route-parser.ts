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
import { buildImportMap } from '../../_shared/ts-morph-utils.js'
import { walkDir, REACTROUTER_EXCLUDE_DIRS } from '../../_shared/file-finder.js'
import { loadTsConfigPaths, resolveModuleSpecWithPaths, type PathsMap } from '../../_shared/ts-config-loader.js'
import { resolveComponentToAbsBase, type ResolveContext } from '../../_shared/component-resolver.js'

const TSX_EXTENSIONS = new Set(['.tsx', '.ts', '.jsx', '.js'])

async function findTsxFiles(repoRoot: string): Promise<string[]> {
  return walkDir(repoRoot, {
    extensions: TSX_EXTENSIONS,
    excludeDirs: REACTROUTER_EXCLUDE_DIRS,
    nameFilter: n => !n.endsWith('.d.ts') && !n.endsWith('.test.ts') && !n.endsWith('.test.tsx'),
  })
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
  // v1.2.49: spread(`...routes`)로 외부 파일 배열에서 inline된 entry는 그 파일 경로를 보존.
  // 컴포넌트 resolve 시 현재 sourceFile이 아닌 이 파일의 importMap을 사용해야 정확하다.
  sourceFilePath?: string
}

interface FlatRouteItem {
  urlPath: string
  dynamicSegmentType: DynamicSegmentType
  elementComponent?: string
  lazyModuleSpec?: string
  sourceFilePath?: string
}

// v1.2.44 A0-4 (F-Route-3): callback `<paramName.propName/>` 패턴에서 추출한 propName을
// entries 키로 사용하여 동적으로 elementComponent를 매핑한다.
// extraComponentKey === 'component'면 A0-3 분기와 중복되지만 결과는 idempotent.
function extractRoutesFromArray(arrayNode: import('ts-morph').Node, extraComponentKey?: string, spreadCtx?: ResolverCtx): RouteEntry[] {
  const entries: RouteEntry[] = []
  if (!arrayNode.isKind(SyntaxKind.ArrayLiteralExpression)) return entries

  for (const el of arrayNode.asKindOrThrow(SyntaxKind.ArrayLiteralExpression).getElements()) {
    // v1.2.49 (결함③): `...routes` spread를 침묵 skip하지 않고 inline.
    // spreadCtx 없으면 하위호환으로 기존처럼 skip.
    if (el.isKind(SyntaxKind.SpreadElement)) {
      if (spreadCtx === undefined) continue
      const spreadExpr = el.asKindOrThrow(SyntaxKind.SpreadElement).getExpression()
      if (!spreadExpr.isKind(SyntaxKind.Identifier)) continue
      const idName = spreadExpr.getText()
      // (a) 배열 리터럴 spread (same-file const 또는 import 1-hop)
      const resolvedArr = resolveArrayLiteralFromIdentifier(idName, spreadCtx)
      if (resolvedArr !== undefined) {
        const childCtx = resolvedArr.external
          ? buildResolverCtxForFile(resolvedArr.sourceFile, spreadCtx)
          : spreadCtx
        const spreadTag = resolvedArr.sourceFile.getFilePath()
        for (const se of extractRoutesFromArray(resolvedArr.arrayNode, extraComponentKey, childCtx)) {
          if (se.sourceFilePath === undefined) se.sourceFilePath = spreadTag
          entries.push(se)
        }
        continue
      }
      // (b) Object.entries(obj).map() spread → 객체 키를 path로 추출 (component는 동적 → 생략)
      const objEntries = resolveObjectEntriesMapEntries(idName, spreadCtx)
      if (objEntries !== undefined) for (const oe of objEntries) entries.push(oe)
      continue
    }
    if (!el.isKind(SyntaxKind.ObjectLiteralExpression)) continue
    const obj = el.asKindOrThrow(SyntaxKind.ObjectLiteralExpression)

    const pathProp = obj.getProperty('path')
    if (!pathProp?.isKind(SyntaxKind.PropertyAssignment)) continue
    const pathInit = pathProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
    if (pathInit === undefined) continue
    // v1.2.50 (RR-1): path가 StringLiteral이 아니어도 정적 평가.
    //   `${ORD_PROD_PLAN}/spec`(import 상수 치환 template) / bare const Identifier 지원.
    //   평가 불가(동적 표현식)면 종전처럼 skip (Evidence-First).
    const routePath = evalPathExpression(pathInit, obj.getSourceFile(), spreadCtx)
    if (routePath === undefined) continue

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

    // v1.2.44 A0-3 (F-Route-2): lowercase `component: PageComponent` Identifier 인식
    // React Router 공식 키(element/Component/lazy)는 아니지만 사용자 커스텀 컨벤션으로 흔함.
    // 첫 글자 대문자 가드로 일반 string/숫자/객체 prop 오인식 차단.
    if (entry.elementComponent === undefined) {
      const componentLowerProp = obj.getProperty('component')
      if (componentLowerProp?.isKind(SyntaxKind.PropertyAssignment)) {
        const init = componentLowerProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
        if (init?.isKind(SyntaxKind.Identifier)) {
          const name = init.getText()
          if (name[0] !== undefined && name[0] !== name[0].toLowerCase()) {
            entry.elementComponent = name
          }
        }
      }
    }

    // v1.2.44 A0-4 (F-Route-3): callback이 알려준 임의 propName으로 추가 lookup
    if (entry.elementComponent === undefined && extraComponentKey !== undefined && extraComponentKey !== 'component' && extraComponentKey !== 'Component' && extraComponentKey !== 'lazy' && extraComponentKey !== 'element') {
      const extraProp = obj.getProperty(extraComponentKey)
      if (extraProp?.isKind(SyntaxKind.PropertyAssignment)) {
        const init = extraProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
        if (init?.isKind(SyntaxKind.Identifier)) {
          const name = init.getText()
          if (name[0] !== undefined && name[0] !== name[0].toLowerCase()) {
            entry.elementComponent = name
          }
        }
      }
    }

    const childrenProp = obj.getProperty('children')
    if (childrenProp?.isKind(SyntaxKind.PropertyAssignment)) {
      const childInit = childrenProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
      if (childInit !== undefined) entry.children = extractRoutesFromArray(childInit, extraComponentKey, spreadCtx)
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
    if (entry.sourceFilePath !== undefined) item.sourceFilePath = entry.sourceFilePath
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
  // v1.2.44 A0-2: 외부 import 1-hop 추적 시 elementComponent가 외부 sourceFile에서 import된 경우,
  // 그 sourceFile의 importMap에서 resolve된 abs base(확장자 미포함) 경로.
  // parseReactRouterFull JSX 분기는 이 필드가 있으면 현재 sourceFile importMap 대신 이것을 우선 사용한다.
  elementComponentAbsBase?: string
  line: number
  inferenceChain?: string[]
}

// v1.1.6 T1: JsxExpression child를 resolve하기 위한 컨텍스트. 1-hop 추적용.
// v1.2.47: paths(tsconfig) + repoRoot 주입 — alias(@/...) 인식
interface ResolverCtx {
  sourceFile: import('ts-morph').SourceFile
  project: import('ts-morph').Project
  importMap: Map<string, string>
  routerDir: string
  paths: PathsMap
  repoRoot: string
  unresolved: string[]
}

// v1.1.6 T1: JsxExpression {identifier} → 1-hop으로 식별자가 가리키는 JSX 자식들을 수집.
// .map() 콜백 JSX의 <Route path={...}> 속성에서 정적 prefix 추출.
// 지원: BinaryExpression('prefix' + id) / TemplateLiteral(`prefix${id}`).
// 추출 실패 시 '' 반환.
// v1.2.44 A0-4 (F-Route-3): map callback의 element={<paramName.propName />} 패턴에서 propName 추출.
// v1.2.47 ST7: callback 첫 파라미터 이름을 추출하고, callback 전체 JSX descend로
// `<paramName.X />` 형태의 PropertyAccessExpression 태그만 매칭한다.
// 이전 구현은 element JsxAttribute의 outer tag만 검사 → `<React.Suspense>` wrapper에서
// outer가 PropertyAccessExpression(left='React')이라 `Suspense` 잘못 반환. lowercase 'component'
// fallback이 가려주었지만 다른 컨벤션 사용자 프로젝트에선 곧장 누락으로 전파.
function extractMapElementPropName(callback: import('ts-morph').Node): string | undefined {
  let paramName: string | undefined
  if (callback.isKind(SyntaxKind.ArrowFunction)) {
    paramName = callback.asKindOrThrow(SyntaxKind.ArrowFunction).getParameters()[0]?.getName()
  } else if (callback.isKind(SyntaxKind.FunctionExpression)) {
    paramName = callback.asKindOrThrow(SyntaxKind.FunctionExpression).getParameters()[0]?.getName()
  }
  if (paramName === undefined) return undefined

  const tagNodes: import('ts-morph').Node[] = []
  for (const el of callback.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)) {
    tagNodes.push(el.getTagNameNode())
  }
  for (const el of callback.getDescendantsOfKind(SyntaxKind.JsxOpeningElement)) {
    tagNodes.push(el.getTagNameNode())
  }
  for (const tagNode of tagNodes) {
    if (!tagNode.isKind(SyntaxKind.PropertyAccessExpression)) continue
    const pae = tagNode.asKindOrThrow(SyntaxKind.PropertyAccessExpression)
    const left = pae.getExpression()
    if (left.isKind(SyntaxKind.Identifier) && left.getText() === paramName) {
      return pae.getName()
    }
  }
  return undefined
}

function extractMapPathPrefix(callback: import('ts-morph').Node): string {
  const jsxAttrs = callback.getDescendantsOfKind(SyntaxKind.JsxAttribute)
    .filter(a => a.getNameNode().getText() === 'path')
  for (const attr of jsxAttrs) {
    const attrInit = attr.getInitializer()
    if (!attrInit?.isKind(SyntaxKind.JsxExpression)) continue
    const expr = attrInit.asKindOrThrow(SyntaxKind.JsxExpression).getExpression()
    if (expr === undefined) continue
    if (expr.isKind(SyntaxKind.BinaryExpression)) {
      const left = expr.asKindOrThrow(SyntaxKind.BinaryExpression).getLeft()
      if (left.isKind(SyntaxKind.StringLiteral)) {
        return left.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue()
      }
    }
    if (expr.isKind(SyntaxKind.TemplateExpression)) {
      // TemplateHead getText() → "`prefix${" 형태. 앞 ` 와 뒤 ${ 제거하여 literal prefix 추출.
      const raw = expr.asKindOrThrow(SyntaxKind.TemplateExpression).getHead().getText()
      if (raw.startsWith('`') && raw.endsWith('${')) return raw.slice(1, raw.length - 2)
    }
  }
  return ''
}

// v1.2.44 A0-2 (F-Route-1): 식별자를 ArrayLiteralExpression으로 resolve.
// 1) 동일 파일 const 변수 우선 (회귀 가드)
// 2) fallback: import 1-hop으로 외부 모듈의 export const X = [...] 탐색
// 반환: 발견된 ArrayLiteralExpression + 그 정의가 위치한 sourceFile(elementComponent import lookup용).
interface ArrayLiteralResolveResult {
  arrayNode: import('ts-morph').Node
  external: boolean
  sourceFile: import('ts-morph').SourceFile
}
function resolveArrayLiteralFromIdentifier(
  identifierName: string,
  ctx: ResolverCtx,
): ArrayLiteralResolveResult | undefined {
  const sameFileVar = ctx.sourceFile.getVariableDeclarations().find(v => v.getName() === identifierName)
  const sameFileInit = sameFileVar?.getInitializer()
  if (sameFileInit !== undefined && sameFileInit.isKind(SyntaxKind.ArrayLiteralExpression)) {
    return { arrayNode: sameFileInit, external: false, sourceFile: ctx.sourceFile }
  }
  const moduleSpec = ctx.importMap.get(identifierName)
  if (moduleSpec === undefined) return undefined
  // v1.2.47: relative + tsconfig paths alias 둘 다 지원 (이전엔 relative만)
  const absBase = resolveModuleSpecWithPaths(moduleSpec, ctx.routerDir, ctx.paths)
  if (absBase === undefined) return undefined
  let importedSf: import('ts-morph').SourceFile | undefined
  for (const ext of ['.tsx', '.ts', '.jsx', '.js']) {
    const candidate = absBase + ext
    importedSf = ctx.project.getSourceFile(candidate)
    if (importedSf === undefined) {
      try { importedSf = ctx.project.addSourceFileAtPath(candidate) } catch { continue }
    }
    if (importedSf !== undefined) break
  }
  if (importedSf === undefined) return undefined
  for (const exportedDecl of importedSf.getVariableDeclarations()) {
    if (exportedDecl.getName() !== identifierName) continue
    if (!exportedDecl.isExported()) continue
    const initRaw = exportedDecl.getInitializer()
    if (initRaw !== undefined && initRaw.isKind(SyntaxKind.ArrayLiteralExpression)) {
      return { arrayNode: initRaw, external: true, sourceFile: importedSf }
    }
  }
  return undefined
}

// v1.2.49: 외부 파일(spread 대상)의 배열을 재귀 처리할 때 그 파일 기준 ResolverCtx를 구성.
function buildResolverCtxForFile(sf: import('ts-morph').SourceFile, base: ResolverCtx): ResolverCtx {
  return {
    sourceFile: sf,
    project: base.project,
    importMap: buildImportMap(sf),
    routerDir: path.dirname(sf.getFilePath()),
    paths: base.paths,
    repoRoot: base.repoRoot,
    unresolved: base.unresolved,
  }
}

// v1.2.49: 식별자의 initializer(같은 파일 const 또는 export import 1-hop)와 정의 파일을 반환.
function locateVarInitializer(
  idName: string,
  ctx: ResolverCtx,
): { init: import('ts-morph').Node; sourceFile: import('ts-morph').SourceFile } | undefined {
  const sameFileVar = ctx.sourceFile.getVariableDeclarations().find(v => v.getName() === idName)
  const sameInit = sameFileVar?.getInitializer()
  if (sameInit !== undefined) return { init: sameInit, sourceFile: ctx.sourceFile }
  const moduleSpec = ctx.importMap.get(idName)
  if (moduleSpec === undefined) return undefined
  const absBase = resolveModuleSpecWithPaths(moduleSpec, ctx.routerDir, ctx.paths)
  if (absBase === undefined) return undefined
  for (const ext of ['.tsx', '.ts', '.jsx', '.js']) {
    const candidate = absBase + ext
    let sf = ctx.project.getSourceFile(candidate)
    if (sf === undefined) {
      try { sf = ctx.project.addSourceFileAtPath(candidate) } catch { continue }
    }
    if (sf === undefined) continue
    const v = sf.getVariableDeclarations().find(d => d.getName() === idName && d.isExported())
    const init = v?.getInitializer()
    if (init !== undefined) return { init, sourceFile: sf }
  }
  return undefined
}

function resolveObjectLiteralFromIdentifier(
  idName: string,
  sf: import('ts-morph').SourceFile,
): import('ts-morph').ObjectLiteralExpression | undefined {
  const v = sf.getVariableDeclarations().find(d => d.getName() === idName)
  const init = v?.getInitializer()
  if (init !== undefined && init.isKind(SyntaxKind.ObjectLiteralExpression)) {
    return init.asKindOrThrow(SyntaxKind.ObjectLiteralExpression)
  }
  return undefined
}

// const 문자열(StringLiteral·NoSubstitutionTemplate)을 정적 평가.
// 같은 파일 우선, 실패 시 ctx가 있으면 import 1-hop(cross-file)으로 export const를 추적 (v1.2.50).
function evalStringConst(
  idName: string,
  sf: import('ts-morph').SourceFile,
  ctx?: ResolverCtx,
): string | undefined {
  const readLiteral = (init: import('ts-morph').Node | undefined): string | undefined => {
    if (init?.isKind(SyntaxKind.StringLiteral)) return init.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue()
    if (init?.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
      return init.asKindOrThrow(SyntaxKind.NoSubstitutionTemplateLiteral).getLiteralValue()
    }
    return undefined
  }
  const sameFile = readLiteral(sf.getVariableDeclarations().find(d => d.getName() === idName)?.getInitializer())
  if (sameFile !== undefined) return sameFile
  if (ctx === undefined) return undefined
  // cross-file 1-hop — sf가 ctx.sourceFile과 다르면 그 파일 기준 ctx로 importMap 재구성.
  const lookupCtx = sf === ctx.sourceFile ? ctx : buildResolverCtxForFile(sf, ctx)
  return readLiteral(locateVarInitializer(idName, lookupCtx)?.init)
}

// template token 텍스트(`...${ / }...${ / }...`)에서 delimiter 제거.
function stripTemplateToken(raw: string): string {
  let s = raw
  if (s.startsWith('`') || s.startsWith('}')) s = s.slice(1)
  if (s.endsWith('${')) s = s.slice(0, -2)
  else if (s.endsWith('`')) s = s.slice(0, -1)
  return s
}

// 계산된 객체 키 표현식을 정적 평가. StringLiteral / NoSubstitutionTemplate / TemplateExpression(const 치환) 지원.
// v1.2.50: ctx 전달 시 template span의 식별자를 cross-file import 1-hop으로도 평가.
function evalKeyExpression(
  expr: import('ts-morph').Node,
  sf: import('ts-morph').SourceFile,
  ctx?: ResolverCtx,
): string | undefined {
  if (expr.isKind(SyntaxKind.StringLiteral)) return expr.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue()
  if (expr.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
    return expr.asKindOrThrow(SyntaxKind.NoSubstitutionTemplateLiteral).getLiteralValue()
  }
  if (expr.isKind(SyntaxKind.TemplateExpression)) {
    const te = expr.asKindOrThrow(SyntaxKind.TemplateExpression)
    let out = stripTemplateToken(te.getHead().getText())
    for (const span of te.getTemplateSpans()) {
      const spanExpr = span.getExpression()
      const sub = spanExpr.isKind(SyntaxKind.Identifier) ? evalStringConst(spanExpr.getText(), sf, ctx) : undefined
      if (sub === undefined) return undefined
      out += sub
      out += stripTemplateToken(span.getLiteral().getText())
    }
    return out
  }
  return undefined
}

// 라우트 path 표현식 정적 평가 (v1.2.50 RR-1). evalKeyExpression + bare const Identifier.
function evalPathExpression(
  expr: import('ts-morph').Node,
  sf: import('ts-morph').SourceFile,
  ctx?: ResolverCtx,
): string | undefined {
  if (expr.isKind(SyntaxKind.Identifier)) return evalStringConst(expr.getText(), sf, ctx)
  return evalKeyExpression(expr, sf, ctx)
}

// v1.2.49 (결함③b): `Object.entries(obj).map((...) => ({path, component}))` 패턴에서
// obj의 정적 키를 라우트 path로 추출. component는 콜백이 동적 매핑(def.component)하므로 생략(Evidence-First).
function resolveObjectEntriesMapEntries(idName: string, ctx: ResolverCtx): RouteEntry[] | undefined {
  const located = locateVarInitializer(idName, ctx)
  if (located === undefined) return undefined
  const { init, sourceFile: sf } = located
  if (!init.isKind(SyntaxKind.CallExpression)) return undefined
  const mapCallee = init.asKindOrThrow(SyntaxKind.CallExpression).getExpression()
  if (!mapCallee.isKind(SyntaxKind.PropertyAccessExpression)) return undefined
  const pae = mapCallee.asKindOrThrow(SyntaxKind.PropertyAccessExpression)
  if (pae.getName() !== 'map') return undefined
  const entriesCall = pae.getExpression()
  if (!entriesCall.isKind(SyntaxKind.CallExpression)) return undefined
  const ec = entriesCall.asKindOrThrow(SyntaxKind.CallExpression)
  if (ec.getExpression().getText() !== 'Object.entries') return undefined
  const objArg = ec.getArguments()[0]
  if (objArg === undefined || !objArg.isKind(SyntaxKind.Identifier)) return undefined
  const objLit = resolveObjectLiteralFromIdentifier(objArg.getText(), sf)
  if (objLit === undefined) return undefined

  const entries: RouteEntry[] = []
  for (const prop of objLit.getProperties()) {
    if (!prop.isKind(SyntaxKind.PropertyAssignment)) continue
    const nameNode = prop.asKindOrThrow(SyntaxKind.PropertyAssignment).getNameNode()
    let key: string | undefined
    if (nameNode.isKind(SyntaxKind.ComputedPropertyName)) {
      key = evalKeyExpression(nameNode.asKindOrThrow(SyntaxKind.ComputedPropertyName).getExpression(), sf)
    } else if (nameNode.isKind(SyntaxKind.StringLiteral)) {
      key = nameNode.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue()
    } else if (nameNode.isKind(SyntaxKind.Identifier)) {
      key = nameNode.getText()
    }
    if (key === undefined || key === '') continue
    entries.push({ path: key })
  }
  return entries.length > 0 ? entries : undefined
}

// v1.2.47: component-resolver로 위임. tsconfig paths alias + named import alias rename(as) + barrel + lazy 일괄 처리.
// 호출자는 ResolverCtx에서 paths/project/repoRoot를 전달해야 한다.
function resolveElementComponentAbsBase(
  componentName: string,
  sf: import('ts-morph').SourceFile,
  ctx: ResolveContext,
): string | undefined {
  return resolveComponentToAbsBase(componentName, sf, ctx)?.absBase
}

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
      // v1.2.44 A0-2 (F-Route-1): 동일 파일 const 실패 시 import 1-hop fallback
      if (init.isKind(SyntaxKind.CallExpression)) {
        const call = init.asKindOrThrow(SyntaxKind.CallExpression)
        const callee = call.getExpression()
        if (callee.isKind(SyntaxKind.PropertyAccessExpression)) {
          const propAccess = callee.asKindOrThrow(SyntaxKind.PropertyAccessExpression)
          if (propAccess.getName() === 'map') {
            const target = propAccess.getExpression()
            if (target.isKind(SyntaxKind.Identifier)) {
              const resolved = resolveArrayLiteralFromIdentifier(target.getText(), ctx)
              if (resolved !== undefined) {
                const callback = call.getArguments()[0]
                const pathPrefix = callback !== undefined ? extractMapPathPrefix(callback) : ''
                const propName = callback !== undefined ? extractMapElementPropName(callback) : undefined
                const entries = extractRoutesFromArray(resolved.arrayNode, propName, buildResolverCtxForFile(resolved.sourceFile, ctx))
                const sourceTag = resolved.external ? ` (외부 모듈 import 1-hop)` : ''
                const resolveCtx: ResolveContext = { project: ctx.project, repoRoot: ctx.repoRoot, paths: ctx.paths }
                return entries.map(e => {
                  const raw: JsxRouteRaw = {
                    routePath: pathPrefix + e.path,
                    elementComponent: e.elementComponent,
                    line: call.getStartLineNumber(),
                    inferenceChain: pathPrefix
                      ? [`${target.getText()}${sourceTag} 배열의 path 프로퍼티를 정적 평가, prefix '${pathPrefix}' 추출`]
                      : [`${target.getText()}${sourceTag} 배열의 path 프로퍼티를 정적 평가`],
                  }
                  if (e.elementComponent !== undefined) {
                    // spread inline된 entry는 정의 파일(e.sourceFilePath) 기준으로 컴포넌트 추적.
                    const compSf = e.sourceFilePath !== undefined
                      ? (ctx.project.getSourceFile(e.sourceFilePath) ?? resolved.sourceFile)
                      : resolved.sourceFile
                    const absBase = resolveElementComponentAbsBase(e.elementComponent, compSf, resolveCtx)
                    if (absBase !== undefined) raw.elementComponentAbsBase = absBase
                  }
                  return raw
                })
              }
            }
          }
        }
      }
    }
  }
  // Case B: named/default import → 1-hop 파일 추가
  const moduleSpec = ctx.importMap.get(identifierName)
  if (moduleSpec === undefined) {
    ctx.unresolved.push(identifierName)
    return []
  }
  // v1.2.47: relative + tsconfig paths alias 둘 다 지원
  const absBase = resolveModuleSpecWithPaths(moduleSpec, ctx.routerDir, ctx.paths)
  if (absBase === undefined) {
    ctx.unresolved.push(identifierName)
    return []
  }
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
  // 외부 파일 ctx — 외부 모듈 내부의 X.map(...) 추적을 위해 importMap을 새로 build
  const importedImportMap = buildImportMap(importedSf)
  const importedCtx: ResolverCtx = {
    sourceFile: importedSf,
    project: ctx.project,
    importMap: importedImportMap,
    routerDir: path.dirname(importedAbsPath),
    paths: ctx.paths,
    repoRoot: ctx.repoRoot,
    unresolved: ctx.unresolved,
  }
  // Case B에서 emit된 JsxRouteRaw에 외부 sf 기준 elementComponentAbsBase를 채우기 위한 helper.
  // advisor 권고: Case B(JsxElement/JsxFragment 직접 export)도 absBase 전파 필요.
  const importedResolveCtx: ResolveContext = { project: ctx.project, repoRoot: ctx.repoRoot, paths: ctx.paths }
  const attachAbsBaseFromImportedSf = (rs: JsxRouteRaw[]): JsxRouteRaw[] => {
    for (const r of rs) {
      if (r.elementComponent === undefined || r.elementComponentAbsBase !== undefined) continue
      const ab = resolveElementComponentAbsBase(r.elementComponent, importedSf, importedResolveCtx)
      if (ab !== undefined) r.elementComponentAbsBase = ab
    }
    return rs
  }
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
      return attachAbsBaseFromImportedSf(
        extractJsxRouteChildren(init.asKindOrThrow(SyntaxKind.JsxFragment).getJsxChildren(), parentPath, importedCtx),
      )
    }
    if (init.isKind(SyntaxKind.JsxElement)) {
      return attachAbsBaseFromImportedSf(
        extractJsxRouteChildren([init as import('ts-morph').JsxChild], parentPath, importedCtx),
      )
    }
    if (init.isKind(SyntaxKind.JsxSelfClosingElement)) {
      return attachAbsBaseFromImportedSf(
        extractJsxRouteChildren([init as import('ts-morph').JsxChild], parentPath, importedCtx),
      )
    }
    if (init.isKind(SyntaxKind.ArrayLiteralExpression)) {
      const jsxChildren = init.asKindOrThrow(SyntaxKind.ArrayLiteralExpression).getElements()
        .filter(el => el.isKind(SyntaxKind.JsxElement) || el.isKind(SyntaxKind.JsxSelfClosingElement)) as import('ts-morph').JsxChild[]
      return attachAbsBaseFromImportedSf(extractJsxRouteChildren(jsxChildren, parentPath, importedCtx))
    }
    // v1.2.44 A0-2 (F-Route-1): 외부 export가 X.map((p) => <Route .../>) 패턴인 경우
    // importedCtx로 swap하여 X(외부 파일 또는 그 다음 hop의 import)를 resolve
    if (init.isKind(SyntaxKind.CallExpression)) {
      const call = init.asKindOrThrow(SyntaxKind.CallExpression)
      const callee = call.getExpression()
      if (callee.isKind(SyntaxKind.PropertyAccessExpression)) {
        const propAccess = callee.asKindOrThrow(SyntaxKind.PropertyAccessExpression)
        if (propAccess.getName() === 'map') {
          const target = propAccess.getExpression()
          if (target.isKind(SyntaxKind.Identifier)) {
            const resolved = resolveArrayLiteralFromIdentifier(target.getText(), importedCtx)
            if (resolved !== undefined) {
              const callback = call.getArguments()[0]
              const pathPrefix = callback !== undefined ? extractMapPathPrefix(callback) : ''
              const propName = callback !== undefined ? extractMapElementPropName(callback) : undefined
              const entries = extractRoutesFromArray(resolved.arrayNode, propName, buildResolverCtxForFile(resolved.sourceFile, importedCtx))
              const sourceTag = resolved.external ? ` (외부 모듈 import 1-hop)` : ` (모듈 ${moduleSpec})`
              return entries.map(e => {
                const raw: JsxRouteRaw = {
                  routePath: pathPrefix + e.path,
                  elementComponent: e.elementComponent,
                  line: call.getStartLineNumber(),
                  inferenceChain: pathPrefix
                    ? [`${target.getText()}${sourceTag} 배열의 path 프로퍼티를 정적 평가, prefix '${pathPrefix}' 추출`]
                    : [`${target.getText()}${sourceTag} 배열의 path 프로퍼티를 정적 평가`],
                }
                if (e.elementComponent !== undefined) {
                  const compSf = e.sourceFilePath !== undefined
                    ? (ctx.project.getSourceFile(e.sourceFilePath) ?? resolved.sourceFile)
                    : resolved.sourceFile
                  const absBase = resolveElementComponentAbsBase(e.elementComponent, compSf, importedResolveCtx)
                  if (absBase !== undefined) raw.elementComponentAbsBase = absBase
                }
                return raw
              })
            }
          }
        }
      }
    }
  }
  // export default <>...</>
  for (const exportAssign of importedSf.getExportAssignments()) {
    const expr = exportAssign.getExpression()
    if (expr.isKind(SyntaxKind.JsxFragment)) {
      return attachAbsBaseFromImportedSf(
        extractJsxRouteChildren(expr.asKindOrThrow(SyntaxKind.JsxFragment).getJsxChildren(), parentPath, importedCtx),
      )
    }
    if (expr.isKind(SyntaxKind.JsxElement)) {
      return attachAbsBaseFromImportedSf(
        extractJsxRouteChildren([expr as import('ts-morph').JsxChild], parentPath, importedCtx),
      )
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
      // pathless layout wrapper (path·index 둘 다 없음): 화면이 아니므로 노드 emit 금지.
      // children만 같은 parentPath로 재귀 — 가짜 '/' 중복 노드 제거 (Less is More).
      if (nested.length > 0) {
        results.push(...extractJsxRouteChildren(nested, parentPath, ctx))
      }
      continue
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

  // v1.2.47: tsconfig paths 1회 로드 (양 분기 공유)
  const tsConfigPaths = await loadTsConfigPaths(repoRoot)

  const routeNodes: RouteNode[] = []
  const componentNodes: ComponentNode[] = []
  const rendersEdges: IREdge[] = []
  const seenCompFiles = new Map<string, NodeId>()
  const seenRouteIds = new Set<string>()

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath()
    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')
    const routerDir = path.dirname(filePath)

    // v1.2.47: createBrowserRouter 분기도 named import 수집(이전엔 default만 수집)
    const importMap = buildImportMap(sourceFile)
    const resolveCtx: ResolveContext = { project, repoRoot, paths: tsConfigPaths }

    for (const callExpr of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const calleeName = callExpr.getExpression().getText()
      if (calleeName !== 'createBrowserRouter' && calleeName !== 'createHashRouter' && calleeName !== 'createMemoryRouter') continue

      const args = callExpr.getArguments()
      if (args.length === 0) continue

      // v1.2.47 ST6: createBrowserRouter 분기 외부 import 1-hop 추가 + JSX 분기와 일관성.
      // 라우트 배열이 외부 sf에 있을 때 그 sf의 elementComponent absBase 추적용으로 originSf 보존.
      let routesArrayNode: import('ts-morph').Node | undefined
      let originSf: import('ts-morph').SourceFile = sourceFile
      const firstArg = args[0]!
      if (firstArg.isKind(SyntaxKind.ArrayLiteralExpression)) {
        routesArrayNode = firstArg
      } else if (firstArg.isKind(SyntaxKind.Identifier)) {
        const idName = firstArg.getText()
        const varDecls = sourceFile.getVariableDeclarations()
        const varDecl = varDecls.find(v => v.getName() === idName)
        const sameFileInit = varDecl?.getInitializer()
        if (sameFileInit !== undefined && sameFileInit.isKind(SyntaxKind.ArrayLiteralExpression)) {
          routesArrayNode = sameFileInit
        } else {
          const spec = importMap.get(idName)
          if (spec !== undefined) {
            const extAbsBase = resolveModuleSpecWithPaths(spec, routerDir, tsConfigPaths)
            if (extAbsBase !== undefined) {
              for (const ext of ['.tsx', '.ts', '.jsx', '.js']) {
                const candidate = extAbsBase + ext
                let extSf = project.getSourceFile(candidate)
                if (extSf === undefined) {
                  try { extSf = project.addSourceFileAtPath(candidate) } catch { continue }
                }
                if (extSf === undefined) continue
                const extVar = extSf.getVariableDeclarations().find(v => v.getName() === idName && v.isExported())
                const extInit = extVar?.getInitializer()
                if (extInit !== undefined && extInit.isKind(SyntaxKind.ArrayLiteralExpression)) {
                  routesArrayNode = extInit
                  originSf = extSf
                  break
                }
              }
            }
          }
        }
      }

      if (routesArrayNode === undefined) continue

      const spreadCtx: ResolverCtx = {
        sourceFile: originSf,
        project,
        importMap: originSf === sourceFile ? importMap : buildImportMap(originSf),
        routerDir: path.dirname(originSf.getFilePath()),
        paths: tsConfigPaths,
        repoRoot,
        unresolved: [],
      }
      const routeEntries = extractRoutesFromArray(routesArrayNode, undefined, spreadCtx)
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
        if (seenRouteIds.has(routeNode.id)) continue
        seenRouteIds.add(routeNode.id)
        routeNodes.push(routeNode)

        if (elementComponent !== undefined) {
          // v1.2.47: component-resolver 위임 — alias + as rename + barrel + lazy 일괄.
          // originSf(외부 라우트 배열 정의 파일 또는 동일 파일)의 import 기준으로 추적.
          // v1.2.49: spread inline된 entry는 정의 파일(flat.sourceFilePath) 기준.
          const compOriginSf = flat.sourceFilePath !== undefined
            ? (project.getSourceFile(flat.sourceFilePath) ?? originSf)
            : originSf
          let absBase: string | undefined
          const compResolved = resolveComponentToAbsBase(elementComponent, compOriginSf, resolveCtx)
          if (compResolved !== undefined) {
            absBase = compResolved.absBase
          } else if (lazyModuleSpec !== undefined) {
            absBase = resolveModuleSpecWithPaths(lazyModuleSpec, path.dirname(compOriginSf.getFilePath()), tsConfigPaths)
          }
          if (absBase !== undefined) {
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
                    // v1.2.47: tsconfig paths alias 인식 (이전엔 relative만)
                    const subBase = resolveModuleSpecWithPaths(spec, path.dirname(compAbsPath), tsConfigPaths)
                    if (subBase === undefined) continue
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
    const fileImportMaps2 = new Map<string, Map<string, string>>()
    for (const sf of jsxProject.getSourceFiles()) {
      fileImportMaps2.set(sf.getFilePath(), buildImportMap(sf))
    }

    const subRouterParentPaths2 = new Map<string, string>()
    const unresolvedExprs: string[] = []
    for (const sf of jsxProject.getSourceFiles()) {
      const routerDir2 = path.dirname(sf.getFilePath())
      const importMap2 = fileImportMaps2.get(sf.getFilePath()) ?? new Map()
      const ctx2: ResolverCtx = { sourceFile: sf, project: jsxProject, importMap: importMap2, routerDir: routerDir2, paths: tsConfigPaths, repoRoot, unresolved: unresolvedExprs }
      for (const jsxEl of sf.getDescendantsOfKind(SyntaxKind.JsxElement)) {
        if (jsxEl.getOpeningElement().getTagNameNode().getText() !== 'Routes') continue
        for (const item of extractJsxRouteChildren(jsxEl.getJsxChildren(), '', ctx2)) {
          if (item.elementComponent === undefined) continue
          const moduleSpec2 = importMap2.get(item.elementComponent)
          if (moduleSpec2 === undefined) continue
          // v1.2.47: tsconfig paths alias 인식
          const absBase2 = resolveModuleSpecWithPaths(moduleSpec2, routerDir2, tsConfigPaths)
          if (absBase2 === undefined) continue
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
      const ctx: ResolverCtx = { sourceFile, project: jsxProject, importMap, routerDir, paths: tsConfigPaths, repoRoot, unresolved: unresolvedExprs }
      const jsxResolveCtx: ResolveContext = { project: jsxProject, repoRoot, paths: tsConfigPaths }

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
          if (seenRouteIds.has(routeNode.id)) continue
          seenRouteIds.add(routeNode.id)
          routeNodes.push(routeNode)

          if (item.elementComponent !== undefined) {
            // v1.2.47: 우선순위 (1) elementComponentAbsBase 미리 resolve된 외부 sf 결과 →
            //          (2) resolveComponentToAbsBase로 현재 sf에서 alias + as rename + barrel + lazy 일괄 추적.
            let absBase: string | undefined
            if (item.elementComponentAbsBase !== undefined) {
              absBase = item.elementComponentAbsBase
            } else {
              const compResolved = resolveComponentToAbsBase(item.elementComponent, sourceFile, jsxResolveCtx)
              if (compResolved !== undefined) absBase = compResolved.absBase
            }
            if (absBase !== undefined) {
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

  // v1.2.47: tsconfig paths 1회 로드
  const tsConfigPaths = await loadTsConfigPaths(repoRoot)

  const routes: RouteNode[] = []
  const seenRouteIds = new Set<string>()

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath()
    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')
    const routerDir = path.dirname(filePath)
    const importMap = buildImportMap(sourceFile)

    for (const callExpr of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const calleeName = callExpr.getExpression().getText()
      if (calleeName !== 'createBrowserRouter' && calleeName !== 'createHashRouter' && calleeName !== 'createMemoryRouter') continue

      const args = callExpr.getArguments()
      if (args.length === 0) continue

      // v1.2.47: 외부 import 1-hop 추가 (createBrowserRouter 분기)
      let routesArrayNode: import('ts-morph').Node | undefined
      let originSf: import('ts-morph').SourceFile = sourceFile
      const firstArg = args[0]!
      if (firstArg.isKind(SyntaxKind.ArrayLiteralExpression)) {
        routesArrayNode = firstArg
      } else if (firstArg.isKind(SyntaxKind.Identifier)) {
        const idName = firstArg.getText()
        const varDecls = sourceFile.getVariableDeclarations()
        const varDecl = varDecls.find(v => v.getName() === idName)
        const sameFileInit = varDecl?.getInitializer()
        if (sameFileInit !== undefined && sameFileInit.isKind(SyntaxKind.ArrayLiteralExpression)) {
          routesArrayNode = sameFileInit
        } else {
          const spec = importMap.get(idName)
          if (spec !== undefined) {
            const extAbsBase = resolveModuleSpecWithPaths(spec, routerDir, tsConfigPaths)
            if (extAbsBase !== undefined) {
              for (const ext of ['.tsx', '.ts', '.jsx', '.js']) {
                const candidate = extAbsBase + ext
                let extSf = project.getSourceFile(candidate)
                if (extSf === undefined) {
                  try { extSf = project.addSourceFileAtPath(candidate) } catch { continue }
                }
                if (extSf === undefined) continue
                const extVar = extSf.getVariableDeclarations().find(v => v.getName() === idName && v.isExported())
                const extInit = extVar?.getInitializer()
                if (extInit !== undefined && extInit.isKind(SyntaxKind.ArrayLiteralExpression)) {
                  routesArrayNode = extInit
                  originSf = extSf
                  break
                }
              }
            }
          }
        }
      }

      if (routesArrayNode === undefined) continue

      const spreadCtx: ResolverCtx = {
        sourceFile: originSf,
        project,
        importMap: originSf === sourceFile ? importMap : buildImportMap(originSf),
        routerDir: path.dirname(originSf.getFilePath()),
        paths: tsConfigPaths,
        repoRoot,
        unresolved: [],
      }
      const routeEntries = extractRoutesFromArray(routesArrayNode, undefined, spreadCtx)
      const flatPaths = flattenRoutes(routeEntries)

      for (const rawPath of flatPaths) {
        const { urlPath, dynamicSegmentType } = normalizePath(rawPath)
        const provenance: Provenance = {
          file: relPath,
          line: callExpr.getStartLineNumber(),
          adapter: 'react-router@0.1',
          analyzerVersion,
        }

        const nodeId = makeNodeId('route', relPath, urlPath)
        if (seenRouteIds.has(nodeId)) continue
        seenRouteIds.add(nodeId)
        routes.push(
          createRouteNode({
            id: nodeId,
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
    const fileImportMaps = new Map<string, Map<string, string>>()
    for (const sf of jsxProject.getSourceFiles()) {
      fileImportMaps.set(sf.getFilePath(), buildImportMap(sf))
    }

    const subRouterParentPaths = new Map<string, string>()
    const unresolvedExprs: string[] = []
    for (const sf of jsxProject.getSourceFiles()) {
      const routerDir = path.dirname(sf.getFilePath())
      const importMap = fileImportMaps.get(sf.getFilePath()) ?? new Map()
      const ctx: ResolverCtx = { sourceFile: sf, project: jsxProject, importMap, routerDir, paths: tsConfigPaths, repoRoot, unresolved: unresolvedExprs }
      for (const jsxEl of sf.getDescendantsOfKind(SyntaxKind.JsxElement)) {
        if (jsxEl.getOpeningElement().getTagNameNode().getText() !== 'Routes') continue
        for (const item of extractJsxRouteChildren(jsxEl.getJsxChildren(), '', ctx)) {
          if (item.elementComponent === undefined) continue
          const moduleSpec = importMap.get(item.elementComponent)
          if (moduleSpec === undefined) continue
          // v1.2.47: tsconfig paths alias 인식
          const absBase = resolveModuleSpecWithPaths(moduleSpec, routerDir, tsConfigPaths)
          if (absBase === undefined) continue
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
      const ctx: ResolverCtx = { sourceFile, project: jsxProject, importMap, routerDir, paths: tsConfigPaths, repoRoot, unresolved: unresolvedExprs }

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
          const nodeId = makeNodeId('route', relPath, urlPath)
          if (seenRouteIds.has(nodeId)) continue
          seenRouteIds.add(nodeId)
          routes.push(
            createRouteNode({
              id: nodeId,
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
