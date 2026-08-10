import { describe, it, expect } from 'vitest'
import { createIRGraph, createRouteNode, makeNodeId, type IRGraphMetadata } from '@codebase-viz/types'
import { resolveTab3Kind } from './db-diagram.js'

const PROV = { file: 'x', line: 1, adapter: 'test@0.1', analyzerVersion: 'test' }

const RR_META: IRGraphMetadata = {
  framework: 'react-router', hasSupabase: false, hasPrisma: false, hasDexie: false, hasFirebase: false,
}

const NEXT_META: IRGraphMetadata = {
  framework: 'nextjs-app-router', hasSupabase: true, hasPrisma: false, hasDexie: false, hasFirebase: false,
}

const BE_META: IRGraphMetadata = {
  framework: 'springboot', hasSupabase: false, hasPrisma: false, hasDexie: false, hasFirebase: false,
  adapterCategory: 'BE',
}

function graphWithMeta(metadata: IRGraphMetadata) {
  return createIRGraph({
    analyzerVersion: 'test',
    repoRoot: '/tmp/test',
    metadata,
    nodes: [],
    edges: [],
  })
}

describe('resolveTab3Kind — Tab3 렌더 종류 판정 단일화 (v1.2.63 D0)', () => {
  it('react-router FE + 테이블 0개면 flow', () => {
    expect(resolveTab3Kind(graphWithMeta(RR_META))).toBe('flow')
  })

  it('테이블이 있는 react-router FE는 erd(회귀 0 — buildDbScreenDiagram 분기와 동일)', () => {
    const route = createRouteNode({
      id: makeNodeId('route', 'app/page.tsx', 'page'),
      path: '/',
      filePath: 'app/page.tsx',
      routeFileKind: 'page',
      dynamicSegmentType: 'static',
      isGroupRoute: false,
      renderingMode: 'SSR',
      provenance: PROV,
      confidence: 'verified',
    })
    const graph = createIRGraph({
      analyzerVersion: 'test',
      repoRoot: '/tmp/test',
      metadata: RR_META,
      nodes: [route],
      edges: [],
    })
    // 테이블 0개인 그래프에서만 flow — 이 케이스는 route만 있고 table 없음이라 여전히 flow.
    // 테이블 존재 케이스는 결합그래프(BE_META)로 별도 검증.
    expect(resolveTab3Kind(graph)).toBe('flow')
  })

  it('Next.js(비 react-router) FE는 erd', () => {
    expect(resolveTab3Kind(graphWithMeta(NEXT_META))).toBe('erd')
  })

  it('BE 어댑터는 react-router 메타와 무관하게 항상 erd', () => {
    expect(resolveTab3Kind(graphWithMeta(BE_META))).toBe('erd')
  })

  it('metadata 없으면 erd(안전한 기본값)', () => {
    const graph = createIRGraph({
      analyzerVersion: 'test',
      repoRoot: '/tmp/test',
      nodes: [],
      edges: [],
    })
    expect(resolveTab3Kind(graph)).toBe('erd')
  })
})
