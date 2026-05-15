import * as path from 'node:path'
import { describe, it, expect } from 'vitest'
import { parseReactRoutes } from './route-parser.js'

const FIXTURE = path.resolve(process.cwd(), 'fixtures/mini-react-router-jsx-expr')

describe('parseReactRoutes — JsxExpression 1-hop 추적 (v1.1.6 T1)', () => {
  // E-1: 동일 파일 const + .map() 데이터 배열 → inferred
  it('E-1: 동일 파일 const 변수 ({appRouteElements})로부터 .map() 결과 추출', async () => {
    const routes = await parseReactRoutes(FIXTURE, 'test@0.1')
    const paths = routes.map(r => r.path)
    expect(paths).toContain('/dashboard')
    expect(paths).toContain('/settings')
    expect(paths).toContain('/profile')
  })

  it('E-2: .map() 결과 라우트는 confidence: inferred + inferenceChain', async () => {
    const routes = await parseReactRoutes(FIXTURE, 'test@0.1')
    const dashboard = routes.find(r => r.path === '/dashboard')
    expect(dashboard?.confidence).toBe('inferred')
    expect(Array.isArray((dashboard as { inferenceChain?: string[] }).inferenceChain)).toBe(true)
  })

  // E-3: named import 1-hop → 다른 파일의 JSX fragment 추적
  it('E-3: named import ({MobileRoutes})에서 JSX fragment 안 Route 추출', async () => {
    const routes = await parseReactRoutes(FIXTURE, 'test@0.1')
    const paths = routes.map(r => r.path)
    expect(paths).toContain('/m/home')
    expect(paths).toContain('/m/search')
  })

  it('E-3b: named import ({MobileLoginRoute}) 단일 JsxSelfClosingElement도 추출', async () => {
    const routes = await parseReactRoutes(FIXTURE, 'test@0.1')
    expect(routes.map(r => r.path)).toContain('/m/login')
  })

  // E-4: 미해결 식별자는 노드 미생성 + 진단
  it('E-4: 미해결 식별자({Unknown})는 RouteNode 미생성 (Less is More)', async () => {
    const routes = await parseReactRoutes(FIXTURE, 'test@0.1')
    const paths = routes.map(r => r.path)
    for (const p of paths) {
      expect(p).not.toContain('Unknown')
    }
  })

  // E-5: path-less layout wrapper 안에서 expression이 아닌 일반 JsxElement는 부모 path와 합성
  it('E-5: path-less layout wrapper 안 Route는 부모 path 사용', async () => {
    const routes = await parseReactRoutes(FIXTURE, 'test@0.1')
    expect(routes.map(r => r.path)).toContain('/inside')
  })

  // E-6: literal Route는 회귀 없음
  it('E-6: 기존 literal Route(/login)도 정상 추출', async () => {
    const routes = await parseReactRoutes(FIXTURE, 'test@0.1')
    expect(routes.map(r => r.path)).toContain('/login')
  })

  // E-7: 총 합계 — JsxExpression 추적 전 0 추가 → 추가 후 모두 추출
  it('E-7: 총 라우트 8개 이상 (/login, /inside, /dashboard, /settings, /profile, /m/home, /m/search, /m/login)', async () => {
    const routes = await parseReactRoutes(FIXTURE, 'test@0.1')
    const paths = new Set(routes.map(r => r.path))
    const expected = ['/login', '/inside', '/dashboard', '/settings', '/profile', '/m/home', '/m/search', '/m/login']
    for (const p of expected) expect(paths.has(p)).toBe(true)
  })
})
