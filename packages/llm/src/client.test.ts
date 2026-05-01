import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LLMAnalysisResult } from './schema.js'

const mockCreate = vi.fn()

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('analyzWithLLM', () => {
  it('LLM 응답에서 JSON을 파싱하여 LLMAnalysisResult를 반환한다', async () => {
    const mockResult: LLMAnalysisResult = {
      framework: 'nextjs-app-router',
      routes: [{ path: '/blog', file: 'app/blog/page.tsx', mode: 'SSR', components: ['BlogList'] }],
      tables: [{ name: 'blog_posts', usedBy: ['BlogList'] }],
      inferenceNotes: ['blog route is server-rendered'],
    }

    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(mockResult) }],
    })

    const { analyzWithLLM } = await import('./client.js')
    const result = await analyzWithLLM(
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

    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: `Here is the analysis:\n\`\`\`json\n${JSON.stringify(mockResult)}\n\`\`\`` }],
    })

    const { analyzWithLLM } = await import('./client.js')
    const result = await analyzWithLLM(
      { apiKey: 'test-key' },
      { projectName: 'test', framework: 'vite-react', fileContents: {} },
    )

    expect(result.framework).toBe('vite-react')
  })

  it('텍스트 응답이 없으면 에러를 던진다', async () => {
    mockCreate.mockResolvedValue({ content: [] })

    const { analyzWithLLM } = await import('./client.js')
    await expect(
      analyzWithLLM({ apiKey: 'test-key' }, { projectName: 'test', framework: 'unknown', fileContents: {} }),
    ).rejects.toThrow('LLM returned no text content')
  })
})
