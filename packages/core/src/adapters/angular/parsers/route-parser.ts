import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Project, SyntaxKind } from 'ts-morph'
import {
  createRouteNode,
  makeNodeId,
  type RouteNode,
  type DynamicSegmentType,
  type Provenance,
} from '@codebase-viz/types'
import { buildImportMap } from '../../_shared/ts-morph-utils.js'
import { walkDir, ANGULAR_EXCLUDE_DIRS } from '../../_shared/file-finder.js'

async function findTsFiles(repoRoot: string): Promise<string[]> {
  return walkDir(repoRoot, {
    excludeDirs: ANGULAR_EXCLUDE_DIRS,
    nameFilter: n => n.endsWith('.ts')
      && !n.endsWith('.d.ts')
      && !n.endsWith('.test.ts')
      && !n.endsWith('.spec.ts'),
  })
}

function extractLoadComponentClass(
  prop: import('ts-morph').PropertyAssignment,
): string | undefined {
  const init = prop.getInitializer()
  if (init === undefined) return undefined

  for (const call of init.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression()
    if (!expr.isKind(SyntaxKind.PropertyAccessExpression)) continue
    const propAccess = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression)
    if (propAccess.getName() !== 'then') continue

    const thenArgs = call.getArguments()
    if (thenArgs.length === 0) continue
    const thenArg = thenArgs[0]!
    if (!thenArg.isKind(SyntaxKind.ArrowFunction)) continue
    const body = thenArg.asKindOrThrow(SyntaxKind.ArrowFunction).getBody()
    if (!body.isKind(SyntaxKind.PropertyAccessExpression)) continue
    return body.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName()
  }
  return undefined
}

