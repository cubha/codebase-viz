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

const EXCLUDE_DIRS = new Set(['.git', 'node_modules', 'dist', '.nuxt'])

async function findTsFiles(repoRoot: string): Promise<string[]> {
  const results: string[] = []
  async function recurse(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null)
    if (entries === null) return
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name)) await recurse(path.join(dir, entry.name))
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))
        && !entry.name.endsWith('.d.ts') && !entry.name.endsWith('.test.ts')) {
        results.push(path.join(dir, entry.name))
      }
    }
  }
  await recurse(repoRoot)
  return results
}

function extractPathsFromRoutesArray(
  arrayNode: import('ts-morph').Node,
): string[] {
  const paths: string[] = []
  if (!arrayNode.isKind(SyntaxKind.ArrayLiteralExpression)) return paths

  for (const el of arrayNode.asKindOrThrow(SyntaxKind.ArrayLiteralExpression).getElements()) {
    if (!el.isKind(SyntaxKind.ObjectLiteralExpression)) continue

    const pathProp = el.asKindOrThrow(SyntaxKind.ObjectLiteralExpression).getProperty('path')
    if (pathProp?.isKind(SyntaxKind.PropertyAssignment)) {
      const init = pathProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
      if (init?.isKind(SyntaxKind.StringLiteral)) {
        paths.push(init.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue())
      }
    }

    // Handle children: [] for nested routes
    const childrenProp = el.asKindOrThrow(SyntaxKind.ObjectLiteralExpression).getProperty('children')
    if (childrenProp?.isKind(SyntaxKind.PropertyAssignment)) {
      const childInit = childrenProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
      if (childInit !== undefined) paths.push(...extractPathsFromRoutesArray(childInit))
    }
  }

  return paths
}

function normalizePath(rawPath: string): { urlPath: string; dynamicSegmentType: DynamicSegmentType } {
  // Vue Router uses :param syntax natively
  const urlPath = rawPath.startsWith('/') ? rawPath : '/' + rawPath
  const dynamicSegmentType: DynamicSegmentType = urlPath.includes(':') ? 'dynamic' : 'static'
  return { urlPath, dynamicSegmentType }
}

export async function parseVueRoutes(
  repoRoot: string,
  analyzerVersion: string,
): Promise<RouteNode[]> {
  const allFiles = await findTsFiles(repoRoot)

  const routerFiles: string[] = []
  for (const f of allFiles) {
    const content = await fs.readFile(f, 'utf-8').catch(() => '')
    if (content.includes('createRouter')) routerFiles.push(f)
  }
  if (routerFiles.length === 0) return []

  const project = new Project({
    compilerOptions: { target: 99, allowJs: true, strict: false },
    skipAddingFilesFromTsConfig: true,
  })
  for (const f of routerFiles) project.addSourceFileAtPath(f)

  const routes: RouteNode[] = []

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath()
    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')

    for (const callExpr of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = callExpr.getExpression()
      if (expr.getText() !== 'createRouter') continue

      const args = callExpr.getArguments()
      if (args.length === 0) continue

      const firstArg = args[0]!
      if (!firstArg.isKind(SyntaxKind.ObjectLiteralExpression)) continue

      const routesProp = firstArg.asKindOrThrow(SyntaxKind.ObjectLiteralExpression).getProperty('routes')
      if (!routesProp?.isKind(SyntaxKind.PropertyAssignment)) continue

      const routesInit = routesProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
      if (routesInit === undefined) continue

      let routesArray: import('ts-morph').Node | undefined
      if (routesInit.isKind(SyntaxKind.ArrayLiteralExpression)) {
        routesArray = routesInit
      } else if (routesInit.isKind(SyntaxKind.Identifier)) {
        // routes defined as const routes = [...]
        const varDecls = sourceFile.getVariableDeclarations()
        const varDecl = varDecls.find(v => v.getName() === routesInit.getText())
        routesArray = varDecl?.getInitializer()
      }

      if (routesArray === undefined) continue

      const extractedPaths = extractPathsFromRoutesArray(routesArray)

      for (const rawPath of extractedPaths) {
        const { urlPath, dynamicSegmentType } = normalizePath(rawPath)
        const provenance: Provenance = {
          file: relPath,
          line: callExpr.getStartLineNumber(),
          adapter: 'vue-spa@0.1',
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
