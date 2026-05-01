import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import { verifyNodes } from './verifier.js'
import { createRouteNode, createComponentNode, createTableNode, makeNodeId } from '@codebase-viz/types'

const REPO_ROOT = path.resolve('../../../fixtures/mini-next-app')
const PROV = { file: 'app/page.tsx', line: 1, adapter: 'test', analyzerVersion: '0.1' }

describe('verifyNodes', () => {
  it('실제 파일이 있는 RouteNode는 verified 배열에 포함된다', async () => {
    const node = createRouteNode({
      id: makeNodeId('route', 'app/page.tsx', '/'),
      path: '/',
      filePath: 'app/page.tsx',
      routeFileKind: 'page',
      dynamicSegmentType: 'static',
      isGroupRoute: false,
      renderingMode: 'SSR',
      provenance: PROV,
      confidence: 'inferred',
      inferenceChain: ['test'],
    })

    const repoRoot = path.resolve(import.meta.dirname, '../../../fixtures/mini-next-app')
    const result = await verifyNodes([node], repoRoot)
    expect(result.verified).toHaveLength(1)
    expect(result.failed).toHaveLength(0)
  })

  it('존재하지 않는 파일 경로는 failed 배열에 포함된다', async () => {
    const node = createRouteNode({
      id: makeNodeId('route', 'app/nonexistent/page.tsx', '/nonexistent'),
      path: '/nonexistent',
      filePath: 'app/nonexistent/page.tsx',
      routeFileKind: 'page',
      dynamicSegmentType: 'static',
      isGroupRoute: false,
      renderingMode: 'SSR',
      provenance: { ...PROV, file: 'app/nonexistent/page.tsx' },
      confidence: 'inferred',
      inferenceChain: ['test'],
    })

    const result = await verifyNodes([node], '/tmp/test-repo')
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]?.reason).toContain('not found')
  })

  it('TableNode는 파일 검증 없이 verified로 통과한다', async () => {
    const node = createTableNode({
      id: makeNodeId('table', '(inferred)/blog_posts', 'blog_posts'),
      name: 'blog_posts',
      columns: [],
      provenance: PROV,
      confidence: 'inferred',
      inferenceChain: ['test'],
    })

    const result = await verifyNodes([node], '/tmp/test-repo')
    expect(result.verified).toHaveLength(1)
    expect(result.failed).toHaveLength(0)
  })
})
