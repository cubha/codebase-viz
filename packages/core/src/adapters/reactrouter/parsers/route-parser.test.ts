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

// v1.2.44 Track A0 — React Router map() 패턴 외부 import 추적 회귀 해소
// 사용자 케이스: appRoutes.map() + 외부 import + lowercase `component` + `<route.component />`
const MAP_IMPORT_FIXTURE = path.resolve(process.cwd(), 'fixtures/mini-react-router-map-import-app')

describe('parseReactRoutes — F-Route-1·2·3 통합 (mini-react-router-map-import-app)', () => {
  it('F-Route-1: 외부 import 데이터 배열 추적으로 5개 라우트 추출', async () => {
    const routes = await parseReactRoutes(MAP_IMPORT_FIXTURE, 'test@0.1')
    const paths = routes.map(r => r.path).sort()
    expect(paths).toContain('/home')
    expect(paths).toContain('/code')
    expect(paths).toContain('/message')
    expect(paths).toContain('/profile')
    expect(paths).toContain('/settings')
  })

  it('catch-all 라우트도 추출된다', async () => {
    const routes = await parseReactRoutes(MAP_IMPORT_FIXTURE, 'test@0.1')
    const paths = routes.map(r => r.path)
    expect(paths).toContain('/*')
  })

  it('renderingMode는 CSR', async () => {
    const routes = await parseReactRoutes(MAP_IMPORT_FIXTURE, 'test@0.1')
    for (const r of routes) expect(r.renderingMode).toBe('CSR')
  })

  it('F-Route-1 추출 라우트는 inferred + inferenceChain 보유', async () => {
    const routes = await parseReactRoutes(MAP_IMPORT_FIXTURE, 'test@0.1')
    const home = routes.find(r => r.path === '/home')
    expect(home).toBeDefined()
    expect(home?.confidence).toBe('inferred')
    if (home?.confidence === 'inferred') {
      expect(home.inferenceChain[0]).toMatch(/외부 모듈 import 1-hop/)
    }
  })
})

describe('parseReactRouterFull — F-Route-2·3 renders 엣지 매핑 (mini-react-router-map-import-app)', () => {
  it('F-Route-2/3: 5개 페이지 ComponentNode 생성', async () => {
    const { componentNodes } = await parseReactRouterFull(MAP_IMPORT_FIXTURE, 'test@0.1')
    const names = componentNodes.map(n => n.name)
    expect(names).toContain('Home')
    expect(names).toContain('Code')
    expect(names).toContain('Message')
    expect(names).toContain('Profile')
    expect(names).toContain('Settings')
  })

  it('각 라우트 → 매칭되는 페이지 컴포넌트로 renders 엣지', async () => {
    const { routeNodes, rendersEdges, componentNodes } = await parseReactRouterFull(MAP_IMPORT_FIXTURE, 'test@0.1')
    for (const pageName of ['Home', 'Code', 'Message', 'Profile', 'Settings']) {
      const route = routeNodes.find(r => r.path === '/' + pageName.toLowerCase())
      const comp = componentNodes.find(c => c.name === pageName)
      expect(route, `route /${pageName.toLowerCase()}`).toBeDefined()
      expect(comp, `component ${pageName}`).toBeDefined()
      const edge = rendersEdges.find(e => e.from === route?.id && e.to === comp?.id)
      expect(edge, `renders edge ${pageName}`).toBeDefined()
    }
  })
})

describe('extractRoutesFromArray — F-Route-2 단위 검증', () => {
  it('lowercase `component` Identifier (대문자 시작)를 인식', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-rr-froute2-'))
    try {
      await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true })
      await fs.writeFile(
        path.join(tmpDir, 'src', 'Foo.tsx'),
        `export default function Foo() { return <div/> }`,
      )
      await fs.writeFile(
        path.join(tmpDir, 'src', 'router.tsx'),
        `import { createBrowserRouter } from 'react-router-dom'
import Foo from './Foo'
export const router = createBrowserRouter([
  { path: '/foo', component: Foo },
])`,
      )
      const { componentNodes, rendersEdges } = await parseReactRouterFull(tmpDir, 'test@0.1')
      const fooComp = componentNodes.find(c => c.name === 'Foo')
      expect(fooComp).toBeDefined()
      expect(rendersEdges.some(e => e.to === fooComp?.id)).toBe(true)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('lowercase 시작 Identifier는 component 키여도 무시 (오인식 차단)', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-rr-froute2-guard-'))
    try {
      await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true })
      await fs.writeFile(
        path.join(tmpDir, 'src', 'router.tsx'),
        `import { createBrowserRouter } from 'react-router-dom'
const someValue = 'not-a-component'
export const router = createBrowserRouter([
  { path: '/foo', component: someValue },
])`,
      )
      const { componentNodes } = await parseReactRouterFull(tmpDir, 'test@0.1')
      expect(componentNodes.find(c => c.name === 'someValue')).toBeUndefined()
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })
})

