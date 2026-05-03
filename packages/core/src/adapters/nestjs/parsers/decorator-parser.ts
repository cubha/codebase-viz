import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { Project, SyntaxKind, type ClassDeclaration, type Decorator, type MethodDeclaration } from 'ts-morph'
import {
  createRouteNode,
  createComponentNode,
  createEdge,
  makeNodeId,
  makeEdgeId,
  type RouteNode,
  type ComponentNode,
  type IREdge,
  type NodeId,
  type DynamicSegmentType,
  type Provenance,
} from '@codebase-viz/types'

const EXCLUDE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next'])
const HTTP_METHOD_DECORATORS = new Set(['Get', 'Post', 'Put', 'Delete', 'Patch', 'All', 'Options', 'Head'])

async function collectTsFiles(dir: string): Promise<string[]> {
  const results: string[] = []
  async function recurse(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => null)
    if (entries === null) return
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name)) await recurse(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        results.push(fullPath)
      }
    }
  }
  await recurse(dir)
  return results
}

function getStringArg(decorator: Decorator): string {
  const args = decorator.getArguments()
  const first = args[0]
  if (first === undefined) return ''
  if (first.getKind() === SyntaxKind.StringLiteral) {
    return first.getText().slice(1, -1)
  }
  return ''
}

function buildRoutePath(prefix: string, methodPath: string): string {
  const segments = [prefix, methodPath].filter(s => s.length > 0).join('/')
  return '/' + segments
}

function getDynamicSegmentType(routePath: string): DynamicSegmentType {
  if (routePath.includes(':')) return 'dynamic'
  return 'static'
}

function findDecoratorByName(node: ClassDeclaration | MethodDeclaration, name: string): Decorator | undefined {
  return node.getDecorators().find(d => d.getName() === name)
}

function findHttpMethodDecorator(method: MethodDeclaration): Decorator | undefined {
  return method.getDecorators().find(d => HTTP_METHOD_DECORATORS.has(d.getName()))
}

function makeProject(repoRoot: string): Project {
  return new Project({
    compilerOptions: {
      target: 99,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      allowJs: false,
      strict: false,
    },
    skipAddingFilesFromTsConfig: true,
  })
}

export async function parseControllers(
  repoRoot: string,
  analyzerVersion = 'codebase-viz@0.1.0',
): Promise<{ routes: RouteNode[]; controllers: ComponentNode[] }> {
  const normalizedRoot = path.resolve(repoRoot)
  const tsFiles = await collectTsFiles(normalizedRoot)
  const project = makeProject(normalizedRoot)
  for (const f of tsFiles) project.addSourceFileAtPath(f)

  const routes: RouteNode[] = []
  const controllers: ComponentNode[] = []

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath()
    const relPath = path.relative(normalizedRoot, filePath).replace(/\\/g, '/')

    for (const cls of sourceFile.getClasses()) {
      const controllerDecorator = findDecoratorByName(cls, 'Controller')
      if (controllerDecorator === undefined) continue

      const className = cls.getName() ?? path.basename(filePath, '.ts')
      const prefix = getStringArg(controllerDecorator)

      const controllerProvenance: Provenance = {
        file: relPath,
        line: cls.getStartLineNumber(),
        adapter: 'nestjs@0.1',
        analyzerVersion,
      }

      controllers.push(
        createComponentNode({
          id: makeNodeId('component', relPath, className),
          name: className,
          filePath: relPath,
          runtime: 'server',
          provenance: controllerProvenance,
          confidence: 'verified',
        }),
      )

      for (const method of cls.getMethods()) {
        const httpDecorator = findHttpMethodDecorator(method)
        if (httpDecorator === undefined) continue

        const methodPath = getStringArg(httpDecorator)
        const routePath = buildRoutePath(prefix, methodPath)
        const methodName = method.getName()

        const routeProvenance: Provenance = {
          file: relPath,
          line: method.getStartLineNumber(),
          adapter: 'nestjs@0.1',
          analyzerVersion,
        }

        routes.push(
          createRouteNode({
            id: makeNodeId('route', relPath, `${className}.${methodName}`),
            path: routePath,
            filePath: relPath,
            routeFileKind: 'page',
            dynamicSegmentType: getDynamicSegmentType(routePath),
            isGroupRoute: false,
            renderingMode: 'SSR',
            provenance: routeProvenance,
            confidence: 'verified',
          }),
        )
      }
    }
  }

  return { routes, controllers }
}

