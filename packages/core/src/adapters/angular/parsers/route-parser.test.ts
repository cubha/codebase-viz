import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { parseAngularRoutes } from './route-parser.js'
import { AngularAdapter } from '../adapter.js'

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

describe('parseAngularRoutes — RouterModule.forChild (B-6)', () => {
  it('RouterModule.forChild routes 추출', async () => {
    const tmpDir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-ng-b6-'))
    await fs.mkdir(path.join(tmpDir2, 'src', 'app', 'users'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir2, 'src', 'app', 'users', 'users.module.ts'),
      `import { NgModule } from '@angular/core'
import { RouterModule } from '@angular/router'
import { UsersComponent } from './users.component'
import { UserDetailComponent } from './user-detail.component'

@NgModule({
  imports: [
    RouterModule.forChild([
      { path: '', component: UsersComponent },
      { path: ':id', component: UserDetailComponent },
    ]),
  ],
})
export class UsersModule {}`,
    )
    const { routes } = await parseAngularRoutes(tmpDir2, 'test@0.1')
    const paths = routes.map(r => r.path)
    expect(paths).toContain('/')
    expect(paths).toContain('/:id')
    await fs.rm(tmpDir2, { recursive: true, force: true })
  })
})

describe('parseAngularRoutes — mini-angular-app fixture', () => {
  it('mini-angular-app: forRoot + forChild 라우트 모두 추출', async () => {
    const FIXTURE = path.resolve(process.cwd(), 'fixtures/mini-angular-app')
    const { routes } = await parseAngularRoutes(FIXTURE, 'test@0.1')
    const paths = routes.map(r => r.path)
    // forRoot routes
    expect(paths).toContain('/')
    expect(paths).toContain('/about')
    expect(paths).toContain('/users')
    expect(paths).toContain('/users/:id')
    // user-detail.module.ts의 forChild { path: '' }는 lazy 부모(users/:id)의 페이지다 — 추가 '/'가 아니다.
    expect(routes).toHaveLength(4)
  })

  // v1.2.44 A1-2: filePath 컴포넌트 파일 치환
  it('A1-2: 각 라우트 filePath는 component Identifier가 가리키는 .ts 파일로 치환됨', async () => {
    const FIXTURE = path.resolve(process.cwd(), 'fixtures/mini-angular-app')
    const { routes } = await parseAngularRoutes(FIXTURE, 'test@0.1')
    const home = routes.find(r => r.path === '/' && r.filePath.endsWith('home.component.ts'))
    const about = routes.find(r => r.path === '/about')
    const users = routes.find(r => r.path === '/users')
    expect(home).toBeDefined()
    expect(about?.filePath).toMatch(/about\.component\.ts$/)
    expect(users?.filePath).toMatch(/users\.component\.ts$/)
    // 라우터 정의 파일과 달라야 함
    expect(about?.filePath).not.toMatch(/app\.routes\.ts$/)
  })

  // v1.2.69 명세 변경: 예전엔 loadChildren 컨테이너를 라우터 정의 파일로 남기고 모듈의 `path:''` 자식을
  // 무접두 `/`로 따로 냈다(상세 페이지가 `/`에 붙어 Tab2에서 소실). 이제 그 자식이 `/users/:id` 페이지다.
  it('A1-2: loadChildren 라우트는 lazy 모듈의 path:\'\' 자식 컴포넌트 파일로 매핑된다', async () => {
    const FIXTURE = path.resolve(process.cwd(), 'fixtures/mini-angular-app')
    const { routes } = await parseAngularRoutes(FIXTURE, 'test@0.1')
    const detail = routes.find(r => r.path === '/users/:id')
    expect(detail?.filePath).toMatch(/user-detail\.component\.ts$/)
  })
})

