import {
  isComponentNode,
  isRouteNode,
  isTableNode,
  type IRGraph,
  type IREdge,
  type IRNode,
  type ComponentNode,
} from '@codebase-viz/types'
import { sanitizeId } from '../helpers/ids.js'
import { escapeSequenceLabel } from '../helpers/label-escape.js'
import { SEQUENCE_INIT } from '../helpers/constants.js'
import { joinChunks } from '../_shared/wrap-fallback.js'

// DI 체인 재귀 깊이 가드 — be/tab2.ts renderControllerLeaf와 동일 값(정상 체인은
// Controller→Svc→Impl→Repo→XML→Statement = 5, C1). 순환 그래프 폭주 방지용이지 정상 케이스를
// 자르기 위함이 아니다.
const MAX_DEPTH = 6

// 청크당 participant 상한. flowchart 계열의 노드 budget(50)을 그대로 쓸 수 없다 — sequenceDiagram은
// 폭이 O(participant)인 1차원 레이아웃이라, 501 participant를 한 다이어그램에 넣으면 fit 배율이
// 1/60으로 떨어져 화면이 사실상 백지가 된다(2026-08-28 실측: 100 라우트/501 participant).
// 12는 1600px 뷰포트에서 actor 박스가 라벨 잘림 없이 들어가는 실측 상한.
// 한 체인(FE→route→controller→DI 체인→table)이 혼자 이 수를 넘으면 그 체인만 담은 청크가 된다 —
// 체인을 쪼개면 시퀀스로서 의미를 잃으므로 그때는 예산보다 체인 완결성을 우선한다.
const MAX_PARTICIPANTS_PER_CHUNK = 12

function seqArrow(edge: IREdge): string {
  return edge.confidence === 'inferred' ? '-->>' : '->>'
}

function labelFor(node: IRNode): string {
  switch (node.kind) {
    case 'route': return node.path
    case 'component': return node.name
    case 'table': return node.name
  }
}

