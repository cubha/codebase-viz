import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
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

describe('parseReactRouterFull — Component: + lazy: 속성 (III-B-1)', () => {
  let b1Dir: string

  beforeAll(async () => {
    b1Dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-rr-b1-'))
    await fs.mkdir(path.join(b1Dir, 'src', 'pages'), { recursive: true })

    await fs.writeFile(
      path.join(b1Dir, 'src', 'pages', 'Dashboard.tsx'),
      `export default function Dashboard() { return <div>Dashboard</div> }`,
    )
    await fs.writeFile(
      path.join(b1Dir, 'src', 'pages', 'Settings.tsx'),
      `export default function Settings() { return <div>Settings</div> }`,
    )
    await fs.writeFile(
      path.join(b1Dir, 'src', 'router.tsx'),
      `import { createBrowserRouter } from 'react-router-dom'
import Dashboard from './pages/Dashboard'

export const router = createBrowserRouter([
  { path: '/dashboard', Component: Dashboard },
  { path: '/settings', lazy: () => import('./pages/Settings') },
])`,
    )
  })

  afterAll(async () => {
    await fs.rm(b1Dir, { recursive: true, force: true })
  })

  it('Component: 속성으로 renders 엣지 생성 (III-B-1)', async () => {
    const { componentNodes, rendersEdges } = await parseReactRouterFull(b1Dir, 'test@0.1')
    const dashComp = componentNodes.find(c => c.name === 'Dashboard')
    expect(dashComp).toBeDefined()
    expect(rendersEdges.some(e => e.to === dashComp?.id)).toBe(true)
  })

  it('lazy: 속성으로 renders 엣지 생성 (III-B-1)', async () => {
    const { componentNodes, rendersEdges } = await parseReactRouterFull(b1Dir, 'test@0.1')
    const settingsComp = componentNodes.find(c => c.name === 'Settings')
    expect(settingsComp).toBeDefined()
    expect(rendersEdges.some(e => e.to === settingsComp?.id)).toBe(true)
  })

  it('컴포넌트 내부 import → sub-component renders 엣지 생성 (IV-3)', async () => {
    await fs.mkdir(path.join(b1Dir, 'src', 'components'), { recursive: true })
    await fs.writeFile(
      path.join(b1Dir, 'src', 'components', 'DashCard.tsx'),
      `export default function DashCard() { return <div>Card</div> }`,
    )
    await fs.writeFile(
      path.join(b1Dir, 'src', 'pages', 'Dashboard.tsx'),
      `import DashCard from '../components/DashCard'
export default function Dashboard() { return <div><DashCard /></div> }`,
    )
    const { componentNodes, rendersEdges } = await parseReactRouterFull(b1Dir, 'test@0.1')
    const dashComp = componentNodes.find(c => c.name === 'Dashboard')
    const cardComp = componentNodes.find(c => c.name === 'DashCard')
    expect(dashComp).toBeDefined()
    expect(cardComp).toBeDefined()
    expect(rendersEdges.some(e => e.from === dashComp?.id && e.to === cardComp?.id)).toBe(true)
  })
})

const JSX_FIXTURE = path.resolve(process.cwd(), 'fixtures/mini-react-router-jsx-app')

describe('parseReactRoutes — JSX <Routes> 패턴 (A3)', () => {
  it('평면 <Route> path를 추출한다', async () => {
    const routes = await parseReactRoutes(JSX_FIXTURE, 'test@0.1')
    const paths = routes.map(r => r.path)
    expect(paths).toContain('/')
    expect(paths).toContain('/about')
  })

  it('nested <Route> path를 부모 prefix와 결합한다', async () => {
    const routes = await parseReactRoutes(JSX_FIXTURE, 'test@0.1')
    const paths = routes.map(r => r.path)
    expect(paths).toContain('/users/:id')
  })

  it('<Route index> 는 부모 path를 사용한다', async () => {
    const routes = await parseReactRoutes(JSX_FIXTURE, 'test@0.1')
    const paths = routes.map(r => r.path)
    expect(paths).toContain('/users')
  })

  it('<Route path="*"> catch-all을 추출한다', async () => {
    const routes = await parseReactRoutes(JSX_FIXTURE, 'test@0.1')
    const paths = routes.map(r => r.path)
    expect(paths).toContain('/*')
  })

  it(':id 포함 라우트를 dynamic으로 감지', async () => {
    const routes = await parseReactRoutes(JSX_FIXTURE, 'test@0.1')
    const dynamic = routes.find(r => r.path === '/users/:id')
    expect(dynamic?.dynamicSegmentType).toBe('dynamic')
  })

  it('renderingMode는 CSR', async () => {
    const routes = await parseReactRoutes(JSX_FIXTURE, 'test@0.1')
    for (const r of routes) expect(r.renderingMode).toBe('CSR')
  })
})

describe('parseReactRouterFull — JSX <Routes> renders 엣지 (A3)', () => {
  it('컴포넌트 노드를 생성한다', async () => {
    const { componentNodes } = await parseReactRouterFull(JSX_FIXTURE, 'test@0.1')
    const names = componentNodes.map(n => n.name)
    expect(names).toContain('HomePage')
    expect(names).toContain('AboutPage')
    expect(names).toContain('UserListPage')
    expect(names).toContain('UserDetailPage')
    expect(names).toContain('NotFoundPage')
  })

  it('renders 엣지: 라우트→컴포넌트 수가 routeNodes 수 이상', async () => {
    const { routeNodes, rendersEdges } = await parseReactRouterFull(JSX_FIXTURE, 'test@0.1')
    expect(rendersEdges.length).toBeGreaterThanOrEqual(routeNodes.length - 1)
  })

  it('renders 엣지 kind는 renders', async () => {
    const { rendersEdges } = await parseReactRouterFull(JSX_FIXTURE, 'test@0.1')
    for (const e of rendersEdges) expect(e.kind).toBe('renders')
  })

  it('ComponentNode.runtime은 client', async () => {
    const { componentNodes } = await parseReactRouterFull(JSX_FIXTURE, 'test@0.1')
    for (const c of componentNodes) expect(c.runtime).toBe('client')
  })

  it('/ 라우트 → HomePage renders 엣지 존재', async () => {
    const { routeNodes, rendersEdges, componentNodes } = await parseReactRouterFull(JSX_FIXTURE, 'test@0.1')
    const homeRoute = routeNodes.find(r => r.path === '/')
    const homeComp = componentNodes.find(c => c.name === 'HomePage')
    expect(homeRoute).toBeDefined()
    expect(homeComp).toBeDefined()
    const edge = rendersEdges.find(e => e.from === homeRoute?.id && e.to === homeComp?.id)
    expect(edge).toBeDefined()
  })

  it('/users/:id 라우트 → UserDetailPage renders 엣지 존재', async () => {
    const { routeNodes, rendersEdges, componentNodes } = await parseReactRouterFull(JSX_FIXTURE, 'test@0.1')
    const detailRoute = routeNodes.find(r => r.path === '/users/:id')
    const detailComp = componentNodes.find(c => c.name === 'UserDetailPage')
    expect(detailRoute).toBeDefined()
    expect(detailComp).toBeDefined()
    const edge = rendersEdges.find(e => e.from === detailRoute?.id && e.to === detailComp?.id)
    expect(edge).toBeDefined()
  })
})
