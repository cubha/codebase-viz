import { describe, it, expect, afterEach } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { renderMermaid } from './mermaid-renderer.js'
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
    expect(content).toContain('subgraph BLOG_G')
    expect(content).toContain('subgraph ADMIN_G')
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
    const content = await fs.readFile(path.join(OUTPUT_DIR, 'rendering.md'), 'utf8')
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
    const compLine = content.split('\n').find(l => l.includes('BlogCard'))
    expect(compLine?.startsWith('  ')).toBe(true)
    expect(compLine?.startsWith('    ')).toBe(false)
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
