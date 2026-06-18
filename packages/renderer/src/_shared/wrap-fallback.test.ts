import { describe, it, expect } from 'vitest'
import {
  createIRGraph,
  createRouteNode,
  createComponentNode,
  createTableNode,
  createEdge,
  makeNodeId,
  makeEdgeId,
  type IRGraph,
  type RouteNode,
  type Provenance,
} from '@codebase-viz/types'
import {
  shouldChunk,
  wrapDiagramHeader,
  chunkByGroups,
  joinChunks,
  CHUNK_SEPARATOR,
  DEFAULT_CHUNK_THRESHOLD,
  DEFAULT_NODE_THRESHOLD,
} from './wrap-fallback.js'

const PROV: Provenance = { file: 'app/x.tsx', line: 1, adapter: 'test', analyzerVersion: 't@0.1' }

function makeRoute(p: string): RouteNode {
  return createRouteNode({
    id: makeNodeId('route', p, 'page'),
    path: p,
    filePath: p,
    routeFileKind: 'page',
    dynamicSegmentType: 'static',
    isGroupRoute: false,
    renderingMode: 'SSR',
    provenance: PROV,
    confidence: 'verified',
  })
}

function makeGraphWith(nodes: ReturnType<typeof makeRoute>[]): IRGraph {
  return createIRGraph({
    analyzerVersion: 't@0.1',
    repoRoot: '/tmp',
    nodes,
    edges: [],
  })
}

describe('shouldChunk', () => {
  it('returns false when text is under threshold', () => {
    expect(shouldChunk('a'.repeat(100))).toBe(false)
  })

  it('returns true when text exceeds threshold', () => {
    expect(shouldChunk('a'.repeat(DEFAULT_CHUNK_THRESHOLD + 1))).toBe(true)
  })

  it('returns false on empty string', () => {
    expect(shouldChunk('')).toBe(false)
  })

  it('respects custom threshold', () => {
    expect(shouldChunk('a'.repeat(50), 10)).toBe(true)
    expect(shouldChunk('a'.repeat(5), 10)).toBe(false)
  })

  it('returns true when nodeCount exceeds nodeThreshold even if text is short (B2)', () => {
    expect(shouldChunk('short', DEFAULT_CHUNK_THRESHOLD, 101, 100)).toBe(true)
  })

  it('returns false when nodeCount is at or below nodeThreshold (B2)', () => {
    expect(shouldChunk('short', DEFAULT_CHUNK_THRESHOLD, 100, 100)).toBe(false)
    expect(shouldChunk('short', DEFAULT_CHUNK_THRESHOLD, 0, 100)).toBe(false)
  })

  it('uses DEFAULT_NODE_THRESHOLD=300 when not specified (B2)', () => {
    expect(DEFAULT_NODE_THRESHOLD).toBe(300)
    expect(shouldChunk('short', DEFAULT_CHUNK_THRESHOLD, 301)).toBe(true)
    expect(shouldChunk('short', DEFAULT_CHUNK_THRESHOLD, 300)).toBe(false)
  })
})

describe('wrapDiagramHeader', () => {
  it('emits chunk directive with index/total', () => {
    expect(wrapDiagramHeader(1, 3)).toBe('%% chunk:1/3')
    expect(wrapDiagramHeader(2, 2)).toBe('%% chunk:2/2')
  })
})

