import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { parseAngularRoutes } from './route-parser.js'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-angular-test-'))
  await fs.mkdir(path.join(tmpDir, 'src', 'app'), { recursive: true })
  await fs.writeFile(
    path.join(tmpDir, 'src', 'app', 'app.routes.ts'),
    `import { Routes } from '@angular/router'
export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'about', component: AboutComponent },
  { path: 'users', component: UsersComponent },
  { path: 'users/:id', loadChildren: () => import('./user-detail.module').then(m => m.Module) },
]`,
  )
  await fs.writeFile(
    path.join(tmpDir, 'src', 'app', 'app.config.ts'),
    `import { provideRouter } from '@angular/router'
import { routes } from './app.routes'
export const appConfig = { providers: [provideRouter(routes)] }`,
  )
})

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('parseAngularRoutes', () => {
  it('provideRouter(routes) 배열에서 path를 추출한다', async () => {
    const routes = await parseAngularRoutes(tmpDir, 'test@0.1')
    expect(routes.length).toBeGreaterThanOrEqual(3)
    const paths = routes.map(r => r.path)
    expect(paths).toContain('/')
    expect(paths).toContain('/about')
    expect(paths).toContain('/users')
  })

  it(':id 라우트를 dynamic으로 감지', async () => {
    const routes = await parseAngularRoutes(tmpDir, 'test@0.1')
    const dynamic = routes.find(r => r.path === '/users/:id')
    expect(dynamic).toBeDefined()
    expect(dynamic?.dynamicSegmentType).toBe('dynamic')
  })

  it('routeFileKind는 page', async () => {
    const routes = await parseAngularRoutes(tmpDir, 'test@0.1')
    for (const r of routes) expect(r.routeFileKind).toBe('page')
  })
})
