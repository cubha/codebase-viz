import { describe, it, expect } from 'vitest'
import { createIRGraph, createRouteNode, createTableNode, makeNodeId, ORM_CLASS_PREFIX, type IRGraphMetadata } from '@codebase-viz/types'
import { resolveTab3Kind, buildDbScreenDiagram, isInformativeOrmClass } from './db-diagram.js'

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

// T5: `%% table:` 마커에 class:<ClassName>을 얹어 viewer로 클래스명을 전달한다.
// 이 마커는 mermaid 주석이라 렌더되지 않고, viewer가 파싱해 라벨·사이드바에 병기한다.
describe('buildDbScreenDiagram — %% table: 마커의 class: 필드 (T5)', () => {
  function tableGraph(name: string, chain: string[] | undefined, file = 'src/main/java/DecoSheet.java') {
    const id = makeNodeId('table', file, name)
    const node = createTableNode({
      id, name, columns: [{ name: 'req_no', type: 'String', nullable: false, isPrimaryKey: true }],
      provenance: { file, line: 1, adapter: 'test@0.1', analyzerVersion: 'test' },
      ...(chain !== undefined
        ? { confidence: 'inferred' as const, inferenceChain: chain }
        : { confidence: 'verified' as const }),
    })
    return createIRGraph({
      analyzerVersion: 'test', repoRoot: '/tmp/test', metadata: BE_META, nodes: [node], edges: [],
    })
  }

  function markerLine(out: string, tbl: string): string | undefined {
    return out.split('\n').find(l => l.trim().startsWith(`%% table:${tbl} `))
  }

  it('클래스명이 테이블명과 다르면 class:<ClassName>을 마커에 싣는다', () => {
    const out = buildDbScreenDiagram(tableGraph('TB_HODS401', [
      'jpa: @Entity class DecoSheet in src/main/java/DecoSheet.java',
      `${ORM_CLASS_PREFIX}DecoSheet`,
    ]))
    expect(markerLine(out, 'TB_HODS401')).toContain('class:DecoSheet')
  })

  it('클래스명이 없으면 class: 필드를 아예 만들지 않는다 — 빈 배지 금지', () => {
    const out = buildDbScreenDiagram(tableGraph('users', undefined))
    const line = markerLine(out, 'users')
    expect(line).toBeDefined()
    expect(line).not.toContain('class:')
  })

  it('대소문자·복수형만 다른 유도 가능한 이름은 싣지 않는다 — 무정보 배지 금지', () => {
    const out = buildDbScreenDiagram(tableGraph('users', [`${ORM_CLASS_PREFIX}User`]))
    const line = markerLine(out, 'users')
    expect(line).toBeDefined()
    expect(line).not.toContain('class:')
  })

  it('클래스명이 테이블명과 같으면 싣지 않는다 — 동일값 배지 금지(Less is More)', () => {
    const out = buildDbScreenDiagram(tableGraph('DecoSheet', [
      'jpa: @Entity class DecoSheet in src/main/java/DecoSheet.java',
      `${ORM_CLASS_PREFIX}DecoSheet`,
    ]))
    const line = markerLine(out, 'DecoSheet')
    expect(line).toBeDefined()
    expect(line).not.toContain('class:')
  })

  it('class:는 기존 path: 필드를 대체하지 않는다', () => {
    const out = buildDbScreenDiagram(tableGraph('TB_HODS401', [`${ORM_CLASS_PREFIX}DecoSheet`]))
    const line = markerLine(out, 'TB_HODS401')!
    expect(line).toContain('path:src/main/java/DecoSheet.java')
    expect(line).toContain('class:DecoSheet')
  })

  it('마커는 mermaid 주석이라 렌더 본문(비주석 줄)에는 클래스명이 없다', () => {
    const out = buildDbScreenDiagram(tableGraph('TB_HODS401', [`${ORM_CLASS_PREFIX}DecoSheet`]))
    const body = out.split('\n').filter(l => !l.trim().startsWith('%%'))
    expect(body.join('\n')).not.toContain('DecoSheet')
  })
})

describe('isInformativeOrmClass — 무정보 배지 억제 규칙 (T5)', () => {
  it('규칙으로 유도되는 이름은 정보가 아니다', () => {
    expect(isInformativeOrmClass('User', 'users')).toBe(false)      // 대소문자+복수
    expect(isInformativeOrmClass('Post', 'posts')).toBe(false)
    expect(isInformativeOrmClass('AuditLog', 'audit_logs')).toBe(false) // snake_case+복수
    expect(isInformativeOrmClass('DecoSheet', 'deco_sheets')).toBe(false)
    expect(isInformativeOrmClass('User', 'User')).toBe(false)       // 완전일치
  })

  it('유도 불가능한 레거시 매핑은 정보다 — 이게 이 기능의 존재 이유다', () => {
    expect(isInformativeOrmClass('DecoSheet', 'TB_HODS401')).toBe(true)
    expect(isInformativeOrmClass('CuttingPlan', 'TWO_MOLD_CUTING_NRM')).toBe(true)
    expect(isInformativeOrmClass('TransStmt', 'TWO_WINS_COM_WHOT_DTL')).toBe(true)
    expect(isInformativeOrmClass('ProcCode', 'TWO_POWCD')).toBe(true)
    expect(isInformativeOrmClass('Contract', 'TWA_CONTRACT_MST')).toBe(true)
  })

  it('없거나 빈 클래스명은 배지 대상이 아니다', () => {
    expect(isInformativeOrmClass(undefined, 'users')).toBe(false)
    expect(isInformativeOrmClass('', 'users')).toBe(false)
  })
})
