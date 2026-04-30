import { describe, it, expect, afterEach } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { renderMermaid } from './mermaid-renderer.js'
import { createIRGraph } from '@codebase-viz/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = path.join(__dirname, '../../../../.tmp-renderer-test')

afterEach(async () => {
  await fs.rm(OUTPUT_DIR, { recursive: true, force: true })
})

describe('renderMermaid', () => {
  it('빈 IRGraph로 3개 .md 파일을 생성한다', async () => {
    const graph = createIRGraph({
      analyzerVersion: 'codebase-viz@0.1.0',
      repoRoot: '/tmp/test',
      nodes: [],
      edges: [],
    })

    await renderMermaid(graph, OUTPUT_DIR)

    const files = await fs.readdir(OUTPUT_DIR)
    expect(files).toContain('rendering.md')
    expect(files).toContain('screen-component.md')
    expect(files).toContain('db-screen.md')
  })

  it('각 .md 파일은 mermaid 코드블록을 포함한다', async () => {
    const graph = createIRGraph({
      analyzerVersion: 'codebase-viz@0.1.0',
      repoRoot: '/tmp/test',
      nodes: [],
      edges: [],
    })

    await renderMermaid(graph, OUTPUT_DIR)

    for (const file of ['rendering.md', 'screen-component.md', 'db-screen.md']) {
      const content = await fs.readFile(path.join(OUTPUT_DIR, file), 'utf8')
      expect(content).toContain('```mermaid')
    }
  })

  it('rendering.md는 graph TD 다이어그램을 포함한다', async () => {
    const graph = createIRGraph({
      analyzerVersion: 'codebase-viz@0.1.0',
      repoRoot: '/tmp/test',
      nodes: [],
      edges: [],
    })

    await renderMermaid(graph, OUTPUT_DIR)
    const content = await fs.readFile(path.join(OUTPUT_DIR, 'rendering.md'), 'utf8')
    expect(content).toContain('graph TD')
  })

  it('screen-component.md는 graph LR 다이어그램을 포함한다', async () => {
    const graph = createIRGraph({
      analyzerVersion: 'codebase-viz@0.1.0',
      repoRoot: '/tmp/test',
      nodes: [],
      edges: [],
    })

    await renderMermaid(graph, OUTPUT_DIR)
    const content = await fs.readFile(path.join(OUTPUT_DIR, 'screen-component.md'), 'utf8')
    expect(content).toContain('graph LR')
  })

  it('db-screen.md는 erDiagram을 포함한다', async () => {
    const graph = createIRGraph({
      analyzerVersion: 'codebase-viz@0.1.0',
      repoRoot: '/tmp/test',
      nodes: [],
      edges: [],
    })

    await renderMermaid(graph, OUTPUT_DIR)
    const content = await fs.readFile(path.join(OUTPUT_DIR, 'db-screen.md'), 'utf8')
    expect(content).toContain('erDiagram')
  })
})