// FE ComponentNode →(fe-be-call, matched)→ BE RouteNode →(handles)→ Controller
// →(calls, N-ary 재귀)→ Service/Repository →(queries)→ Table 체인을 mermaid sequenceDiagram으로
// emit한다. drawableEdges는 buildCombinedDiagram이 이미 계산한 matched-only 목록을 그대로
// 받는다 — 이 함수는 신규 매칭·임계 계산을 하지 않는다(v1.2.49 freeze 재발 방지).
export function buildSequenceDiagram(
  feGraph: IRGraph,
  beGraph: IRGraph,
  drawableEdges: readonly IREdge[],
): string {
  const feById = new Map<string, IRNode>(feGraph.nodes.map(n => [n.id, n]))
  const beById = new Map<string, IRNode>(beGraph.nodes.map(n => [n.id, n]))

  // route → 대표 Controller (fan-in 중 첫 번째. edges 배열 순서가 파서 출력 순이라 결정론적).
  const handlesByRoute = new Map<string, IREdge>()
  const callsByFrom = new Map<string, IREdge[]>()
  const queriesByFrom = new Map<string, IREdge[]>()
  for (const e of beGraph.edges) {
    if (e.kind === 'handles') {
      if (!handlesByRoute.has(e.from)) handlesByRoute.set(e.from, e)
    } else if (e.kind === 'calls') {
      const list = callsByFrom.get(e.from) ?? []
      list.push(e)
      callsByFrom.set(e.from, list)
    } else if (e.kind === 'queries') {
      const list = queriesByFrom.get(e.from) ?? []
      list.push(e)
      queriesByFrom.set(e.from, list)
    }
  }

  const chunks: string[] = []
  let participants = new Map<string, string>() // sid → escaped label (insertion order = declare order)
  let messages: string[] = []
  // 체인 하나를 먼저 여기에 쌓고, 현재 청크에 합쳤을 때 예산을 넘는지 보고 배치를 정한다.
  // 사후 판정(넘고 나서 자르기)이면 청크가 예산을 초과한 채 확정된다 — 실측 13/12.
  let pending = new Map<string, string>()
  let pendingMessages: string[] = []

  // 청크 하나 = 독립된 완결 mermaid 문서. viewer의 splitChunks가 각 청크를 개별 render에 넘기므로
  // SEQUENCE_INIT을 첫 청크에만 붙이면 2번째 행부터 mermaid 기본 테마(밝은 배경·mirrorActors)로
  // 되돌아간다 — 사용자가 지적했던 그 결함이 행마다 부활한다.
  const flushChunk = (): void => {
    if (messages.length === 0) return
    const lines = [SEQUENCE_INIT, 'sequenceDiagram']
    for (const [sid, label] of participants) lines.push(`  participant ${sid} as ${label}`)
    lines.push(...messages)
    chunks.push(lines.join('\n'))
    participants = new Map()
    messages = []
  }

  const declareParticipant = (node: IRNode): string => {
    const sid = sanitizeId(node.id)
    if (!participants.has(sid) && !pending.has(sid)) pending.set(sid, escapeSequenceLabel(labelFor(node)))
    return sid
  }

  // 방금 만든 체인을 현재 청크에 합치거나, 넘치면 청크를 닫고 새 청크의 첫 체인으로 놓는다.
  const commitChain = (): void => {
    if (pendingMessages.length === 0) { pending = new Map(); return }
    let union = participants.size
    for (const sid of pending.keys()) if (!participants.has(sid)) union++
    if (participants.size > 0 && union > MAX_PARTICIPANTS_PER_CHUNK) flushChunk()
    for (const [sid, label] of pending) if (!participants.has(sid)) participants.set(sid, label)
    messages.push(...pendingMessages)
    pending = new Map()
    pendingMessages = []
  }

  const emitCallsChain = (from: ComponentNode, depth: number, visited: Set<string>): void => {
    if (depth > MAX_DEPTH || visited.has(from.id)) return
    visited.add(from.id)
    const fromSid = sanitizeId(from.id)

    for (const edge of callsByFrom.get(from.id) ?? []) {
      const target = beById.get(edge.to)
      if (target === undefined || !isComponentNode(target)) continue
      const toSid = declareParticipant(target)
      pendingMessages.push(`  ${fromSid}${seqArrow(edge)}${toSid}: ${escapeSequenceLabel(target.name)}`)
      emitCallsChain(target, depth + 1, visited)
    }
    for (const edge of queriesByFrom.get(from.id) ?? []) {
      const table = beById.get(edge.to)
      if (table === undefined || !isTableNode(table)) continue
      const tableSid = declareParticipant(table)
      pendingMessages.push(`  ${fromSid}${seqArrow(edge)}${tableSid}: ${escapeSequenceLabel(table.name)}`)
    }
  }

  for (const edge of drawableEdges) {
    const feComp = feById.get(edge.from)
    const beRoute = beById.get(edge.to)
    if (feComp === undefined || !isComponentNode(feComp)) continue
    if (beRoute === undefined || !isRouteNode(beRoute)) continue

    const feSid = declareParticipant(feComp)
    const routeSid = declareParticipant(beRoute)
    pendingMessages.push(`  ${feSid}${seqArrow(edge)}${routeSid}: ${escapeSequenceLabel(beRoute.path)}`)

    const handlesEdge = handlesByRoute.get(beRoute.id)
    if (handlesEdge === undefined) { commitChain(); continue }
    const controller = beById.get(handlesEdge.to)
    if (controller === undefined || !isComponentNode(controller)) { commitChain(); continue }
    const ctrlSid = declareParticipant(controller)
    pendingMessages.push(`  ${routeSid}${seqArrow(handlesEdge)}${ctrlSid}: ${escapeSequenceLabel(controller.name)}`)

    emitCallsChain(controller, 0, new Set())
    commitChain()
  }

  flushChunk()
  return joinChunks(chunks)
}
