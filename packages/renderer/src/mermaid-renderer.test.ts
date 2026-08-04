import { describe, it, expect, afterEach } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { renderMermaid, buildDiagrams } from './mermaid-renderer.js'
import { createIRGraph, createRouteNode, createComponentNode, createTableNode, createEdge, makeNodeId, makeEdgeId } from '@codebase-viz/types'

const FIXTURES_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/mini-next-app',
)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = path.join(__dirname, '../../../../.tmp-renderer-test')

afterEach(async () => {
  await fs.rm(OUTPUT_DIR, { recursive: true, force: true })
})

describe('renderMermaid', () => {
  it('빈 IRGraph로 3개 .md 파일을 생성한다', async () => {
    const graph = createIRGraph({
      analyzerVersion: 'codebase-viz@0.1.0',
      repoRoot: '/tmp/test',
      nodes: [],
      edges: [],
    })

    await renderMermaid(graph, OUTPUT_DIR)

    const files = await fs.readdir(OUTPUT_DIR)
    expect(files).toContain('rendering.md')
    expect(files).toContain('screen-component.md')
    expect(files).toContain('db-screen.md')
  })

  it('각 .md 파일은 mermaid 코드블록을 포함한다', async () => {
    const graph = createIRGraph({
      analyzerVersion: 'codebase-viz@0.1.0',
      repoRoot: '/tmp/test',
      nodes: [],
      edges: [],
    })

    await renderMermaid(graph, OUTPUT_DIR)

    for (const file of ['rendering.md', 'screen-component.md', 'db-screen.md']) {
      const content = await fs.readFile(path.join(OUTPUT_DIR, file), 'utf8')
      expect(content).toContain('```mermaid')
    }
  })

  it('rendering.md는 graph TD 다이어그램을 포함한다', async () => {
    const graph = createIRGraph({
      analyzerVersion: 'codebase-viz@0.1.0',
      repoRoot: '/tmp/test',
      nodes: [],
      edges: [],
    })

    await renderMermaid(graph, OUTPUT_DIR)
    const content = await fs.readFile(path.join(OUTPUT_DIR, 'rendering.md'), 'utf8')
    expect(content).toContain('graph TD')
  })

  it('screen-component.md는 graph TB 다이어그램을 포함한다', async () => {
    const graph = createIRGraph({
      analyzerVersion: 'codebase-viz@0.1.0',
      repoRoot: '/tmp/test',
      nodes: [],
      edges: [],
    })

    await renderMermaid(graph, OUTPUT_DIR)
    const content = await fs.readFile(path.join(OUTPUT_DIR, 'screen-component.md'), 'utf8')
    expect(content).toContain('graph TB')
  })

  it('db-screen.md는 erDiagram을 포함한다', async () => {
    const graph = createIRGraph({
      analyzerVersion: 'codebase-viz@0.1.0',
      repoRoot: '/tmp/test',
      nodes: [],
      edges: [],
    })

    await renderMermaid(graph, OUTPUT_DIR)
    const content = await fs.readFile(path.join(OUTPUT_DIR, 'db-screen.md'), 'utf8')
    expect(content).toContain('erDiagram')
  })

  it('다중 섹션 라우트는 subgraph로 그루핑된다', async () => {
    const prov = { file: 'app/blog/page.tsx', line: 1, adapter: 'test', analyzerVersion: '0.1' }
    const blogRoute = createRouteNode({
      id: makeNodeId('route', 'app/blog/page.tsx', '/blog'),
      path: '/blog',
      filePath: 'app/blog/page.tsx',
      routeFileKind: 'page',
      dynamicSegmentType: 'static',
      isGroupRoute: false,
      renderingMode: 'SSR',
      provenance: prov,
      confidence: 'verified',
    })
    const adminRoute = createRouteNode({
      id: makeNodeId('route', 'app/admin/page.tsx', '/admin'),
      path: '/admin',
      filePath: 'app/admin/page.tsx',
      routeFileKind: 'page',
      dynamicSegmentType: 'static',
      isGroupRoute: false,
      renderingMode: 'CSR',
      provenance: { ...prov, file: 'app/admin/page.tsx' },
      confidence: 'verified',
    })

    const graph = createIRGraph({
      analyzerVersion: 'codebase-viz@0.1.0',
      repoRoot: '/tmp/test',
      nodes: [blogRoute, adminRoute],
      edges: [],
    })

    await renderMermaid(graph, OUTPUT_DIR)
    const content = await fs.readFile(path.join(OUTPUT_DIR, 'rendering.md'), 'utf8')
    // FE 표준 v1.2 (R-T1.2): Tab1은 top-level 도메인 요약 박스(도메인명 + 라우트 수 배지)로 표시.
    // 개별 라우트 leaf 열거는 Tab2로 위임 → Tab1에서는 도메인 박스만 검증.
    expect(content).toContain('blog · 1 route')
    expect(content).toContain('admin · 1 route')
    expect(content).toContain('classDef ssr')
    expect(content).toContain('classDef csr')
  })

  it('Next.js 프로젝트에 VERCEL 인프라 wrapper가 생성된다', async () => {
    const prov = { file: 'app/page.tsx', line: 1, adapter: 'test', analyzerVersion: '0.1' }
    const route = createRouteNode({
      id: makeNodeId('route', 'app/page.tsx', 'page'),
      path: '/',
      filePath: 'app/page.tsx',
      routeFileKind: 'page',
      dynamicSegmentType: 'static',
      isGroupRoute: false,
      renderingMode: 'SSR',
      provenance: prov,
      confidence: 'verified',
    })
    const graph = createIRGraph({
      analyzerVersion: 'codebase-viz@0.1.0',
      repoRoot: FIXTURES_ROOT,
      metadata: {
        framework: 'nextjs-app-router',
        hasSupabase: true,
        hasPrisma: false,
        hasDexie: false,
        hasFirebase: false,
      },
      nodes: [route],
      edges: [],
    })

    await renderMermaid(graph, OUTPUT_DIR)
    const content = await fs.readFile(path.join(OUTPUT_DIR, 'rendering.md'), 'utf8')
    expect(content).toContain('INFRA')
    expect(content).toContain('Next.js')
    expect(content).toContain('REACT')
    expect(content).toContain('DATALAYER')
    expect(content).toContain('PG_SB')
  })

  it('렌더링 모드에 따라 classDef가 적용된다', async () => {
    const prov = { file: 'app/page.tsx', line: 1, adapter: 'test', analyzerVersion: '0.1' }
    const route = createRouteNode({
      id: makeNodeId('route', 'app/page.tsx', '/'),
      path: '/',
      filePath: 'app/page.tsx',
      routeFileKind: 'page',
      dynamicSegmentType: 'static',
      isGroupRoute: false,
      renderingMode: 'ISR',
      provenance: prov,
      confidence: 'verified',
    })

    const graph = createIRGraph({
      analyzerVersion: 'codebase-viz@0.1.0',
      repoRoot: '/tmp/test',
      nodes: [route],
      edges: [],
    })

    await renderMermaid(graph, OUTPUT_DIR)
    // FE 표준 v1.2 (R-T1.6): renderingMode classDef는 라우트 leaf에 적용되며, 라우트 leaf는
    // Tab1(도메인 요약)이 아닌 Tab2(screen-component)에 표시된다. Tab2에서 적용 검증.
    const content = await fs.readFile(path.join(OUTPUT_DIR, 'screen-component.md'), 'utf8')
    expect(content).toContain(':::isr')
  })

  it('Tab2 — section subgraph에 direction LR이 없고 컴포넌트는 외부 자유 노드로 렌더링된다', async () => {
    const prov = { file: 'app/blog/page.tsx', line: 1, adapter: 'test', analyzerVersion: '0.1' }
    const route = createRouteNode({
      id: makeNodeId('route', 'app/blog/page.tsx', '/blog'),
      path: '/blog',
      filePath: 'app/blog/page.tsx',
      routeFileKind: 'page',
      dynamicSegmentType: 'static',
      isGroupRoute: false,
      renderingMode: 'SSR',
      provenance: prov,
      confidence: 'verified',
    })
    const comp = createComponentNode({
      id: makeNodeId('component', 'components/BlogCard.tsx', 'BlogCard'),
      name: 'BlogCard',
      filePath: 'components/BlogCard.tsx',
      runtime: 'server',
      provenance: { file: 'components/BlogCard.tsx', line: 1, adapter: 'test', analyzerVersion: '0.1' },
      confidence: 'verified',
    })
    const edge = createEdge({
      id: makeEdgeId('renders', route.id, comp.id),
      from: route.id,
      to: comp.id,
      kind: 'renders',
      provenance: prov,
      confidence: 'verified',
    })
    const graph = createIRGraph({
      analyzerVersion: 'codebase-viz@0.1.0',
      repoRoot: '/tmp/test',
      nodes: [route, comp],
      edges: [edge],
    })
    await renderMermaid(graph, OUTPUT_DIR)
    const content = await fs.readFile(path.join(OUTPUT_DIR, 'screen-component.md'), 'utf8')
    expect(content).not.toContain('direction LR')
    expect(content).toContain('BlogCard')
    // SubTask B: 컴포넌트는 per-section subgraph 내부에 위치 (4-space indent)
    const compLine = content.split('\n').find(l => l.includes('BlogCard'))
    expect(compLine?.startsWith('    ')).toBe(true)
  })

  it('DB — 9개 이상 컬럼 테이블의 모든 컬럼을 ERD에 출력한다', async () => {
    const prov = { file: 'schema.prisma', line: 1, adapter: 'test', analyzerVersion: '0.1' }
    const columns = Array.from({ length: 9 }, (_, i) => ({
      name: `col${i}`,
      type: 'varchar',
      isPrimaryKey: i === 0,
      nullable: false,
    }))
    const table = createTableNode({
      id: makeNodeId('table', 'schema.prisma', 'users'),
      name: 'users',
      columns,
      provenance: prov,
      confidence: 'verified',
    })
    const graph = createIRGraph({
      analyzerVersion: 'codebase-viz@0.1.0',
      repoRoot: '/tmp/test',
      nodes: [table],
      edges: [],
    })
    await renderMermaid(graph, OUTPUT_DIR)
    const content = await fs.readFile(path.join(OUTPUT_DIR, 'db-screen.md'), 'utf8')
    for (let i = 0; i < 9; i++) expect(content).toContain(`col${i}`)
  })
})

