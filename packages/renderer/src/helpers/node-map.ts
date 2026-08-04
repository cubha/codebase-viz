import type { IRGraph, IRNode } from '@codebase-viz/types'
import { sanitizeId } from './ids.js'

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

export function buildNodeMap(
  graph: IRGraph,
  emittedTexts: string[],
  opts?: BuildNodeMapOptions,
): NodeMap {
  if (graph.nodes.length === 0 || emittedTexts.length === 0) return {}

  const emittedIds = new Set(emittedTexts.join('\n').match(/[A-Za-z0-9_]+/g) ?? [])
  const bestBySid = new Map<string, IRNode>()

  for (const node of graph.nodes) {
    const sid = sanitizeId(node.id)
    if (!emittedIds.has(sid)) continue
    const existing = bestBySid.get(sid)
    if (existing === undefined) {
      bestBySid.set(sid, node)
      continue
    }
    const rank = confidenceRank(node)
    const existingRank = confidenceRank(existing)
    if (rank < existingRank || (rank === existingRank && node.id < existing.id)) {
      bestBySid.set(sid, node)
    }
  }

  const map: NodeMap = {}
  for (const [sid, node] of bestBySid) {
    const name = displayName(node)
    const inferenceHead = node.confidence === 'inferred' ? node.inferenceChain[0] : undefined
    map[sid] = {
      f: node.provenance.file,
      l: node.provenance.line,
      c: node.confidence,
      ...(inferenceHead !== undefined ? { i: inferenceHead } : {}),
      ...(name !== undefined ? { n: name } : {}),
      ...(opts?.root === 'pair' ? { r: 'pair' as const } : {}),
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
