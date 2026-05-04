import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { parseSvelteComponents } from './component-parser.js'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-svelte-comp-test-'))
  await fs.mkdir(path.join(tmpDir, 'src', 'lib'), { recursive: true })
  await fs.mkdir(path.join(tmpDir, 'src', 'routes'), { recursive: true })

  await fs.writeFile(
    path.join(tmpDir, 'src', 'lib', 'UserCard.svelte'),
    `<script lang="ts">
  export let name: string
</script>
<div>{name}</div>`,
  )

  await fs.writeFile(
    path.join(tmpDir, 'src', 'routes', '+page.svelte'),
    `<script lang="ts">
  import UserCard from '$lib/UserCard.svelte'
</script>
<UserCard name="Alice" />`,
  )
})

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('parseSvelteComponents', () => {
  it('.svelte 파일을 ComponentNode로 추출한다', async () => {
    const result = await parseSvelteComponents(tmpDir, 'test@0.1')
    expect(result.nodes.length).toBeGreaterThanOrEqual(2)
  })

  it('$lib 임포트 → componentEdge 생성', async () => {
    const result = await parseSvelteComponents(tmpDir, 'test@0.1')
    expect(result.edges.length).toBeGreaterThanOrEqual(1)
  })

  it('.svelte 파일 없으면 빈 결과 반환', async () => {
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-empty-'))
    const result = await parseSvelteComponents(emptyDir, 'test@0.1')
    expect(result.nodes).toHaveLength(0)
    await fs.rm(emptyDir, { recursive: true, force: true })
  })
})

describe('runtime 판정', () => {
  it('+page.svelte 단독 → runtime: client', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-rt-client-'))
    await fs.mkdir(path.join(dir, 'src', 'routes'), { recursive: true })

    await fs.writeFile(
      path.join(dir, 'src', 'routes', '+page.svelte'),
      `<script lang="ts">
  const x = 1
</script>`,
    )

    const result = await parseSvelteComponents(dir, 'test@0.1')
    const pageNode = result.nodes.find(n => n.name === '+page')
    expect(pageNode).toBeDefined()
    expect(pageNode?.runtime).toBe('client')

    await fs.rm(dir, { recursive: true, force: true })
  })

  it('+page.svelte + +page.server.ts → runtime: shared', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-rt-shared-'))
    await fs.mkdir(path.join(dir, 'src', 'routes'), { recursive: true })

    await fs.writeFile(
      path.join(dir, 'src', 'routes', '+page.svelte'),
      `<script lang="ts">
  export let data: { message: string }
</script>`,
    )
    await fs.writeFile(
      path.join(dir, 'src', 'routes', '+page.server.ts'),
      `export async function load() { return { message: 'hello' } }`,
    )

    const result = await parseSvelteComponents(dir, 'test@0.1')
    const pageNode = result.nodes.find(n => n.name === '+page')
    expect(pageNode).toBeDefined()
    expect(pageNode?.runtime).toBe('shared')

    await fs.rm(dir, { recursive: true, force: true })
  })

  it('+page.server.ts 단독 → runtime: server', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-rt-server-'))
    await fs.mkdir(path.join(dir, 'src', 'routes'), { recursive: true })

    await fs.writeFile(
      path.join(dir, 'src', 'routes', '+page.server.ts'),
      `export async function load() { return {} }`,
    )

    const result = await parseSvelteComponents(dir, 'test@0.1')
    const serverNode = result.nodes.find(n => n.name === '+page')
    expect(serverNode).toBeDefined()
    expect(serverNode?.runtime).toBe('server')

    await fs.rm(dir, { recursive: true, force: true })
  })
})
