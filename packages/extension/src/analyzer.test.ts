import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { runAnalysis, loadCachedGraph, saveCachedGraph, ANALYZER_VERSION } from './analyzer.js'

describe('runAnalysis — LLM OFF + LLM-only stack', () => {
  const tmpDirs: string[] = []

  async function makeTmpDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-viz-analyzer-test-'))
    tmpDirs.push(dir)
    return dir
  }

  afterEach(async () => {
    for (const dir of tmpDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  it('vite+react 프로젝트에서 LLM OFF 시 명시적 에러를 던진다', async () => {
    const dir = await makeTmpDir()
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ dependencies: { vite: '^5.0.0', react: '^18.2.0' } }),
    )
    await expect(runAnalysis(dir)).rejects.toThrow('LLM 분석이 필요합니다')
  })

  it('unknown 프레임워크에서 LLM OFF 시 명시적 에러를 던진다', async () => {
    const dir = await makeTmpDir()
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ dependencies: {} }))
    await expect(runAnalysis(dir)).rejects.toThrow('LLM 분석이 필요합니다')
  })

  it('react-router 프로젝트는 LLM 없이도 정상 분석된다', async () => {
    const dir = await makeTmpDir()
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ dependencies: { react: '^18.2.0', 'react-router-dom': '^6.10.0' } }),
    )
    const result = await runAnalysis(dir)
    expect(result.graph).toBeDefined()
  })
})

describe('loadCachedGraph / saveCachedGraph — 캐시 무효화 (C1)', () => {
  const tmpDirs: string[] = []

  async function makeTmpDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-viz-cache-test-'))
    tmpDirs.push(dir)
    return dir
  }

  afterEach(async () => {
    for (const dir of tmpDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  it('캐시 파일 없으면 null 반환', async () => {
    const dir = await makeTmpDir()
    expect(await loadCachedGraph(dir)).toBeNull()
  })

  it('이전 버전 analyzerVersion 캐시 → null 반환 (무효화)', async () => {
    const dir = await makeTmpDir()
    const codesightDir = path.join(dir, '.codesight')
    await fs.mkdir(codesightDir, { recursive: true })
    await fs.writeFile(
      path.join(codesightDir, 'cache.json'),
      JSON.stringify({ analyzerVersion: 'codebase-viz@1.1.0', graph: {} }),
      'utf8',
    )
    expect(await loadCachedGraph(dir)).toBeNull()
  })

  it('현재 버전 캐시 → IRGraph 반환 (캐시 히트)', async () => {
    const dir = await makeTmpDir()
    const fakeGraph = { analyzerVersion: ANALYZER_VERSION, schemaVersion: 1, repoRoot: dir, generatedAt: '', nodes: [], edges: [] }
    await saveCachedGraph(dir, fakeGraph as Parameters<typeof saveCachedGraph>[1])
    const loaded = await loadCachedGraph(dir)
    expect(loaded).not.toBeNull()
    expect(loaded?.analyzerVersion).toBe(ANALYZER_VERSION)
  })

  it('saveCachedGraph — .codesight/cache.json 에 현재 버전 기록', async () => {
    const dir = await makeTmpDir()
    const fakeGraph = { analyzerVersion: ANALYZER_VERSION, schemaVersion: 1, repoRoot: dir, generatedAt: '', nodes: [], edges: [] }
    await saveCachedGraph(dir, fakeGraph as Parameters<typeof saveCachedGraph>[1])
    const raw = await fs.readFile(path.join(dir, '.codesight', 'cache.json'), 'utf8')
    const entry = JSON.parse(raw) as { analyzerVersion: string }
    expect(entry.analyzerVersion).toBe(ANALYZER_VERSION)
  })
})
