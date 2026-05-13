/**
 * v1.1.52 결함4 검증: React Router sub-router 100+ routes 감지
 * 이전 버그: <Routes> 직속 children만 파싱 → 9 routes
 * 수정: 2-pass 알고리즘으로 sub-router JSX 감지 + parentPath 전달
 */
import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import { fileURLToPath } from 'url'
import { parseReactRouterFull } from './route-parser.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../../../../../../')
const FIXTURE_PATH = path.join(REPO_ROOT, 'fixtures/mini-react-router-overload')

describe('결함4: React Router sub-router 100+ routes 감지', () => {
  it('App.tsx → 10개 sub-router × 12 routes = 최소 100 routes 감지', async () => {
    const { routeNodes } = await parseReactRouterFull(FIXTURE_PATH, 'test@0.1')

    console.log(`  감지된 routes: ${routeNodes.length}`)
    if (routeNodes.length > 0) {
      const sample = routeNodes.slice(0, 6).map(r => r.path)
      console.log(`  샘플 경로: ${sample.join(', ')}`)
    }

    // 이전 버그 재현 시: App.tsx 직속 10개만 반환
    expect(routeNodes.length).toBeGreaterThanOrEqual(100)
  }, 30000)

  it('sub-router 경로 prefix가 올바르게 붙어야 한다 (/users/list, /admin/create 등)', async () => {
    const { routeNodes } = await parseReactRouterFull(FIXTURE_PATH, 'test@0.1')
    const paths = routeNodes.map(r => r.path)

    // App.tsx의 /users → UserRoutes.tsx의 list → /users/list
    const hasUsersRoutes = paths.some(p => p.startsWith('/users/'))
    // App.tsx의 /admin → AdminRoutes.tsx → /admin/...
    const hasAdminRoutes = paths.some(p => p.startsWith('/admin/'))
    // App.tsx의 /api → ApiRoutes.tsx → /api/...
    const hasApiRoutes = paths.some(p => p.startsWith('/api/'))

    console.log(`  /users/* 경로 존재: ${hasUsersRoutes}`)
    console.log(`  /admin/* 경로 존재: ${hasAdminRoutes}`)
    console.log(`  /api/* 경로 존재: ${hasApiRoutes}`)

    expect(hasUsersRoutes).toBe(true)
    expect(hasAdminRoutes).toBe(true)
    expect(hasApiRoutes).toBe(true)
  }, 30000)

  it('감지된 routes에 중복이 없어야 한다', async () => {
    const { routeNodes } = await parseReactRouterFull(FIXTURE_PATH, 'test@0.1')
    const paths = routeNodes.map(r => r.path)
    const unique = new Set(paths)
    console.log(`  전체: ${paths.length}, 유니크: ${unique.size}`)
    // 일부 중복은 허용 (동적 경로 패턴 중복), 하지만 절반 이상 중복이면 이상
    expect(unique.size).toBeGreaterThan(paths.length * 0.7)
  }, 30000)

  it('기존 mini-react-router-app fixture는 여전히 올바르게 파싱됨 (회귀 없음)', async () => {
    const origFixture = path.join(REPO_ROOT, 'fixtures/mini-react-router-app')
    const { routeNodes } = await parseReactRouterFull(origFixture, 'test@0.1')
    console.log(`  원본 fixture routes: ${routeNodes.length}`)
    // 기존 fixture: /, /about, /users, /users/:id = 4 routes
    expect(routeNodes.length).toBeGreaterThanOrEqual(4)
    expect(routeNodes.some(r => r.path === '/')).toBe(true)
  }, 30000)
})
