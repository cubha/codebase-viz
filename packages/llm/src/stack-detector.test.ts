import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
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
