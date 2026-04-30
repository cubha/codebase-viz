import { describe, it, expect, afterEach } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { analyze } from './index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.resolve(__dirname, '../../../fixtures/mini-next-app')
const OUTPUT_DIR = path.join(__dirname, '../../../.tmp-cli-test')

afterEach(async () => {
  await fs.rm(OUTPUT_DIR, { recursive: true, force: true })
})

describe('analyze CLI', () => {
  it('fixtures/mini-next-app 분석 시 3개 .md 파일을 생성한다', async () => {
    await analyze(FIXTURE, OUTPUT_DIR)

    const files = await fs.readdir(OUTPUT_DIR)
    expect(files).toContain('rendering.md')
    expect(files).toContain('screen-component.md')
    expect(files).toContain('db-screen.md')
  })

  it('rendering.md에 라우트 정보가 포함된다', async () => {
    await analyze(FIXTURE, OUTPUT_DIR)

    const content = await fs.readFile(path.join(OUTPUT_DIR, 'rendering.md'), 'utf8')
    expect(content).toContain('```mermaid')
    expect(content).toContain('graph TD')
  })

  it('db-screen.md에 posts 테이블이 포함된다', async () => {
    await analyze(FIXTURE, OUTPUT_DIR)

    const content = await fs.readFile(path.join(OUTPUT_DIR, 'db-screen.md'), 'utf8')
    expect(content).toContain('posts')
  })
})