// v1.2.47 Phase 1 ST3 — 사용자 케이스(REPO-SHARED-B2B-WINA-APP-FE) 1:1 reproducer.
// path alias(@/) + named import rename(as) + nested 2겹 Routes + appRoutes.map + <Suspense> wrapper.
// Phase 1 종료 시점에는 4 RouteNode는 PASS, 4 ComponentNode/4 rendersEdge는 FAIL (root cause 박제).
// Phase 2 ST4~ST6 통합 resolver 적용 후 전체 PASS로 전환되는 것이 회귀 가드.
const ALIAS_FIXTURE = path.resolve(process.cwd(), 'fixtures/mini-react-router-alias-app')

describe('parseReactRoutes — path alias + as rename (mini-react-router-alias-app)', () => {
  it('appRoutes 4개 + MobileLoginRoute 1개 + catch-all = 6개 라우트 추출', async () => {
    const routes = await parseReactRoutes(ALIAS_FIXTURE, 'test@0.1')
    const paths = routes.map(r => r.path)
    expect(paths).toContain('/home')
    expect(paths).toContain('/system/code')
    expect(paths).toContain('/system/menu')
    expect(paths).toContain('/system/api')
    expect(paths).toContain('/mobile/login')
    expect(paths).toContain('/*')
  })
})

// v1.2.47 Phase 2 활성화: ST4 component-resolver + ST5 JSX 분기 적용 후 PASS 전환.
// 회귀 가드: alias(@/) + as rename + 외부 sf importMap + JsxExpression(MobileLoginRoute) 모두 매핑.
describe('parseReactRouterFull — @/ alias + as rename rendersEdge (mini-react-router-alias-app)', () => {
  it('appRoutes 4개 컴포넌트 ComponentNode 생성 (alias resolve + rename 인식 필요)', async () => {
    const { componentNodes } = await parseReactRouterFull(ALIAS_FIXTURE, 'test@0.1')
    const names = componentNodes.map(n => n.name)
    expect(names).toContain('HomePage')
    expect(names).toContain('CodePage')
    expect(names).toContain('MenuManagePage')
    expect(names).toContain('ApiPage')
  })

  it('각 라우트 → 매칭 컴포넌트 rendersEdge 존재 (특히 MenuManagePage rename fix 박제)', async () => {
    const { routeNodes, rendersEdges, componentNodes } = await parseReactRouterFull(ALIAS_FIXTURE, 'test@0.1')
    const cases: Array<[string, string]> = [
      ['/home', 'HomePage'],
      ['/system/code', 'CodePage'],
      ['/system/menu', 'MenuManagePage'],
      ['/system/api', 'ApiPage'],
    ]
    for (const [urlPath, compName] of cases) {
      const route = routeNodes.find(r => r.path === urlPath)
      const comp = componentNodes.find(c => c.name === compName)
      expect(route, `route ${urlPath}`).toBeDefined()
      expect(comp, `component ${compName}`).toBeDefined()
      const edge = rendersEdges.find(e => e.from === route?.id && e.to === comp?.id)
      expect(edge, `rendersEdge ${urlPath} → ${compName}`).toBeDefined()
    }
  })

  it('MobileLoginRoute(단일 JsxExpression)도 컴포넌트 매핑됨', async () => {
    const { routeNodes, rendersEdges, componentNodes } = await parseReactRouterFull(ALIAS_FIXTURE, 'test@0.1')
    const route = routeNodes.find(r => r.path === '/mobile/login')
    const comp = componentNodes.find(c => c.name === 'MobileLoginPage')
    expect(route).toBeDefined()
    expect(comp).toBeDefined()
    expect(rendersEdges.some(e => e.from === route?.id && e.to === comp?.id)).toBe(true)
  })
})

// v1.2.47 ST6b — createBrowserRouter 분기 외부 import 1-hop + @/ alias + as rename 회귀 가드
const CREATEBROWSER_ALIAS_FIXTURE = path.resolve(
  process.cwd(),
  'fixtures/mini-react-router-createbrowser-alias-app',
)

