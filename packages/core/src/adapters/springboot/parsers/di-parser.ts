import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type Parser from 'web-tree-sitter'
import {
  createEdge,
  makeEdgeId,
  type IREdge,
  type ComponentNode,
  type Provenance,
} from '@codebase-viz/types'
import { createJavaParser } from '../../_shared/tree-sitter-loader.js'
import { findJavaFiles } from '../../_shared/file-finder.js'

const SPRING_COMPONENT_ANNOTATIONS = new Set([
  'Controller', 'RestController', 'Service', 'Repository', 'Component',
])

function getAnnotationName(node: Parser.SyntaxNode): string | undefined {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child !== null && child.type === 'identifier') return child.text
    if (child !== null && child.type === 'scoped_identifier') {
      const last = child.lastChild
      if (last !== null) return last.text
    }
  }
  return undefined
}

function hasAutowired(modifiers: Parser.SyntaxNode): boolean {
  for (let i = 0; i < modifiers.childCount; i++) {
    const node = modifiers.child(i)
    if (node === null) continue
    if (node.type === 'annotation' || node.type === 'marker_annotation') {
      if (getAnnotationName(node) === 'Autowired') return true
    }
  }
  return false
}

// A-ST1: 클래스 레벨 Lombok 생성자 어노테이션 — final 필드를 생성자 주입으로 간주.
function hasLombokCtorAnnotation(node: Parser.SyntaxNode): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child === null || child.type !== 'modifiers') continue
    for (let j = 0; j < child.childCount; j++) {
      const mod = child.child(j)
      if (mod === null || (mod.type !== 'annotation' && mod.type !== 'marker_annotation')) continue
      const name = getAnnotationName(mod)
      if (name === 'RequiredArgsConstructor' || name === 'AllArgsConstructor') return true
    }
  }
  return false
}

function isFinalField(member: Parser.SyntaxNode): boolean {
  for (let i = 0; i < member.childCount; i++) {
    const part = member.child(i)
    if (part === null || part.type !== 'modifiers') continue
    for (let j = 0; j < part.childCount; j++) {
      if (part.child(j)?.type === 'final') return true
    }
  }
  return false
}

// A-ST1: `class X implements A, B` 의 구현 인터페이스 이름 목록.
function extractImplementedInterfaces(node: Parser.SyntaxNode): string[] {
  const names: string[] = []
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child === null || child.type !== 'super_interfaces') continue
    for (const tid of child.descendantsOfType('type_identifier')) names.push(tid.text)
  }
  return names
}

function extractParamTypes(formalParams: Parser.SyntaxNode): string[] {
  const types: string[] = []
  for (let i = 0; i < formalParams.childCount; i++) {
    const param = formalParams.child(i)
    if (param === null || param.type !== 'formal_parameter') continue
    for (let j = 0; j < param.childCount; j++) {
      const child = param.child(j)
      if (child !== null && child.type === 'type_identifier') {
        types.push(child.text)
        break
      }
    }
  }
  return types
}

