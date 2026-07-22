import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  createComponentNode,
  makeNodeId,
  type ComponentNode,
} from '@codebase-viz/types'
import { createPythonParser } from '../../_shared/tree-sitter-loader.js'
import { findPyFiles } from '../../_shared/file-finder.js'

const ROUTER_HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'options', 'head'])

function extractDecoratorNames(node: import('web-tree-sitter').SyntaxNode): string[] {
  const decorators: string[] = []
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child === null || child.type !== 'decorator') continue
    // decorator text: e.g. "@router.get('/path')" — grab the attribute/call expression
    const decoratorText = child.text
    const m = decoratorText.match(/@([\w.]+)/)
    if (m !== null) decorators.push(m[1]!)
  }
  return decorators
}

function isRouterDecorator(decoratorName: string): boolean {
  const parts = decoratorName.split('.')
  if (parts.length < 2) return false
  const method = parts[parts.length - 1]
  return method !== undefined && ROUTER_HTTP_METHODS.has(method)
}

export async function parseFastapiComponents(
  repoRoot: string,
  analyzerVersion: string,
): Promise<ComponentNode[]> {
  const pyFiles = await findPyFiles(repoRoot)
  if (pyFiles.length === 0) return []

  const parser = await createPythonParser()
  const nodes: ComponentNode[] = []

  for (const filePath of pyFiles) {
    const source = await fs.readFile(filePath, 'utf-8').catch(() => null)
    if (source === null) continue
    if (!source.includes('BaseModel') && !source.includes('APIRouter')) continue

    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')
    const tree = parser.parse(source)

    for (let i = 0; i < tree.rootNode.childCount; i++) {
      const node = tree.rootNode.child(i)
      if (node === null) continue

      // BaseModel subclass → Schema component
      if (node.type === 'class_definition') {
        const nameNode = node.childForFieldName('name')
        if (nameNode === null) continue
        const className = nameNode.text

        const baseClause = node.childForFieldName('superclasses')
        if (baseClause === null) continue

        let isModel = false
        for (let j = 0; j < baseClause.childCount; j++) {
          const base = baseClause.child(j)
          if (base !== null && (base.text === 'BaseModel' || base.text.endsWith('Schema'))) {
            isModel = true
            break
          }
        }
        if (!isModel) continue

        nodes.push(
          createComponentNode({
            id: makeNodeId('component', relPath, className),
            name: className,
            filePath: relPath,
            runtime: 'server',
            provenance: {
              file: relPath,
              line: node.startPosition.row + 1,
              adapter: 'fastapi-component-parser@0.1',
              analyzerVersion,
            },
            confidence: 'inferred',
            inferenceChain: [`fastapi: BaseModel subclass ${className} in ${relPath}`],
          }),
        )
        continue
      }

      // @router.get/post/... decorated handler function
      if (node.type === 'decorated_definition') {
        const decorators = extractDecoratorNames(node)
        if (!decorators.some(isRouterDecorator)) continue

        // The function_definition is the last child of decorated_definition
        let funcDef: import('web-tree-sitter').SyntaxNode | null = null
        for (let j = node.childCount - 1; j >= 0; j--) {
          const child = node.child(j)
          if (child !== null && child.type === 'function_definition') {
            funcDef = child
            break
          }
        }
        if (funcDef === null) continue

        const nameNode = funcDef.childForFieldName('name')
        if (nameNode === null) continue
        const funcName = nameNode.text

        nodes.push(
          createComponentNode({
            id: makeNodeId('component', relPath, funcName),
            name: funcName,
            filePath: relPath,
            runtime: 'server',
            provenance: {
              file: relPath,
              line: node.startPosition.row + 1,
              adapter: 'fastapi-component-parser@0.1',
              analyzerVersion,
            },
            confidence: 'inferred',
            inferenceChain: [`fastapi: @router handler ${funcName} in ${relPath}`],
          }),
        )
      }
    }
  }

  return nodes
}
