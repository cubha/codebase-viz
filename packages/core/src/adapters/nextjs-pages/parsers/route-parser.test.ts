import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parseNextPagesRoutes } from './route-parser.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-nextpages-test-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeFile(relPath: string, content: string): Promise<void> {
  const absPath = path.join(tmpDir, relPath)
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  await fs.writeFile(absPath, content, 'utf-8')
}

describe('parseNextPagesRoutes', () => {
  it('pages/ 파일을 RouteNode로 추출한다', async () => {
    await writeFile('pages/index.tsx', 'export default function Home() {}')
    await writeFile('pages/about.tsx', 'export default function About() {}')
    await writeFile('pages/users/[id].tsx', 'export default function User() {}')
    const routes = await parseNextPagesRoutes(tmpDir, 'test@0.1')
    expect(routes.length).toBeGreaterThanOrEqual(3)
    const paths = routes.map(r => r.path)
    expect(paths).toContain('/')
    expect(paths).toContain('/about')
  })

  it('[id] → :id 동적 라우트 변환', async () => {
    await writeFile('pages/users/[id].tsx', 'export default function User() {}')
    const routes = await parseNextPagesRoutes(tmpDir, 'test@0.1')
    const dynamic = routes.find(r => r.path === '/users/:id')
    expect(dynamic).toBeDefined()
    expect(dynamic?.dynamicSegmentType).toBe('dynamic')
  })

  it('routeFileKind는 page', async () => {
    await writeFile('pages/index.tsx', 'export default function Home() {}')
    const routes = await parseNextPagesRoutes(tmpDir, 'test@0.1')
    for (const r of routes) expect(r.routeFileKind).toBe('page')
  })

  it('getStaticProps export → SSG', async () => {
    await writeFile('pages/blog.tsx', `
export async function getStaticProps() {
  return { props: {} }
}
export default function Blog() {}
`)
    const routes = await parseNextPagesRoutes(tmpDir, 'test@0.1')
    expect(routes[0]?.renderingMode).toBe('SSG')
  })

  it('getServerSideProps export → SSR', async () => {
    await writeFile('pages/profile.tsx', `
export async function getServerSideProps(context) {
  return { props: {} }
}
export default function Profile() {}
`)
    const routes = await parseNextPagesRoutes(tmpDir, 'test@0.1')
    expect(routes[0]?.renderingMode).toBe('SSR')
  })

  it('getStaticProps + revalidate → ISR', async () => {
    await writeFile('pages/news.tsx', `
export async function getStaticProps() {
  return { props: {}, revalidate: 60 }
}
export default function News() {}
`)
    const routes = await parseNextPagesRoutes(tmpDir, 'test@0.1')
    expect(routes[0]?.renderingMode).toBe('ISR')
  })

  it('아무 export 함수 없음 → SSR (기본값)', async () => {
    await writeFile('pages/about.tsx', `
export default function About() {}
`)
    const routes = await parseNextPagesRoutes(tmpDir, 'test@0.1')
    expect(routes[0]?.renderingMode).toBe('SSR')
  })

  it('getServerSideProps가 getStaticProps보다 우선 → SSR', async () => {
    await writeFile('pages/mixed.tsx', `
export async function getStaticProps() {
  return { props: {} }
}
export async function getServerSideProps() {
  return { props: {} }
}
export default function Mixed() {}
`)
    const routes = await parseNextPagesRoutes(tmpDir, 'test@0.1')
    expect(routes[0]?.renderingMode).toBe('SSR')
  })
})