export async function parseSpringDependencies(
  repoRoot: string,
  componentNodes: ComponentNode[],
  analyzerVersion: string,
): Promise<IREdge[]> {
  if (componentNodes.length === 0) return []

  const nameToNode = new Map<string, ComponentNode>()
  for (const node of componentNodes) {
    nameToNode.set(node.name, node)
  }

  const javaFiles = await findJavaFiles(repoRoot)
  if (javaFiles.length === 0) return []

  const parser = await createJavaParser()
  const edges: IREdge[] = []
  const seenEdgeIds = new Set<string>()

  function addEdge(from: ComponentNode, toTypeName: string, provenance: Provenance): void {
    // Spring 표준: Controller가 Service interface 주입 시 ServiceImpl로 fallback 매핑.
    const direct = nameToNode.get(toTypeName)
    const toNode = direct ?? nameToNode.get(`${toTypeName}Impl`)
    if (toNode === undefined || from.id === toNode.id) return
    const edgeId = makeEdgeId('calls', from.id, toNode.id)
    if (seenEdgeIds.has(edgeId)) return
    seenEdgeIds.add(edgeId)
    const chain = [`spring-di: ${from.name} → ${toTypeName} in ${provenance.file}`]
    if (direct === undefined) chain.push(`resolved via Impl fallback as ${toTypeName}Impl`)
    edges.push(
      createEdge({
        id: edgeId,
        from: from.id,
        to: toNode.id,
        kind: 'calls',
        provenance,
        confidence: 'inferred',
        inferenceChain: chain,
      }),
    )
  }

  // A-ST1: interface → 구현 클래스 calls 엣지 (DI 체인의 Service → ServiceImpl 단계).
  function addImplementsEdge(implClass: ComponentNode, interfaceName: string, provenance: Provenance): void {
    const ifaceNode = nameToNode.get(interfaceName)
    if (ifaceNode === undefined || ifaceNode.id === implClass.id) return
    const edgeId = makeEdgeId('calls', ifaceNode.id, implClass.id)
    if (seenEdgeIds.has(edgeId)) return
    seenEdgeIds.add(edgeId)
    edges.push(
      createEdge({
        id: edgeId,
        from: ifaceNode.id,
        to: implClass.id,
        kind: 'calls',
        provenance,
        confidence: 'inferred',
        inferenceChain: [`spring-di: ${implClass.name} implements ${interfaceName} in ${provenance.file}`],
      }),
    )
  }

  for (const filePath of javaFiles) {
    const source = await fs.readFile(filePath, 'utf-8').catch(() => null)
    if (source === null) continue

    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')
    const tree = parser.parse(source)

    function walkNode(node: Parser.SyntaxNode): void {
      if (node.type !== 'class_declaration') {
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (child !== null) walkNode(child)
        }
        return
      }

      const nameNode = node.childForFieldName('name')
      if (nameNode === null) return
      const fromNode = nameToNode.get(nameNode.text)
      if (fromNode === undefined) return

      // Verify class has Spring component annotation
      let isSpringComponent = false
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child === null || child.type !== 'modifiers') continue
        for (let j = 0; j < child.childCount; j++) {
          const mod = child.child(j)
          if (mod === null || (mod.type !== 'annotation' && mod.type !== 'marker_annotation')) continue
          const annotName = getAnnotationName(mod)
          if (annotName !== undefined && SPRING_COMPONENT_ANNOTATIONS.has(annotName)) {
            isSpringComponent = true
            break
          }
        }
        if (isSpringComponent) break
      }
      if (!isSpringComponent) return

      const provenance: Provenance = {
        file: relPath,
        line: node.startPosition.row + 1,
        adapter: 'spring-di-parser@0.1',
        analyzerVersion,
      }

      // A-ST1: implements 인터페이스 → 구현 클래스 엣지 (Service → ServiceImpl)
      for (const ifaceName of extractImplementedInterfaces(node)) {
        addImplementsEdge(fromNode, ifaceName, provenance)
      }

      // A-ST1: Lombok @RequiredArgsConstructor/@AllArgsConstructor → final 필드 생성자 주입
      const lombokCtorInject = hasLombokCtorAnnotation(node)

      for (let i = 0; i < node.childCount; i++) {
        const classBody = node.child(i)
        if (classBody === null || classBody.type !== 'class_body') continue

        const constructors: Array<{ autowired: boolean; paramTypes: string[] }> = []

        for (let j = 0; j < classBody.childCount; j++) {
          const member = classBody.child(j)
          if (member === null) continue

          // Field injection: @Autowired on field, 또는 Lombok 생성자 주입(final 필드)
          if (member.type === 'field_declaration') {
            let autowired = false
            let fieldType: string | undefined
            for (let k = 0; k < member.childCount; k++) {
              const part = member.child(k)
              if (part === null) continue
              if (part.type === 'modifiers' && hasAutowired(part)) autowired = true
              if (part.type === 'type_identifier') fieldType = part.text
            }
            // Lombok: 명시적 초기화 없는 final 필드만 주입 대상 (`= null` 등 초기화 시 제외)
            const lombokInject = lombokCtorInject && isFinalField(member)
              && member.descendantsOfType('variable_declarator').every(vd => vd.childForFieldName('value') === null)
            if ((autowired || lombokInject) && fieldType !== undefined) addEdge(fromNode, fieldType, provenance)
          }

          // Constructor injection (collected for single-ctor auto-inject)
          if (member.type === 'constructor_declaration') {
            let autowired = false
            let paramTypes: string[] = []
            for (let k = 0; k < member.childCount; k++) {
              const part = member.child(k)
              if (part === null) continue
              if (part.type === 'modifiers' && hasAutowired(part)) autowired = true
              if (part.type === 'formal_parameters') paramTypes = extractParamTypes(part)
            }
            constructors.push({ autowired, paramTypes })
          }

          // Setter injection: @Autowired on method starting with "set"
          if (member.type === 'method_declaration') {
            let autowired = false
            let methodName: string | undefined
            let paramTypes: string[] = []
            for (let k = 0; k < member.childCount; k++) {
              const part = member.child(k)
              if (part === null) continue
              if (part.type === 'modifiers' && hasAutowired(part)) autowired = true
              if (part.type === 'identifier') methodName = part.text
              if (part.type === 'formal_parameters') paramTypes = extractParamTypes(part)
            }
            if (autowired && methodName?.startsWith('set') === true) {
              for (const t of paramTypes) addEdge(fromNode, t, provenance)
            }
          }
        }

        // Single constructor → Spring auto-injects. Multi-constructor → only @Autowired one.
        if (constructors.length === 1 && constructors[0] !== undefined) {
          for (const t of constructors[0].paramTypes) addEdge(fromNode, t, provenance)
        } else {
          for (const ctor of constructors) {
            if (ctor.autowired) {
              for (const t of ctor.paramTypes) addEdge(fromNode, t, provenance)
            }
          }
        }
      }
    }

    walkNode(tree.rootNode)
  }

  return edges
}
