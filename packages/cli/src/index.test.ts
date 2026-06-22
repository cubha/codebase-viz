import { describe, it, expect, afterEach, vi } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { analyze } from './index.js'
import type { LLMAnalysisResult } from '@codebase-viz/llm'

// vi.mock is hoisted — factory cannot reference variables declared below
vi.mock('@codebase-viz/llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codebase-viz/llm')>()
  return { ...actual, analyzeWithLLM: vi.fn() }
})

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.resolve(__dirname, '../../../fixtures/mini-next-app')
const REACT_FIXTURE = path.resolve(__dirname, '../../../fixtures/mini-react-partner-mock-app')
const OUTPUT_DIR = path.join(__dirname, '../../../.tmp-cli-test')

afterEach(async () => {
  await fs.rm(OUTPUT_DIR, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('analyze CLI', { timeout: 30000 }, () => {
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
    // v1.2.45: FE Tab1은 graph LR (표준 1 형제 X축 배치, mermaid v11 nested LR 트리거).
    expect(content).toContain('graph LR')
  })

  it('db-screen.md에 posts 테이블이 포함된다', async () => {
    await analyze(FIXTURE, OUTPUT_DIR)

    const content = await fs.readFile(path.join(OUTPUT_DIR, 'db-screen.md'), 'utf8')
    expect(content).toContain('posts')
  })

  it('--with-llm 모드: mock LLM 결과를 정적 분석에 머지하여 3개 .md를 생성한다', async () => {
    const { analyzeWithLLM } = await import('@codebase-viz/llm')
    const mockResult: LLMAnalysisResult = {
      framework: 'nextjs-app-router',
      routes: [{ path: '/llm-only-page', file: 'app/page.tsx', mode: 'SSR', components: [] }],
      tables: [],
      inferenceNotes: [],
    }
    vi.mocked(analyzeWithLLM).mockResolvedValue(mockResult)

    await analyze(FIXTURE, OUTPUT_DIR, { apiKey: 'mock-key' })

    const files = await fs.readdir(OUTPUT_DIR)
    expect(files).toContain('rendering.md')
    expect(files).toContain('screen-component.md')
    expect(files).toContain('db-screen.md')
    expect(vi.mocked(analyzeWithLLM)).toHaveBeenCalledOnce()
  })

  // v1.2.54 WINA 재현 e2e (Fix1 + Fix2 결합): mini-react-partner-mock-app은 FE-only(axios만, 서버 소스 0).
  // LLM이 deployTarget='mobile' + backendServices(express+PostgreSQL)를 발명한 실 WINA 오분석을 그대로 주입.
  //  - Fix1(infra.ts): deployTarget='mobile'이 react-router framework 가드를 우회하지 못해 web 분류 유지.
  //  - Fix2(corroborate, Design B): 수집물에 서버 코드 증거 없으므로 상세 BACKEND_0 블록 드롭.
  //  - 정적 api-call edges는 보존 → External REST API gateway로 fallback.
  // (v1.2.43 ST3의 "backends 무조건 우선"은 FE-only 환각을 노출하던 결함 → 본 사이클에서 정정.)
  it('--with-llm 모드 + FE-only 레포에 deployTarget=mobile·backends 환각 주입(WINA 재현): web 분류 유지 + 상세 backend 드롭 + gateway fallback', async () => {
    const { analyzeWithLLM } = await import('@codebase-viz/llm')
    const mockResult: LLMAnalysisResult = {
      framework: 'react-router',
      deployTarget: 'mobile',
      routes: [],
      tables: [],
      backendServices: [
        { name: 'Partner API', framework: 'express', modules: ['UserModule', 'OrderModule'], dbType: 'postgresql' },
      ],
      inferenceNotes: [],
    }
    vi.mocked(analyzeWithLLM).mockResolvedValue(mockResult)

    await analyze(REACT_FIXTURE, OUTPUT_DIR, { apiKey: 'mock-key' })

    const tab1 = await fs.readFile(path.join(OUTPUT_DIR, 'rendering.md'), 'utf8')
    // Fix1: deployTarget=mobile 환각에도 React Router(web) 분류 유지, Mobile/RN 래퍼 미발동
    expect(tab1).toContain('React Router · SPA')
    expect(tab1).not.toContain('React Native · Expo')
    expect(tab1).not.toContain('Mobile · iOS')
    // Fix2: 서버 증거 부재 → 상세 LLM backends 블록 드롭 (환각 차단)
    expect(tab1).not.toContain('BACKEND_0')
    expect(tab1).not.toContain('Partner API · express')
    // 정적 api-call edges 보존 → 증거 기반 generic gateway로 표현
    expect(tab1).toContain('External REST API')
  })

  it('--with-llm 모드 + backends 없음: 정적 api-call edges가 보존되어 React Tab1 External API Gateway 분기 발동', async () => {
    const { analyzeWithLLM } = await import('@codebase-viz/llm')
    const mockResult: LLMAnalysisResult = {
      framework: 'react-router',
      routes: [],
      tables: [],
      inferenceNotes: [],
      // backendServices 없음 → ST1 신규 fallback 분기 발동 조건
    }
    vi.mocked(analyzeWithLLM).mockResolvedValue(mockResult)

    await analyze(REACT_FIXTURE, OUTPUT_DIR, { apiKey: 'mock-key' })

    const tab1 = await fs.readFile(path.join(OUTPUT_DIR, 'rendering.md'), 'utf8')
    // 정적 파서가 추출한 axios/fetch api-call edges가 LLM 머지 후에도 보존 → External REST API Gateway 노드 표시
    expect(tab1).toContain('External REST API')
    expect(tab1).toContain('API_GATEWAY')
    // LLM backends가 없으니 LLM backends 분기는 미발동
    expect(tab1).not.toContain('BACKEND_0')
  })
})
