import { describe, it, expect } from 'vitest'
import { createTableNode, makeNodeId, ORM_CLASS_PREFIX, readOrmClassName } from './ir.js'

const PROV = { file: 'x', line: 1, adapter: 'test@0.1', analyzerVersion: 'test' }

function table(conf: Parameters<typeof createTableNode>[0]['confidence'], chain?: string[]) {
  return createTableNode({
    id: makeNodeId('table', 'schema.sql', 'users'),
    name: 'users',
    columns: [],
    provenance: PROV,
    ...(conf === 'inferred'
      ? { confidence: 'inferred' as const, inferenceChain: chain ?? [] }
      : { confidence: conf as 'verified' | 'manual' }),
  })
}

describe('readOrmClassName — inferenceChain 센티넬 완전일치 조회', () => {
  it('센티넬 원소가 있으면 클래스명을 돌려준다', () => {
    const n = table('inferred', ['jpa: @Entity class DecoSheet in src/DecoSheet.java', `${ORM_CLASS_PREFIX}DecoSheet`])
    expect(readOrmClassName(n)).toBe('DecoSheet')
  })

  it('사람이 읽는 문장만 있고 센티넬이 없으면 undefined — 산문을 정규식으로 긁지 않는다', () => {
    const n = table('inferred', ['jpa: @Entity class DecoSheet in src/DecoSheet.java'])
    expect(readOrmClassName(n)).toBeUndefined()
  })

  it("confidence가 'inferred'가 아니면 undefined (inferenceChain이 존재하지 않는 타입)", () => {
    expect(readOrmClassName(table('verified'))).toBeUndefined()
    expect(readOrmClassName(table('manual'))).toBeUndefined()
  })

  it('빈 체인·빈 클래스명은 undefined — 빈 배지를 만들지 않는다', () => {
    expect(readOrmClassName(table('inferred', []))).toBeUndefined()
    expect(readOrmClassName(table('inferred', [ORM_CLASS_PREFIX]))).toBeUndefined()
  })

  it('접두사가 다른 원소는 무시한다(부분일치 금지)', () => {
    const n = table('inferred', ['xorm-class:Nope', 'class:Nope2'])
    expect(readOrmClassName(n)).toBeUndefined()
  })

  it('센티넬이 여러 개면 첫 번째를 쓴다(결정론)', () => {
    const n = table('inferred', [`${ORM_CLASS_PREFIX}First`, `${ORM_CLASS_PREFIX}Second`])
    expect(readOrmClassName(n)).toBe('First')
  })
})
