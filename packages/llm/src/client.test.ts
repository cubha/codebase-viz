import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LLMAnalysisResult } from './schema.js'

const mockGenerateText = vi.fn()

vi.mock('ai', () => ({
  generateText: mockGenerateText,
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn().mockReturnValue(vi.fn().mockReturnValue('mock-anthropic-model')),
}))

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn().mockReturnValue(vi.fn().mockReturnValue('mock-google-model')),
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn().mockReturnValue(vi.fn().mockReturnValue('mock-openai-model')),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('analyzeWithLLM', () => {
  it('LLM 응답에서 JSON을 파싱하여 LLMAnalysisResult를 반환한다', async () => {
    const mockResult: LLMAnalysisResult = {
      framework: 'nextjs-app-router',
      routes: [{ path: '/blog', file: 'app/blog/page.tsx', mode: 'SSR', components: ['BlogList'] }],
      tables: [{ name: 'blog_posts', usedBy: ['BlogList'] }],
      inferenceNotes: ['blog route is server-rendered'],
    }

    mockGenerateText.mockResolvedValue({ text: JSON.stringify(mockResult) })

    const { analyzeWithLLM } = await import('./client.js')
    const result = await analyzeWithLLM(
      { apiKey: 'test-key' },
      { projectName: 'test', framework: 'nextjs-app-router', fileContents: { 'app/blog/page.tsx': 'export default function Blog() {}' } },
    )

    expect(result.framework).toBe('nextjs-app-router')
    expect(result.routes).toHaveLength(1)
    expect(result.routes[0]?.path).toBe('/blog')
    expect(result.tables[0]?.name).toBe('blog_posts')
  })

  it('JSON 마크다운 블록이 포함된 응답도 파싱한다', async () => {
    const mockResult: LLMAnalysisResult = {
      framework: 'vite-react',
      routes: [],
      tables: [],
      inferenceNotes: [],
    }

    mockGenerateText.mockResolvedValue({
      text: `Here is the analysis:\n\`\`\`json\n${JSON.stringify(mockResult)}\n\`\`\``,
    })

    const { analyzeWithLLM } = await import('./client.js')
    const result = await analyzeWithLLM(
      { apiKey: 'test-key' },
      { projectName: 'test', framework: 'vite-react', fileContents: {} },
    )

    expect(result.framework).toBe('vite-react')
  })

  it('JSON이 없는 응답이면 에러를 던진다', async () => {
    mockGenerateText.mockResolvedValue({ text: 'No JSON content here' })

    const { analyzeWithLLM } = await import('./client.js')
    await expect(
      analyzeWithLLM({ apiKey: 'test-key' }, { projectName: 'test', framework: 'unknown', fileContents: {} }),
    ).rejects.toThrow('LLM response does not contain valid JSON')
  })

  it('ERR-1: isRetryable=false(4xx) 에러는 재시도 없이 즉시 표면화한다', async () => {
    const authError = Object.assign(new Error('Invalid API key'), { isRetryable: false, statusCode: 401 })
    mockGenerateText.mockRejectedValue(authError)

    const { analyzeWithLLM } = await import('./client.js')
    await expect(
      analyzeWithLLM({ apiKey: 'bad-key' }, { projectName: 'test', framework: 'unknown', fileContents: {} }),
    ).rejects.toThrow('Invalid API key')
    expect(mockGenerateText).toHaveBeenCalledTimes(1)
  })

  it('ERR-1: isRetryable=true(429/5xx) 에러는 1회 재시도하고, 재시도도 실패하면 첫 에러를 보존해 함께 표면화한다', async () => {
    const rateLimitError = Object.assign(new Error('Rate limit exceeded'), { isRetryable: true, statusCode: 429 })
    const serverError = Object.assign(new Error('Service unavailable'), { isRetryable: true, statusCode: 503 })
    mockGenerateText.mockRejectedValueOnce(rateLimitError).mockRejectedValueOnce(serverError)

    const { analyzeWithLLM } = await import('./client.js')
    await expect(
      analyzeWithLLM({ apiKey: 'test-key' }, { projectName: 'test', framework: 'unknown', fileContents: {} }),
    ).rejects.toThrow(/Rate limit exceeded.*Service unavailable/s)
    expect(mockGenerateText).toHaveBeenCalledTimes(2)
  })

  it('ERR-1: 재시도까지 실패하면 첫 에러의 name을 물려받아 pipeline.ts 진단(err.name)이 유지된다', async () => {
    const rateLimitError = Object.assign(new Error('Rate limit exceeded'), {
      isRetryable: true,
      statusCode: 429,
      name: 'APICallError',
    })
    const serverError = Object.assign(new Error('Service unavailable'), { isRetryable: true, statusCode: 503 })
    mockGenerateText.mockRejectedValueOnce(rateLimitError).mockRejectedValueOnce(serverError)

    const { analyzeWithLLM } = await import('./client.js')
    try {
      await analyzeWithLLM({ apiKey: 'test-key' }, { projectName: 'test', framework: 'unknown', fileContents: {} })
      expect.unreachable('analyzeWithLLM이 예외를 던져야 한다')
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).name).toBe('APICallError')
    }
  })

  it('ERR-1: isRetryable=true 에러가 재시도에서 성공하면 정상 결과를 반환한다', async () => {
    const rateLimitError = Object.assign(new Error('Rate limit exceeded'), { isRetryable: true, statusCode: 429 })
    const mockResult: LLMAnalysisResult = { framework: 'vite-react', routes: [], tables: [], inferenceNotes: [] }
    mockGenerateText.mockRejectedValueOnce(rateLimitError).mockResolvedValueOnce({ text: JSON.stringify(mockResult) })

    const { analyzeWithLLM } = await import('./client.js')
    const result = await analyzeWithLLM(
      { apiKey: 'test-key' },
      { projectName: 'test', framework: 'unknown', fileContents: {} },
    )
    expect(result.framework).toBe('vite-react')
    expect(mockGenerateText).toHaveBeenCalledTimes(2)
  })
})
