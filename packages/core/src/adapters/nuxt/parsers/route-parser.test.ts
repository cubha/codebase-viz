import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parseRoutes } from './route-parser.js'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-viz-nuxt-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeFile(relPath: string, content = '<template><div /></template>'): Promise<void> {
  const absPath = path.join(tmpDir, relPath)
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  await fs.writeFile(absPath, content, 'utf-8')
}

describe('NuxtAdapter parseRoutes', () => {
  it('pages/ 디렉토리 없으면 빈 배열 반환', async () => {
    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toEqual([])
  })

  it('pages/index.vue → path="/"', async () => {
    await writeFile('pages/index.vue')
    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toHaveLength(1)
    const node = nodes[0]
    expect(node).toBeDefined()
    expect(node!.path).toBe('/')
    expect(node!.dynamicSegmentType).toBe('static')
    expect(node!.routeFileKind).toBe('page')
    expect(node!.isGroupRoute).toBe(false)
    expect(node!.renderingMode).toBe('SSR')
    expect(node!.confidence).toBe('verified')
  })

  it('pages/about.vue → path="/about"', async () => {
    await writeFile('pages/about.vue')
    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toHaveLength(1)
    const node = nodes[0]
    expect(node).toBeDefined()
    expect(node!.path).toBe('/about')
    expect(node!.dynamicSegmentType).toBe('static')
  })

  it('pages/users/[id].vue → path="/users/:id", dynamicSegmentType="dynamic"', async () => {
    await writeFile('pages/users/[id].vue')
    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toHaveLength(1)
    const node = nodes[0]
    expect(node).toBeDefined()
    expect(node!.path).toBe('/users/:id')
    expect(node!.dynamicSegmentType).toBe('dynamic')
  })

  it('pages/blog/[...slug].vue → path="/blog/:slug*", dynamicSegmentType="catch-all"', async () => {
    await writeFile('pages/blog/[...slug].vue')
    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toHaveLength(1)
    const node = nodes[0]
    expect(node).toBeDefined()
    expect(node!.path).toBe('/blog/:slug*')
    expect(node!.dynamicSegmentType).toBe('catch-all')
  })

  it('4개 파일 구조: 전체 노드 수 + 각 경로 검증', async () => {
    await writeFile('pages/index.vue')
    await writeFile('pages/about.vue')
    await writeFile('pages/users/[id].vue')
    await writeFile('pages/blog/[...slug].vue')

    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toHaveLength(4)

    const paths = nodes.map(n => n.path).sort()
    expect(paths).toEqual(['/', '/about', '/blog/:slug*', '/users/:id'].sort())

    const catchAll = nodes.find(n => n.dynamicSegmentType === 'catch-all')
    expect(catchAll).toBeDefined()
    expect(catchAll!.path).toBe('/blog/:slug*')

    const dynamic = nodes.find(n => n.dynamicSegmentType === 'dynamic')
    expect(dynamic).toBeDefined()
    expect(dynamic!.path).toBe('/users/:id')
  })

  it('app/pages/ (Nuxt 4+ 호환) 디렉토리 탐지', async () => {
    await writeFile('app/pages/index.vue')
    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.path).toBe('/')
  })

  it('NodeId 결정론적 — 같은 디렉토리 두 파일이 다른 ID', async () => {
    await writeFile('pages/index.vue')
    await writeFile('pages/about.vue')
    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toHaveLength(2)
    const ids = nodes.map(n => n.id)
    expect(new Set(ids).size).toBe(2)
  })

  it('provenance 필드 검증', async () => {
    await writeFile('pages/index.vue')
    const nodes = await parseRoutes(tmpDir, 'codebase-viz@0.1.0')
    const node = nodes[0]
    expect(node).toBeDefined()
    expect(node!.provenance.adapter).toBe('nuxt@0.1')
    expect(node!.provenance.analyzerVersion).toBe('codebase-viz@0.1.0')
    expect(node!.provenance.line).toBe(1)
    expect(node!.provenance.file).toMatch(/pages\/index\.vue$/)
  })

  it('.ts 파일도 스캔', async () => {
    await writeFile('pages/api.ts', 'export default defineEventHandler(() => {})')
    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.path).toBe('/api')
  })

  it('definePageMeta({ ssr: false }) → renderingMode: CSR', async () => {
    await writeFile('pages/client.vue', `
<template><div>Client</div></template>
<script setup lang="ts">
definePageMeta({
  ssr: false,
})
</script>
`)
    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.renderingMode).toBe('CSR')
  })

  it('definePageMeta({ ssr: true }) → renderingMode: SSR', async () => {
    await writeFile('pages/ssr-explicit.vue', `
<template><div>SSR</div></template>
<script setup lang="ts">
definePageMeta({ ssr: true })
</script>
`)
    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.renderingMode).toBe('SSR')
  })

  it('definePageMeta 없으면 renderingMode: SSR (기본값)', async () => {
    await writeFile('pages/default.vue')
    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.renderingMode).toBe('SSR')
  })

  it('.ts 파일은 definePageMeta 파싱 없이 SSR 기본값', async () => {
    await writeFile('pages/api.ts', 'export default defineEventHandler(() => {})')
    const nodes = await parseRoutes(tmpDir)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.renderingMode).toBe('SSR')
  })
})
