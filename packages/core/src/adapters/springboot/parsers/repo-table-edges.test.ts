import { describe, it, expect } from 'vitest'
import { createTableNode, makeNodeId, type Provenance } from '@codebase-viz/types'
import { buildRepoTableEdges } from './repo-table-edges.js'
import type { RepoTableRef } from './mapper-xml-parser.js'

const PROV: Provenance = { file: 'mapper/UserMapper.xml', line: 1, adapter: 'mybatis-xml-parser@0.1', analyzerVersion: 'test' }

function makeRef(tableNames: string[]): RepoTableRef {
  return { repoComponentId: makeNodeId('component', 'src/UserRepository.java', 'UserRepository'), tableNames, provenance: PROV }
}

describe('buildRepoTableEdges', () => {
  it('빈 입력이면 빈 배열', () => {
    expect(buildRepoTableEdges([], [])).toEqual([])
  })

  it('이름이 정확히 매칭되는 테이블에만 queries 엣지를 생성한다', () => {
    const table = createTableNode({
      id: makeNodeId('table', 'db', 'TB_USER'),
      name: 'TB_USER',
      columns: [],
      provenance: PROV,
      confidence: 'inferred',
      inferenceChain: ['test'],
    })
    const edges = buildRepoTableEdges([makeRef(['TB_USER', 'TB_GHOST'])], [table])
    expect(edges).toHaveLength(1)
    expect(edges[0]?.kind).toBe('queries')
    expect(edges[0]?.to).toBe(table.id)
    const edge = edges[0]!
    expect(edge.confidence).toBe('inferred')
    if (edge.confidence === 'inferred') expect(edge.inferenceChain.length).toBeGreaterThan(0)
  })

  it('매칭 실패 테이블은 침묵(엣지 생성 안 함) — Evidence-First', () => {
    const table = createTableNode({
      id: makeNodeId('table', 'db', 'TB_OTHER'),
      name: 'TB_OTHER',
      columns: [],
      provenance: PROV,
      confidence: 'inferred',
      inferenceChain: ['test'],
    })
    expect(buildRepoTableEdges([makeRef(['TB_GHOST'])], [table])).toEqual([])
  })

  it('동일 Repository→table 조합의 중복 엣지를 만들지 않는다', () => {
    const table = createTableNode({
      id: makeNodeId('table', 'db', 'TB_USER'),
      name: 'TB_USER',
      columns: [],
      provenance: PROV,
      confidence: 'inferred',
      inferenceChain: ['test'],
    })
    const ref = makeRef(['TB_USER'])
    const edges = buildRepoTableEdges([ref, ref], [table])
    expect(edges).toHaveLength(1)
  })
})