describe('parseAngularRoutes — nested children path prefix (III-A-2)', () => {
  let nestedDir: string

  beforeAll(async () => {
    nestedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-ng-nested-'))
    await fs.mkdir(path.join(nestedDir, 'src', 'app'), { recursive: true })
    await fs.writeFile(
      path.join(nestedDir, 'src', 'app', 'app.routes.ts'),
      `import { Routes } from '@angular/router'
export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'admin', children: [
    { path: '', component: AdminDashboardComponent },
    { path: 'users', component: UsersListComponent },
    { path: 'settings', component: SettingsComponent },
  ]},
]`,
    )
    await fs.writeFile(
      path.join(nestedDir, 'src', 'app', 'app.config.ts'),
      `import { provideRouter } from '@angular/router'
import { routes } from './app.routes'
export const appConfig = { providers: [provideRouter(routes)] }`,
    )
  })

  afterAll(async () => {
    await fs.rm(nestedDir, { recursive: true, force: true })
  })

  it('children 경로에 부모 prefix 누적 (III-A-2)', async () => {
    const { routes } = await parseAngularRoutes(nestedDir, 'test@0.1')
    const paths = routes.map(r => r.path)
    expect(paths).toContain('/')
    expect(paths).toContain('/admin')
    expect(paths).toContain('/admin/users')
    expect(paths).toContain('/admin/settings')
  })
})

describe('parseAngularRoutes — loadChildren lazy routes (III-A-2)', () => {
  let lazyDir: string

  beforeAll(async () => {
    lazyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-ng-lazy-'))
    await fs.mkdir(path.join(lazyDir, 'src', 'app', 'admin'), { recursive: true })
    await fs.writeFile(
      path.join(lazyDir, 'src', 'app', 'admin', 'admin.routes.ts'),
      `import { Routes } from '@angular/router'
export const adminRoutes: Routes = [
  { path: 'dashboard', component: AdminDashboardComponent },
  { path: 'users', component: UsersListComponent },
]`,
    )
    await fs.writeFile(
      path.join(lazyDir, 'src', 'app', 'app.routes.ts'),
      `import { Routes } from '@angular/router'
export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'admin', loadChildren: () => import('./admin/admin.routes').then(m => m.adminRoutes) },
]`,
    )
    await fs.writeFile(
      path.join(lazyDir, 'src', 'app', 'app.config.ts'),
      `import { provideRouter } from '@angular/router'
import { routes } from './app.routes'
export const appConfig = { providers: [provideRouter(routes)] }`,
    )
  })

  afterAll(async () => {
    await fs.rm(lazyDir, { recursive: true, force: true })
  })

  it('loadChildren 대상 routes 파일의 경로를 해소한다 (III-A-2)', async () => {
    const { routes } = await parseAngularRoutes(lazyDir, 'test@0.1')
    const paths = routes.map(r => r.path)
    expect(paths).toContain('/')
    expect(paths).toContain('/admin')
    expect(paths).toContain('/admin/dashboard')
    expect(paths).toContain('/admin/users')
  })
})

describe('parseAngularRoutes', () => {
  it('provideRouter(routes) 배열에서 path를 추출한다', async () => {
    const { routes } = await parseAngularRoutes(tmpDir, 'test@0.1')
    expect(routes.length).toBeGreaterThanOrEqual(3)
    const paths = routes.map(r => r.path)
    expect(paths).toContain('/')
    expect(paths).toContain('/about')
    expect(paths).toContain('/users')
  })

  it(':id 라우트를 dynamic으로 감지', async () => {
    const { routes } = await parseAngularRoutes(tmpDir, 'test@0.1')
    const dynamic = routes.find(r => r.path === '/users/:id')
    expect(dynamic).toBeDefined()
    expect(dynamic?.dynamicSegmentType).toBe('dynamic')
  })

  it('routeFileKind는 page', async () => {
    const { routes } = await parseAngularRoutes(tmpDir, 'test@0.1')
    for (const r of routes) expect(r.routeFileKind).toBe('page')
  })
})

describe('parseAngularRoutes — loadComponent standalone 라우팅 (N-20)', () => {
  it('loadComponent lazy 라우트를 RouteNode로 파싱한다 (N-20)', async () => {
    const tmpDirN20 = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-ng-n20-'))
    await fs.mkdir(path.join(tmpDirN20, 'src', 'app'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDirN20, 'src', 'app', 'app.routes.ts'),
      `import { Routes } from '@angular/router'
export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'profile', loadComponent: () => import('./profile.component').then(m => m.ProfileComponent) },
  { path: 'settings', loadComponent: () => import('./settings.component').then(m => m.SettingsComponent) },
]`,
    )
    await fs.writeFile(
      path.join(tmpDirN20, 'src', 'app', 'app.config.ts'),
      `import { provideRouter } from '@angular/router'
import { routes } from './app.routes'
export const appConfig = { providers: [provideRouter(routes)] }`,
    )
    const { routes } = await parseAngularRoutes(tmpDirN20, 'test@0.1')
    const paths = routes.map(r => r.path)
    expect(paths).toContain('/')
    expect(paths).toContain('/profile')
    expect(paths).toContain('/settings')
    await fs.rm(tmpDirN20, { recursive: true, force: true })
  })
})