// ─── BE Renderer Tests ────────────────────────────────────────────────────────

function makeBeRoute(
  filePath: string,
  urlPath: string,
  httpMethod: string,
): ReturnType<typeof createRouteNode> {
  const prov = { file: filePath, line: 1, adapter: 'test', analyzerVersion: '0.1' }
  return createRouteNode({
    id: makeNodeId('route', filePath, `${urlPath}:${httpMethod}`),
    path: urlPath,
    filePath,
    routeFileKind: 'page',
    dynamicSegmentType: 'static',
    isGroupRoute: false,
    renderingMode: 'SSR',
    httpMethod,
    provenance: prov,
    confidence: 'verified',
  })
}

function makeBeComponent(
  name: string,
  filePath: string,
): ReturnType<typeof createComponentNode> {
  const prov = { file: filePath, line: 1, adapter: 'test', analyzerVersion: '0.1' }
  return createComponentNode({
    id: makeNodeId('component', filePath, name),
    name,
    filePath,
    runtime: 'server',
    provenance: prov,
    confidence: 'inferred',
    inferenceChain: [`spring: @Component ${name}`],
  })
}

describe('BE 렌더러 — Tab3 (BE-E)', () => {
  it('adapterCategory=BE 시 queries 엣지 없는 Repository도 Tab3에 표시', async () => {
    const repo = makeBeComponent('UserRepository', 'repository/UserRepository.java')
    const table = createTableNode({
      id: makeNodeId('table', 'schema.sql', 'users'),
      name: 'users',
      columns: [{ name: 'id', type: 'bigint', nullable: false, isPrimaryKey: true }],
      provenance: { file: 'schema.sql', line: 1, adapter: 'test', analyzerVersion: '0.1' },
      confidence: 'verified',
    })

    const graph = createIRGraph({
      analyzerVersion: '0.1',
      repoRoot: '/tmp/be',
      metadata: { framework: 'springboot', hasSupabase: false, hasPrisma: false, hasDexie: false, hasFirebase: false, adapterCategory: 'BE' },
      nodes: [repo, table],
      edges: [], // no queries edges
    })

    await renderMermaid(graph, OUTPUT_DIR)
    const content = await fs.readFile(path.join(OUTPUT_DIR, 'db-screen.md'), 'utf8')
    expect(content).toContain('UserRepository')
    expect(content).toContain('users')
  })

  it('queries 엣지 있는 Repository는 Table과 연결 표시', async () => {
    const prov = { file: 'repository/UserRepository.java', line: 1, adapter: 'test', analyzerVersion: '0.1' }
    const repo = makeBeComponent('UserRepository', 'repository/UserRepository.java')
    const table = createTableNode({
      id: makeNodeId('table', 'schema.sql', 'users'),
      name: 'users',
      columns: [{ name: 'id', type: 'bigint', nullable: false, isPrimaryKey: true }],
      provenance: { file: 'schema.sql', line: 1, adapter: 'test', analyzerVersion: '0.1' },
      confidence: 'verified',
    })
    const queriesEdge = createEdge({
      id: makeEdgeId('queries', repo.id, table.id),
      from: repo.id,
      to: table.id,
      kind: 'queries',
      provenance: prov,
      confidence: 'inferred',
      inferenceChain: ['filename match: table "users" found in component basename "UserRepository"'],
    })

    const graph = createIRGraph({
      analyzerVersion: '0.1',
      repoRoot: '/tmp/be',
      metadata: { framework: 'springboot', hasSupabase: false, hasPrisma: false, hasDexie: false, hasFirebase: false, adapterCategory: 'BE' },
      nodes: [repo, table],
      edges: [queriesEdge],
    })

    await renderMermaid(graph, OUTPUT_DIR)
    const content = await fs.readFile(path.join(OUTPUT_DIR, 'db-screen.md'), 'utf8')
    expect(content).toContain('UserRepository')
    expect(content).toContain('queries')
  })

  it('FE 프로젝트는 기존 Tab3 동작 유지 (Repository 추가 없음)', async () => {
    const table = createTableNode({
      id: makeNodeId('table', 'schema.prisma', 'posts'),
      name: 'posts',
      columns: [{ name: 'id', type: 'int', nullable: false, isPrimaryKey: true }],
      provenance: { file: 'schema.prisma', line: 1, adapter: 'test', analyzerVersion: '0.1' },
      confidence: 'verified',
    })
    const graph = createIRGraph({
      analyzerVersion: '0.1',
      repoRoot: '/tmp/fe',
      metadata: { framework: 'nextjs-app-router', hasSupabase: false, hasPrisma: false, hasDexie: false, hasFirebase: false, adapterCategory: 'FE' },
      nodes: [table],
      edges: [],
    })
    await renderMermaid(graph, OUTPUT_DIR)
    const content = await fs.readFile(path.join(OUTPUT_DIR, 'db-screen.md'), 'utf8')
    expect(content).toContain('posts')
    expect(content).not.toContain('CTRL_G')
  })
})

