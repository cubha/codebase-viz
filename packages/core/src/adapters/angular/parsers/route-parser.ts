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

function resolveLoadChildrenPaths(
  prop: import('ts-morph').PropertyAssignment,
  parentPath: string,
  project: import('ts-morph').Project,
  currentFileDir: string,
): string[] {
  const init = prop.getInitializer()
  if (init === undefined) return []

  // Pattern: loadChildren: () => import('./path').then(m => m.exportName)
  for (const call of init.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression()
    if (!expr.isKind(SyntaxKind.PropertyAccessExpression)) continue
    const propAccess = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression)
    if (propAccess.getName() !== 'then') continue

    const importText = propAccess.getExpression().getText()
    const importMatch = importText.match(/^import\(['"`]([^'"`]+)['"`]\)$/)
    if (importMatch === null) continue

    const importPathRel = importMatch[1]!

    const thenArgs = call.getArguments()
    if (thenArgs.length === 0) continue
    const thenArg = thenArgs[0]!
    if (!thenArg.isKind(SyntaxKind.ArrowFunction)) continue
    const body = thenArg.asKindOrThrow(SyntaxKind.ArrowFunction).getBody()
    if (!body.isKind(SyntaxKind.PropertyAccessExpression)) continue
    const exportName = body.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName()

    for (const candidate of [
      path.resolve(currentFileDir, importPathRel + '.ts'),
      path.resolve(currentFileDir, importPathRel),
      path.resolve(currentFileDir, importPathRel, 'index.ts'),
    ]) {
      let sf = project.getSourceFile(candidate)
      if (sf === undefined) {
        try { sf = project.addSourceFileAtPath(candidate) } catch { continue }
      }
      const varDecl = sf.getVariableDeclarations().find(v => v.getName() === exportName)
      const routesArray = varDecl?.getInitializer()
      if (routesArray === undefined) continue
      return extractPathsFromRoutesArray(routesArray, parentPath, project, path.dirname(candidate))
    }
  }

  return []
}

// v1.2.44 A1-2: 각 경로의 컴포넌트 spec(모듈 상대 경로 or Identifier 이름)을 수집하는 map.
// parseAngularRoutes는 이 map으로 routeFilePath를 컴포넌트 파일로 치환한다.
interface ComponentSpecEntry {
  spec: string  // 모듈 상대 경로(예 './foo') 또는 Identifier name(예 'FooComponent')
  isIdentifier: boolean  // true=Identifier sync import, false=dynamic import path
  resolveFromDir: string  // spec을 어느 디렉토리 기준으로 resolve할지 (loadChildren cross-file 시 외부 파일 디렉토리)
}

function extractPathsFromRoutesArray(
  arrayNode: import('ts-morph').Node,
  parentPath = '',
  project?: import('ts-morph').Project,
  currentFileDir?: string,
  loadComponentMap?: Map<string, string>,
  componentSpecMap?: Map<string, ComponentSpecEntry>,
): string[] {
  const paths: string[] = []
  if (!arrayNode.isKind(SyntaxKind.ArrayLiteralExpression)) return paths

  for (const el of arrayNode.asKindOrThrow(SyntaxKind.ArrayLiteralExpression).getElements()) {
    if (!el.isKind(SyntaxKind.ObjectLiteralExpression)) continue
    const obj = el.asKindOrThrow(SyntaxKind.ObjectLiteralExpression)

    const pathProp = obj.getProperty('path')
    let rawSegment = ''
    if (pathProp?.isKind(SyntaxKind.PropertyAssignment)) {
      const init = pathProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
      if (init?.isKind(SyntaxKind.StringLiteral)) {
        rawSegment = init.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue()
      }
    }

    if (rawSegment === '**') continue

    // Accumulate full path: combine parent prefix with current segment
    const fullPath = rawSegment.startsWith('/')
      ? rawSegment
      : parentPath
        ? (parentPath + '/' + rawSegment).replace('//', '/')
        : rawSegment

    paths.push(fullPath)

    // Capture loadComponent class name for renders edge generation
    const loadComponentProp = obj.getProperty('loadComponent')
    if (loadComponentProp?.isKind(SyntaxKind.PropertyAssignment)) {
      const propAssign = loadComponentProp.asKindOrThrow(SyntaxKind.PropertyAssignment)
      const className = extractLoadComponentClass(propAssign)
      if (className !== undefined && loadComponentMap !== undefined) {
        loadComponentMap.set(fullPath, className)
      }
      // v1.2.44 A1-2: loadComponent 모듈 spec 캡처
      const moduleSpec = extractLoadComponentModuleSpec(propAssign)
      if (moduleSpec !== undefined && componentSpecMap !== undefined && currentFileDir !== undefined) {
        componentSpecMap.set(fullPath, { spec: moduleSpec, isIdentifier: false, resolveFromDir: currentFileDir })
      }
    }

    // v1.2.44 A1-2: component: FooComponent (Identifier sync import) 캡처
    const componentProp = obj.getProperty('component')
    if (componentProp?.isKind(SyntaxKind.PropertyAssignment) && componentSpecMap !== undefined && currentFileDir !== undefined) {
      const init = componentProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
      if (init?.isKind(SyntaxKind.Identifier)) {
        componentSpecMap.set(fullPath, { spec: init.getText(), isIdentifier: true, resolveFromDir: currentFileDir })
      }
    }

    // Recurse into children: [] passing accumulated path as prefix
    const childrenProp = obj.getProperty('children')
    if (childrenProp?.isKind(SyntaxKind.PropertyAssignment)) {
      const childInit = childrenProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
      if (childInit !== undefined) {
        paths.push(...extractPathsFromRoutesArray(childInit, fullPath, project, currentFileDir, loadComponentMap, componentSpecMap))
      }
    }

    // Attempt to resolve loadChildren: () => import('./path').then(m => m.routes)
    const loadChildrenProp = obj.getProperty('loadChildren')
    if (loadChildrenProp?.isKind(SyntaxKind.PropertyAssignment) && project !== undefined && currentFileDir !== undefined) {
      paths.push(...resolveLoadChildrenPaths(
        loadChildrenProp.asKindOrThrow(SyntaxKind.PropertyAssignment),
        fullPath, project, currentFileDir,
      ))
    }
  }

  return paths
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

  const routes: RouteNode[] = []
  const loadComponentMap = new Map<string, string>()

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath()
    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')

    for (const callExpr of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const exprText = callExpr.getExpression().getText()
      if (exprText !== 'provideRouter' && exprText !== 'RouterModule.forRoot' && exprText !== 'RouterModule.forChild') continue

      const args = callExpr.getArguments()
      if (args.length === 0) continue

      const firstArg = args[0]!
      let routesArray: import('ts-morph').Node | undefined

      if (firstArg.isKind(SyntaxKind.ArrayLiteralExpression)) {
        routesArray = firstArg
      } else if (firstArg.isKind(SyntaxKind.Identifier)) {
        const varName = firstArg.getText()
        const varDecl = sourceFile.getVariableDeclarations().find(v => v.getName() === varName)
        routesArray = varDecl?.getInitializer()
        if (routesArray === undefined) {
          for (const sf of project.getSourceFiles()) {
            const vd = sf.getVariableDeclarations().find(v => v.getName() === varName)
            if (vd !== undefined) {
              routesArray = vd.getInitializer()
              break
            }
          }
        }
      }

      if (routesArray === undefined) continue

      // v1.2.44 A1-2: routesArray가 외부 파일 import인 경우 그 외부 파일의 디렉토리 기준으로 resolve
      // (routes의 component Identifier import는 외부 파일에 있으므로)
      const routesArraySf = routesArray.getSourceFile()
      const routesArrayDir = path.dirname(routesArraySf.getFilePath())

      const rawPathMap = new Map<string, string>()
      // v1.2.44 A1-2: componentSpec 수집 — resolveFromDir은 외부 파일 디렉토리
      const componentSpecMap = new Map<string, ComponentSpecEntry>()
      const extractedPaths = extractPathsFromRoutesArray(routesArray, '', project, routesArrayDir, rawPathMap, componentSpecMap)

      // sync Identifier resolve용 importMap (routesArray의 sourceFile)
      const importMap = buildImportMap(routesArraySf)

      // v1.2.44 A1-2: routesArray가 외부 파일이면 fallback도 그 파일로 변경
      // (provideRouter 호출 파일이 아닌, routes 정의 파일이 라우트의 원본)
      const routesArrayRelPath = path.relative(repoRoot, routesArraySf.getFilePath()).replace(/\\/g, '/')

      for (const rawPath of extractedPaths) {
        const urlPath = rawPath === '' ? '/' : rawPath.startsWith('/') ? rawPath : ('/' + rawPath)
        const dynamicSegmentType: DynamicSegmentType = urlPath.includes(':') ? 'dynamic' : 'static'

        const provenance: Provenance = {
          file: relPath,
          line: callExpr.getStartLineNumber(),
          adapter: 'angular@0.1',
          analyzerVersion,
        }

        // v1.2.44 A1-2: componentSpec resolve → 컴포넌트 abs path → relPath 치환
        let routeFilePath = routesArrayRelPath  // fallback: routes 정의 파일 (외부 import면 외부 파일)
        let routeConfidence: 'verified' | 'inferred' = 'verified'
        let routeInferenceChain: string[] | undefined
        const specEntry = componentSpecMap.get(rawPath)
        if (specEntry !== undefined) {
          let moduleSpec: string | undefined
          if (specEntry.isIdentifier) {
            moduleSpec = importMap.get(specEntry.spec)
          } else {
            moduleSpec = specEntry.spec
          }
          if (moduleSpec !== undefined && moduleSpec.startsWith('.')) {
            const absBase = path.resolve(specEntry.resolveFromDir, moduleSpec)
            let compAbsPath: string | undefined
            for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
              try {
                await fs.access(absBase + ext)
                compAbsPath = absBase + ext
                break
              } catch { /* try next */ }
            }
            if (compAbsPath !== undefined) {
              routeFilePath = path.relative(repoRoot, compAbsPath).replace(/\\/g, '/')
              routeInferenceChain = [`라우트 정의의 component spec '${specEntry.spec}' → 컴포넌트 파일로 매핑`]
              routeConfidence = 'inferred'
            }
          }
        }

        const confField = routeConfidence === 'inferred' && routeInferenceChain !== undefined
          ? { confidence: 'inferred' as const, inferenceChain: routeInferenceChain }
          : { confidence: 'verified' as const }

        const routeId = makeNodeId('route', routeFilePath, urlPath)
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

        const compClass = rawPathMap.get(rawPath)
        if (compClass !== undefined) loadComponentMap.set(routeId, compClass)
      }
    }
  }

  return { routes, loadComponentMap }
}
