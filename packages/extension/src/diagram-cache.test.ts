import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { ANALYZER_VERSION } from '@codebase-viz/types'
import { readDiagramCache, writeDiagramCache, type DiagramCache } from './diagram-cache.js'

describe('readDiagramCache / writeDiagramCache — 캐시 파일 분리 (ARCH-1)', () => {
  const tmpDirs: string[] = []

  async function makeTmpDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-viz-diagram-cache-test-'))
    tmpDirs.push(dir)
    return dir
  }

  afterEach(async () => {
    for (const dir of tmpDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  const sample: DiagramCache = {
    analyzerVersion: ANALYZER_VERSION,
    savedAt: 1700000000000,
    projectName: 'demo',
    routeCount: 3,
    tableCount: 2,
    diagrams: { rendering: 'graph LR', screenComponent: '', dbScreen: '', nodeMap: {}, tab3Kind: 'erd' },
  }

  // v1.2.62: nodeMap이 없는 캐시 = v1.2.61 이전 산출물. analyzerVersion 범프를 빠뜨려도
  // 딥링크·hover가 조용히 죽지 않도록 shape로 한 번 더 무효화한다.
  it('nodeMap 없는 구버전 diagrams 캐시는 무효 처리한다', async () => {
    const dir = await makeTmpDir()
    const cacheDir = path.join(dir, '.codebase-viz')
    await fs.mkdir(cacheDir, { recursive: true })
    const legacy = { ...sample, diagrams: { rendering: 'graph LR', screenComponent: '', dbScreen: '' } }
    await fs.writeFile(path.join(cacheDir, 'cache-diagrams.json'), JSON.stringify(legacy))
    expect(await readDiagramCache(dir)).toBeUndefined()
  })

  // v1.2.63 D0: tab3Kind 없는 캐시 = v1.2.62 이전 산출물. webview가 이 필드로 Tab3 렌더 종류를
  // 분기하므로(ST3), 없는 채 로드되면 D0(react-router FE Tab3 (No data))가 조용히 재발한다.
  it('tab3Kind 없는 구버전 diagrams 캐시는 무효 처리한다', async () => {
    const dir = await makeTmpDir()
    const cacheDir = path.join(dir, '.codebase-viz')
    await fs.mkdir(cacheDir, { recursive: true })
    const legacy = { ...sample, diagrams: { rendering: 'graph LR', screenComponent: '', dbScreen: '', nodeMap: {} } }
    await fs.writeFile(path.join(cacheDir, 'cache-diagrams.json'), JSON.stringify(legacy))
    expect(await readDiagramCache(dir)).toBeUndefined()
  })

  it('캐시 파일 없으면 undefined 반환', async () => {
    const dir = await makeTmpDir()
    expect(await readDiagramCache(dir)).toBeUndefined()
  })

  it('writeDiagramCache로 저장한 값을 readDiagramCache로 그대로 읽는다', async () => {
    const dir = await makeTmpDir()
    await writeDiagramCache(dir, sample)
    const loaded = await readDiagramCache(dir)
    expect(loaded).toEqual(sample)
  })

  it('cache-diagrams.json 파일명에 저장한다 (analyzer의 cache-graph.json과 분리)', async () => {
    const dir = await makeTmpDir()
    await writeDiagramCache(dir, sample)
    const raw = await fs.readFile(path.join(dir, '.codebase-viz', 'cache-diagrams.json'), 'utf8')
    expect(JSON.parse(raw)).toEqual(sample)
  })

  it('pairRepoRoot 지정 시 별도 파일명(cache-diagrams-pair-*)에 저장한다', async () => {
    const dir = await makeTmpDir()
    const pairDir = await makeTmpDir()
    await writeDiagramCache(dir, sample, pairDir)
    const files = await fs.readdir(path.join(dir, '.codebase-viz'))
    expect(files.some(f => f.startsWith('cache-diagrams-pair-'))).toBe(true)
    expect(files).not.toContain('cache-diagrams.json')
  })

  it('shape 가드: 형태가 다른 JSON(analyzer의 {analyzerVersion,graph} 등)은 무시하고 undefined 반환', async () => {
    const dir = await makeTmpDir()
    const cacheDir = path.join(dir, '.codebase-viz')
    await fs.mkdir(cacheDir, { recursive: true })
    await fs.writeFile(
      path.join(cacheDir, 'cache-diagrams.json'),
      JSON.stringify({ analyzerVersion: 'codebase-viz@1.2.57', graph: {} }),
      'utf8',
    )
    expect(await readDiagramCache(dir)).toBeUndefined()
  })

  it('구 버전 마이그레이션: cache-diagrams.json 없고 구 cache.json이 diagram-cache 형태면 채택한다', async () => {
    const dir = await makeTmpDir()
    const cacheDir = path.join(dir, '.codebase-viz')
    await fs.mkdir(cacheDir, { recursive: true })
    await fs.writeFile(path.join(cacheDir, 'cache.json'), JSON.stringify(sample), 'utf8')
    expect(await readDiagramCache(dir)).toEqual(sample)
  })

  it('구 버전 cache.json이 analyzer graph 캐시 형태(비-diagram shape)면 마이그레이션하지 않는다', async () => {
    const dir = await makeTmpDir()
    const cacheDir = path.join(dir, '.codebase-viz')
    await fs.mkdir(cacheDir, { recursive: true })
    await fs.writeFile(
      path.join(cacheDir, 'cache.json'),
      JSON.stringify({ analyzerVersion: 'codebase-viz@1.2.57', graph: {} }),
      'utf8',
    )
    expect(await readDiagramCache(dir)).toBeUndefined()
  })

  it('A3: 이전 analyzerVersion의 diagram 캐시는 미스로 처리한다(graph 캐시와 동일한 무효화 규칙)', async () => {
    const dir = await makeTmpDir()
    const cacheDir = path.join(dir, '.codebase-viz')
    await fs.mkdir(cacheDir, { recursive: true })
    await fs.writeFile(
      path.join(cacheDir, 'cache-diagrams.json'),
      JSON.stringify({ ...sample, analyzerVersion: 'codebase-viz@0.0.1-stale' }),
      'utf8',
    )
    expect(await readDiagramCache(dir)).toBeUndefined()
  })

  it('A3: pair 캐시도 이전 analyzerVersion이면 미스로 처리한다', async () => {
    const dir = await makeTmpDir()
    const pairDir = await makeTmpDir()
    await writeDiagramCache(dir, sample, pairDir)
    const files = await fs.readdir(path.join(dir, '.codebase-viz'))
    const pairFile = files.find(f => f.startsWith('cache-diagrams-pair-'))!
    const filePath = path.join(dir, '.codebase-viz', pairFile)
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as DiagramCache
    await fs.writeFile(filePath, JSON.stringify({ ...raw, analyzerVersion: 'codebase-viz@0.0.1-stale' }), 'utf8')
    expect(await readDiagramCache(dir, pairDir)).toBeUndefined()
  })
})
