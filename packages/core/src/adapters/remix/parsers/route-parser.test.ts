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

  // 폴더형 nested route
  await fs.mkdir(path.join(tmpDir, 'app', 'routes', 'users'), { recursive: true })
  await fs.writeFile(path.join(tmpDir, 'app', 'routes', 'users', '_index.tsx'), 'export default function Users() {}')
  await fs.writeFile(path.join(tmpDir, 'app', 'routes', 'users', '$id.tsx'), 'export default function UserId() {}')
  await fs.mkdir(path.join(tmpDir, 'app', 'routes', 'admin', 'settings'), { recursive: true })
  await fs.writeFile(path.join(tmpDir, 'app', 'routes', 'admin', 'settings.tsx'), 'export default function AdminSettings() {}')
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

  it('폴더형 nested route: users/_index.tsx → /users', async () => {
    const routes = await parseRemixRoutes(tmpDir, 'test@0.1')
    const paths = routes.map(r => r.path)
    expect(paths).toContain('/users')
  })

  it('폴더형 nested route: users/$id.tsx → /users/:id', async () => {
    const routes = await parseRemixRoutes(tmpDir, 'test@0.1')
    const route = routes.find(r => r.path === '/users/:id' && r.filePath.includes('users/$id'))
    expect(route).toBeDefined()
    expect(route?.dynamicSegmentType).toBe('dynamic')
  })

  it('폴더형 nested route: admin/settings.tsx → /admin/settings', async () => {
    const routes = await parseRemixRoutes(tmpDir, 'test@0.1')
    const paths = routes.map(r => r.path)
    expect(paths).toContain('/admin/settings')
  })

  it('app/routes 없으면 라우트 0건 (app/ fallback 없음)', async () => {
    const tmpNoRoutes = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-remix-nofallback-'))
    await fs.mkdir(path.join(tmpNoRoutes, 'app'), { recursive: true })
    await fs.writeFile(path.join(tmpNoRoutes, 'app', 'root.tsx'), 'export default function Root() {}')
    await fs.writeFile(path.join(tmpNoRoutes, 'app', 'entry.client.tsx'), 'export {}')
    const routes = await parseRemixRoutes(tmpNoRoutes, 'test@0.1')
    expect(routes).toHaveLength(0)
    await fs.rm(tmpNoRoutes, { recursive: true, force: true })
  })

  it('pathless layout _auth.login.tsx → /login (B-5)', async () => {
    const tmpPathless = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-remix-pathless-'))
    await fs.mkdir(path.join(tmpPathless, 'app', 'routes'), { recursive: true })
    await fs.writeFile(
      path.join(tmpPathless, 'app', 'routes', '_auth.login.tsx'),
      'export default function Login() {}',
    )
    await fs.writeFile(
      path.join(tmpPathless, 'app', 'routes', '_auth.signup.tsx'),
      'export default function Signup() {}',
    )
    const routes = await parseRemixRoutes(tmpPathless, 'test@0.1')
    const paths = routes.map(r => r.path)
    expect(paths).toContain('/login')
    expect(paths).toContain('/signup')
    expect(paths).not.toContain('/auth/login')
    expect(paths).not.toContain('/auth/signup')
    await fs.rm(tmpPathless, { recursive: true, force: true })
  })
})
