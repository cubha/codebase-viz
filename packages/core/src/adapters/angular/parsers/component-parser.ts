import * as path from 'node:path'
import { Project, SyntaxKind } from 'ts-morph'
import {
  createComponentNode,
  createEdge,
  makeNodeId,
  makeEdgeId,
  type ComponentNode,
  type IREdge,
  type Provenance,
} from '@codebase-viz/types'
import { walkDir, ANGULAR_EXCLUDE_DIRS } from '../../_shared/file-finder.js'

async function findComponentFiles(repoRoot: string): Promise<string[]> {
  return walkDir(repoRoot, {
    excludeDirs: ANGULAR_EXCLUDE_DIRS,
    nameFilter: n => n.endsWith('.component.ts') && !n.endsWith('.spec.ts'),
  })
}

export async function parseAngularComponents(
  repoRoot: string,
  analyzerVersion: string,
): Promise<{ nodes: ComponentNode[]; edges: IREdge[] }> {
  const componentFiles = await findComponentFiles(repoRoot)
  if (componentFiles.length === 0) return { nodes: [], edges: [] }

  const nodes: ComponentNode[] = []
  const edges: IREdge[] = []

  const project = new Project({
    compilerOptions: {
      target: 99,
      experimentalDecorators: true,
      allowJs: false,
      strict: false,
    },
    skipAddingFilesFromTsConfig: true,
  })
  for (const f of componentFiles) project.addSourceFileAtPath(f)

  // Build class-name → nodeId map and selector → nodeId map
  // classToNodeId key: `${relPath}::${className}` (복합키 — 동명 클래스 충돌 방지)
  const classToNodeId = new Map<string, import('@codebase-viz/types').NodeId>()
  // classNameFallback: className → nodeId (last-write-wins, dep 해석 fallback용)
  const classNameFallback = new Map<string, import('@codebase-viz/types').NodeId>()
  const selectorToNodeId = new Map<string, import('@codebase-viz/types').NodeId>()

  // First pass: collect ComponentNodes + selector map
  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath()
    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')

    for (const cls of sourceFile.getClasses()) {
      const decorator = cls.getDecorator('Component')
      if (decorator === undefined) continue

      const name = cls.getName()
      if (name === undefined) continue

      const provenance: Provenance = {
        file: relPath,
        line: cls.getStartLineNumber(),
        adapter: 'angular-component-parser@0.1',
        analyzerVersion,
      }

      const nodeId = makeNodeId('component', relPath, name)
      classToNodeId.set(`${relPath}::${name}`, nodeId)
      classNameFallback.set(name, nodeId)

      // Extract selector for template-based edge resolution
      const args = decorator.getArguments()
      const firstArg = args[0]
      if (firstArg?.isKind(SyntaxKind.ObjectLiteralExpression)) {
        const selectorProp = firstArg.asKindOrThrow(SyntaxKind.ObjectLiteralExpression).getProperty('selector')
        if (selectorProp?.isKind(SyntaxKind.PropertyAssignment)) {
          const selectorInit = selectorProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
          if (selectorInit?.isKind(SyntaxKind.StringLiteral)) {
            selectorToNodeId.set(selectorInit.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue(), nodeId)
          }
        }
      }

      nodes.push(
        createComponentNode({
          id: nodeId,
          name,
          filePath: relPath,
          runtime: 'client',
          provenance,
          confidence: 'verified',
        }),
      )
    }
  }

  // Second pass: extract imports[] dependencies → edges
  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath()
    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')

    for (const cls of sourceFile.getClasses()) {
      const decorator = cls.getDecorator('Component')
      if (decorator === undefined) continue

      const name = cls.getName()
      if (name === undefined) continue

      const fromId = classToNodeId.get(`${relPath}::${name}`)
      if (fromId === undefined) continue

      const provenance: Provenance = {
        file: relPath,
        line: cls.getStartLineNumber(),
        adapter: 'angular-component-parser@0.1',
        analyzerVersion,
      }

      // Find imports: [...] in @Component({ imports: [...] })
      const args = decorator.getArguments()
      if (args.length === 0) continue
      const firstArg = args[0]
      if (firstArg === undefined || !firstArg.isKind(SyntaxKind.ObjectLiteralExpression)) continue

      const importsProp = firstArg.asKindOrThrow(SyntaxKind.ObjectLiteralExpression).getProperty('imports')
      if (!importsProp?.isKind(SyntaxKind.PropertyAssignment)) continue

      const importsInit = importsProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
      if (!importsInit?.isKind(SyntaxKind.ArrayLiteralExpression)) continue

      for (const el of importsInit.asKindOrThrow(SyntaxKind.ArrayLiteralExpression).getElements()) {
        if (!el.isKind(SyntaxKind.Identifier)) continue
        const depName = el.getText()
        // 복합키 우선: import 선언에서 depName의 원본 파일 추적
        let toId: import('@codebase-viz/types').NodeId | undefined
        const importDeclForDep = sourceFile.getImportDeclarations().find(imp =>
          imp.getNamedImports().some(ni => ni.getName() === depName),
        )
        if (importDeclForDep !== undefined) {
          const moduleSpec = importDeclForDep.getModuleSpecifierValue()
          if (moduleSpec.startsWith('.')) {
            const absBase = path.resolve(path.dirname(filePath), moduleSpec)
            for (const tryExt of ['.component.ts', '.ts', '']) {
              const relCandidate = path.relative(repoRoot, absBase + tryExt).replace(/\\/g, '/')
              const hit = classToNodeId.get(`${relCandidate}::${depName}`)
              if (hit !== undefined) { toId = hit; break }
            }
          }
        }
        if (toId === undefined) toId = classNameFallback.get(depName)
        if (toId === undefined) continue

        const edgeId = makeEdgeId('imports', fromId, toId)
        if (!edges.some(e => e.id === edgeId)) {
          edges.push(createEdge({
            id: edgeId,
            from: fromId,
            to: toId,
            kind: 'imports',
            importDepth: 1,
            provenance,
            confidence: 'inferred',
            inferenceChain: [`angular: ${name} imports ${depName} in @Component.imports`],
          }))
        }
      }

      // template: `...` → selector 태그 기반 renders 엣지
      const templateProp = firstArg.asKindOrThrow(SyntaxKind.ObjectLiteralExpression).getProperty('template')
      if (templateProp?.isKind(SyntaxKind.PropertyAssignment)) {
        const templateInit = templateProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
        let templateStr: string | undefined
        if (templateInit?.isKind(SyntaxKind.StringLiteral)) {
          templateStr = templateInit.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue()
        } else if (templateInit !== undefined) {
          // NoSubstitutionTemplateLiteral or TemplateExpression
          const raw = templateInit.getText()
          templateStr = raw.startsWith('`') ? raw.slice(1, -1) : raw
        }

        if (templateStr !== undefined) {
          const tagRe = /<([\w-]+)/g
          let m: RegExpExecArray | null
          while ((m = tagRe.exec(templateStr)) !== null) {
            const tagName = m[1]!
            const toId = selectorToNodeId.get(tagName)
            if (toId === undefined || toId === fromId) continue
            const edgeId = makeEdgeId('renders', fromId, toId)
            if (!edges.some(e => e.id === edgeId)) {
              edges.push(createEdge({
                id: edgeId,
                from: fromId,
                to: toId,
                kind: 'renders',
                provenance,
                confidence: 'inferred',
                inferenceChain: [`angular: <${tagName}> in template of ${name}`],
              }))
            }
          }
        }
      }
    }
  }

  return { nodes, edges }
}