describe('chunkByGroups', () => {
  const opts = { maxNodesPerGroup: 30, maxDepth: 8 }

  it('returns single chunk when all routes share the same LCP', () => {
    const graph = makeGraphWith([makeRoute('/blog/a'), makeRoute('/blog/b')])
    const chunks = chunkByGroups(graph, opts)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.nodes).toHaveLength(2)
  })

  it('splits large group when exceeding maxNodesPerGroup', () => {
    const routes = Array.from({ length: 75 }, (_, i) => makeRoute(`/api/users/${i}`))
    const graph = makeGraphWith(routes)
    const chunks = chunkByGroups(graph, { maxNodesPerGroup: 30, maxDepth: 8 })
    expect(chunks.length).toBeGreaterThanOrEqual(3)
    const totalNodes = chunks.reduce((sum, c) => sum + c.nodes.length, 0)
    expect(totalNodes).toBe(75)
  })

  it('separates clusters when LCP fallback triggered', () => {
    const routes = [
      makeRoute('/api/users'),
      makeRoute('/api/posts'),
      makeRoute('/admin/dashboard'),
      makeRoute('/'),
    ]
    const graph = makeGraphWith(routes)
    const chunks = chunkByGroups(graph, opts)
    // 3 clusters: /api, /admin, / → 3 chunks
    expect(chunks.length).toBeGreaterThanOrEqual(3)
  })

  it('returns single graph for empty graph', () => {
    const graph = createIRGraph({
      analyzerVersion: 't@0.1',
      repoRoot: '/tmp',
      nodes: [],
      edges: [],
    })
    const chunks = chunkByGroups(graph, opts)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.nodes).toHaveLength(0)
  })

  it('chunks tables when no routes (Tab3-only graph)', () => {
    const tables = Array.from({ length: 50 }, (_, i) =>
      createTableNode({
        id: makeNodeId('table', `db/${i}.sql`, `t${i}`),
        name: `t${i}`,
        columns: [],
        provenance: PROV,
        confidence: 'verified',
      }),
    )
    const graph = createIRGraph({
      analyzerVersion: 't@0.1',
      repoRoot: '/tmp',
      nodes: tables,
      edges: [],
    })
    const chunks = chunkByGroups(graph, { maxNodesPerGroup: 20, maxDepth: 8 })
    expect(chunks.length).toBe(3)
    const totalTables = chunks.reduce((sum, c) => sum + c.nodes.length, 0)
    expect(totalTables).toBe(50)
  })

  it('preserves edges that connect nodes within the same chunk', () => {
    const route = makeRoute('/dashboard')
    const comp = createComponentNode({
      id: makeNodeId('component', 'app/dashboard.tsx', 'Dashboard'),
      name: 'Dashboard',
      filePath: 'app/dashboard.tsx',
      runtime: 'server',
      provenance: PROV,
      confidence: 'verified',
    })
    const edge = createEdge({
      id: makeEdgeId('renders', route.id, comp.id),
      from: route.id,
      to: comp.id,
      kind: 'renders',
      provenance: PROV,
      confidence: 'verified',
    })
    const graph = createIRGraph({
      analyzerVersion: 't@0.1',
      repoRoot: '/tmp',
      nodes: [route, comp],
      edges: [edge],
    })
    const chunks = chunkByGroups(graph, { maxNodesPerGroup: 30, maxDepth: 8 })
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.edges).toHaveLength(1)
  })
})

describe('joinChunks', () => {
  it('returns single chunk verbatim (no header, no separator)', () => {
    expect(joinChunks(['flowchart TD\n  A --> B'])).toBe('flowchart TD\n  A --> B')
  })

  it('joins multiple chunks with directive headers and separator', () => {
    const out = joinChunks(['A', 'B', 'C'])
    expect(out).toContain('%% chunk:1/3\nA')
    expect(out).toContain('%% chunk:2/3\nB')
    expect(out).toContain('%% chunk:3/3\nC')
    expect(out).toContain(CHUNK_SEPARATOR)
  })

  it('returns empty string for empty array', () => {
    expect(joinChunks([])).toBe('')
  })
})

