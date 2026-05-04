import * as path from 'node:path'
import { describe, it, expect } from 'vitest'
import { parseReactRoutes, parseReactRouterFull } from './route-parser.js'

const FIXTURE = path.resolve(process.cwd(), 'fixtures/mini-react-router-app')

describe('parseReactRoutes — mini-react-router-app fixture', () => {
  it('createBrowserRouter routes 배열에서 path를 추출한다', async () => {
    const routes = await parseReactRoutes(FIXTURE, 'test@0.1')
    expect(routes.length).toBeGreaterThanOrEqual(4)
    const paths = routes.map(r => r.path)
    expect(paths).toContain('/')
    expect(paths).toContain('/about')
    expect(paths).toContain('/users')
  })

  it('nested children route를 부모 prefix와 합성한다', async () => {
    const routes = await parseReactRoutes(FIXTURE, 'test@0.1')
    const paths = routes.map(r => r.path)
    expect(paths).toContain('/users/:id')
  })

  it(':id 포함 라우트를 dynamic으로 감지', async () => {
    const routes = await parseReactRoutes(FIXTURE, 'test@0.1')
    const dynamic = routes.find(r => r.path === '/users/:id')
    expect(dynamic?.dynamicSegmentType).toBe('dynamic')
  })

  it('renderingMode는 CSR', async () => {
    const routes = await parseReactRoutes(FIXTURE, 'test@0.1')
    for (const r of routes) expect(r.renderingMode).toBe('CSR')
  })

  it('routeFileKind는 page', async () => {
    const routes = await parseReactRoutes(FIXTURE, 'test@0.1')
    for (const r of routes) expect(r.routeFileKind).toBe('page')
  })
})

describe('parseReactRouterFull — renders 엣지 (II-A-1)', () => {
  it('4개 라우트에 대해 ComponentNode 생성', async () => {
    const { componentNodes } = await parseReactRouterFull(FIXTURE, 'test@0.1')
    expect(componentNodes.length).toBeGreaterThanOrEqual(4)
    const names = componentNodes.map(n => n.name)
    expect(names).toContain('HomePage')
    expect(names).toContain('AboutPage')
    expect(names).toContain('UserListPage')
    expect(names).toContain('UserDetailPage')
  })

  it('renders 엣지: 라우트→컴포넌트 수가 routeNodes 수와 동일', async () => {
    const { routeNodes, rendersEdges } = await parseReactRouterFull(FIXTURE, 'test@0.1')
    expect(rendersEdges.length).toBeGreaterThanOrEqual(routeNodes.length)
  })

  it('renders 엣지 kind는 renders', async () => {
    const { rendersEdges } = await parseReactRouterFull(FIXTURE, 'test@0.1')
    for (const e of rendersEdges) expect(e.kind).toBe('renders')
  })

  it('ComponentNode.runtime은 client', async () => {
    const { componentNodes } = await parseReactRouterFull(FIXTURE, 'test@0.1')
    for (const c of componentNodes) expect(c.runtime).toBe('client')
  })

  it('/ 라우트 → HomePage renders 엣지 존재', async () => {
    const { routeNodes, rendersEdges, componentNodes } = await parseReactRouterFull(FIXTURE, 'test@0.1')
    const homeRoute = routeNodes.find(r => r.path === '/')
    const homeComp = componentNodes.find(c => c.name === 'HomePage')
    expect(homeRoute).toBeDefined()
    expect(homeComp).toBeDefined()
    const edge = rendersEdges.find(e => e.from === homeRoute?.id && e.to === homeComp?.id)
    expect(edge).toBeDefined()
  })
})
