import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectFiles } from './file-collector.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.resolve(__dirname, '../../../fixtures')

describe('collectFiles', () => {
  it('nextjs-app-router: package.json 및 라우터 파일을 수집한다', async () => {
    const files = await collectFiles(path.join(FIXTURES, 'mini-next-app'), 'nextjs-app-router')
    expect(Object.keys(files)).toContain('package.json')
    expect(Object.keys(files).some(f => f.endsWith('.tsx') || f.endsWith('.ts'))).toBe(true)
  })

  it('vite-react: src/ 내 tsx 파일을 수집한다', async () => {
    const files = await collectFiles('/mnt/d/workspace/dev-note', 'vite-react')
    const keys = Object.keys(files)
    expect(keys).toContain('package.json')
    expect(keys.some(f => f.endsWith('.tsx'))).toBe(true)
  })

  it('수집된 각 파일 내용은 8000자 이하로 트런케이션된다', async () => {
    const files = await collectFiles(path.join(FIXTURES, 'mini-next-app'), 'nextjs-app-router')
    for (const content of Object.values(files)) {
      expect(content.length).toBeLessThanOrEqual(8000)
    }
  })

  it('node_modules 디렉토리는 수집하지 않는다', async () => {
    const files = await collectFiles(path.join(FIXTURES, 'mini-next-app'), 'nextjs-app-router')
    const hasNodeModules = Object.keys(files).some(f => f.includes('node_modules'))
    expect(hasNodeModules).toBe(false)
  })
})
