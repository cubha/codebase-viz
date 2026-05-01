import { describe, it, expect } from 'vitest'
import { convertToIR } from './converter.js'
import type { LLMAnalysisResult } from './schema.js'

const ANALYZER_VERSION = 'codebase-viz@0.1.0'
const REPO_ROOT = '/tmp/test-repo'

describe('convertToIR', () => {
  it('LLM 라우트를 RouteNode로 변환한다', () => {
    const result: LLMAnalysisResult = {
      framework: 'nextjs-app-router',
      routes: [{
        path: '/blog',
        file: 'app/blog/page.tsx',
        mode: 'SSR',
        components: [],
      }],
      tables: [],
      inferenceNotes: [],
    }

    const { routeNodes } = convertToIR(result, REPO_ROOT, ANALYZER_VERSION)
    expect(routeNodes).toHaveLength(1)
    expect(routeNodes[0]?.path).toBe('/blog')
    expect(routeNodes[0]?.renderingMode).toBe('SSR')
    expect(routeNodes[0]?.confidence).toBe('inferred')
  })

  it('동적 경로 [slug]는 dynamicSegmentType: dynamic으로 변환한다', () => {
    const result: LLMAnalysisResult = {
      framework: 'nextjs-app-router',
      routes: [{ path: '/blog/[slug]', file: 'app/blog/[slug]/page.tsx', mode: 'SSR', components: [] }],
      tables: [],
      inferenceNotes: [],
    }

    const { routeNodes } = convertToIR(result, REPO_ROOT, ANALYZER_VERSION)
    expect(routeNodes[0]?.dynamicSegmentType).toBe('dynamic')
  })

  it('라우트 컴포넌트를 ComponentNode + renders 엣지로 변환한다', () => {
    const result: LLMAnalysisResult = {
      framework: 'nextjs-app-router',
      routes: [{ path: '/blog', file: 'app/blog/page.tsx', mode: 'SSR', components: ['BlogList', 'Header'] }],
      tables: [],
      inferenceNotes: [],
    }

    const { componentNodes, edges } = convertToIR(result, REPO_ROOT, ANALYZER_VERSION)
    expect(componentNodes).toHaveLength(2)
    expect(componentNodes.map(c => c.name)).toContain('BlogList')
    expect(componentNodes.map(c => c.name)).toContain('Header')

    const rendersEdges = edges.filter(e => e.kind === 'renders')
    expect(rendersEdges).toHaveLength(2)
    expect(rendersEdges.every(e => e.confidence === 'inferred')).toBe(true)
  })

  it('같은 컴포넌트가 여러 라우트에 있으면 중복 생성하지 않는다', () => {
    const result: LLMAnalysisResult = {
      framework: 'nextjs-app-router',
      routes: [
        { path: '/', file: 'app/page.tsx', mode: 'SSR', components: ['Header'] },
        { path: '/blog', file: 'app/blog/page.tsx', mode: 'SSR', components: ['Header', 'BlogList'] },
      ],
      tables: [],
      inferenceNotes: [],
    }

    const { componentNodes } = convertToIR(result, REPO_ROOT, ANALYZER_VERSION)
    const headerNodes = componentNodes.filter(c => c.name === 'Header')
    expect(headerNodes).toHaveLength(1)
  })

  it('테이블을 TableNode + queries 엣지로 변환한다', () => {
    const result: LLMAnalysisResult = {
      framework: 'nextjs-app-router',
      routes: [{ path: '/blog', file: 'app/blog/page.tsx', mode: 'SSR', components: ['BlogList'] }],
      tables: [{ name: 'blog_posts', usedBy: ['BlogList'] }],
      inferenceNotes: [],
    }

    const { tableNodes, edges } = convertToIR(result, REPO_ROOT, ANALYZER_VERSION)
    expect(tableNodes).toHaveLength(1)
    expect(tableNodes[0]?.name).toBe('blog_posts')

    const queriesEdges = edges.filter(e => e.kind === 'queries')
    expect(queriesEdges).toHaveLength(1)
    expect(queriesEdges[0]?.confidence).toBe('inferred')
  })

  it('inferenceChain이 채워진다', () => {
    const result: LLMAnalysisResult = {
      framework: 'vite-react',
      routes: [{ path: '/', file: 'src/App.tsx', mode: 'CSR', components: ['App'] }],
      tables: [],
      inferenceNotes: [],
    }

    const { routeNodes, componentNodes } = convertToIR(result, REPO_ROOT, ANALYZER_VERSION)
    const route = routeNodes[0]
    if (route?.confidence !== 'inferred') throw new Error('expected inferred')
    expect(route.inferenceChain.length).toBeGreaterThan(0)

    const comp = componentNodes[0]
    if (comp?.confidence !== 'inferred') throw new Error('expected inferred')
    expect(comp.inferenceChain.length).toBeGreaterThan(0)
  })
})
