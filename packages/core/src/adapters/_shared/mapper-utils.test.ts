import { describe, it, expect } from 'vitest'
import {
  makeNodeId,
  createRouteNode,
  createComponentNode,
  createTableNode,
  type Provenance,
} from '@codebase-viz/types'
import { buildMapperEdges } from './mapper-utils.js'

const provenance: Provenance = {
  file: 'src/routes/user.ts',
  line: 1,
  adapter: 'sveltekit@0.1',
  analyzerVersion: 'codebase-viz@0.1.0',
}

function makeRoute(filePath: string) {
  return createRouteNode({
    id: makeNodeId('route', filePath, 'page'),
    path: '/' + filePath,
    filePath,
    routeFileKind: 'page',
    dynamicSegmentType: 'static',
    isGroupRoute: false,
    renderingMode: 'SSR',
    provenance: { ...provenance, file: filePath },
    confidence: 'verified',
  })
}

function makeComponent(filePath: string) {
  return createComponentNode({
    id: makeNodeId('component', filePath, 'UserComp'),
    name: 'UserComp',
    filePath,
    runtime: 'server',
    provenance: { ...provenance, file: filePath },
    confidence: 'verified',
  })
}

function makeTable(name: string) {
  return createTableNode({
    id: makeNodeId('table', `schema/${name}.ts`, name),
    name,
    columns: [],
    provenance: { ...provenance, file: `schema/${name}.ts` },
    confidence: 'verified',
  })
}

describe('buildMapperEdges', () => {
  it('tables가 없으면 빈 배열을 반환한다', () => {
    const route = makeRoute('src/routes/user.ts')
    const result = buildMapperEdges([route], [], [], 'codebase-viz@0.1.0')
    expect(result).toEqual([])
  })

  it('routes와 components가 모두 없으면 빈 배열을 반환한다', () => {
    const table = makeTable('user')
    const result = buildMapperEdges([], [], [table], 'codebase-viz@0.1.0')
    expect(result).toEqual([])
  })

  it('table name이 route filePath에 포함되면 edge를 생성한다', () => {
    const route = makeRoute('src/routes/user.ts')
    const table = makeTable('user')
    const result = buildMapperEdges([route], [], [table], 'codebase-viz@0.1.0')
    expect(result).toHaveLength(1)
  })

  it('생성된 edge의 kind가 queries이다', () => {
    const route = makeRoute('src/routes/user.ts')
    const table = makeTable('user')
    const result = buildMapperEdges([route], [], [table], 'codebase-viz@0.1.0')
    expect(result[0]?.kind).toBe('queries')
  })

  it('생성된 edge의 confidence가 inferred이다', () => {
    const route = makeRoute('src/routes/user.ts')
    const table = makeTable('user')
    const result = buildMapperEdges([route], [], [table], 'codebase-viz@0.1.0')
    const edge = result[0]
    expect(edge?.confidence).toBe('inferred')
  })

  it('inferenceChain이 포함되어 있다', () => {
    const route = makeRoute('src/routes/user.ts')
    const table = makeTable('user')
    const result = buildMapperEdges([route], [], [table], 'codebase-viz@0.1.0')
    const edge = result[0]
    if (edge?.confidence === 'inferred') {
      expect(edge.inferenceChain.length).toBeGreaterThan(0)
    } else {
      throw new Error('expected inferred edge')
    }
  })

  it('table name이 component filePath에 포함되면 edge를 생성한다', () => {
    const component = makeComponent('src/components/users.svelte')
    const table = makeTable('users')
    const result = buildMapperEdges([], [component], [table], 'codebase-viz@0.1.0')
    expect(result).toHaveLength(1)
    expect(result[0]?.kind).toBe('queries')
  })

  it('table name이 filePath에 없으면 edge를 생성하지 않는다', () => {
    const route = makeRoute('src/routes/dashboard.ts')
    const table = makeTable('orders')
    const result = buildMapperEdges([route], [], [table], 'codebase-viz@0.1.0')
    expect(result).toEqual([])
  })

  it('edge from이 route id, to가 table id이다', () => {
    const route = makeRoute('src/routes/user.ts')
    const table = makeTable('user')
    const result = buildMapperEdges([route], [], [table], 'codebase-viz@0.1.0')
    expect(result[0]?.from).toBe(route.id)
    expect(result[0]?.to).toBe(table.id)
  })
})
