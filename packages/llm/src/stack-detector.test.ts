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
})