describe('BE 렌더러 — Tab2 (BE-D, v1.2.40 표준)', () => {
  it('adapterCategory=BE 시 leaf DI 수직 체인 subgraph 생성', async () => {
    // 동일 도메인 패키지(user) 안의 Controller·Service·Repository — cross-pkg edge 없어야 함
    const ctrl = makeBeComponent('UserController', 'src/main/java/com/example/user/controller/UserController.java')
    const svc = makeBeComponent('UserService', 'src/main/java/com/example/user/service/UserService.java')
    const repo = makeBeComponent('UserRepository', 'src/main/java/com/example/user/repository/UserRepository.java')

    const prov = { file: ctrl.filePath, line: 1, adapter: 'test', analyzerVersion: '0.1' }
    const callsEdge = createEdge({
      id: makeEdgeId('calls', ctrl.id, svc.id),
      from: ctrl.id, to: svc.id, kind: 'calls', provenance: prov, confidence: 'inferred',
      inferenceChain: ['spring-di: UserController → UserService'],
    })
    const callsEdge2 = createEdge({
      id: makeEdgeId('calls', svc.id, repo.id),
      from: svc.id, to: repo.id, kind: 'calls', provenance: prov, confidence: 'inferred',
      inferenceChain: ['spring-di: UserService → UserRepository'],
    })

    const graph = createIRGraph({
      analyzerVersion: '0.1',
      repoRoot: '/tmp/be',
      metadata: { framework: 'springboot', hasSupabase: false, hasPrisma: false, hasDexie: false, hasFirebase: false, adapterCategory: 'BE' },
      nodes: [ctrl, svc, repo],
      edges: [callsEdge, callsEdge2],
    })

    await renderMermaid(graph, OUTPUT_DIR)
    const content = await fs.readFile(path.join(OUTPUT_DIR, 'screen-component.md'), 'utf8')

    expect(content).toContain('graph TD')
    expect(content).toContain('📁 src/main/java/com.example.user') // 헤더 annotation (R-T1.2)
    expect(content).toMatch(/subgraph di_[^"]*\["\[ DI \]"\]/) // leaf DI subgraph (R-T2.2)
    expect(content).toContain('UserController')
    expect(content).toContain('UserService')
    expect(content).toContain('UserRepository')
    expect(content).toContain('-.->') // inferred edge
    expect(content).not.toContain('cross-pkg') // 동일 도메인 → cross-pkg 없음
    expect(content).not.toContain('CTRL_G') // 구 v1.2.2 layout 폐기 확인
  })

  it('Repository 없는 Service 체인 — 실제 노드만 표시, (no Repository) 추정 안 함 (v1.2.50)', async () => {
    // v1.2.50: 고정 슬롯 폐기. Controller→Service만 있으면 2단만 그리고 placeholder 미생성 (Less is More).
    const ctrl = makeBeComponent('AdminController', 'src/main/java/com/example/admin/controller/AdminController.java')
    const svc = makeBeComponent('AdminService', 'src/main/java/com/example/admin/service/AdminService.java')
    const prov = { file: ctrl.filePath, line: 1, adapter: 'test', analyzerVersion: '0.1' }
    const callsEdge = createEdge({
      id: makeEdgeId('calls', ctrl.id, svc.id),
      from: ctrl.id, to: svc.id, kind: 'calls', provenance: prov, confidence: 'verified',
    })
    const graph = createIRGraph({
      analyzerVersion: '0.1',
      repoRoot: '/tmp/be',
      metadata: { framework: 'springboot', hasSupabase: false, hasPrisma: false, hasDexie: false, hasFirebase: false, adapterCategory: 'BE' },
      nodes: [ctrl, svc],
      edges: [callsEdge],
    })
    await renderMermaid(graph, OUTPUT_DIR)
    const content = await fs.readFile(path.join(OUTPUT_DIR, 'screen-component.md'), 'utf8')
    expect(content).toContain('AdminController')
    expect(content).toContain('AdminService')
    expect(content).not.toContain('(no Repository)')
    expect(content).not.toContain('(no Service)')
  })

  it('C3: 외부 시스템 노드(@FeignClient)는 :::ext 클래스로 구분 렌더된다', async () => {
    const base = 'src/main/java/com/example/order'
    const ctrl = makeBeComponent('OrderController', `${base}/controller/OrderController.java`)
    const svc = makeBeComponent('OrderService', `${base}/service/OrderService.java`)
    const feignRaw = makeBeComponent('UserServiceClient', `${base}/client/UserServiceClient.java`)
    // external-call-extractor 마커(provenance.adapter)를 재현 — 실제 parseFeignClients 산출과 동일 형태.
    const feign = { ...feignRaw, provenance: { ...feignRaw.provenance, adapter: 'external-call-extractor@0.1' } }
    const prov = { file: ctrl.filePath, line: 1, adapter: 'test', analyzerVersion: '0.1' }
    const ce = (from: typeof ctrl, to: typeof ctrl) => createEdge({
      id: makeEdgeId('calls', from.id, to.id), from: from.id, to: to.id, kind: 'calls', provenance: prov, confidence: 'verified',
    })
    const graph = createIRGraph({
      analyzerVersion: '0.1',
      repoRoot: '/tmp/be',
      metadata: { framework: 'springboot', hasSupabase: false, hasPrisma: false, hasDexie: false, hasFirebase: false, adapterCategory: 'BE' },
      nodes: [ctrl, svc, feign],
      edges: [ce(ctrl, svc), ce(svc, feign)],
    })
    await renderMermaid(graph, OUTPUT_DIR)
    const content = await fs.readFile(path.join(OUTPUT_DIR, 'screen-component.md'), 'utf8')
    expect(content).toContain('UserServiceClient')
    expect(content).not.toContain('cross-pkg') // 동일 파일 트리 내 — cross-pkg 아님
    const feignLine = content.split('\n').find(l => l.includes('UserServiceClient['))
    expect(feignLine).toMatch(/:::ext$/)
  })

  it('C4: Tab1 leaf가 DI 체인으로 도달 가능한 테이블을 🗄 뱃지로 보여준다 (K4)', async () => {
    const base = 'src/main/java/com/example/order'
    const ctrl = makeBeComponent('OrderController', `${base}/controller/OrderController.java`)
    const repo = makeBeComponent('OrderRepository', `${base}/repository/OrderRepository.java`)
    const route = makeBeRoute(`${base}/controller/OrderController.java`, '/api/orders', 'GetMapping')
    const table = createTableNode({
      id: makeNodeId('table', 'db', 'orders'),
      name: 'orders',
      columns: [],
      provenance: { file: 'db', line: 1, adapter: 'test', analyzerVersion: '0.1' },
      confidence: 'verified',
    })
    const prov = { file: ctrl.filePath, line: 1, adapter: 'test', analyzerVersion: '0.1' }
    const graph = createIRGraph({
      analyzerVersion: '0.1',
      repoRoot: '/tmp/be',
      metadata: { framework: 'springboot', hasSupabase: false, hasPrisma: false, hasDexie: false, hasFirebase: false, adapterCategory: 'BE' },
      nodes: [ctrl, repo, route, table],
      edges: [
        createEdge({ id: makeEdgeId('calls', ctrl.id, repo.id), from: ctrl.id, to: repo.id, kind: 'calls', provenance: prov, confidence: 'verified' }),
        createEdge({ id: makeEdgeId('queries', repo.id, table.id), from: repo.id, to: table.id, kind: 'queries', provenance: prov, confidence: 'inferred', inferenceChain: ['filename match'] }),
      ],
    })

    await renderMermaid(graph, OUTPUT_DIR)
    const rendering = await fs.readFile(path.join(OUTPUT_DIR, 'rendering.md'), 'utf8')
    expect(rendering).toContain('🗄 orders')
    expect(rendering).toContain('OrderController')
  })

  it('N-ary DI 체인: 다중 Service 인라인 + ServiceImpl→다중 Repository fan-out + Repository→XML (v1.2.50, A-ST4)', async () => {
    const base = 'src/main/java/com/wina/partner/common/commonPop'
    const ctrl = makeBeComponent('CommonPopController', `${base}/controller/CommonPopController.java`)
    const svcA = makeBeComponent('CommonPopService', `${base}/service/CommonPopService.java`)
    const svcB = makeBeComponent('PerfStatusService', `${base}/service/PerfStatusService.java`)
    const implA = makeBeComponent('CommonPopServiceImpl', `${base}/service/CommonPopServiceImpl.java`)
    const implB = makeBeComponent('PerfStatusServiceImpl', `${base}/service/PerfStatusServiceImpl.java`)
    const repo1 = makeBeComponent('CommonPopRepository', `${base}/repository/CommonPopRepository.java`)
    const repo2 = makeBeComponent('OrderRepository', `${base}/repository/OrderRepository.java`)
    const repo3 = makeBeComponent('PerfStatusRepository', `${base}/repository/PerfStatusRepository.java`)
    const xml1 = makeBeComponent('CommonPopMapper.xml', 'src/main/resources/mapper/CommonPopMapper.xml')
    const prov = { file: ctrl.filePath, line: 1, adapter: 'test', analyzerVersion: '0.1' }
    const ce = (from: typeof ctrl, to: typeof ctrl) => createEdge({
      id: makeEdgeId('calls', from.id, to.id), from: from.id, to: to.id, kind: 'calls', provenance: prov, confidence: 'verified',
    })
    const graph = createIRGraph({
      analyzerVersion: '0.1',
      repoRoot: '/tmp/be',
      metadata: { framework: 'springboot', hasSupabase: false, hasPrisma: false, hasDexie: false, hasFirebase: false, adapterCategory: 'BE' },
      nodes: [ctrl, svcA, svcB, implA, implB, repo1, repo2, repo3, xml1],
      edges: [
        ce(ctrl, svcA), ce(ctrl, svcB),
        ce(svcA, implA), ce(svcB, implB),
        ce(implA, repo1), ce(implA, repo2), ce(implB, repo3),
        ce(repo1, xml1),
      ],
    })
    await renderMermaid(graph, OUTPUT_DIR)
    const content = await fs.readFile(path.join(OUTPUT_DIR, 'screen-component.md'), 'utf8')
    // 다중 Service 인라인 — 둘 다 노드 존재
    expect(content).toContain('CommonPopService')
    expect(content).toContain('PerfStatusService')
    // Service → ServiceImpl
    expect(content).toContain('CommonPopServiceImpl')
    expect(content).toContain('PerfStatusServiceImpl')
    // ServiceImpl → 다중 Repository fan-out
    expect(content).toContain('CommonPopRepository')
    expect(content).toContain('OrderRepository')
    expect(content).toContain('PerfStatusRepository')
    // Repository → XML
    expect(content).toContain('CommonPopMapper.xml')
    expect(content).not.toContain('cross-pkg') // 단일 도메인
  })

  it('C1: XML → Statement 홉이 cross-pkg placeholder 아닌 실 terminal 노드로 렌더된다', async () => {
    const base = 'src/main/java/com/wina/partner/common/commonPop'
    const ctrl = makeBeComponent('CommonPopController', `${base}/controller/CommonPopController.java`)
    const repo = makeBeComponent('CommonPopRepository', `${base}/repository/CommonPopRepository.java`)
    const xmlPath = 'src/main/resources/mapper/CommonPopMapper.xml'
    const xml = makeBeComponent('CommonPopMapper.xml', xmlPath)
    const stmt = makeBeComponent('findAll [SELECT]', xmlPath)
    const prov = { file: ctrl.filePath, line: 1, adapter: 'test', analyzerVersion: '0.1' }
    const ce = (from: typeof ctrl, to: typeof ctrl) => createEdge({
      id: makeEdgeId('calls', from.id, to.id), from: from.id, to: to.id, kind: 'calls', provenance: prov, confidence: 'verified',
    })
    const graph = createIRGraph({
      analyzerVersion: '0.1',
      repoRoot: '/tmp/be',
      metadata: { framework: 'springboot', hasSupabase: false, hasPrisma: false, hasDexie: false, hasFirebase: false, adapterCategory: 'BE' },
      nodes: [ctrl, repo, xml, stmt],
      edges: [ce(ctrl, repo), ce(repo, xml), ce(xml, stmt)],
    })
    await renderMermaid(graph, OUTPUT_DIR)
    const content = await fs.readFile(path.join(OUTPUT_DIR, 'screen-component.md'), 'utf8')
    expect(content).toContain('findAll [SELECT]')
    expect(content).not.toContain('(external')
    expect(content).not.toContain('cross-pkg')
    // statement는 XML과 동일한 :::pkg 스타일 (R-T2.6 v1.2 amendment)
    const stmtLine = content.split('\n').find(l => l.includes('findAll [SELECT]'))
    expect(stmtLine).toMatch(/:::pkg/)
  })

  it('신뢰 불가 이름(XML statement id)의 따옴표·개행이 Tab2 plain 라벨을 탈출하지 못한다', async () => {
    const base = 'src/main/java/com/wina/partner/common/commonPop'
    const ctrl = makeBeComponent('CommonPopController', `${base}/controller/CommonPopController.java`)
    const xmlPath = 'src/main/resources/mapper/CommonPopMapper.xml'
    const xml = makeBeComponent('CommonPopMapper.xml', xmlPath)
    // MyBatis XML의 id 속성은 분석 대상 리포가 통제 — 라벨 탈출(`"]`) + 개행 후 mermaid 구문 주입 시도
    const evil = makeBeComponent('evil"]:::x\n  click nid "https://evil [SELECT]', xmlPath)
    const prov = { file: ctrl.filePath, line: 1, adapter: 'test', analyzerVersion: '0.1' }
    const ce = (from: typeof ctrl, to: typeof ctrl) => createEdge({
      id: makeEdgeId('calls', from.id, to.id), from: from.id, to: to.id, kind: 'calls', provenance: prov, confidence: 'verified',
    })
    const graph = createIRGraph({
      analyzerVersion: '0.1',
      repoRoot: '/tmp/be',
      metadata: { framework: 'springboot', hasSupabase: false, hasPrisma: false, hasDexie: false, hasFirebase: false, adapterCategory: 'BE' },
      nodes: [ctrl, xml, evil],
      edges: [ce(ctrl, xml), ce(xml, evil)],
    })
    await renderMermaid(graph, OUTPUT_DIR)
    const content = await fs.readFile(path.join(OUTPUT_DIR, 'screen-component.md'), 'utf8')
    // 개행이 살아남아 별도 mermaid 문장이 되면 실패
    expect(content).not.toMatch(/^\s*click /m)
    // 라벨 안 원본 `"`는 `'`로 치환 — evil 라인의 `"`는 라벨 구분자 2개뿐이어야 한다
    const evilLine = content.split('\n').find(l => l.includes('evil'))
    expect(evilLine).toBeDefined()
    expect((evilLine as string).match(/"/g)).toHaveLength(2)
  })

  it('DI edge 없는 Controller는 leaf만 표시 — (none) 추정 안 함 (R-T2.5)', async () => {
    const ctrl = makeBeComponent('UtilController', 'src/main/java/com/example/util/controller/UtilController.java')
    const graph = createIRGraph({
      analyzerVersion: '0.1',
      repoRoot: '/tmp/be',
      metadata: { framework: 'springboot', hasSupabase: false, hasPrisma: false, hasDexie: false, hasFirebase: false, adapterCategory: 'BE' },
      nodes: [ctrl],
      edges: [],
    })
    await renderMermaid(graph, OUTPUT_DIR)
    const content = await fs.readFile(path.join(OUTPUT_DIR, 'screen-component.md'), 'utf8')
    expect(content).toContain('📄 UtilController')
    expect(content).not.toContain('(no Service)')
    expect(content).not.toContain('(no Repository)')
    expect(content).not.toMatch(/subgraph di_/)
  })

  it('cross-package DI: 외부 컴포넌트 ID 참조 금지 — placeholder로 대체 (ghost-node 회피)', async () => {
    // partner Controller·Service는 chunk A, agency Controller·Service·Repository는 chunk B.
    // partner Service → agency Repository 주입 (cross-pkg) → 외부 ID 참조 대신 (external Repository) placeholder 사용.
    const pCtrl = makeBeComponent('PartnerController', 'src/main/java/com/example/partner/controller/PartnerController.java')
    const pSvc = makeBeComponent('PartnerService', 'src/main/java/com/example/partner/service/PartnerService.java')
    const aCtrl = makeBeComponent('AgencyController', 'src/main/java/com/example/agency/controller/AgencyController.java')
    const aSvc = makeBeComponent('AgencyService', 'src/main/java/com/example/agency/service/AgencyService.java')
    const aRepo = makeBeComponent('AgencyRepository', 'src/main/java/com/example/agency/repository/AgencyRepository.java')
    const prov = { file: pCtrl.filePath, line: 1, adapter: 'test', analyzerVersion: '0.1' }
    const e1 = createEdge({ id: makeEdgeId('calls', pCtrl.id, pSvc.id), from: pCtrl.id, to: pSvc.id, kind: 'calls', provenance: prov, confidence: 'verified' })
    const e2 = createEdge({ id: makeEdgeId('calls', pSvc.id, aRepo.id), from: pSvc.id, to: aRepo.id, kind: 'calls', provenance: prov, confidence: 'verified' })
    const e3 = createEdge({ id: makeEdgeId('calls', aCtrl.id, aSvc.id), from: aCtrl.id, to: aSvc.id, kind: 'calls', provenance: prov, confidence: 'verified' })
    const e4 = createEdge({ id: makeEdgeId('calls', aSvc.id, aRepo.id), from: aSvc.id, to: aRepo.id, kind: 'calls', provenance: prov, confidence: 'verified' })
    const graph = createIRGraph({
      analyzerVersion: '0.1',
      repoRoot: '/tmp/be',
      metadata: { framework: 'springboot', hasSupabase: false, hasPrisma: false, hasDexie: false, hasFirebase: false, adapterCategory: 'BE' },
      nodes: [pCtrl, pSvc, aCtrl, aSvc, aRepo],
      edges: [e1, e2, e3, e4],
    })
    await renderMermaid(graph, OUTPUT_DIR)
    const content = await fs.readFile(path.join(OUTPUT_DIR, 'screen-component.md'), 'utf8')
    // chunked emit 확인
    expect(content).toContain('%%--CHUNK--%%')
    // partner chunk는 (external Repository) placeholder 사용 (실제 aRepo 노드 ID 참조 금지)
    expect(content).toContain('(external Repository)')
    // cross-pkg 라벨 in-chain edge에 정상 부여
    expect(content).toContain('cross-pkg')
    // 핵심: partner chunk가 외부 aRepo의 node ID를 직접 참조하지 않아야 함 → ghost-node 회피
    expect(content).not.toMatch(/PartnerService.* -.-> +component_src_main_java_com_example_agency/)
  })

  it('cross-package DI edge emit (R-T2.4)', async () => {
    // 단일 chunk(partner) 안에 from·to 양쪽 모두 존재 — cross-pkg edge emit
    const ctrl = makeBeComponent('PartnerController', 'src/main/java/com/example/partner/controller/PartnerController.java')
    const svc = makeBeComponent('PartnerService', 'src/main/java/com/example/partner/service/PartnerService.java')
    // partner 안에서 agency Repository를 주입받는 가정 — 실제 도메인 다름
    const repo = makeBeComponent('AgencyRepository', 'src/main/java/com/example/partner/agency/repository/AgencyRepository.java')
    const prov = { file: ctrl.filePath, line: 1, adapter: 'test', analyzerVersion: '0.1' }
    const e1 = createEdge({
      id: makeEdgeId('calls', ctrl.id, svc.id),
      from: ctrl.id, to: svc.id, kind: 'calls', provenance: prov, confidence: 'verified',
    })
    const e2 = createEdge({
      id: makeEdgeId('calls', svc.id, repo.id),
      from: svc.id, to: repo.id, kind: 'calls', provenance: prov, confidence: 'verified',
    })
    const graph = createIRGraph({
      analyzerVersion: '0.1',
      repoRoot: '/tmp/be',
      metadata: { framework: 'springboot', hasSupabase: false, hasPrisma: false, hasDexie: false, hasFirebase: false, adapterCategory: 'BE' },
      nodes: [ctrl, svc, repo],
      edges: [e1, e2],
    })
    await renderMermaid(graph, OUTPUT_DIR)
    const content = await fs.readFile(path.join(OUTPUT_DIR, 'screen-component.md'), 'utf8')
    expect(content).toContain('cross-pkg')
  })

  it('BE Controller 없으면 empty 표시', async () => {
    const graph = createIRGraph({
      analyzerVersion: '0.1',
      repoRoot: '/tmp/be',
      metadata: { framework: 'springboot', hasSupabase: false, hasPrisma: false, hasDexie: false, hasFirebase: false, adapterCategory: 'BE' },
      nodes: [],
      edges: [],
    })
    await renderMermaid(graph, OUTPUT_DIR)
    const content = await fs.readFile(path.join(OUTPUT_DIR, 'screen-component.md'), 'utf8')
    expect(content).toContain('empty')
  })
})

describe('BE 렌더러 — Tab1 (BE-C, v1.2.40 표준)', () => {
  it('adapterCategory=BE 시 트리 + 헤더 + leaf Controller + endpoints subgraph', async () => {
    // LCP=com.example.svc.user, top-level 2개(profile, account), profile 아래 photo 패키지 depth → :::pkg 출현 보장
    const r1 = makeBeRoute('src/main/java/com/example/svc/user/profile/photo/controller/PhotoController.java', '/api/photo', 'GET')
    const r2 = makeBeRoute('src/main/java/com/example/svc/user/profile/photo/controller/AvatarController.java', '/api/avatar', 'GET')
    const r3 = makeBeRoute('src/main/java/com/example/svc/user/account/main/controller/AccountController.java', '/api/account', 'GET')

    const graph = createIRGraph({
      analyzerVersion: '0.1',
      repoRoot: '/tmp/be',
      metadata: { framework: 'springboot', hasSupabase: false, hasPrisma: false, hasDexie: false, hasFirebase: false, adapterCategory: 'BE' },
      nodes: [r1, r2, r3],
      edges: [],
    })

    await renderMermaid(graph, OUTPUT_DIR)
    const content = await fs.readFile(path.join(OUTPUT_DIR, 'rendering.md'), 'utf8')

    expect(content).toContain('graph TD')
    expect(content).toContain('📁 src/main/java/com.example.svc.user.profile') // 헤더 = LCP+topSeg (R-T1.2 + R-T1.8)
    expect(content).toContain('📄 **PhotoController**')
    expect(content).toContain('📄 **AccountController**')
    expect(content).not.toMatch(/subgraph endpoints_/) // v1.2.57: endpoint subgraph 폐기(collapse)
    expect(content).toContain('**GET** /') // endpoint = leaf 노드 안 markdown bold 라인 (R-T1.6 amendment)
    expect(content).toContain(':::pkg') // 패키지 트리 노드 (R-T1.4)
    expect(content).not.toContain('BE_ROOT') // 구 outer subgraph 폐기 확인 (D7)
  })

  it('intrinsic prefix 자동 추출 — suffix만 라벨 표시 (R-T1.5)', async () => {
    const r1 = makeBeRoute('src/main/java/com/example/user/controller/UserController.java', '/api/v1/users/list', 'GET')
    const r2 = makeBeRoute('src/main/java/com/example/user/controller/UserController.java', '/api/v1/users/detail', 'GET')

    const graph = createIRGraph({
      analyzerVersion: '0.1',
      repoRoot: '/tmp/be',
      metadata: { framework: 'springboot', hasSupabase: false, hasPrisma: false, hasDexie: false, hasFirebase: false, adapterCategory: 'BE' },
      nodes: [r1, r2],
      edges: [],
    })

    await renderMermaid(graph, OUTPUT_DIR)
    const content = await fs.readFile(path.join(OUTPUT_DIR, 'rendering.md'), 'utf8')
    expect(content).toContain('/api/v1/users') // leaf 라벨에 prefix
    expect(content).toContain('/list')
    expect(content).toContain('/detail')
  })

  it('top-level 패키지 단위 chunking (R-T1.8) — wide-pkg 시 chunk 분할', async () => {
    // 같은 top-level(domain) 아래 다수 Controller는 1 chunk, 다른 top-level은 별도 chunk
    const partner1 = makeBeRoute('src/main/java/com/example/partner/order/controller/OrderController.java', '/api/order', 'GET')
    const partner2 = makeBeRoute('src/main/java/com/example/partner/inv/controller/InvController.java', '/api/inv', 'GET')
    const agency = makeBeRoute('src/main/java/com/example/agency/main/controller/AgencyController.java', '/api/agency', 'GET')
    const graph = createIRGraph({
      analyzerVersion: '0.1',
      repoRoot: '/tmp/be',
      metadata: { framework: 'springboot', hasSupabase: false, hasPrisma: false, hasDexie: false, hasFirebase: false, adapterCategory: 'BE' },
      nodes: [partner1, partner2, agency],
      edges: [],
    })
    await renderMermaid(graph, OUTPUT_DIR)
    const content = await fs.readFile(path.join(OUTPUT_DIR, 'rendering.md'), 'utf8')
    expect(content).toContain('%%--CHUNK--%%') // chunk separator 검출
    expect(content).toContain('com.example.partner')
    expect(content).toContain('com.example.agency')
  })

  it('FE 프로젝트는 기존 URL-grouping 렌더러 유지', async () => {
    const prov = { file: 'app/blog/page.tsx', line: 1, adapter: 'test', analyzerVersion: '0.1' }
    const feRoute = createRouteNode({
      id: makeNodeId('route', 'app/blog/page.tsx', 'page'),
      path: '/blog',
      filePath: 'app/blog/page.tsx',
      routeFileKind: 'page',
      dynamicSegmentType: 'static',
      isGroupRoute: false,
      renderingMode: 'SSR',
      provenance: prov,
      confidence: 'verified',
    })
    const graph = createIRGraph({
      analyzerVersion: '0.1',
      repoRoot: '/tmp/fe',
      metadata: { framework: 'nextjs-app-router', hasSupabase: false, hasPrisma: false, hasDexie: false, hasFirebase: false, adapterCategory: 'FE' },
      nodes: [feRoute],
      edges: [],
    })
    await renderMermaid(graph, OUTPUT_DIR)
    const content = await fs.readFile(path.join(OUTPUT_DIR, 'rendering.md'), 'utf8')
    // FE 표준 v1.2 (R-T1.2): Tab1 도메인 요약. FE 렌더러가 BE 분기로 빠지지 않았음을 도메인 박스로 확인.
    expect(content).toContain('blog · 1 route')
    expect(content).not.toContain('_BE')
  })
})

describe('Tab1 v1.2.54 Fix1 — deployTarget=mobile 뒷문 차단 (렌더러 경계)', () => {
  const prov = { file: 'src/router.tsx', line: 1, adapter: 'reactrouter', analyzerVersion: '0.1' }

  it('react-router + metadata.deployTarget=mobile이어도 React Router(web) 래퍼 사용, Mobile/RN 미발동', () => {
    const route = createRouteNode({
      id: makeNodeId('route', 'src/router.tsx', '/dashboard'),
      path: '/dashboard',
      filePath: 'src/router.tsx',
      routeFileKind: 'page',
      dynamicSegmentType: 'static',
      isGroupRoute: false,
      renderingMode: 'CSR',
      provenance: prov,
      confidence: 'verified',
    })
    const graph = createIRGraph({
      analyzerVersion: '0.1',
      repoRoot: '/tmp/rr',
      metadata: {
        framework: 'react-router',
        deployTarget: 'mobile',
        hasSupabase: false,
        hasPrisma: false,
        hasDexie: false,
        hasFirebase: false,
        adapterCategory: 'FE',
      },
      nodes: [route],
      edges: [],
    })
    const { rendering } = buildDiagrams(graph)
    expect(rendering).toContain('React Router · SPA')
    expect(rendering).not.toContain('React Native · Expo')
    expect(rendering).not.toContain('Mobile · iOS')
    // WINA 실제 수정 출력 봉인: 정적 api-call edge 없음(메모리 line 10 실측) + backends 드롭됨 →
    // 상세 백엔드 블록도, generic gateway도 없는 깨끗한 SPA. (partner-mock e2e는 api-call edge가 있어
    // gateway로 fallback하므로 이 무-edge 케이스는 별도 봉인이 필요.)
    expect(rendering).not.toContain('BACKEND_0')
    expect(rendering).not.toContain('External REST API')
  })
})

describe('buildDiagrams — nodeMap (Wave A T1/T2 사이드채널, v1.2.61)', () => {
  it('emit된 라우트/컴포넌트 노드가 nodeMap에 f/l/c/n으로 포함된다', () => {
    const routeProv = { file: 'app/blog/page.tsx', line: 3, adapter: 'nextjs@0.1', analyzerVersion: 'test' }
    const route = createRouteNode({
      id: makeNodeId('route', 'app/blog/page.tsx', 'page'),
      path: '/blog',
      filePath: 'app/blog/page.tsx',
      routeFileKind: 'page',
      dynamicSegmentType: 'static',
      isGroupRoute: false,
      renderingMode: 'SSR',
      provenance: routeProv,
      confidence: 'verified',
    })
    const graph = createIRGraph({
      analyzerVersion: '0.1',
      repoRoot: '/tmp/next',
      nodes: [route],
      edges: [],
    })
    const { rendering, nodeMap } = buildDiagrams(graph)
    expect(rendering).toContain('/blog')
    expect(nodeMap).toBeDefined()
    const entries = Object.values(nodeMap ?? {})
    const hit = entries.find(e => e.f === 'app/blog/page.tsx' && e.l === 3)
    expect(hit).toBeDefined()
    expect(hit?.c).toBe('verified')
    expect(hit?.n).toBe('/blog')
    expect(hit?.r).toBeUndefined()
  })
})
