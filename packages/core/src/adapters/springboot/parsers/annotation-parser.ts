import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type Parser from 'web-tree-sitter'
import {
  createRouteNode,
  makeNodeId,
  astToProvenance,
  type RouteNode,
  type DynamicSegmentType,
} from '@codebase-viz/types'
import { createJavaParser } from '../../_shared/tree-sitter-loader.js'
import { normalizeUrlPath } from '../../_shared/url-path-normalizer.js'

const EXCLUDE_DIRS = new Set(['.git', 'node_modules', 'target', 'build', '.gradle'])
const HTTP_MAPPING_ANNOTATIONS = new Set([
  'GetMapping', 'PostMapping', 'PutMapping', 'DeleteMapping', 'PatchMapping',
])
const CONTROLLER_ANNOTATIONS = new Set(['RestController', 'Controller'])

async function findJavaFiles(repoRoot: string): Promise<string[]> {
  const results: string[] = []
  async function recurse(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null)
    if (entries === null) return
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name)) await recurse(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.java')) {
        results.push(fullPath)
      }
    }
  }
  await recurse(repoRoot)
  return results
}

function extractStringFragment(node: Parser.SyntaxNode): string | undefined {
  for (let k = 0; k < node.childCount; k++) {
    const frag = node.child(k)
    if (frag !== null && frag.type === 'string_fragment') return frag.text
  }
  return undefined
}

// Extracts all string paths from annotation_argument_list.
// Handles single string, array {"/a","/b"}, and value="/a" element_value_pair forms.
function getAnnotationStringArgs(annotation: Parser.SyntaxNode): string[] {
  const paths: string[] = []
  for (let i = 0; i < annotation.childCount; i++) {
    const child = annotation.child(i)
    if (child === null || child.type !== 'annotation_argument_list') continue
    for (let j = 0; j < child.childCount; j++) {
      const arg = child.child(j)
      if (arg === null) continue
      if (arg.type === 'string_literal') {
        const v = extractStringFragment(arg)
        if (v !== undefined) paths.push(v)
      }
      if (arg.type === 'element_value_array_initializer') {
        for (let k = 0; k < arg.childCount; k++) {
          const el = arg.child(k)
          if (el !== null && el.type === 'string_literal') {
            const v = extractStringFragment(el)
            if (v !== undefined) paths.push(v)
          }
        }
      }
      if (arg.type === 'element_value_pair') {
        for (let k = 0; k < arg.childCount; k++) {
          const val = arg.child(k)
          if (val === null) continue
          if (val.type === 'string_literal') {
            const v = extractStringFragment(val)
            if (v !== undefined) paths.push(v)
          }
          if (val.type === 'element_value_array_initializer') {
            for (let m = 0; m < val.childCount; m++) {
              const el = val.child(m)
              if (el !== null && el.type === 'string_literal') {
                const v = extractStringFragment(el)
                if (v !== undefined) paths.push(v)
              }
            }
          }
        }
      }
    }
  }
  return paths
}

interface AnnotationInfo {
  name: string
  pathArgs: string[]
  row: number
  col: number
}

function extractAnnotations(modifiers: Parser.SyntaxNode): AnnotationInfo[] {
  const infos: AnnotationInfo[] = []
  for (let i = 0; i < modifiers.childCount; i++) {
    const node = modifiers.child(i)
    if (node === null) continue
    if (node.type === 'annotation' || node.type === 'marker_annotation') {
      const nameNode = node.child(1) // @ + name
      if (nameNode === null) continue
      const name = nameNode.text
      const pathArgs = getAnnotationStringArgs(node)
      infos.push({ name, pathArgs, row: node.startPosition.row, col: node.startPosition.column })
    }
  }
  return infos
}

function getDynamicSegmentType(urlPath: string): DynamicSegmentType {
  return urlPath.includes(':') ? 'dynamic' : 'static'
}

function composePath(classPrefix: string, methodSuffix: string): string {
  const prefix = classPrefix.endsWith('/') ? classPrefix.slice(0, -1) : classPrefix
  const suffix = methodSuffix.startsWith('/') ? methodSuffix : '/' + methodSuffix
  return prefix + (methodSuffix === '' ? '' : suffix)
}

export async function parseAnnotations(
  repoRoot: string,
  analyzerVersion = 'codebase-viz@0.1.0',
): Promise<RouteNode[]> {
  const javaFiles = await findJavaFiles(repoRoot)
  if (javaFiles.length === 0) return []

  const javaParser = await createJavaParser()
  const routes: RouteNode[] = []

  for (const absPath of javaFiles) {
    const source = await fs.readFile(absPath, 'utf-8').catch(() => null)
    if (source === null) continue
    const relPath = path.relative(repoRoot, absPath).replace(/\\/g, '/')
    const tree = javaParser.parse(source)

    // Walk class_declarations
    function walkNode(node: Parser.SyntaxNode): void {
      if (node.type === 'class_declaration') {
        // Check class-level modifiers
        let isController = false
        let classPrefix = ''
        let prefixRow = 0
        let prefixCol = 0

        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (child === null || child.type !== 'modifiers') continue
          const annotations = extractAnnotations(child)
          for (const ann of annotations) {
            if (CONTROLLER_ANNOTATIONS.has(ann.name)) isController = true
            if (ann.name === 'RequestMapping' && ann.pathArgs.length > 0 && ann.pathArgs[0] !== undefined) {
              classPrefix = ann.pathArgs[0]
              prefixRow = ann.row
              prefixCol = ann.col
            }
          }
        }

        if (!isController) {
          // still recurse for nested classes
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i)
            if (child !== null) walkNode(child)
          }
          return
        }

        // Walk methods
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (child === null || child.type !== 'class_body') continue
          for (let j = 0; j < child.childCount; j++) {
            const method = child.child(j)
            if (method === null || method.type !== 'method_declaration') continue

            for (let k = 0; k < method.childCount; k++) {
              const modifiers = method.child(k)
              if (modifiers === null || modifiers.type !== 'modifiers') continue
              const annotations = extractAnnotations(modifiers)

              for (const ann of annotations) {
                if (!HTTP_MAPPING_ANNOTATIONS.has(ann.name) && ann.name !== 'RequestMapping') continue

                const methodSuffixes = ann.pathArgs.length > 0 ? ann.pathArgs : ['']
                const row = ann.row !== undefined ? ann.row : prefixRow

                for (const methodSuffix of methodSuffixes) {
                  const rawPath = composePath(classPrefix, methodSuffix)
                  if (rawPath === '') continue

                  const urlPath = normalizeUrlPath(rawPath)

                  routes.push(
                    createRouteNode({
                      id: makeNodeId('route', relPath, `${urlPath}:${ann.name}`),
                      path: urlPath,
                      filePath: relPath,
                      routeFileKind: 'page',
                      dynamicSegmentType: getDynamicSegmentType(urlPath),
                      isGroupRoute: false,
                      renderingMode: 'SSR',
                      provenance: astToProvenance(
                        relPath,
                        { row, column: ann.col },
                        'springboot@0.1',
                        analyzerVersion,
                      ),
                      confidence: 'verified',
                    }),
                  )
                }
              }
            }
          }
        }
        return
      }
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child !== null) walkNode(child)
      }
    }

    walkNode(tree.rootNode)
  }

  return routes
}