// v1.2.47 ST7 — extractMapElementPropName이 callback 파라미터 기반으로 매칭하는지 검증.
// Suspense wrapper 안쪽 <route.X /> 매칭 + 비표준 propName(`view`/`el` 등) 인식.
describe('extractMapElementPropName — callback param 기반 매칭 (ST7)', () => {
  it('Suspense wrapper 안 <route.view /> 패턴에서 lowercase view propName으로 매칭', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-rr-st7-view-'))
    try {
      await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true })
      await fs.writeFile(
        path.join(tmpDir, 'src', 'HomePage.tsx'),
        `export default function HomePage() { return <div/> }`,
      )
      await fs.writeFile(
        path.join(tmpDir, 'src', 'routes.tsx'),
        `import React from 'react'
import { Routes, Route } from 'react-router-dom'
import HomePage from './HomePage'

const items = [
  { path: '/', view: HomePage },
]

const RouteList = items.map((route) => (
  <Route key={route.path} path={route.path} element={
    <React.Suspense fallback={null}>
      <route.view />
    </React.Suspense>
  } />
))

export default function App() {
  return <Routes>{RouteList}</Routes>
}`,
      )
      const { componentNodes, rendersEdges } = await parseReactRouterFull(tmpDir, 'test@0.1')
      const homeComp = componentNodes.find(c => c.name === 'HomePage')
      expect(homeComp, 'HomePage component').toBeDefined()
      expect(rendersEdges.some(e => e.to === homeComp?.id), 'rendersEdge → HomePage').toBe(true)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })
})

// v1.2.47 ST8 — barrel re-export 1-hop 회귀 가드
const BARREL_FIXTURE = path.resolve(process.cwd(), 'fixtures/mini-react-router-barrel-app')

describe('parseReactRouterFull — barrel re-export 1-hop (mini-react-router-barrel-app)', () => {
  it('default → named (export { default as HomePage } from)와 named pass-through 모두 ComponentNode 생성', async () => {
    const { componentNodes } = await parseReactRouterFull(BARREL_FIXTURE, 'test@0.1')
    const names = componentNodes.map(n => n.name)
    expect(names).toContain('HomePage')
    expect(names).toContain('AboutPage')
  })

  it('barrel 추적 후 각 페이지 파일로 rendersEdge 연결', async () => {
    const { routeNodes, componentNodes, rendersEdges } = await parseReactRouterFull(BARREL_FIXTURE, 'test@0.1')
    const homeRoute = routeNodes.find(r => r.path === '/')
    const homeComp = componentNodes.find(c => c.name === 'HomePage')
    expect(homeRoute).toBeDefined()
    expect(homeComp).toBeDefined()
    expect(homeComp?.filePath).toContain('HomePage')
    expect(rendersEdges.some(e => e.from === homeRoute?.id && e.to === homeComp?.id)).toBe(true)

    const aboutRoute = routeNodes.find(r => r.path === '/about')
    const aboutComp = componentNodes.find(c => c.name === 'AboutPage')
    expect(aboutRoute).toBeDefined()
    expect(aboutComp).toBeDefined()
    expect(aboutComp?.filePath).toContain('AboutPage')
    expect(rendersEdges.some(e => e.from === aboutRoute?.id && e.to === aboutComp?.id)).toBe(true)
  })
})

describe('parseReactRouterFull — createBrowserRouter + @/ alias + as rename (mini-react-router-createbrowser-alias-app)', () => {
  it('외부 import된 appRoutes 배열을 1-hop으로 추적하여 4개 라우트 추출', async () => {
    const { routeNodes } = await parseReactRouterFull(CREATEBROWSER_ALIAS_FIXTURE, 'test@0.1')
    const paths = routeNodes.map(r => r.path).sort()
    expect(paths).toContain('/home')
    expect(paths).toContain('/system/code')
    expect(paths).toContain('/system/menu')
    expect(paths).toContain('/system/api')
  })

  it('4개 페이지 ComponentNode 생성 (alias resolve + as rename 인식)', async () => {
    const { componentNodes } = await parseReactRouterFull(CREATEBROWSER_ALIAS_FIXTURE, 'test@0.1')
    const names = componentNodes.map(n => n.name)
    expect(names).toContain('HomePage')
    expect(names).toContain('CodePage')
    expect(names).toContain('MenuManagePage')
    expect(names).toContain('ApiPage')
  })

  it('각 라우트 → 매칭 컴포넌트 rendersEdge 존재 (MenuManagePage rename 포함)', async () => {
    const { routeNodes, rendersEdges, componentNodes } = await parseReactRouterFull(CREATEBROWSER_ALIAS_FIXTURE, 'test@0.1')
    const cases: Array<[string, string]> = [
      ['/home', 'HomePage'],
      ['/system/code', 'CodePage'],
      ['/system/menu', 'MenuManagePage'],
      ['/system/api', 'ApiPage'],
    ]
    for (const [urlPath, compName] of cases) {
      const route = routeNodes.find(r => r.path === urlPath)
      const comp = componentNodes.find(c => c.name === compName)
      expect(route, `route ${urlPath}`).toBeDefined()
      expect(comp, `component ${compName}`).toBeDefined()
      const edge = rendersEdges.find(e => e.from === route?.id && e.to === comp?.id)
      expect(edge, `rendersEdge ${urlPath} → ${compName}`).toBeDefined()
    }
  })
})

