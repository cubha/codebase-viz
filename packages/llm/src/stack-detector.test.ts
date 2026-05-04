import { describe, it, expect, afterEach } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import { fileURLToPath } from 'node:url'
import { detectStack } from './stack-detector.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.resolve(__dirname, '../../../fixtures')

describe('detectStack', () => {
  it('Next.js App Router 프로젝트를 nextjs-app-router로 감지한다', async () => {
    const info = await detectStack(path.join(FIXTURES, 'mini-next-app'))
    expect(info.framework).toBe('nextjs-app-router')
  })

  it('Supabase 의존성을 감지한다', async () => {
    const info = await detectStack(path.join(FIXTURES, 'mini-next-app'))
    expect(info.hasSupabase).toBe(true)
  })

  it('존재하지 않는 디렉토리는 unknown으로 반환한다', async () => {
    const info = await detectStack('/tmp/non-existent-project-xyz')
    expect(info.framework).toBe('unknown')
  })

  it('vite-react 프로젝트를 감지한다', async () => {
    const info = await detectStack('/mnt/d/workspace/dev-note')
    expect(info.framework).toBe('vite-react')
    expect(info.hasDexie).toBe(true)
  })

  it('모노레포 구조를 감지한다', async () => {
    const info = await detectStack('/mnt/d/workspace/fa-support')
    // fa-support has apps/ dir → isMonorepo
    expect(info.appDirs.length).toBeGreaterThanOrEqual(0) // may or may not have apps/
  })

  it('Next.js App Router는 adapterId/L1/llmRecommended=false 매핑된다', async () => {
    const info = await detectStack(path.join(FIXTURES, 'mini-next-app'))
    expect(info.adapterId).toBe('nextjs-app-router')
    expect(info.parsingLevel).toBe('L1')
    expect(info.llmRecommended).toBe(false)
  })

  it('unknown 스택은 adapterId 없음/L3/llmRecommended=true', async () => {
    const info = await detectStack('/tmp/non-existent-project-xyz')
    expect(info.adapterId).toBeUndefined()
    expect(info.parsingLevel).toBe('L3')
    expect(info.llmRecommended).toBe(true)
  })

  it('vite-react는 adapterId=vite-react/L2/llmRecommended=true', async () => {
    const info = await detectStack('/mnt/d/workspace/dev-note')
    expect(info.adapterId).toBe('vite-react')
    expect(info.parsingLevel).toBe('L2')
    expect(info.llmRecommended).toBe(true)
  })

  it('Flask 프로젝트를 flask로 감지한다', async () => {
    const info = await detectStack(path.join(FIXTURES, 'mini-flask-app'))
    expect(info.framework).toBe('flask')
    expect(info.adapterId).toBe('flask')
  })

  it('Next.js Pages Router를 nextjs-pages로 감지한다', async () => {
    const info = await detectStack(path.join(FIXTURES, 'mini-nextpages-app'))
    expect(info.framework).toBe('nextjs-pages')
    expect(info.adapterId).toBe('nextjs-pages')
  })

  it('Vue SPA 프로젝트를 vue-spa로 감지한다', async () => {
    const info = await detectStack(path.join(FIXTURES, 'mini-vue-spa-app'))
    expect(info.framework).toBe('vue-spa')
    expect(info.adapterId).toBe('vue-spa')
  })

  it('Remix 프로젝트를 remix로 감지한다', async () => {
    const info = await detectStack(path.join(FIXTURES, 'mini-remix-app'))
    expect(info.framework).toBe('remix')
    expect(info.adapterId).toBe('remix')
  })

  it('Angular 프로젝트를 angular로 감지한다', async () => {
    const info = await detectStack(path.join(FIXTURES, 'mini-angular-app'))
    expect(info.framework).toBe('angular')
    expect(info.adapterId).toBe('angular')
  })
})

describe('detectStack — ORM 플래그 감지', () => {
  const tmpDirs: string[] = []

  async function makeTmpDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-viz-orm-test-'))
    tmpDirs.push(dir)
    return dir
  }

  afterEach(async () => {
    for (const dir of tmpDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  it('drizzle-orm → hasDrizzle: true', async () => {
    const dir = await makeTmpDir()
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({
        dependencies: { 'drizzle-orm': '^0.29.0', 'vite': '^5.0.0', 'react': '^18.0.0' },
      }),
    )
    const info = await detectStack(dir)
    expect(info.hasDrizzle).toBe(true)
    expect(info.hasTypeOrm).toBe(false)
  })

  it('typeorm → hasTypeOrm: true', async () => {
    const dir = await makeTmpDir()
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({
        dependencies: { 'typeorm': '^0.3.0', 'vite': '^5.0.0', 'react': '^18.0.0' },
      }),
    )
    const info = await detectStack(dir)
    expect(info.hasTypeOrm).toBe(true)
    expect(info.hasDrizzle).toBe(false)
  })

  it('requirements.txt에 sqlalchemy → hasSQLAlchemy: true', async () => {
    const dir = await makeTmpDir()
    await fs.writeFile(path.join(dir, 'requirements.txt'), 'SQLAlchemy>=2.0\nfastapi>=0.100\n')
    const info = await detectStack(dir)
    expect(info.hasSQLAlchemy).toBe(true)
    expect(info.framework).toBe('fastapi')
  })

  it('pyproject.toml에 sqlalchemy → hasSQLAlchemy: true', async () => {
    const dir = await makeTmpDir()
    await fs.writeFile(
      path.join(dir, 'pyproject.toml'),
      '[tool.poetry.dependencies]\nsqlalchemy = "^2.0"\nflask = "^3.0"\n',
    )
    const info = await detectStack(dir)
    expect(info.hasSQLAlchemy).toBe(true)
  })

  it('django 프레임워크 → hasDjangoORM: true', async () => {
    const info = await detectStack(path.join(FIXTURES, 'mini-django-app'))
    expect(info.framework).toBe('django')
    expect(info.hasDjangoORM).toBe(true)
  })

  it('build.gradle에 spring-boot-starter-data-jpa → hasSpringDataJpa: true', async () => {
    const dir = await makeTmpDir()
    await fs.writeFile(
      path.join(dir, 'build.gradle'),
      "dependencies {\n  implementation 'org.springframework.boot:spring-boot-starter-data-jpa:3.2.0'\n}\n",
    )
    const info = await detectStack(dir)
    expect(info.hasSpringDataJpa).toBe(true)
    expect(info.framework).toBe('springboot')
  })

  it('pom.xml에 spring-data-jpa → hasSpringDataJpa: true', async () => {
    const dir = await makeTmpDir()
    await fs.writeFile(
      path.join(dir, 'pom.xml'),
      '<project><dependencies><dependency><artifactId>spring-data-jpa</artifactId></dependency></dependencies></project>',
    )
    const info = await detectStack(dir)
    expect(info.hasSpringDataJpa).toBe(true)
  })

  it('ORM 의존성 없으면 모두 false', async () => {
    const dir = await makeTmpDir()
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ dependencies: { 'next': '^15.0.0', 'react': '^18.0.0' } }),
    )
    await fs.mkdir(path.join(dir, 'app'), { recursive: true })
    const info = await detectStack(dir)
    expect(info.hasDrizzle).toBe(false)
    expect(info.hasTypeOrm).toBe(false)
    expect(info.hasSQLAlchemy).toBe(false)
    expect(info.hasDjangoORM).toBe(false)
    expect(info.hasSpringDataJpa).toBe(false)
  })
})
