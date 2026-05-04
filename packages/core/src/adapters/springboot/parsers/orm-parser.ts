import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  createTableNode,
  makeNodeId,
  type TableNode,
  type ColumnDef,
  type Provenance,
} from '@codebase-viz/types'
import { createJavaParser } from '../../_shared/tree-sitter-loader.js'

const EXCLUDE_DIRS = new Set(['.git', 'node_modules', 'target', 'build', '.gradle'])

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
      return child.lastChild?.text
    }
  }
  return undefined
}

export async function parseJpaEntities(
  repoRoot: string,
  analyzerVersion: string,
): Promise<TableNode[]> {
  const javaFiles = await findJavaFiles(repoRoot)
  if (javaFiles.length === 0) return []

  const parser = await createJavaParser()
  const tables: TableNode[] = []

  for (const filePath of javaFiles) {
    const source = await fs.readFile(filePath, 'utf-8').catch(() => null)
    if (source === null || !source.includes('@Entity')) continue

    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')
    const tree = parser.parse(source)

    function walkNode(node: import('web-tree-sitter').SyntaxNode): void {
      if (node.type === 'class_declaration') {
        let isEntity = false
        let tableName: string | undefined

        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (child === null || child.type !== 'modifiers') continue
          for (let j = 0; j < child.childCount; j++) {
            const mod = child.child(j)
            if (mod === null || (mod.type !== 'annotation' && mod.type !== 'marker_annotation')) continue
            const annotName = getAnnotationName(mod)
            if (annotName === 'Entity') {
              isEntity = true
            } else if (annotName === 'Table') {
              for (let k = 0; k < mod.childCount; k++) {
                const argNode = mod.child(k)
                if (argNode === null || argNode.type !== 'annotation_argument_list') continue
                for (let l = 0; l < argNode.childCount; l++) {
                  const pair = argNode.child(l)
                  if (pair === null || pair.type !== 'element_value_pair') continue
                  const keyNode = pair.child(0)
                  const valNode = pair.child(2)
                  if (keyNode?.text === 'name' && valNode?.type === 'string_literal') {
                    for (let m = 0; m < valNode.childCount; m++) {
                      const frag = valNode.child(m)
                      if (frag !== null && frag.type === 'string_fragment') tableName = frag.text
                    }
                  }
                }
              }
            }
          }
        }

        if (!isEntity) {
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i)
            if (child !== null) walkNode(child)
          }
          return
        }

        const nameNode = node.childForFieldName('name')
        if (nameNode === null) return
        const className = nameNode.text
        const resolvedTableName = tableName ?? className

        const columns: ColumnDef[] = []
        const body = node.childForFieldName('body')
        if (body !== null) {
          for (let i = 0; i < body.childCount; i++) {
            const member = body.child(i)
            if (member === null || member.type !== 'field_declaration') continue

            let hasColumn = false
            let isPrimary = false
            let isManyToOne = false
            let nullable: boolean = true
            let joinColumnName: string | undefined

            for (let j = 0; j < member.childCount; j++) {
              const mod = member.child(j)
              if (mod === null || mod.type !== 'modifiers') continue
              for (let k = 0; k < mod.childCount; k++) {
                const annot = mod.child(k)
                if (annot === null || (annot.type !== 'annotation' && annot.type !== 'marker_annotation')) continue
                const annotName = getAnnotationName(annot)
                if (annotName === 'Column') {
                  hasColumn = true
                  // @Column(nullable = false/true) 파싱 — marker_annotation은 인자 없으므로 스킵
                  if (annot.type === 'annotation') {
                    for (let l = 0; l < annot.childCount; l++) {
                      const argList = annot.child(l)
                      if (argList === null || argList.type !== 'annotation_argument_list') continue
                      for (let m = 0; m < argList.childCount; m++) {
                        const pair = argList.child(m)
                        if (pair === null || pair.type !== 'element_value_pair') continue
                        const keyNode = pair.child(0)
                        const valNode = pair.child(2)
                        if (keyNode?.text === 'nullable') {
                          if (valNode?.type === 'false') nullable = false
                          else if (valNode?.type === 'true') nullable = true
                        }
                      }
                    }
                  }
                }
                if (annotName === 'JoinColumn') {
                  hasColumn = true
                  // @JoinColumn(name = "col_name") 파싱
                  if (annot.type === 'annotation') {
                    for (let l = 0; l < annot.childCount; l++) {
                      const argList = annot.child(l)
                      if (argList === null || argList.type !== 'annotation_argument_list') continue
                      for (let m = 0; m < argList.childCount; m++) {
                        const pair = argList.child(m)
                        if (pair === null || pair.type !== 'element_value_pair') continue
                        const keyNode = pair.child(0)
                        const valNode = pair.child(2)
                        if (keyNode?.text === 'name' && valNode?.type === 'string_literal') {
                          for (let n = 0; n < valNode.childCount; n++) {
                            const frag = valNode.child(n)
                            if (frag !== null && frag.type === 'string_fragment') joinColumnName = frag.text
                          }
                        }
                      }
                    }
                  }
                }
                if (annotName === 'Id' || annotName === 'GeneratedValue') isPrimary = true
                if (annotName === 'ManyToOne' || annotName === 'ManyToMany') {
                  hasColumn = true
                  isManyToOne = true
                }
              }
            }

            if (isPrimary) nullable = false
            if (!hasColumn && !isPrimary) continue

            const declarators = member.descendantsOfType('variable_declarator')
            for (const decl of declarators) {
              const nameChild = decl.childForFieldName('name')
              if (nameChild !== null) {
                const typeNode = member.childForFieldName('type')
                const colType = typeNode?.text ?? 'unknown'
                const colName = joinColumnName ?? (isManyToOne ? nameChild.text + '_id' : nameChild.text)
                columns.push({
                  name: colName,
                  type: colType,
                  nullable,
                  isPrimaryKey: isPrimary,
                  ...(isManyToOne && colType !== 'unknown' ? { references: { table: colType, column: 'id' } } : {}),
                })
              }
            }
          }
        }

        const provenance: Provenance = {
          file: relPath,
          line: node.startPosition.row + 1,
          adapter: 'jpa-orm-parser@0.1',
          analyzerVersion,
        }

        tables.push(
          createTableNode({
            id: makeNodeId('table', relPath, resolvedTableName),
            name: resolvedTableName,
            columns,
            provenance,
            confidence: 'inferred',
            inferenceChain: [`jpa: @Entity class ${className} in ${relPath}`],
          }),
        )
        return
      }
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child !== null) walkNode(child)
      }
    }

    walkNode(tree.rootNode)
  }

  return tables
}
