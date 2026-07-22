import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type Parser from 'web-tree-sitter'
import { createComponentNode, makeNodeId, type ComponentNode, type Provenance } from '@codebase-viz/types'
import { createJavaParser } from '../../_shared/tree-sitter-loader.js'
import { findJavaFiles } from '../../_shared/file-finder.js'

// C3(BE-DIAGRAM-STANDARD v1.2): 외부 시스템 후보 중 @FeignClient만 우선 구현(Less is More) —
// RestTemplate/WebClient는 호출 대상 URL이 표현식/설정값이라 정적 추출 신뢰도가 낮고,
// SAP RFC는 범용 Java 문법만으로 판별 불가(도메인 지식 필요). @JmsListener는 "외부→이 컴포넌트"
// 방향이라 Feign(이 컴포넌트→외부)과 엣지 방향이 달라 별도 설계 필요 — 전부 defer(gbc).
//
// ST7-2 Option A(승인됨): 신규 NodeKind 없이 ComponentNode 재사용. 이름은 실제 인터페이스명 그대로
// 유지한다(di-parser의 @Autowired 필드-타입명 매칭이 이름 기준이라, 접미사를 붙이면 기존 DI 엣지
// 자동 연결이 깨진다) — 대신 provenance.adapter를 마커로 사용해 렌더러가 "외부 시스템"임을 판별한다.
export const EXTERNAL_CALL_ADAPTER_TAG = 'external-call-extractor@0.1'

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

function hasFeignClientAnnotation(modifiers: Parser.SyntaxNode): boolean {
  for (let i = 0; i < modifiers.childCount; i++) {
    const mod = modifiers.child(i)
    if (mod === null || (mod.type !== 'annotation' && mod.type !== 'marker_annotation')) continue
    if (getAnnotationName(mod) === 'FeignClient') return true
  }
  return false
}

export async function parseFeignClients(
  repoRoot: string,
  analyzerVersion: string,
): Promise<ComponentNode[]> {
  const javaFiles = await findJavaFiles(repoRoot)
  if (javaFiles.length === 0) return []

  const parser = await createJavaParser()
  const nodes: ComponentNode[] = []

  for (const filePath of javaFiles) {
    const source = await fs.readFile(filePath, 'utf-8').catch(() => null)
    if (source === null || !source.includes('FeignClient')) continue

    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')
    const tree = parser.parse(source)

    function walkNode(node: Parser.SyntaxNode): void {
      if (node.type === 'interface_declaration') {
        let isFeign = false
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (child !== null && child.type === 'modifiers' && hasFeignClientAnnotation(child)) isFeign = true
        }

        const nameNode = node.childForFieldName('name')
        if (isFeign && nameNode !== null) {
          const className = nameNode.text
          const provenance: Provenance = {
            file: relPath,
            line: node.startPosition.row + 1,
            adapter: EXTERNAL_CALL_ADAPTER_TAG,
            analyzerVersion,
          }
          nodes.push(
            createComponentNode({
              id: makeNodeId('component', relPath, className),
              name: className,
              filePath: relPath,
              runtime: 'server',
              provenance,
              confidence: 'verified',
            }),
          )
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

  return nodes
}
