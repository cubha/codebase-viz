import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { parseRemixRoutes } from './route-parser.js'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-remix-test-'))
  await fs.mkdir(path.join(tmpDir, 'app', 'routes'), { recursive: true })
  await fs.writeFile(path.join(tmpDir, 'app', 'routes', '_index.tsx'), 'export default function Index() {}')
  await fs.writeFile(path.join(tmpDir, 'app', 'routes', 'about.tsx'), 'export default function About() {}')
  await fs.writeFile(path.join(tmpDir, 'app', 'routes', 'users.$id.tsx'), 'export default function User() {}')
})

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('parseRemixRoutes', () => {
  it('app/routes 파일을 RouteNode로 추출한다', async () => {
    const routes = await parseRemixRoutes(tmpDir, 'test@0.1')
    expect(routes.length).toBeGreaterThanOrEqual(3)
    const paths = routes.map(r => r.path)
    expect(paths).toContain('/')
    expect(paths).toContain('/about')
  })

  it('$id → :id 변환', async () => {
    const routes = await parseRemixRoutes(tmpDir, 'test@0.1')
    const dynamic = routes.find(r => r.path.includes(':id'))
    expect(dynamic).toBeDefined()
    expect(dynamic?.dynamicSegmentType).toBe('dynamic')
  })

  it('routeFileKind는 page', async () => {
    const routes = await parseRemixRoutes(tmpDir, 'test@0.1')
    for (const r of routes) expect(r.routeFileKind).toBe('page')
  })
})
