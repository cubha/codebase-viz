import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseComponents } from '../parsers/component-parser.js'
import { parseTables } from '../parsers/db-parser.js'
import { mapScreenToTable } from './screen-mapper.js'
import { createIRGraph } from '@codebase-viz/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.resolve(__dirname, '../../../../fixtures/mini-next-app')

describe('mapScreenToTable', () => {
  it('PostList.tsx → posts 테이블 queries 엣지를 생성한다', async () => {
    const { nodes: componentNodes, edges: componentEdges } = await parseComponents(FIXTURE)
    const tableNodes = await parseTables(FIXTURE)

    const graph = createIRGraph({
      analyzerVersion: 'codebase-viz@0.1.0',
      repoRoot: FIXTURE,
      nodes: [...componentNodes, ...tableNodes],
      edges: componentEdges,
    })

    const edges = await mapScreenToTable(graph)

    expect(edges.length).toBeGreaterThan(0)

    const postListNode = componentNodes.find(n => n.name === 'PostList')
    const postsTableNode = tableNodes.find(n => n.name === 'posts')
    expect(postListNode).toBeDefined()
    expect(postsTableNode).toBeDefined()

    const edge = edges.find(
      e => e.from === postListNode!.id && e.to === postsTableNode!.id,
    )
    expect(edge).toBeDefined()
    expect(edge!.kind).toBe('queries')
    expect(edge!.confidence).toBe('verified')
  })

  it('테이블 없는 컴포넌트는 엣지를 생성하지 않는다', async () => {
    const { nodes: componentNodes, edges: componentEdges } = await parseComponents(FIXTURE)

    const graph = createIRGraph({
      analyzerVersion: 'codebase-viz@0.1.0',
      repoRoot: FIXTURE,
      nodes: componentNodes,
      edges: componentEdges,
    })

    const edges = await mapScreenToTable(graph)
    expect(edges).toHaveLength(0)
  })

  it('같은 컴포넌트-테이블 쌍은 중복 엣지를 생성하지 않는다', async () => {
    const { nodes: componentNodes, edges: componentEdges } = await parseComponents(FIXTURE)
    const tableNodes = await parseTables(FIXTURE)

    const graph = createIRGraph({
      analyzerVersion: 'codebase-viz@0.1.0',
      repoRoot: FIXTURE,
      nodes: [...componentNodes, ...tableNodes],
      edges: componentEdges,
    })

    const edges = await mapScreenToTable(graph)
    const edgeIds = edges.map(e => e.id)
    const uniqueIds = new Set(edgeIds)
    expect(edgeIds.length).toBe(uniqueIds.size)
  })
})
