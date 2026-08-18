import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { runAnalysis, loadCachedGraph, saveCachedGraph } from './analyzer.js'
import { ANALYZER_VERSION } from '@codebase-viz/types'

const FE_PAIR_FIXTURE = path.resolve(process.cwd(), 'fixtures/mini-react-partner-mock-app')
const BE_PAIR_FIXTURE = path.resolve(process.cwd(), 'fixtures/mini-spring-partner-mock-app')

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

  // RR 딥링크 수정은 캐시 **shape를 안 바꾸고 내용만** 바꿨다(provenance 좌표·nodeMap f/l).
  // shape 가드는 이런 변경을 구조적으로 못 걸러내므로 ANALYZER_VERSION 범프가 유일한 무효화
  // 수단이다 — 그 규율이 지켜지는지(=직전 릴리스 캐시가 거부되는지) 고정한다.
  it('직전 릴리스(v1.2.63) 캐시는 거부된다 — 내용만 바뀐 변경의 유일한 무효화 수단', async () => {
    const dir = await makeTmpDir()
    const cacheDir = path.join(dir, '.codebase-viz')
    await fs.mkdir(cacheDir, { recursive: true })
    await fs.writeFile(
      path.join(cacheDir, 'cache-graph.json'),
      JSON.stringify({ analyzerVersion: 'codebase-viz@1.2.63', graph: { nodes: [], edges: [] } }),
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

describe('runAnalysis — pair 모드 결합 다이어그램 배선 (A1, FE↔BE cross-edge 렌더링 결함 복구)', () => {
  afterEach(async () => {
    await fs.rm(path.join(FE_PAIR_FIXTURE, '.codebase-viz'), { recursive: true, force: true }).catch(() => undefined)
    await fs.rm(path.join(BE_PAIR_FIXTURE, '.codebase-viz'), { recursive: true, force: true }).catch(() => undefined)
  })

  // 이 fixture 페어는 FE가 '/api/...' 접두사, BE가 '/v1/...' 접두사를 써서 실제로는 한 건도
  // 매칭되지 않는다(gateway rewrite를 가정한 실제 파트너 코드베이스 재현 — 실측 확인). A2의
  // matched-only 필터가 dangling crossEdge에는 선을 그리지 않으므로 FE_PROJ/BE_PROJ/dashed는
  // 이 fixture로 증명할 수 없다 — 그 경로는 정확 매칭 fixture로 별도 검증한다
  // (packages/cli/src/cross-project-integration.test.ts, packages/renderer/src/combined-diagram.test.ts).
  // 여기서는 배선 자체(pair 모드가 실제로 buildCombinedDiagram을 타는지)만 증명한다 — Tab3가
  // FE 단독일 때의 형태(react-router+무테이블 → FE API-call 다이어그램)가 아니라 BE의 실제
  // erDiagram·실제 테이블명으로 바뀐다는 사실이 배선의 유일하게 거짓없는 증거다.
  it('pair 분석 시 diagrams가 결합 경로(buildCombinedDiagram)로 구성된다 — Tab3가 BE의 실제 ERD로 바뀐다', async () => {
    const result = await runAnalysis(FE_PAIR_FIXTURE, { pairRepoRoot: BE_PAIR_FIXTURE })
    expect(result.pair).toBeDefined()
    expect(result.pair?.crossEdges.length).toBeGreaterThan(0)
    expect(result.diagrams.dbScreen).toContain('erDiagram')
    expect(result.diagrams.dbScreen).toContain('TWA_CONTRACT_MST')
  })

  it('실제 매칭되는 crossEdge는 matched-only 필터를 거쳐 FE_PROJ·BE_PROJ·dashed cross-edge로 렌더된다', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-viz-pair-match-'))
    const beDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-viz-pair-match-be-'))
    try {
      await fs.mkdir(path.join(dir, 'app'), { recursive: true })
      await fs.writeFile(
        path.join(dir, 'package.json'),
        JSON.stringify({ dependencies: { next: '^15.0.0', react: '^18.2.0' } }),
      )
      await fs.writeFile(
        path.join(dir, 'app', 'page.tsx'),
        `export default function Page() {\n  fetch('/api/users')\n  return null\n}\n`,
      )
      await fs.mkdir(path.join(beDir, 'src/main/java/com/x/controller'), { recursive: true })
      await fs.writeFile(path.join(beDir, 'pom.xml'), '<project></project>')
      await fs.writeFile(
        path.join(beDir, 'src/main/java/com/x/controller/UserController.java'),
        `package com.x.controller;\nimport org.springframework.web.bind.annotation.*;\n@RestController\npublic class UserController {\n  @GetMapping("/api/users")\n  public Object list() { return null; }\n}\n`,
      )
      const result = await runAnalysis(dir, { pairRepoRoot: beDir })
      expect(result.pair?.crossEdges.length).toBeGreaterThan(0)
      expect(result.diagrams.rendering).toContain('FE_PROJ')
      expect(result.diagrams.rendering).toContain('BE_PROJ')
      expect(result.diagrams.rendering).toContain('-.->')
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
      await fs.rm(beDir, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  it('pair 미지정 시(단일 분석)에는 결합 다이어그램을 만들지 않는다(회귀 방지)', async () => {
    const result = await runAnalysis(FE_PAIR_FIXTURE)
    expect(result.pair).toBeUndefined()
    expect(result.diagrams.rendering).not.toContain('BE_PROJ')
  })
})
