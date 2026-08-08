import type { IRGraph, IRNode, RouteNode } from '@codebase-viz/types'
import { sanitizeId } from './ids.js'

// 폴더/패키지 박스는 하위 라우트 N개를 합친 집계 노드라 대응 소스 파일이 1:1로 없다. 딥링크가
// 통째로 죽지 않도록 "대표 라우트"를 정한다: URL 세그먼트가 가장 얕은 것(= 그 묶음의 진입점),
// 동수면 id 사전순으로 결정론 고정. Tab1 폴더·BE leaf·패키지 트리가 이 규칙을 공유한다.
// 단, BE Tab2는 트리에 라우트가 아니라 컨트롤러를 매달아(`routes: []`) 파일 경로 기준 대표 선정으로
// 폴백하므로(pkg-tree.ts representativeFileNodeId), 같은 패키지 박스라도 Tab1과 Tab2가 서로 다른
// 컨트롤러를 가리킬 수 있다 — 같은 패키지 안 인접 파일이라 실사용 영향은 작지만 동일 보장은 아니다.
export function pickRepresentativeRoute(routes: readonly RouteNode[]): RouteNode | undefined {
  let best: RouteNode | undefined
  let bestDepth = Number.POSITIVE_INFINITY
  for (const r of routes) {
    const depth = r.path.split('/').filter(Boolean).length
    if (depth < bestDepth || (depth === bestDepth && best !== undefined && r.id < best.id)) {
      best = r
      bestDepth = depth
    }
  }
  return best
}

export interface NodeMapEntry {
  f: string
  l: number
  c: 'verified' | 'inferred' | 'manual'
  i?: string
  n?: string
  r?: 'pair'
}

export type NodeMap = Record<string, NodeMapEntry>

interface BuildNodeMapOptions {
  root?: 'pair'
}

// 빌더가 IR 노드와 1:1 대응하지 않는 합성 id(FE Tab1 폴더 박스 `T1_*`, BE Tab1 `leaf_<Ctrl>` 등)를
// emit할 때, 그 노드가 대표하는 IR 노드를 명시 선언하는 주석 마커. erd/db-diagram.ts의 `%% table:`
// 선례와 동일한 기법 — IR 확장 0, 빌더 시그니처 변경 0으로 매핑을 실어 나른다.
// buildDiagrams가 nodeMap 추출 후 stripNodeMapMarkers로 제거하므로 렌더 텍스트에는 남지 않는다.
// IR 노드 id는 분석 대상 리포의 파일 경로·라우트 경로로 조립되는 **신뢰 불가 값**이다. 원문을
// 그대로 실으면 파일명 하나에 개행이 있는 것만으로 마커가 여러 물리 라인으로 쪼개지고, strip은
// 첫 줄만 지워 나머지가 생 mermaid 소스로 남는다(실측: `app/evil\nEVIL_NODE["pwned"]\n/page.tsx`가
// 노드 선언으로 렌더됨). percent-encoding으로 값을 `[A-Za-z0-9%._~()!*'-]` 안에 가둬 마커가
// **구조적으로** 단일 라인·단일 토큰이 되게 한다 — 이스케이프 누락 가능성 자체를 없앤다.
const MARKER_RE = /^[ \t]*%% nodemap:([A-Za-z0-9_]+)=(\S+)[ \t]*$/gm
const MARKER_STRIP_RE = /^[ \t]*%% nodemap:[A-Za-z0-9_]+=\S*[ \t]*(?:\r?\n|$)/gm

export function nodeMapMarker(indent: string, declId: string, irNodeId: string): string {
  return `${indent}%% nodemap:${declId}=${encodeURIComponent(irNodeId)}`
}

export function stripNodeMapMarkers(text: string): string {
  return text.replace(MARKER_STRIP_RE, '')
}

function decodeMarkerTarget(raw: string): string | undefined {
  try {
    return decodeURIComponent(raw)
  } catch {
    return undefined // 손상된 인코딩 — 조용히 무시(무반응 > 잘못된 점프)
  }
}

function displayName(node: IRNode): string | undefined {
  switch (node.kind) {
    case 'route': return node.path
    case 'component': return node.name
    case 'table': return node.name
  }
}

// verified/manual은 정적 증거, inferred는 휴리스틱 — 충돌 시 더 확실한 쪽을 남긴다.
function entryConfidenceRank(c: NodeMapEntry['c']): number {
  if (c === 'verified') return 0
  if (c === 'manual') return 1
  return 2
}

function confidenceRank(node: IRNode): number {
  return entryConfidenceRank(node.confidence)
}

