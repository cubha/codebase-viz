import { describe, it, expect } from 'vitest'
import {
  createComponentNode,
  createTableNode,
  createEdge,
  createIRGraph,
  makeNodeId,
  makeEdgeId,
  type NodeId,
} from '@codebase-viz/types'
import { collectReachableTables } from './table-cluster.js'

const PROV = { file: 'x', line: 1, adapter: 'test', analyzerVersion: '0.1' }

function component(name: string, filePath: string) {
  return createComponentNode({ id: makeNodeId('component', filePath, name), name, filePath, runtime: 'server', provenance: PROV, confidence: 'verified' })
}
function table(name: string) {
  return createTableNode({ id: makeNodeId('table', 'db', name), name, columns: [], provenance: PROV, confidence: 'verified' })
}
function edge(kind: 'calls' | 'queries', from: NodeId, to: NodeId) {
  return createEdge({ id: makeEdgeId(kind, from, to), from, to, kind, provenance: PROV, confidence: 'verified' })
}

describe('collectReachableTables (C4/K4)', () => {
  it('DI 체인(calls)을 따라가며 도달한 컴포넌트의 queries 테이블을 모은다', () => {
    const ctrl = component('OrderController', 'Order.java')
    const svc = component('OrderService', 'OrderSvc.java')
    const repo = component('OrderRepository', 'OrderRepo.java')
    const t1 = table('orders')
    const graph = createIRGraph({
      analyzerVersion: '0.1', repoRoot: '/tmp',
      nodes: [ctrl, svc, repo, t1],
      edges: [
        edge('calls', ctrl.id, svc.id),
        edge('calls', svc.id, repo.id),
        edge('queries', repo.id, t1.id),
      ],
    })
    const tables = collectReachableTables(graph, [ctrl.id])
    expect(tables.map(t => t.name)).toEqual(['orders'])
  })

  it('여러 시드(route + component)에서 도달한 테이블을 합쳐 중복 없이 반환한다', () => {
    const ctrl = component('OrderController', 'Order.java')
    const repo = component('OrderRepository', 'OrderRepo.java')
    const t1 = table('orders')
    const t2 = table('order_items')
    const routeId = makeNodeId('route', 'Order.java', '/orders:GetMapping')
    const graph = createIRGraph({
      analyzerVersion: '0.1', repoRoot: '/tmp',
      nodes: [ctrl, repo, t1, t2],
      edges: [
        edge('calls', ctrl.id, repo.id),
        edge('queries', repo.id, t1.id),
        edge('queries', routeId, t2.id),
      ],
    })
    const tables = collectReachableTables(graph, [ctrl.id, routeId]).map(t => t.name)
    expect(tables.sort()).toEqual(['order_items', 'orders'])
  })

  it('도달 가능한 테이블이 없으면 빈 배열', () => {
    const ctrl = component('UtilController', 'Util.java')
    const graph = createIRGraph({ analyzerVersion: '0.1', repoRoot: '/tmp', nodes: [ctrl], edges: [] })
    expect(collectReachableTables(graph, [ctrl.id])).toEqual([])
  })

  it('그래프에 테이블 노드가 전혀 없으면 즉시 빈 배열(조기 반환)', () => {
    const ctrl = component('UtilController', 'Util.java')
    const graph = createIRGraph({ analyzerVersion: '0.1', repoRoot: '/tmp', nodes: [ctrl], edges: [] })
    expect(collectReachableTables(graph, [])).toEqual([])
  })
})
