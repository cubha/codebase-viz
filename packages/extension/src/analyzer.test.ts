import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { runAnalysis, loadCachedGraph, saveCachedGraph } from './analyzer.js'
import { ANALYZER_VERSION } from '@codebase-viz/types'

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
    const cacheDir = path.join(dir, '.codebase-viz')
    await fs.mkdir(cacheDir, { recursive: true })
    await fs.writeFile(
      path.join(cacheDir, 'cache-graph.json'),
      JSON.stringify({ analyzerVersion: 'codebase-viz@1.1.0', graph: {} }),
      'utf8',
    )
    expect(await loadCachedGraph(dir)).toBeNull()
  })

  it('ARCH-1 shape 가드: extension의 diagram cache 형태(savedAt/diagrams)는 무시하고 null 반환', async () => {
    const dir = await makeTmpDir()
    const cacheDir = path.join(dir, '.codebase-viz')
    await fs.mkdir(cacheDir, { recursive: true })
    await fs.writeFile(
      path.join(cacheDir, 'cache-graph.json'),
      JSON.stringify({ savedAt: Date.now(), projectName: 'x', routeCount: 0, tableCount: 0, diagrams: {} }),
      'utf8',
    )
    expect(await loadCachedGraph(dir)).toBeNull()
  })

  it('ARCH-1 구버전 마이그레이션: cache-graph.json 없고 구 cache.json이 graph cache 형태면 채택한다', async () => {
    const dir = await makeTmpDir()
    const cacheDir = path.join(dir, '.codebase-viz')
    await fs.mkdir(cacheDir, { recursive: true })
    await fs.writeFile(
      path.join(cacheDir, 'cache.json'),
      JSON.stringify({ analyzerVersion: ANALYZER_VERSION, graph: { repoRoot: dir, nodes: [], edges: [] } }),
      'utf8',
    )
    const loaded = await loadCachedGraph(dir)
    expect(loaded).not.toBeNull()
    expect(loaded?.repoRoot).toBe(dir)
  })

  it('현재 버전 캐시 → IRGraph 반환 (캐시 히트)', async () => {
    const dir = await makeTmpDir()
    const fakeGraph = { analyzerVersion: ANALYZER_VERSION, schemaVersion: 1, repoRoot: dir, generatedAt: '', nodes: [], edges: [] }
    await saveCachedGraph(dir, fakeGraph as Parameters<typeof saveCachedGraph>[1])
    const loaded = await loadCachedGraph(dir)
    expect(loaded).not.toBeNull()
    expect(loaded?.analyzerVersion).toBe(ANALYZER_VERSION)
  })

  it('saveCachedGraph — .codebase-viz/cache-graph.json 에 현재 버전 기록 (extension의 cache-diagrams.json과 분리)', async () => {
    const dir = await makeTmpDir()
    const fakeGraph = { analyzerVersion: ANALYZER_VERSION, schemaVersion: 1, repoRoot: dir, generatedAt: '', nodes: [], edges: [] }
    await saveCachedGraph(dir, fakeGraph as Parameters<typeof saveCachedGraph>[1])
    const raw = await fs.readFile(path.join(dir, '.codebase-viz', 'cache-graph.json'), 'utf8')
    const entry = JSON.parse(raw) as { analyzerVersion: string }
    expect(entry.analyzerVersion).toBe(ANALYZER_VERSION)
  })
})