// v1.2.44 A1-2: loadComponent의 import 모듈 spec ('./foo')만 추출 (className 별개).
// filePath resolve에 사용.
function extractLoadComponentModuleSpec(
  prop: import('ts-morph').PropertyAssignment,
): string | undefined {
  const init = prop.getInitializer()
  if (init === undefined) return undefined
  const text = init.getText()
  const m = text.match(/import\(['"`]([^'"`]+)['"`]\)/)
  return m !== null ? m[1] : undefined
}

type TsNode = import('ts-morph').Node
type TsSourceFile = import('ts-morph').SourceFile

// v1.2.44 A1-2: 각 경로의 컴포넌트 spec(모듈 상대 경로 or Identifier 이름).
// parseAngularRoutes는 이 spec으로 routeFilePath를 컴포넌트 파일로 치환한다.
interface ComponentSpecEntry {
  spec: string  // 모듈 상대 경로(예 './foo') 또는 Identifier name(예 'FooComponent')
  isIdentifier: boolean  // true=Identifier sync import, false=dynamic import path
  resolveFromDir: string  // spec을 resolve할 디렉토리 = 라우트 객체가 선언된 파일의 디렉토리
}

// v1.2.69: 라우트 하나 = 엔트리 하나. 예전엔 fullPath를 키로 하는 Map에 spec을 모았는데, 같은 path
// (`''` + named outlet, lazy 부모와 그 `''` 자식)가 서로를 덮어써 컴포넌트가 사라지고 같은 NodeId가 둘
// 생겼다. 엔트리는 자신이 선언된 파일을 들고 다녀 lazy 하위 라우트도 그 파일 기준으로 해석된다.
interface RouteEntry {
  fullPath: string
  outlet: string | undefined
  componentSpec: ComponentSpecEntry | undefined
  loadComponentClass: string | undefined
  sourceFile: TsSourceFile
  line: number
}

interface ExtractContext {
  project: import('ts-morph').Project
  // lazy(loadChildren)로 부모에 마운트된 routes 배열. 이 배열을 감싼 forChild 호출은 부모 없이 한 번 더
  // 파싱하면 안 된다(예전엔 `/admin/settings`와 함께 무접두 `/settings`가 이중 등록됐다).
  mounted: Set<import('ts-morph').ts.Node>
  visiting: Set<import('ts-morph').ts.Node>
}

function joinRoutePath(parent: string, segment: string): string {
  const joined = segment.startsWith('/') ? segment : `${parent}/${segment}`
  return joined.replace(/\/+/g, '/').replace(/^\/|\/$/g, '')
}

function stringProp(obj: import('ts-morph').ObjectLiteralExpression, name: string): string | undefined {
  const prop = obj.getProperty(name)
  if (!prop?.isKind(SyntaxKind.PropertyAssignment)) return undefined
  const init = prop.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
  return init?.isKind(SyntaxKind.StringLiteral) ? init.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue() : undefined
}

function loadSourceFile(project: import('ts-morph').Project, absBase: string): TsSourceFile | undefined {
  for (const candidate of [absBase + '.ts', absBase, path.join(absBase, 'index.ts')]) {
    const existing = project.getSourceFile(candidate)
    if (existing !== undefined) return existing
    try { return project.addSourceFileAtPath(candidate) } catch { /* try next */ }
  }
  return undefined
}

// Identifier가 가리키는 routes 배열을 찾는다 — 같은 파일 → import한 모듈 → 프로젝트 전체 순.
function resolveRoutesIdentifier(name: string, sf: TsSourceFile, project: import('ts-morph').Project): TsNode | undefined {
  const local = sf.getVariableDeclarations().find(v => v.getName() === name)?.getInitializer()
  if (local !== undefined) return local
  const spec = buildImportMap(sf).get(name)
  if (spec !== undefined && spec.startsWith('.')) {
    const target = loadSourceFile(project, path.resolve(path.dirname(sf.getFilePath()), spec))
    const init = target?.getVariableDeclarations().find(v => v.getName() === name)?.getInitializer()
    if (init !== undefined) return init
  }
  for (const other of project.getSourceFiles()) {
    const init = other.getVariableDeclarations().find(v => v.getName() === name)?.getInitializer()
    if (init !== undefined) return init
  }
  return undefined
}

function resolveRoutesExpr(expr: TsNode, project: import('ts-morph').Project): TsNode | undefined {
  if (expr.isKind(SyntaxKind.ArrayLiteralExpression)) return expr
  if (expr.isKind(SyntaxKind.Identifier)) {
    const init = resolveRoutesIdentifier(expr.getText(), expr.getSourceFile(), project)
    return init?.isKind(SyntaxKind.ArrayLiteralExpression) ? init : undefined
  }
  return undefined
}

// NgModule 클래스가 등록한 forChild routes. 흔한 `AdminModule → imports: [AdminRoutingModule]` 형태를
// 따라가도록 imports의 Identifier도 같은 방식으로 한 단계씩 해석한다(depth 가드).
function routesOfNgModule(cls: import('ts-morph').ClassDeclaration, project: import('ts-morph').Project, depth = 0): TsNode[] {
  if (depth > 3) return []
  const arrays: TsNode[] = []
  for (const dec of cls.getDecorators()) {
    if (dec.getName() !== 'NgModule') continue
    for (const call of dec.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (call.getExpression().getText() !== 'RouterModule.forChild') continue
      const arg = call.getArguments()[0]
      const arr = arg !== undefined ? resolveRoutesExpr(arg, project) : undefined
      if (arr !== undefined) arrays.push(arr)
    }
    const arg = dec.getArguments()[0]
    if (!arg?.isKind(SyntaxKind.ObjectLiteralExpression)) continue
    const importsProp = arg.asKindOrThrow(SyntaxKind.ObjectLiteralExpression).getProperty('imports')
    const importsInit = importsProp?.isKind(SyntaxKind.PropertyAssignment)
      ? importsProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer() : undefined
    if (!importsInit?.isKind(SyntaxKind.ArrayLiteralExpression)) continue
    for (const el of importsInit.asKindOrThrow(SyntaxKind.ArrayLiteralExpression).getElements()) {
      if (!el.isKind(SyntaxKind.Identifier)) continue
      const imported = resolveClass(el.getText(), cls.getSourceFile(), project)
      if (imported !== undefined) arrays.push(...routesOfNgModule(imported, project, depth + 1))
    }
  }
  return arrays
}

function resolveClass(name: string, sf: TsSourceFile, project: import('ts-morph').Project): import('ts-morph').ClassDeclaration | undefined {
  const local = sf.getClass(name)
  if (local !== undefined) return local
  const spec = buildImportMap(sf).get(name)
  if (spec === undefined || !spec.startsWith('.')) return undefined
  return loadSourceFile(project, path.resolve(path.dirname(sf.getFilePath()), spec))?.getClass(name)
}

// loadChildren: () => import('./x').then(m => m.Name) — Name이 routes 변수면 그 배열, NgModule 클래스면
// 그 모듈의 forChild 배열(v1.2.69 이전엔 클래스를 못 찾아 [] → 부모 prefix가 통째로 사라졌다).
function resolveLoadChildren(prop: import('ts-morph').PropertyAssignment, project: import('ts-morph').Project): TsNode[] {
  const init = prop.getInitializer()
  if (init === undefined) return []
  for (const call of init.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression()
    if (!expr.isKind(SyntaxKind.PropertyAccessExpression)) continue
    const propAccess = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression)
    if (propAccess.getName() !== 'then') continue
    const importMatch = propAccess.getExpression().getText().match(/^import\(['"`]([^'"`]+)['"`]\)$/)
    if (importMatch === null) continue
    const thenArg = call.getArguments()[0]
    if (thenArg === undefined || !thenArg.isKind(SyntaxKind.ArrowFunction)) continue
    const body = thenArg.asKindOrThrow(SyntaxKind.ArrowFunction).getBody()
    if (!body.isKind(SyntaxKind.PropertyAccessExpression)) continue
    const exportName = body.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName()

    const sf = loadSourceFile(project, path.resolve(path.dirname(prop.getSourceFile().getFilePath()), importMatch[1]!))
    if (sf === undefined) return []
    const varInit = sf.getVariableDeclarations().find(v => v.getName() === exportName)?.getInitializer()
    if (varInit !== undefined) {
      const arr = resolveRoutesExpr(varInit, project)
      return arr !== undefined ? [arr] : []
    }
    const cls = sf.getClass(exportName)
    return cls !== undefined ? routesOfNgModule(cls, project) : []
  }
  return []
}

function isPrimaryEmptyPath(el: TsNode): boolean {
  if (!el.isKind(SyntaxKind.ObjectLiteralExpression)) return false
  const obj = el.asKindOrThrow(SyntaxKind.ObjectLiteralExpression)
  return (stringProp(obj, 'path') ?? '') === '' && stringProp(obj, 'outlet') === undefined
}

function extractRouteEntries(arrayNode: TsNode, parentPath: string, ctx: ExtractContext, out: RouteEntry[]): void {
  if (!arrayNode.isKind(SyntaxKind.ArrayLiteralExpression)) return
  if (ctx.visiting.has(arrayNode.compilerNode)) return
  ctx.visiting.add(arrayNode.compilerNode)
  const sourceFile = arrayNode.getSourceFile()
  const fileDir = path.dirname(sourceFile.getFilePath())

  for (const el of arrayNode.asKindOrThrow(SyntaxKind.ArrayLiteralExpression).getElements()) {
    if (!el.isKind(SyntaxKind.ObjectLiteralExpression)) continue
    const obj = el.asKindOrThrow(SyntaxKind.ObjectLiteralExpression)
    const rawSegment = stringProp(obj, 'path') ?? ''
    if (rawSegment === '**') continue
    const fullPath = joinRoutePath(parentPath, rawSegment)

    let componentSpec: ComponentSpecEntry | undefined
    let loadComponentClass: string | undefined
    const loadComponentProp = obj.getProperty('loadComponent')
    if (loadComponentProp?.isKind(SyntaxKind.PropertyAssignment)) {
      const propAssign = loadComponentProp.asKindOrThrow(SyntaxKind.PropertyAssignment)
      loadComponentClass = extractLoadComponentClass(propAssign)
      const moduleSpec = extractLoadComponentModuleSpec(propAssign)
      if (moduleSpec !== undefined) componentSpec = { spec: moduleSpec, isIdentifier: false, resolveFromDir: fileDir }
    }
    const componentProp = obj.getProperty('component')
    if (componentProp?.isKind(SyntaxKind.PropertyAssignment)) {
      const init = componentProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
      if (init?.isKind(SyntaxKind.Identifier)) componentSpec = { spec: init.getText(), isIdentifier: true, resolveFromDir: fileDir }
    }
    const hasComponent = componentProp !== undefined || loadComponentProp !== undefined

    const childArrays: TsNode[] = []
    const childrenProp = obj.getProperty('children')
    if (childrenProp?.isKind(SyntaxKind.PropertyAssignment)) {
      const childInit = childrenProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
      const arr = childInit !== undefined ? resolveRoutesExpr(childInit, ctx.project) : undefined
      if (arr !== undefined) childArrays.push(arr)
    }
    const loadChildrenProp = obj.getProperty('loadChildren')
    if (loadChildrenProp?.isKind(SyntaxKind.PropertyAssignment)) {
      for (const arr of resolveLoadChildren(loadChildrenProp.asKindOrThrow(SyntaxKind.PropertyAssignment), ctx.project)) {
        ctx.mounted.add(arr.compilerNode)
        childArrays.push(arr)
      }
    }

    // redirectTo는 페이지가 아니다. 컴포넌트 없는 컨테이너(children/loadChildren)는 자식 중 `path:''`
    // (기본 outlet)가 같은 URL의 실제 페이지이므로 컨테이너를 따로 내지 않는다 — 내면 같은 URL이
    // 라우트 정의 파일로 한 번, 컴포넌트 파일로 한 번 이중 등록된다.
    const isRedirect = obj.getProperty('redirectTo') !== undefined
    const emptyChildIsPage = childArrays.some(arr =>
      arr.asKind(SyntaxKind.ArrayLiteralExpression)?.getElements().some(isPrimaryEmptyPath) === true)
    if (hasComponent || (!isRedirect && !emptyChildIsPage)) {
      out.push({
        fullPath,
        outlet: stringProp(obj, 'outlet'),
        componentSpec,
        loadComponentClass,
        sourceFile,
        line: obj.getStartLineNumber(),
      })
    }

    for (const arr of childArrays) extractRouteEntries(arr, fullPath, ctx, out)
  }
  ctx.visiting.delete(arrayNode.compilerNode)
}

async function resolveComponentFile(entry: RouteEntry, repoRoot: string): Promise<string | undefined> {
  const spec = entry.componentSpec
  if (spec === undefined) return undefined
  const moduleSpec = spec.isIdentifier ? buildImportMap(entry.sourceFile).get(spec.spec) : spec.spec
  if (moduleSpec === undefined || !moduleSpec.startsWith('.')) return undefined
  const absBase = path.resolve(spec.resolveFromDir, moduleSpec)
  for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
    try {
      await fs.access(absBase + ext)
      return path.relative(repoRoot, absBase + ext).replace(/\\/g, '/')
    } catch { /* try next */ }
  }
  return undefined
}

export async function parseAngularRoutes(
  repoRoot: string,
  analyzerVersion: string,
): Promise<{ routes: RouteNode[]; loadComponentMap: Map<string, string> }> {
  const allFiles = await findTsFiles(repoRoot)

  const routerFiles: string[] = []
  for (const f of allFiles) {
    const content = await fs.readFile(f, 'utf-8').catch(() => '')
    if (content.includes('provideRouter') || content.includes('RouterModule.forRoot')
      || content.includes('RouterModule.forChild')
      || (content.includes('Routes') && content.includes('path:'))) {
      routerFiles.push(f)
    }
  }
  if (routerFiles.length === 0) return { routes: [], loadComponentMap: new Map() }

  const project = new Project({
    compilerOptions: {
      target: 99,
      experimentalDecorators: true,
      allowJs: false,
      strict: false,
    },
    skipAddingFilesFromTsConfig: true,
  })
  for (const f of routerFiles) project.addSourceFileAtPath(f)

  const routerCalls = (names: ReadonlySet<string>): import('ts-morph').CallExpression[] =>
    project.getSourceFiles().flatMap(sf => sf.getDescendantsOfKind(SyntaxKind.CallExpression)
      .filter(c => names.has(c.getExpression().getText())))

  // 루트(provideRouter·forRoot)를 먼저 펼쳐 lazy 마운트 관계를 확정한 뒤, 어디에도 마운트되지 않은
  // forChild만 부모 없이 파싱한다 — 파일 순회 순서에 따라 결과가 달라지지 않게 두 단계로 나눈다.
  const ctx: ExtractContext = { project, mounted: new Set(), visiting: new Set() }
  const entries: RouteEntry[] = []
  for (const call of routerCalls(new Set(['provideRouter', 'RouterModule.forRoot']))) {
    const arg = call.getArguments()[0]
    const arr = arg !== undefined ? resolveRoutesExpr(arg, project) : undefined
    if (arr !== undefined) extractRouteEntries(arr, '', ctx, entries)
  }
  for (const call of routerCalls(new Set(['RouterModule.forChild']))) {
    const arg = call.getArguments()[0]
    const arr = arg !== undefined ? resolveRoutesExpr(arg, project) : undefined
    if (arr !== undefined && !ctx.mounted.has(arr.compilerNode)) extractRouteEntries(arr, '', ctx, entries)
  }

  const routes: RouteNode[] = []
  const seenIds = new Set<string>()
  const loadComponentMap = new Map<string, string>()

  for (const entry of entries) {
    const urlPath = '/' + entry.fullPath
    const dynamicSegmentType: DynamicSegmentType = urlPath.includes(':') ? 'dynamic' : 'static'
    const declRelPath = path.relative(repoRoot, entry.sourceFile.getFilePath()).replace(/\\/g, '/')
    const provenance: Provenance = {
      file: declRelPath,
      line: entry.line,
      adapter: 'angular@0.1',
      analyzerVersion,
    }

    const compFile = await resolveComponentFile(entry, repoRoot)
    const routeFilePath = compFile ?? declRelPath  // fallback: 라우트가 선언된 파일
    const confField = compFile !== undefined
      ? { confidence: 'inferred' as const, inferenceChain: [`라우트 정의의 component spec '${entry.componentSpec!.spec}' → 컴포넌트 파일로 매핑`] }
      : { confidence: 'verified' as const }

    // named outlet은 기본 outlet과 같은 URL을 공유하므로 심볼에 outlet을 붙여 NodeId를 구분한다.
    const routeId = makeNodeId('route', routeFilePath, entry.outlet !== undefined ? `${urlPath}(${entry.outlet})` : urlPath)
    if (seenIds.has(routeId)) continue
    seenIds.add(routeId)
    routes.push(
      createRouteNode({
        id: routeId,
        path: urlPath,
        filePath: routeFilePath,
        routeFileKind: 'page',
        dynamicSegmentType,
        isGroupRoute: false,
        renderingMode: 'CSR',
        provenance,
        ...confField,
      }),
    )
    if (entry.loadComponentClass !== undefined) loadComponentMap.set(routeId, entry.loadComponentClass)
  }

  return { routes, loadComponentMap }
}