function toEntry(node: IRNode, opts?: BuildNodeMapOptions): NodeMapEntry {
  const name = displayName(node)
  const inferenceHead = node.confidence === 'inferred' ? node.inferenceChain[0] : undefined
  return {
    f: node.provenance.file,
    l: node.provenance.line,
    c: node.confidence,
    ...(inferenceHead !== undefined ? { i: inferenceHead } : {}),
    ...(name !== undefined ? { n: name } : {}),
    ...(opts?.root === 'pair' ? { r: 'pair' as const } : {}),
  }
}

// 다이어그램 텍스트에서 "노드 id가 나타날 수 있는 위치"의 토큰만 수집한다. 라벨(따옴표 안)은
// 사용자 텍스트라 id가 아니므로 먼저 제거 — 안 하면 라벨 단어가 sid와 우연히 충돌해 엉뚱한
// 노드가 nodeMap에 실린다. `%%` 주석 라인도 제외(마커는 별도 경로로 파싱).
function collectDeclaredIds(texts: string[]): Set<string> {
  const ids = new Set<string>()
  for (const text of texts) {
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim()
      if (line === '' || line.startsWith('%%')) continue
      const stripped = line.replace(/"[^"]*"/g, '""')
      for (const tok of stripped.match(/[A-Za-z0-9_]+/g) ?? []) ids.add(tok)
    }
  }
  return ids
}

// 빌더들은 같은 IR 노드를 `leaf_<sid>`·`file_<sid>`·`pageleaf_<sid>`·`di_<ctrl>__<sid>`처럼
// 접두사를 붙여 emit한다(탭·모드마다 다름). 접두사 목록을 하드코딩하면 새 빌더가 추가될 때마다
// 조용히 다시 깨지므로, `_` 경계에서 가장 긴 suffix가 sid와 일치하는지로 역해석한다.
// 가장 긴 것부터 보는 이유: `file_component_app_page_tsx_page`에서 짧은 `page`가 먼저 걸리면
// 전혀 다른 노드로 매핑된다.
function resolveBySuffix(declId: string, bySid: Map<string, IRNode>): IRNode | undefined {
  const exact = bySid.get(declId)
  if (exact !== undefined) return exact
  for (let i = 0; i < declId.length; i++) {
    if (declId[i] !== '_') continue
    const candidate = declId.slice(i + 1)
    if (candidate === '') break
    const node = bySid.get(candidate)
    if (node !== undefined) return node
  }
  return undefined
}

export function buildNodeMap(
  graph: IRGraph,
  emittedTexts: string[],
  opts?: BuildNodeMapOptions,
): NodeMap {
  if (graph.nodes.length === 0 || emittedTexts.length === 0) return {}

  const bySid = new Map<string, IRNode>()
  const byIrId = new Map<string, IRNode>()
  for (const node of graph.nodes) {
    byIrId.set(node.id, node)
    const sid = sanitizeId(node.id)
    const existing = bySid.get(sid)
    if (existing === undefined) {
      bySid.set(sid, node)
      continue
    }
    const rank = confidenceRank(node)
    const existingRank = confidenceRank(existing)
    if (rank < existingRank || (rank === existingRank && node.id < existing.id)) {
      bySid.set(sid, node)
    }
  }

  const map: NodeMap = {}
  for (const declId of collectDeclaredIds(emittedTexts)) {
    const node = resolveBySuffix(declId, bySid)
    if (node !== undefined) map[declId] = toEntry(node, opts)
  }

  // 마커는 빌더가 명시 선언한 대표 노드라 suffix 역해석보다 항상 우선한다.
  for (const text of emittedTexts) {
    MARKER_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = MARKER_RE.exec(text)) !== null) {
      const target = decodeMarkerTarget(m[2]!)
      if (target === undefined) continue
      const node = byIrId.get(target)
      if (node !== undefined) map[m[1]!] = toEntry(node, opts)
    }
  }

  return map
}

// FE/BE 등 별개 그래프에서 만든 두 NodeMap을 합친다. 동일 sid 충돌 시 더 확실한 confidence가
// 이기고(Evidence-First), 동순위면 preferred가 이긴다 — buildNodeMap 내부 충돌 해소와 동일 규칙.
export function mergeNodeMaps(preferred: NodeMap, other: NodeMap): NodeMap {
  const merged: NodeMap = { ...other }
  for (const [sid, entry] of Object.entries(preferred)) {
    const existing = merged[sid]
    if (existing === undefined || entryConfidenceRank(entry.c) <= entryConfidenceRank(existing.c)) {
      merged[sid] = entry
    }
  }
  return merged
}