describe('AngularAdapter — loadComponent renders 엣지 (N-20b)', () => {
  it('loadComponent 라우트와 컴포넌트 간 renders 엣지 생성', async () => {
    const tmpDirN20b = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-ng-n20b-'))
    await fs.mkdir(path.join(tmpDirN20b, 'src', 'app'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDirN20b, 'src', 'app', 'profile.component.ts'),
      `import { Component } from '@angular/core'
@Component({ selector: 'app-profile', template: '' })
export class ProfileComponent {}`,
    )
    await fs.writeFile(
      path.join(tmpDirN20b, 'src', 'app', 'app.routes.ts'),
      `import { Routes } from '@angular/router'
export const routes: Routes = [
  { path: 'profile', loadComponent: () => import('./profile.component').then(m => m.ProfileComponent) },
]`,
    )
    await fs.writeFile(
      path.join(tmpDirN20b, 'src', 'app', 'app.config.ts'),
      `import { provideRouter } from '@angular/router'
import { routes } from './app.routes'
export const appConfig = { providers: [provideRouter(routes)] }`,
    )
    const adapter = new AngularAdapter()
    const result = await adapter.analyze({
      repoRoot: tmpDirN20b,
      analyzerVersion: '0.0.0-test',
      stack: {
        framework: 'angular', adapterId: 'angular', parsingLevel: 'L2',
        hasSupabase: false, hasPrisma: false, hasDexie: false, hasDrizzle: false,
        hasTypeOrm: false, hasSQLAlchemy: false, hasDjangoORM: false,
        hasSpringDataJpa: false, isMonorepo: false, appDirs: [], llmRecommended: false,
      },
    })
    const profileRoute = result.routeNodes.find(r => r.path === '/profile')
    expect(profileRoute).toBeDefined()
    const rendersEdges = result.componentEdges.filter(e => e.kind === 'renders')
    expect(rendersEdges.length).toBeGreaterThan(0)
    const profileRendersEdge = rendersEdges.find(e => e.from === profileRoute?.id)
    expect(profileRendersEdge).toBeDefined()
    await fs.rm(tmpDirN20b, { recursive: true, force: true })
  })
})

describe('AngularAdapter — hasSupabase (Tab3)', () => {
  it('hasSupabase=true면 tableNodes 배열 반환', async () => {
    const adapter = new AngularAdapter()
    const result = await adapter.analyze({
      repoRoot: tmpDir,
      analyzerVersion: '0.0.0-test',
      stack: {
        framework: 'angular',
        adapterId: 'angular',
        parsingLevel: 'L2',
        hasSupabase: true,
        hasPrisma: false,
        hasDexie: false,
        hasDrizzle: false,
        hasTypeOrm: false,
        hasSQLAlchemy: false,
        hasDjangoORM: false,
        hasSpringDataJpa: false,
        isMonorepo: false,
        appDirs: [],
        llmRecommended: false,
      },
    })
    expect(Array.isArray(result.tableNodes)).toBe(true)
  })
})