function extractIdentifierList(decorator: Decorator, propertyName: string): string[] {
  const args = decorator.getArguments()
  const first = args[0]
  if (first === undefined || first.getKind() !== SyntaxKind.ObjectLiteralExpression) return []

  const objLit = first.asKindOrThrow(SyntaxKind.ObjectLiteralExpression)
  const prop = objLit.getProperty(propertyName)
  if (prop === undefined || prop.getKind() !== SyntaxKind.PropertyAssignment) return []

  const initializer = prop.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
  if (initializer === undefined || initializer.getKind() !== SyntaxKind.ArrayLiteralExpression) return []

  const arr = initializer.asKindOrThrow(SyntaxKind.ArrayLiteralExpression)
  const ids: string[] = []
  for (const el of arr.getElements()) {
    if (el.getKind() === SyntaxKind.Identifier) {
      ids.push(el.getText())
    }
  }
  return ids
}

export async function parseModulesAndProviders(
  repoRoot: string,
  analyzerVersion = 'codebase-viz@0.1.0',
): Promise<{ modules: ComponentNode[]; services: ComponentNode[]; edges: IREdge[] }> {
  const normalizedRoot = path.resolve(repoRoot)
  const tsFiles = await collectTsFiles(normalizedRoot)
  const project = makeProject(normalizedRoot)
  for (const f of tsFiles) project.addSourceFileAtPath(f)

  const modules: ComponentNode[] = []
  const services: ComponentNode[] = []
  const edges: IREdge[] = []
  const nameToNodeId = new Map<string, NodeId>()

  // Pass 1: collect all module / service nodes so edges can resolve identifiers
  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath()
    const relPath = path.relative(normalizedRoot, filePath).replace(/\\/g, '/')

    for (const cls of sourceFile.getClasses()) {
      const className = cls.getName()
      if (className === undefined) continue

      const moduleDecorator = findDecoratorByName(cls, 'Module')
      const injectableDecorator = findDecoratorByName(cls, 'Injectable')

      if (moduleDecorator !== undefined) {
        const nodeId = makeNodeId('component', relPath, className)
        nameToNodeId.set(className, nodeId)
        modules.push(
          createComponentNode({
            id: nodeId,
            name: className,
            filePath: relPath,
            runtime: 'server',
            provenance: {
              file: relPath,
              line: cls.getStartLineNumber(),
              adapter: 'nestjs@0.1',
              analyzerVersion,
            },
            confidence: 'verified',
          }),
        )
      } else if (injectableDecorator !== undefined) {
        const nodeId = makeNodeId('component', relPath, className)
        nameToNodeId.set(className, nodeId)
        services.push(
          createComponentNode({
            id: nodeId,
            name: className,
            filePath: relPath,
            runtime: 'server',
            provenance: {
              file: relPath,
              line: cls.getStartLineNumber(),
              adapter: 'nestjs@0.1',
              analyzerVersion,
            },
            confidence: 'verified',
          }),
        )
      } else {
        const controllerDecorator = findDecoratorByName(cls, 'Controller')
        if (controllerDecorator !== undefined) {
          nameToNodeId.set(className, makeNodeId('component', relPath, className))
        }
      }
    }
  }

  // Pass 2: build edges from each Module's imports/controllers/providers references
  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath()
    const relPath = path.relative(normalizedRoot, filePath).replace(/\\/g, '/')

    for (const cls of sourceFile.getClasses()) {
      const moduleDecorator = findDecoratorByName(cls, 'Module')
      if (moduleDecorator === undefined) continue
      const className = cls.getName()
      if (className === undefined) continue
      const fromId = nameToNodeId.get(className)
      if (fromId === undefined) continue

      const refs: string[] = [
        ...extractIdentifierList(moduleDecorator, 'imports'),
        ...extractIdentifierList(moduleDecorator, 'controllers'),
        ...extractIdentifierList(moduleDecorator, 'providers'),
      ]

      const provenance: Provenance = {
        file: relPath,
        line: moduleDecorator.getStartLineNumber(),
        adapter: 'nestjs@0.1',
        analyzerVersion,
      }

      for (const ref of refs) {
        const toId = nameToNodeId.get(ref)
        if (toId === undefined) continue
        edges.push(
          createEdge({
            id: makeEdgeId('imports', fromId, toId),
            from: fromId,
            to: toId,
            kind: 'imports',
            importDepth: 1,
            provenance,
            confidence: 'verified',
          }),
        )
      }
    }
  }

  return { modules, services, edges }
}