// 딥링크(T1)는 filePath가 아니라 provenance로 좌표를 만든다(renderer/helpers/node-map.ts).
// 그래서 provenance가 틀리면 클릭이 엉뚱한 곳으로 간다 — 아래 두 결함은 이 단언이 없어서 살아남았다.
describe('provenance 정확도 — 딥링크 좌표의 원천', () => {
  const MAP_IMPORT = path.resolve(process.cwd(), 'fixtures/mini-react-router-map-import-app')
  const MAP_PREFIX = path.resolve(process.cwd(), 'fixtures/mini-react-router-map-prefix')

  it('ComponentNode의 provenance.file은 router 파일이 아니라 컴포넌트 자기 파일이다', async () => {
    const { componentNodes } = await parseReactRouterFull(MAP_IMPORT, 'test@0.1')
    expect(componentNodes.length).toBeGreaterThan(0)
    for (const c of componentNodes) {
      expect(c.provenance.file).toBe(c.filePath)
    }
  })

  // 위 단언은 JSX(<Routes>) 분기만 지난다 — createBrowserRouter 분기는 별도 코드 경로라
  // 같은 결함을 따로 갖고 있었고, 되돌려도 통과하는 무커버리지 상태였다(실험으로 확인).
  it('createBrowserRouter 분기의 ComponentNode도 자기 파일을 가리킨다', async () => {
    const { componentNodes } = await parseReactRouterFull(FIXTURE, 'test@0.1')
    expect(componentNodes.length).toBeGreaterThan(0)
    for (const c of componentNodes) {
      expect(c.provenance.file).toBe(c.filePath)
    }
  })

  it('map으로 뿌려진 라우트는 map 호출 지점이 아니라 각 배열 원소의 선언 라인을 가리킨다', async () => {
    const { routeNodes } = await parseReactRouterFull(MAP_IMPORT, 'test@0.1')
    const code = routeNodes.find(r => r.path === '/code')
    const message = routeNodes.find(r => r.path === '/message')
    // appRoutes.ts의 `{ path: 'code', component: Code }` / `{ path: 'message', ... }`
    expect(code?.provenance.file).toBe('src/router/appRoutes.ts')
    expect(message?.provenance.file).toBe('src/router/appRoutes.ts')
    // 라우트마다 서로 다른 줄 — 한 줄로 붕괴하지 않는다.
    expect(code?.provenance.line).not.toBe(message?.provenance.line)
  })

  it('외부 파일 map에서 온 라우트의 file과 line은 같은 파일에서 온다(유령 좌표 금지)', async () => {
    // 이전 동작: file은 바깥 router(index.tsx), line은 appRouteElements.tsx 기준 →
    // index.tsx:5는 `return <div>404</div>`로 라우트와 무관한 지점이었다.
    const { routeNodes } = await parseReactRouterFull(MAP_IMPORT, 'test@0.1')
    const mapped = routeNodes.filter(r => r.path !== '/*')
    expect(mapped.length).toBeGreaterThan(0)
    for (const r of mapped) {
      expect(r.provenance.file).not.toBe('src/router/index.tsx')
    }
  })

  it('같은 파일 map도 라우트별 선언 라인으로 분리된다', async () => {
    const { routeNodes } = await parseReactRouterFull(MAP_PREFIX, 'test@0.1')
    const dashboard = routeNodes.find(r => r.path === '/dashboard')
    const settings = routeNodes.find(r => r.path === '/settings')
    expect(dashboard?.provenance.line).toBe(5)
    expect(settings?.provenance.line).toBe(6)
  })
})