// v1.2.69: NgModule 기반 lazy 라우팅 결함 일괄 — 부모 prefix 소실·무접두 이중 등록·후행 슬래시·
// lazy 경로 컴포넌트 소실·같은 path 덮어쓰기(동일 NodeId 2개). 재실측(2026-10-06)에서 원본
// mini-angular-app도 `/users/:id` 상세가 `/`로 붙어 Tab2에서 사라지고 있었다.
describe('parseAngularRoutes — NgModule lazy forChild (v1.2.69)', () => {
  let ngDir: string
  const write = async (rel: string, body: string): Promise<void> => {
    await fs.mkdir(path.dirname(path.join(ngDir, rel)), { recursive: true })
    await fs.writeFile(path.join(ngDir, rel), body)
  }
  const comp = (name: string): string => `import { Component } from '@angular/core'
@Component({ selector: 'x', template: '' })
export class ${name} {}`

  beforeAll(async () => {
    ngDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-ng-v1269-'))
    await write('src/app/home.component.ts', comp('HomeComponent'))
    await write('src/app/admin/dashboard.component.ts', comp('DashboardComponent'))
    await write('src/app/admin/side.component.ts', comp('SideComponent'))
    await write('src/app/admin/settings.component.ts', comp('SettingsComponent'))
    await write('src/app/reports/report-list.component.ts', comp('ReportListComponent'))
    await write('src/app/reports/report-detail.component.ts', comp('ReportDetailComponent'))
    await write('src/app/app-routing.module.ts', `import { NgModule } from '@angular/core'
import { RouterModule, Routes } from '@angular/router'
import { HomeComponent } from './home.component'
const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'old-home', redirectTo: '', pathMatch: 'full' },
  { path: 'admin', loadChildren: () => import('./admin/admin.module').then(m => m.AdminModule) },
  { path: 'reports', loadChildren: () => import('./reports/reports.routes').then(m => m.REPORT_ROUTES) },
]
@NgModule({ imports: [RouterModule.forRoot(routes)], exports: [RouterModule] })
export class AppRoutingModule {}`)
    await write('src/app/admin/admin.module.ts', `import { NgModule } from '@angular/core'
import { RouterModule } from '@angular/router'
import { DashboardComponent } from './dashboard.component'
import { SideComponent } from './side.component'
import { SettingsComponent } from './settings.component'
@NgModule({
  imports: [
    RouterModule.forChild([
      { path: '', component: DashboardComponent },
      { path: '', component: SideComponent, outlet: 'side' },
      { path: 'settings', component: SettingsComponent },
    ]),
  ],
})
export class AdminModule {}`)
    await write('src/app/reports/reports.routes.ts', `import { Routes } from '@angular/router'
import { ReportListComponent } from './report-list.component'
import { ReportDetailComponent } from './report-detail.component'
export const REPORT_ROUTES: Routes = [
  { path: '', component: ReportListComponent },
  { path: ':id', component: ReportDetailComponent },
]`)
    await write('src/app/reports/reports.module.ts', `import { NgModule } from '@angular/core'
import { RouterModule } from '@angular/router'
import { REPORT_ROUTES } from './reports.routes'
@NgModule({ imports: [RouterModule.forChild(REPORT_ROUTES)] })
export class ReportsModule {}`)
  })

  afterAll(async () => {
    await fs.rm(ngDir, { recursive: true, force: true })
  })

  it('NgModule 클래스 loadChildren의 forChild 라우트에 부모 prefix가 붙는다', async () => {
    const { routes } = await parseAngularRoutes(ngDir, 'test@0.1')
    const paths = routes.map(r => r.path)
    expect(paths).toContain('/admin/settings')
    expect(paths).not.toContain('/settings')
  })

  it("부모의 path:'' 자식이 부모 URL의 페이지가 된다 — 컴포넌트 파일로 매핑되고 부모 컨테이너는 따로 남지 않는다", async () => {
    const { routes } = await parseAngularRoutes(ngDir, 'test@0.1')
    const admin = routes.filter(r => r.path === '/admin' && !r.id.includes('side'))
    expect(admin).toHaveLength(1)
    expect(admin[0]!.filePath).toBe('src/app/admin/dashboard.component.ts')
    const reports = routes.filter(r => r.path === '/reports')
    expect(reports).toHaveLength(1)
    expect(reports[0]!.filePath).toBe('src/app/reports/report-list.component.ts')
  })

  it('lazy로 마운트된 forChild는 무접두로 한 번 더 등록되지 않는다', async () => {
    const { routes } = await parseAngularRoutes(ngDir, 'test@0.1')
    const paths = routes.map(r => r.path)
    expect(paths).toContain('/reports/:id')
    expect(paths).not.toContain('/:id')
    expect(paths.filter(p => p === '/')).toHaveLength(1)
  })

  it('후행 슬래시가 남지 않는다', async () => {
    const { routes } = await parseAngularRoutes(ngDir, 'test@0.1')
    for (const r of routes) if (r.path !== '/') expect(r.path.endsWith('/')).toBe(false)
  })

  it('lazy 하위 라우트도 컴포넌트 파일로 매핑된다', async () => {
    const { routes } = await parseAngularRoutes(ngDir, 'test@0.1')
    expect(routes.find(r => r.path === '/reports/:id')?.filePath).toBe('src/app/reports/report-detail.component.ts')
    expect(routes.find(r => r.path === '/admin/settings')?.filePath).toBe('src/app/admin/settings.component.ts')
  })

  it("같은 path(''+named outlet)도 덮어쓰지 않고 각자 노드가 되며 NodeId가 전부 고유하다", async () => {
    const { routes } = await parseAngularRoutes(ngDir, 'test@0.1')
    const ids = routes.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    const files = routes.filter(r => r.path === '/admin').map(r => r.filePath).sort()
    expect(files).toEqual(['src/app/admin/dashboard.component.ts', 'src/app/admin/side.component.ts'])
  })

  it('redirectTo 항목은 페이지가 아니므로 라우트로 만들지 않는다', async () => {
    const { routes } = await parseAngularRoutes(ngDir, 'test@0.1')
    expect(routes.map(r => r.path)).not.toContain('/old-home')
  })

  it('mini-angular-app: /users/:id는 상세 컴포넌트로 매핑되고 / 는 하나뿐이다', async () => {
    const FIXTURE = path.resolve(process.cwd(), 'fixtures/mini-angular-app')
    const { routes } = await parseAngularRoutes(FIXTURE, 'test@0.1')
    expect(routes.map(r => r.path).sort()).toEqual(['/', '/about', '/users', '/users/:id'])
    expect(routes.find(r => r.path === '/users/:id')?.filePath).toBe('src/app/user-detail/user-detail.component.ts')
  })

  // scope-critic(v1.2.69): 같은 "라우트 소실" 결함 계열 — 기존부터 미지원이던 두 형태.
  it('provideRouter 배열의 spread(...routes)도 펼친다', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-ng-spread-'))
    await fs.mkdir(path.join(dir, 'src/app'), { recursive: true })
    await fs.writeFile(path.join(dir, 'src/app/auth.routes.ts'), `import { Routes } from '@angular/router'
export const AUTH_ROUTES: Routes = [{ path: 'login', component: LoginComponent }]`)
    await fs.writeFile(path.join(dir, 'src/app/app.config.ts'), `import { provideRouter } from '@angular/router'
import { AUTH_ROUTES } from './auth.routes'
export const appConfig = { providers: [provideRouter([...AUTH_ROUTES, { path: 'home', component: HomeComponent }])] }`)
    const { routes } = await parseAngularRoutes(dir, 't')
    expect(routes.map(r => r.path).sort()).toEqual(['/home', '/login'])
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("loadChildren: () => import('./x')(default export routes)도 부모 prefix로 해석한다", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-ng-default-'))
    await fs.mkdir(path.join(dir, 'src/app/admin'), { recursive: true })
    await fs.writeFile(path.join(dir, 'src/app/admin/admin.routes.ts'), `import { Routes } from '@angular/router'
const routes: Routes = [{ path: 'users', component: UsersComponent }]
export default routes`)
    await fs.writeFile(path.join(dir, 'src/app/app.routes.ts'), `import { Routes } from '@angular/router'
export const routes: Routes = [
  { path: 'admin', loadChildren: () => import('./admin/admin.routes') },
  { path: 'shop', loadChildren: () => import('./admin/admin.routes').then(m => m.default) },
]`)
    await fs.writeFile(path.join(dir, 'src/app/app.config.ts'), `import { provideRouter } from '@angular/router'
import { routes } from './app.routes'
export const appConfig = { providers: [provideRouter(routes)] }`)
    const { routes } = await parseAngularRoutes(dir, 't')
    const paths = routes.map(r => r.path)
    expect(paths).toContain('/admin/users')
    expect(paths).toContain('/shop/users')
    expect(paths).not.toContain('/users')
    await fs.rm(dir, { recursive: true, force: true })
  })
})
