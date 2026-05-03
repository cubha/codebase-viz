import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parseRoutes } from './route-parser.js'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-viz-sveltekit-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeFile(relPath: string, content = '<script></script>'): Promise<void> {
  const absPath = path.join(tmpDir, relPath)
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  await fs.writeFile(absPath, content, 'utf-8')
}

describe('parseRoutes (SvelteKit)', () => {
  it('루트 페이지: src/routes/+page.svelte → path="/", routeFileKind="page"', async () => {
    await writeFile('src/routes/+page.svelte')
    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toHaveLength(1)
    const node = nodes[0]
    expect(node).toBeDefined()
    expect(node!.path).toBe('/')
    expect(node!.routeFileKind).toBe('page')
    expect(node!.dynamicSegmentType).toBe('static')
    expect(node!.isGroupRoute).toBe(false)
    expect(node!.renderingMode).toBe('SSR')
    expect(node!.confidence).toBe('verified')
  })

  it('정적 라우트: src/routes/about/+page.svelte → path="/about"', async () => {
    await writeFile('src/routes/about/+page.svelte')
    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toHaveLength(1)
    const node = nodes[0]
    expect(node).toBeDefined()
    expect(node!.path).toBe('/about')
    expect(node!.routeFileKind).toBe('page')
    expect(node!.dynamicSegmentType).toBe('static')
  })

  it('동적 라우트: src/routes/blog/[slug]/+page.svelte → path="/blog/:slug", dynamicSegmentType="dynamic"', async () => {
    await writeFile('src/routes/blog/[slug]/+page.svelte')
    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toHaveLength(1)
    const node = nodes[0]
    expect(node).toBeDefined()
    expect(node!.path).toBe('/blog/:slug')
    expect(node!.routeFileKind).toBe('page')
    expect(node!.dynamicSegmentType).toBe('dynamic')
  })

  it('API endpoint: src/routes/api/users/+server.ts → path="/api/users", routeFileKind="route-handler"', async () => {
    await writeFile('src/routes/api/users/+server.ts', 'export function GET() {}')
    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toHaveLength(1)
    const node = nodes[0]
    expect(node).toBeDefined()
    expect(node!.path).toBe('/api/users')
    expect(node!.routeFileKind).toBe('route-handler')
  })

  it('그룹 라우트: src/routes/(marketing)/contact/+page.svelte → path="/contact", isGroupRoute=true', async () => {
    await writeFile('src/routes/(marketing)/contact/+page.svelte')
    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toHaveLength(1)
    const node = nodes[0]
    expect(node).toBeDefined()
    expect(node!.path).toBe('/contact')
    expect(node!.isGroupRoute).toBe(true)
    expect(node!.dynamicSegmentType).toBe('static')
  })

  it('레이아웃: src/routes/+layout.svelte → routeFileKind="layout"', async () => {
    await writeFile('src/routes/+layout.svelte')
    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toHaveLength(1)
    const node = nodes[0]
    expect(node).toBeDefined()
    expect(node!.routeFileKind).toBe('layout')
    expect(node!.path).toBe('/')
  })

  it('6개 노드 통합: path/routeFileKind/dynamicSegmentType 검증', async () => {
    await writeFile('src/routes/+page.svelte')
    await writeFile('src/routes/about/+page.svelte')
    await writeFile('src/routes/blog/[slug]/+page.svelte')
    await writeFile('src/routes/api/users/+server.ts')
    await writeFile('src/routes/(marketing)/contact/+page.svelte')
    await writeFile('src/routes/+layout.svelte')

    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toHaveLength(6)

    const rootPage = nodes.find(n => n.path === '/' && n.routeFileKind === 'page')
    expect(rootPage).toBeDefined()
    expect(rootPage!.dynamicSegmentType).toBe('static')

    const aboutPage = nodes.find(n => n.path === '/about')
    expect(aboutPage).toBeDefined()
    expect(aboutPage!.routeFileKind).toBe('page')

    const blogPage = nodes.find(n => n.path === '/blog/:slug')
    expect(blogPage).toBeDefined()
    expect(blogPage!.routeFileKind).toBe('page')
    expect(blogPage!.dynamicSegmentType).toBe('dynamic')

    const apiUsers = nodes.find(n => n.path === '/api/users')
    expect(apiUsers).toBeDefined()
    expect(apiUsers!.routeFileKind).toBe('route-handler')

    const contactPage = nodes.find(n => n.path === '/contact')
    expect(contactPage).toBeDefined()
    expect(contactPage!.isGroupRoute).toBe(true)

    const rootLayout = nodes.find(n => n.path === '/' && n.routeFileKind === 'layout')
    expect(rootLayout).toBeDefined()
    expect(rootLayout!.routeFileKind).toBe('layout')
  })

  it('renderingMode: CSR 감지 (ssr = false)', async () => {
    await writeFile('src/routes/+page.svelte', '<script>\nexport const ssr = false\n</script>')
    const nodes = await parseRoutes(tmpDir)
    expect(nodes[0]!.renderingMode).toBe('CSR')
  })

  it('renderingMode: SSG 감지 (prerender = true)', async () => {
    await writeFile('src/routes/+page.svelte', '<script>\nexport const prerender = true\n</script>')
    const nodes = await parseRoutes(tmpDir)
    expect(nodes[0]!.renderingMode).toBe('SSG')
  })

  it('src/routes 없으면 빈 배열 반환', async () => {
    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toEqual([])
  })

  it('provenance에 adapter="sveltekit@0.1" 포함', async () => {
    await writeFile('src/routes/+page.svelte')
    const nodes = await parseRoutes(tmpDir)
    expect(nodes[0]!.provenance.adapter).toBe('sveltekit@0.1')
    expect(nodes[0]!.provenance.line).toBe(1)
  })

  it('+server.js도 route-handler로 인식', async () => {
    await writeFile('src/routes/api/health/+server.js', 'export function GET() {}')
    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.routeFileKind).toBe('route-handler')
    expect(nodes[0]!.path).toBe('/api/health')
  })

  it('NodeId 결정론적: 같은 디렉토리의 page/layout이 다른 ID', async () => {
    await writeFile('src/routes/+page.svelte')
    await writeFile('src/routes/+layout.svelte')
    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toHaveLength(2)
    const ids = nodes.map(n => n.id)
    expect(new Set(ids).size).toBe(2)
  })

  it('catch-all: src/routes/[...rest]/+page.svelte → dynamicSegmentType="catch-all"', async () => {
    await writeFile('src/routes/[...rest]/+page.svelte')
    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.dynamicSegmentType).toBe('catch-all')
  })

  it('+error.svelte → routeFileKind="error"', async () => {
    await writeFile('src/routes/+error.svelte')
    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.routeFileKind).toBe('error')
  })
})
