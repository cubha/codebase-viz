import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parseRoutes } from './route-parser.js'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-viz-s3-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeFile(relPath: string, content = 'export default function Page() {}'): Promise<void> {
  const absPath = path.join(tmpDir, relPath)
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  await fs.writeFile(absPath, content, 'utf-8')
}

describe('parseRoutes', () => {
  it('정적 라우트: app/page.tsx → path="/", dynamicSegmentType="static"', async () => {
    await writeFile('app/page.tsx')
    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toHaveLength(1)
    const node = nodes[0]
    expect(node).toBeDefined()
    expect(node!.path).toBe('/')
    expect(node!.dynamicSegmentType).toBe('static')
    expect(node!.routeFileKind).toBe('page')
    expect(node!.isGroupRoute).toBe(false)
    expect(node!.renderingMode).toBe('SSR')
    expect(node!.confidence).toBe('verified')
  })

  it('동적 라우트: app/blog/[slug]/page.tsx → dynamicSegmentType="dynamic"', async () => {
    await writeFile('app/blog/[slug]/page.tsx')
    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toHaveLength(1)
    const node = nodes[0]
    expect(node).toBeDefined()
    expect(node!.path).toBe('/blog/[slug]')
    expect(node!.dynamicSegmentType).toBe('dynamic')
    expect(node!.isGroupRoute).toBe(false)
  })

  it('그룹 라우트: app/(marketing)/about/page.tsx → isGroupRoute=true', async () => {
    await writeFile('app/(marketing)/about/page.tsx')
    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toHaveLength(1)
    const node = nodes[0]
    expect(node).toBeDefined()
    expect(node!.isGroupRoute).toBe(true)
    expect(node!.path).toBe('/about')
    expect(node!.dynamicSegmentType).toBe('static')
  })

  it('route-handler: app/api/posts/route.ts → routeFileKind="route-handler"', async () => {
    await writeFile('app/api/posts/route.ts', 'export function GET() {}')
    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toHaveLength(1)
    const node = nodes[0]
    expect(node).toBeDefined()
    expect(node!.routeFileKind).toBe('route-handler')
    expect(node!.path).toBe('/api/posts')
  })

  it('layout: app/layout.tsx → routeFileKind="layout"', async () => {
    await writeFile('app/layout.tsx')
    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toHaveLength(1)
    const node = nodes[0]
    expect(node).toBeDefined()
    expect(node!.routeFileKind).toBe('layout')
    expect(node!.path).toBe('/')
  })

  it('NodeId 결정론적: 같은 디렉토리의 page/layout이 다른 ID', async () => {
    await writeFile('app/page.tsx')
    await writeFile('app/layout.tsx')
    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toHaveLength(2)
    const ids = nodes.map(n => n.id)
    expect(new Set(ids).size).toBe(2)
    const pageNode = nodes.find(n => n.routeFileKind === 'page')
    const layoutNode = nodes.find(n => n.routeFileKind === 'layout')
    expect(pageNode).toBeDefined()
    expect(layoutNode).toBeDefined()
    expect(pageNode!.id).toBe('route:app:page')
    expect(layoutNode!.id).toBe('route:app:layout')
  })

  it('중첩 동적: app/[lang]/[...slug]/page.tsx → dynamicSegmentType="catch-all"', async () => {
    await writeFile('app/[lang]/[...slug]/page.tsx')
    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toHaveLength(1)
    const node = nodes[0]
    expect(node).toBeDefined()
    expect(node!.dynamicSegmentType).toBe('catch-all')
    expect(node!.path).toBe('/[lang]/[...slug]')
  })

  it('renderingMode: SSG 감지', async () => {
    await writeFile('app/page.tsx', "export const dynamic = 'force-static'\nexport default function Page() {}")
    const nodes = await parseRoutes(tmpDir)
    expect(nodes[0]!.renderingMode).toBe('SSG')
  })

  it('renderingMode: ISR 감지', async () => {
    await writeFile('app/page.tsx', 'export const revalidate = 60\nexport default function Page() {}')
    const nodes = await parseRoutes(tmpDir)
    expect(nodes[0]!.renderingMode).toBe('ISR')
  })

  it('renderingMode: CSR 감지', async () => {
    await writeFile('app/page.tsx', "'use client'\nexport default function Page() {}")
    const nodes = await parseRoutes(tmpDir)
    expect(nodes[0]!.renderingMode).toBe('CSR')
  })

  it('app/ 디렉토리 없으면 빈 배열 반환', async () => {
    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toEqual([])
  })
})
