import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { parseNextPagesRoutes } from './route-parser.js'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-nextpages-test-'))
  await fs.mkdir(path.join(tmpDir, 'pages', 'users'), { recursive: true })
  await fs.writeFile(path.join(tmpDir, 'pages', 'index.tsx'), 'export default function Home() {}')
  await fs.writeFile(path.join(tmpDir, 'pages', 'about.tsx'), 'export default function About() {}')
  await fs.writeFile(path.join(tmpDir, 'pages', 'users', '[id].tsx'), 'export default function User() {}')
})

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('parseNextPagesRoutes', () => {
  it('pages/ 파일을 RouteNode로 추출한다', async () => {
    const routes = await parseNextPagesRoutes(tmpDir, 'test@0.1')
    expect(routes.length).toBeGreaterThanOrEqual(3)
    const paths = routes.map(r => r.path)
    expect(paths).toContain('/')
    expect(paths).toContain('/about')
  })

  it('[id] → :id 동적 라우트 변환', async () => {
    const routes = await parseNextPagesRoutes(tmpDir, 'test@0.1')
    const dynamic = routes.find(r => r.path === '/users/:id')
    expect(dynamic).toBeDefined()
    expect(dynamic?.dynamicSegmentType).toBe('dynamic')
  })

  it('routeFileKind는 page', async () => {
    const routes = await parseNextPagesRoutes(tmpDir, 'test@0.1')
    for (const r of routes) expect(r.routeFileKind).toBe('page')
  })
})
