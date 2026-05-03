import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { parseNuxtComponents } from './component-parser.js'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-nuxt-comp-test-'))
  await fs.mkdir(path.join(tmpDir, 'components'), { recursive: true })
  await fs.mkdir(path.join(tmpDir, 'pages'), { recursive: true })

  await fs.writeFile(
    path.join(tmpDir, 'components', 'UserCard.vue'),
    `<template><div>{{ name }}</div></template>
<script setup lang="ts">
defineProps<{ name: string }>()
</script>`,
  )

  await fs.writeFile(
    path.join(tmpDir, 'pages', 'index.vue'),
    `<template><UserCard name="Alice" /></template>
<script setup lang="ts">
import UserCard from '~/components/UserCard.vue'
</script>`,
  )
})

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('parseNuxtComponents', () => {
  it('.vue 파일을 ComponentNode로 추출한다', async () => {
    const result = await parseNuxtComponents(tmpDir, 'test@0.1')
    expect(result.nodes.length).toBeGreaterThanOrEqual(2)
  })

  it('~/components 임포트 → componentEdge 생성', async () => {
    const result = await parseNuxtComponents(tmpDir, 'test@0.1')
    expect(result.edges.length).toBeGreaterThanOrEqual(1)
    const edge = result.edges[0]!
    expect(edge.kind).toBe('imports')
  })

  it('.vue 파일 없으면 빈 결과 반환', async () => {
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-empty-'))
    const result = await parseNuxtComponents(emptyDir, 'test@0.1')
    expect(result.nodes).toHaveLength(0)
    expect(result.edges).toHaveLength(0)
    await fs.rm(emptyDir, { recursive: true, force: true })
  })
})
