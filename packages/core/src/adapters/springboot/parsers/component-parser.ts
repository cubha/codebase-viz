import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  createComponentNode,
  makeNodeId,
  type ComponentNode,
  type Provenance,
} from '@codebase-viz/types'
import { createJavaParser } from '../../_shared/tree-sitter-loader.js'

const EXCLUDE_DIRS = new Set(['.git', 'node_modules', 'target', 'build', '.gradle'])
const COMPONENT_ANNOTATIONS = new Set(['Service', 'Component', 'Repository', 'Controller', 'RestController'])

async function findJavaFiles(repoRoot: string): Promise<string[]> {
  const results: string[] = []
  async function recurse(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null)
    if (entries === null) return
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name)) await recurse(path.join(dir, entry.name))
      } else if (entry.isFile() && entry.name.endsWith('.java')) {
        results.push(path.join(dir, entry.name))
      }
    }
  }
  await recurse(repoRoot)
  return results
}

function getAnnotationName(annotNode: import('web-tree-sitter').SyntaxNode): string | undefined {
  for (let i = 0; i < annotNode.childCount; i++) {
    const child = annotNode.child(i)
    if (child !== null && child.type === 'identifier') return child.text
    if (child !== null && child.type === 'scoped_identifier') {
      const last = child.lastChild
      if (last !== null) return last.text
    }
  }
  return undefined
}

export async function parseSpringComponents(
  repoRoot: string,
  analyzerVersion: string,
): Promise<ComponentNode[]> {
  const javaFiles = await findJavaFiles(repoRoot)
  if (javaFiles.length === 0) return []

  const parser = await createJavaParser()
  const nodes: ComponentNode[] = []

  for (const filePath of javaFiles) {
    const source = await fs.readFile(filePath, 'utf-8').catch(() => null)
    if (source === null) continue

    const hasComponent = source.includes('@Service')
      || source.includes('@Component')
      || source.includes('@Repository')
      || source.includes('@Controller')
      || source.includes('@RestController')
    if (!hasComponent) continue

    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')
    const tree = parser.parse(source)

    function walkNode(node: import('web-tree-sitter').SyntaxNode): void {
      if (node.type === 'class_declaration') {
        let matchedAnnotation: string | undefined
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (child === null) continue
          if (child.type === 'modifiers') {
            for (let j = 0; j < child.childCount; j++) {
              const mod = child.child(j)
              if (mod === null || (mod.type !== 'annotation' && mod.type !== 'marker_annotation')) continue
              const annotName = getAnnotationName(mod)
              if (annotName !== undefined && COMPONENT_ANNOTATIONS.has(annotName)) {
                matchedAnnotation = annotName
                break
              }
            }
          }
        }

        if (matchedAnnotation !== undefined) {
          const nameNode = node.childForFieldName('name')
          if (nameNode !== null) {
            const className = nameNode.text
            const provenance: Provenance = {
              file: relPath,
              line: node.startPosition.row + 1,
              adapter: 'spring-component-parser@0.1',
              analyzerVersion,
            }
            nodes.push(
              createComponentNode({
                id: makeNodeId('component', relPath, className),
                name: className,
                filePath: relPath,
                runtime: 'server',
                provenance,
                confidence: 'inferred',
                inferenceChain: [`spring: @${matchedAnnotation} class ${className} in ${relPath}`],
              }),
            )
          }
        }
      }
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child !== null) walkNode(child)
      }
    }

    walkNode(tree.rootNode)
  }

  return nodes
}
