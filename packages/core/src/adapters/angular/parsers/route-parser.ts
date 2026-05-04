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

const EXCLUDE_DIRS = new Set(['.git', 'node_modules', 'dist', '.angular'])
const ROUTER_FUNCS = new Set(['provideRouter', 'RouterModule'])

async function findTsFiles(repoRoot: string): Promise<string[]> {
  const results: string[] = []
  async function recurse(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null)
    if (entries === null) return
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name)) await recurse(path.join(dir, entry.name))
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')
        && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.spec.ts')) {
        results.push(path.join(dir, entry.name))
      }
    }
  }
  await recurse(repoRoot)
  return results
}

function extractPathsFromRoutesArray(arrayNode: import('ts-morph').Node): string[] {
  const paths: string[] = []
  if (!arrayNode.isKind(SyntaxKind.ArrayLiteralExpression)) return paths

  for (const el of arrayNode.asKindOrThrow(SyntaxKind.ArrayLiteralExpression).getElements()) {
    if (!el.isKind(SyntaxKind.ObjectLiteralExpression)) continue

    const pathProp = el.asKindOrThrow(SyntaxKind.ObjectLiteralExpression).getProperty('path')
    if (pathProp?.isKind(SyntaxKind.PropertyAssignment)) {
      const init = pathProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
      if (init?.isKind(SyntaxKind.StringLiteral)) {
        const p = init.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue()
        if (p !== '**') paths.push(p)
      }
    }

    const childrenProp = el.asKindOrThrow(SyntaxKind.ObjectLiteralExpression).getProperty('children')
    if (childrenProp?.isKind(SyntaxKind.PropertyAssignment)) {
      const childInit = childrenProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
      if (childInit !== undefined) paths.push(...extractPathsFromRoutesArray(childInit))
    }
  }

  return paths
}

export async function parseAngularRoutes(
  repoRoot: string,
  analyzerVersion: string,
): Promise<RouteNode[]> {
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
  if (routerFiles.length === 0) return []

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

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath()
    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')

    // Find provideRouter(routes) or RouterModule.forRoot(routes) calls
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
        // Check same file first
        const varDecl = sourceFile.getVariableDeclarations().find(v => v.getName() === varName)
        routesArray = varDecl?.getInitializer()
        // If not found, search across all project source files
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

      const extractedPaths = extractPathsFromRoutesArray(routesArray)

      for (const rawPath of extractedPaths) {
        const urlPath = rawPath === '' ? '/' : ('/' + rawPath)
        const dynamicSegmentType: DynamicSegmentType = urlPath.includes(':') ? 'dynamic' : 'static'

        const provenance: Provenance = {
          file: relPath,
          line: callExpr.getStartLineNumber(),
          adapter: 'angular@0.1',
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
