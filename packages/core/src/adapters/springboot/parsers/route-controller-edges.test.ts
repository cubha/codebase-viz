import { describe, it, expect } from 'vitest'
import { createRouteNode, createComponentNode, makeNodeId } from '@codebase-viz/types'
import { buildControllerRouteEdges } from './route-controller-edges.js'

const PROVENANCE = { file: 'UsersController.java', line: 10, adapter: 'springboot@0.1', analyzerVersion: 'test' }

function route(path: string, filePath: string) {
  return createRouteNode({
    id: makeNodeId('route', filePath, `${path}:GetMapping`),
    path,
    filePath,
    routeFileKind: 'page',
    dynamicSegmentType: 'static',
    isGroupRoute: false,
    renderingMode: 'SSR',
    httpMethod: 'GET',
    provenance: PROVENANCE,
    confidence: 'verified',
  })
}

function component(name: string, filePath: string) {
  return createComponentNode({
    id: makeNodeId('component', filePath, name),
    name,
    filePath,
    runtime: 'server',
    provenance: PROVENANCE,
    confidence: 'verified',
  })
}

describe('buildControllerRouteEdges (C2)', () => {
  it('같은 파일의 route와 Controller 컴포넌트를 handles 엣지로 연결한다', () => {
    const r1 = route('/users', 'UsersController.java')
    const r2 = route('/users/:id', 'UsersController.java')
    const ctrl = component('UsersController', 'UsersController.java')

    const edges = buildControllerRouteEdges([r1, r2], [ctrl])

    expect(edges).toHaveLength(2)
    expect(edges.every(e => e.kind === 'handles')).toBe(true)
    expect(edges.map(e => e.from).sort()).toEqual([r1.id, r2.id].sort())
    expect(edges.every(e => e.to === ctrl.id)).toBe(true)
  })

  it('Controller 이름 suffix가 아닌 컴포넌트(Service 등)는 매칭하지 않는다', () => {
    const r1 = route('/users', 'UsersService.java')
    const svc = component('UsersService', 'UsersService.java')

    const edges = buildControllerRouteEdges([r1], [svc])

    expect(edges).toHaveLength(0)
  })

  it('매칭되는 Controller 컴포넌트가 없는 route는 침묵한다(phantom 엣지 없음)', () => {
    const r1 = route('/orphan', 'Orphan.java')

    const edges = buildControllerRouteEdges([r1], [])

    expect(edges).toHaveLength(0)
  })

  it('routes 또는 components가 비어있으면 빈 배열을 반환한다', () => {
    expect(buildControllerRouteEdges([], [])).toEqual([])
    expect(buildControllerRouteEdges([route('/a', 'A.java')], [])).toEqual([])
  })
})