describe('buildDiagrams chunk fallback integration', () => {
  it('emits chunked output when threshold is exceeded; each chunk is a complete mermaid diagram', async () => {
    const { buildDiagrams } = await import('../mermaid-renderer.js')
    const routes = Array.from({ length: 60 }, (_, i) => makeRoute(`/blog/post-${i}`))
    const graph = makeGraphWith(routes)
    const out = buildDiagrams(graph, { chunkThreshold: 500, grouping: { maxNodesPerGroup: 15, maxDepth: 8 } })
    expect(out.rendering).toContain(CHUNK_SEPARATOR)
    expect(out.rendering).toMatch(/%% chunk:1\/\d+/)
    const parts = out.rendering.split(`\n${CHUNK_SEPARATOR}\n`)
    expect(parts.length).toBeGreaterThanOrEqual(2)
    for (const part of parts) {
      expect(part).toMatch(/(graph|flowchart)\s+(TD|LR)/)
    }
  })

  it('skips chunking when subGraphs collapse to one (single LCP within threshold)', async () => {
    const { buildDiagrams } = await import('../mermaid-renderer.js')
    const routes = [makeRoute('/blog/a'), makeRoute('/blog/b')]
    const graph = makeGraphWith(routes)
    const out = buildDiagrams(graph, { chunkThreshold: 500 })
    expect(out.rendering).not.toContain(CHUNK_SEPARATOR)
  })

  it('chunks 110 flat routes by nodeThreshold even when text < 1M chars (B2)', async () => {
    const { buildDiagrams } = await import('../mermaid-renderer.js')
    // 110 routes with no shared LCP — each is its own cluster
    const routes = Array.from({ length: 110 }, (_, i) => makeRoute(`/r${i}`))
    const graph = makeGraphWith(routes)
    const out = buildDiagrams(graph, {
      nodeThreshold: 80,
      grouping: { maxNodesPerGroup: 30, maxDepth: 8 },
    })
    expect(out.rendering.length).toBeLessThan(DEFAULT_CHUNK_THRESHOLD)
    expect(out.rendering).toContain(CHUNK_SEPARATOR)
  })

  it('row-batches flat routes when top-level groups exceed GROUPS_PER_ROW (B2)', async () => {
    const { buildDiagrams } = await import('../mermaid-renderer.js')
    // v1.2.51 C2: routeCount>100 OR top-level 형제>GROUPS_PER_ROW(5) 중 하나면 chunked.
    // 110 flat routes → 110 top-level groups → 게이트 통과 → row batching kicks in.
    const routes = Array.from({ length: 110 }, (_, i) => makeRoute(`/r${i}`))
    const graph = makeGraphWith(routes)
    const out = buildDiagrams(graph, { nodeThreshold: 80 })
    expect(out.rendering).toContain(CHUNK_SEPARATOR)
  })

  it('FE 표준 v1.2 (R-T1.7): 50 flat domains여도 Tab1은 청킹하지 않고 도메인 요약 grid 단일 다이어그램', async () => {
    const { buildDiagrams } = await import('../mermaid-renderer.js')
    const routes = Array.from({ length: 50 }, (_, i) => makeRoute(`/r${i}`))
    const graph = makeGraphWith(routes)
    const out = buildDiagrams(graph, { nodeThreshold: 80 })
    // v1.2.53: Tab1 청킹 폐지. 50 도메인 > GROUPS_PER_ROW(5) → inner-row wrapper로 줄넘김(청킹 아님).
    // (v1.2.51 C2 청킹 게이트는 wrapper·외부분기를 폐기시켜 폐지 — docs/analysis/v1.2.52-fe-tab1-yaxis-findings.md)
    expect(out.rendering).not.toContain(CHUNK_SEPARATOR)
    expect(out.rendering).toMatch(/subgraph DOMAINS_R\d/)
  })

  it('소형-소도메인: 4 flat routes (≤5 groups, <100) → single diagram 유지 (회귀 보존)', async () => {
    const { buildDiagrams } = await import('../mermaid-renderer.js')
    const routes = Array.from({ length: 4 }, (_, i) => makeRoute(`/r${i}`))
    const graph = makeGraphWith(routes)
    const out = buildDiagrams(graph, { nodeThreshold: 80 })
    // 4 top-level ≤ GROUPS_PER_ROW(5) → 기존대로 single (C1 미영향)
    expect(out.rendering).not.toContain(CHUNK_SEPARATOR)
  })
})
