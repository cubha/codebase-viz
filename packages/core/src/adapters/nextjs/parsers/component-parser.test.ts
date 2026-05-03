import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { parseComponents } from './component-parser.js'

let tmpDir: string

beforeEach(async () => {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-s4-'))
  tmpDir = await fs.realpath(raw)
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('parseComponents', () => {
  it('"use client" → runtime: client, confidence: verified', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'Button.tsx'),
      `'use client'\nexport default function Button() { return <button/> }`,
    )

    const { nodes } = await parseComponents(tmpDir)

    expect(nodes).toHaveLength(1)
    const node = nodes[0]!
    expect(node.runtime).toBe('client')
    expect(node.confidence).toBe('verified')
    expect(node.name).toBe('Button')
  })

  it('no "use client" → runtime: server, confidence: inferred', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'Header.tsx'),
      `export default function Header() { return <header/> }`,
    )

    const { nodes } = await parseComponents(tmpDir)

    expect(nodes).toHaveLength(1)
    const node = nodes[0]!
    expect(node.runtime).toBe('server')
    expect(node.confidence).toBe('inferred')
    if (node.confidence === 'inferred') {
      expect(node.inferenceChain).toContain('no "use client" directive found')
    }
  })

  it('default export → filename stem as name', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'MyCard.tsx'),
      `export default function MyCard() { return <div/> }`,
    )

    const { nodes } = await parseComponents(tmpDir)

    expect(nodes[0]?.name).toBe('MyCard')
  })

  it('relative .tsx import → IREdge with kind: imports', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'Child.tsx'),
      `export default function Child() { return <span/> }`,
    )
    await fs.writeFile(
      path.join(tmpDir, 'Parent.tsx'),
      `import Child from './Child.js'\nexport default function Parent() { return <Child/> }`,
    )

    const { nodes, edges } = await parseComponents(tmpDir)

    expect(nodes).toHaveLength(2)
    expect(edges).toHaveLength(1)
    const edge = edges[0]!
    expect(edge.kind).toBe('imports')
    expect(edge.importDepth).toBe(1)
    expect(edge.confidence).toBe('verified')
  })

  it('node_modules import → no IREdge created', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'App.tsx'),
      `import React from 'react'\nexport default function App() { return <div/> }`,
    )

    const { edges } = await parseComponents(tmpDir)

    expect(edges).toHaveLength(0)
  })

  it('@/ alias import → tsconfig paths 읽어서 IREdge 생성', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { paths: { '@/*': ['./*'] } } }),
    )
    await fs.mkdir(path.join(tmpDir, 'components'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'components', 'Header.tsx'),
      `export default function Header() { return <header/> }`,
    )
    await fs.writeFile(
      path.join(tmpDir, 'Page.tsx'),
      `import Header from '@/components/Header'\nexport default function Page() { return <Header/> }`,
    )

    const { nodes, edges } = await parseComponents(tmpDir)

    expect(nodes).toHaveLength(2)
    expect(edges).toHaveLength(1)
    const edge = edges[0]!
    expect(edge.kind).toBe('imports')
    expect(edge.confidence).toBe('verified')
  })

  it('tsconfig.json 없으면 @/ alias 무시 → edge 없음', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'Button.tsx'),
      `export default function Button() { return <button/> }`,
    )
    await fs.writeFile(
      path.join(tmpDir, 'Page.tsx'),
      `import Button from '@/Button'\nexport default function Page() { return <Button/> }`,
    )

    const { edges } = await parseComponents(tmpDir)

    expect(edges).toHaveLength(0)
  })
})
