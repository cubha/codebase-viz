import * as path from 'node:path'
import { describe, it, expect } from 'vitest'
import { parseReactRouterFull } from './route-parser.js'

// v1.2.50 B-ST1 — path가 template literal(import 상수 치환)인 라우트의 정적 평가.
// 실제 repo 패턴: `path: \`${ORD_PROD_PLAN}/spec\`` — 현 파서는 StringLiteral만 허용해 전부 누락.
const FIXTURE = path.resolve(process.cwd(), 'fixtures/mini-react-router-domain-app')

describe('parseReactRouterFull — template literal path 정적 평가 (v1.2.50)', () => {
  it('cross-file import 상수 치환 template path 라우트 출현', async () => {
    const { routeNodes } = await parseReactRouterFull(FIXTURE, 'test@0.1')
    const paths = routeNodes.map(r => r.path)
    expect(paths).toContain('/order-plan/spec')
    expect(paths).toContain('/material/deco')
    expect(paths).toContain('/agency/users')
    expect(paths).toContain('/head-office/proc-code')
  })

  it('spread(...extraRoutes) 내부 template path도 평가', async () => {
    const { routeNodes } = await parseReactRouterFull(FIXTURE, 'test@0.1')
    expect(routeNodes.map(r => r.path)).toContain('/perf/trans')
  })

  it('5개 라우트 전부 컴포넌트 렌더 edge 보유 (src/pages 컴포넌트 resolve)', async () => {
    const { routeNodes, rendersEdges, componentNodes } = await parseReactRouterFull(FIXTURE, 'test@0.1')
    expect(routeNodes.length).toBe(5)
    expect(rendersEdges.length).toBeGreaterThanOrEqual(5)
    // 컴포넌트 filePath는 src/pages/<도메인>/... 형태여야 도메인 레이어링(B-ST2)이 동작
    const pagePaths = componentNodes.map(c => c.filePath)
    expect(pagePaths.some(p => p.includes('pages/partner/ordProdPlanMgmt'))).toBe(true)
    expect(pagePaths.some(p => p.includes('pages/agency/userMgmt'))).toBe(true)
    expect(pagePaths.some(p => p.includes('pages/headoffice/partnerBaseInfo'))).toBe(true)
  })
})
