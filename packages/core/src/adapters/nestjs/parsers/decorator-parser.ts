import * as path from 'node:path'
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
  type Provenance,
} from '@codebase-viz/types'
import { getDynamicSegmentType } from '../../_shared/url-path-normalizer.js'
import { walkDir, NESTJS_EXCLUDE_DIRS } from '../../_shared/file-finder.js'

const HTTP_METHOD_DECORATORS = new Set(['Get', 'Post', 'Put', 'Delete', 'Patch', 'All', 'Options', 'Head'])

async function collectTsFiles(dir: string): Promise<string[]> {
  return walkDir(dir, {
    excludeDirs: NESTJS_EXCLUDE_DIRS,
    nameFilter: n => n.endsWith('.ts') && !n.endsWith('.d.ts'),
  })
}

function getStringArg(decorator: Decorator): string {
  const args = decorator.getArguments()
  const first = args[0]
  if (first === undefined) return ''
  if (first.getKind() === SyntaxKind.StringLiteral) {
    return first.getText().slice(1, -1)
  }
  if (first.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral) {
    return first.getText().slice(1, -1)
  }
  if (first.getKind() === SyntaxKind.TemplateExpression) {
    const tmpl = first.asKindOrThrow(SyntaxKind.TemplateExpression)
    const headText = tmpl.getHead().getText()
    const inner = headText.slice(1, headText.endsWith('${') ? -2 : -1)
    return inner.replace(/^\/+/, '').replace(/\/+$/, '')
  }
  return ''
}

function buildRoutePath(prefix: string, methodPath: string): string {
  const segments = [prefix, methodPath].filter(s => s.length > 0).join('/')
  return '/' + segments
}

function findDecoratorByName(node: ClassDeclaration | MethodDeclaration, name: string): Decorator | undefined {
  return node.getDecorators().find(d => d.getName() === name)
}

function findHttpMethodDecorator(method: MethodDeclaration): Decorator | undefined {
  return method.getDecorators().find(d => HTTP_METHOD_DECORATORS.has(d.getName()))
}

function makeProject(): Project {
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
  const project = makeProject()
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
            httpMethod: httpDecorator.getName().toUpperCase(),
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
  const project = makeProject()
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
