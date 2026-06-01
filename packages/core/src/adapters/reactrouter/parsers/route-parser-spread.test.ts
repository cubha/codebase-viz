import * as path from 'node:path'
import { describe, it, expect } from 'vitest'
import { parseReactRouterFull, parseReactRoutes } from './route-parser.js'

// v1.2.49 회귀 fixture — 실제 repo(REPO-SHARED-B2B-WINA-APP-FE) 구조 1:1.
// 결함 ① pathless layout `<Route>`가 가짜 '/' 노드 emit
// 결함 ② 부모 path + index 자식 동일 path 중복
// 결함 ③ 배열 spread(`...agencyRoutes`/`...partnerRoutes`) 침묵 skip
const FIXTURE = path.resolve(process.cwd(), 'fixtures/mini-react-router-spread-app')

describe('parseReactRouterFull — spread + pathless + dedup (v1.2.49)', () => {
  it('③a 배열 리터럴 spread(...partnerRoutes) 라우트 출현', async () => {
    const { routeNodes } = await parseReactRouterFull(FIXTURE, 'test@0.1')
    const paths = routeNodes.map(r => r.path)
    expect(paths).toContain('/partner/ordProdPlanMgmt/prodOrdSpec')
    expect(paths).toContain('/partner/matMgmt/decoSheet')
  })

  it('③b Object.entries(obj).map() spread(...agencyRoutes) 라우트 출현 (키 정적 평가)', async () => {
    const { routeNodes } = await parseReactRouterFull(FIXTURE, 'test@0.1')
    expect(routeNodes.map(r => r.path)).toContain('/agency/masterMgmt/customerMgmt')
  })

  it('① pathless layout 래퍼는 가짜 / 노드를 emit하지 않음 (/ 정확히 1개)', async () => {
    const { routeNodes } = await parseReactRouterFull(FIXTURE, 'test@0.1')
    const rootCount = routeNodes.filter(r => r.path === '/').length
    expect(rootCount).toBe(1)
  })

  it('② 부모 path + index 자식 동일 path 중복 제거 (/login 정확히 1개)', async () => {
    const { routeNodes } = await parseReactRouterFull(FIXTURE, 'test@0.1')
    const loginCount = routeNodes.filter(r => r.path === '/login').length
    expect(loginCount).toBe(1)
  })

  it('inline appRoutes(home/system/headOffice) 회귀 없음', async () => {
    const { routeNodes } = await parseReactRouterFull(FIXTURE, 'test@0.1')
    const paths = routeNodes.map(r => r.path)
    expect(paths).toContain('/home')
    expect(paths).toContain('/system/code')
    expect(paths).toContain('/headOffice/alloc/regionalRank/regional-rank')
  })

  it('mobile sub-router(named import JSX) 회귀 없음', async () => {
    const { routeNodes } = await parseReactRouterFull(FIXTURE, 'test@0.1')
    const paths = routeNodes.map(r => r.path)
    expect(paths).toContain('/mobile/login')
    expect(paths).toContain('/mobile')
    expect(paths).toContain('/mobile/home')
  })

  it('모든 routeNode id는 유일 (dedup 보장)', async () => {
    const { routeNodes } = await parseReactRouterFull(FIXTURE, 'test@0.1')
    const ids = routeNodes.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('parseReactRoutes(twin) — spread 일관성 (v1.2.49)', () => {
  it('twin도 spread 라우트를 동일하게 추출', async () => {
    const routes = await parseReactRoutes(FIXTURE, 'test@0.1')
    const paths = new Set(routes.map(r => r.path))
    expect(paths.has('/partner/matMgmt/decoSheet')).toBe(true)
    expect(paths.has('/agency/masterMgmt/customerMgmt')).toBe(true)
    expect(routes.filter(r => r.path === '/').length).toBe(1)
  })
})
