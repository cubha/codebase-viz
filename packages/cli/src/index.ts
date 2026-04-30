import * as path from 'node:path'
import * as process from 'node:process'
import { pathToFileURL } from 'node:url'
import { parseRoutes, parseComponents, parseTables, mapScreenToTable } from '@codebase-viz/core'
import { renderMermaid } from '@codebase-viz/renderer'
import { createIRGraph } from '@codebase-viz/types'

export async function analyze(repoRoot: string, outputDir: string): Promise<void> {
  const [routeNodes, { nodes: componentNodes, edges: componentEdges }, tableNodes] =
    await Promise.all([
      parseRoutes(repoRoot),
      parseComponents(repoRoot),
      parseTables(repoRoot),
    ])

  const graph = createIRGraph({
    analyzerVersion: 'codebase-viz@0.1.0',
    repoRoot,
    projectName: path.basename(repoRoot),
    nodes: [...routeNodes, ...componentNodes, ...tableNodes],
    edges: componentEdges,
  })

  const mapperEdges = await mapScreenToTable(graph)
  const finalGraph = { ...graph, edges: [...graph.edges, ...mapperEdges] }

  await renderMermaid(finalGraph, outputDir)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const subcommand = args[0]

  if (subcommand !== 'analyze') {
    console.error('Usage: codebase-viz analyze <path> [--output <dir>]')
    process.exit(1)
  }

  const targetPath = args[1]
  if (targetPath === undefined || targetPath === '') {
    console.error('Error: <path> is required')
    process.exit(1)
  }

  const outputFlagIndex = args.indexOf('--output')
  const outputArg = outputFlagIndex !== -1 ? args[outputFlagIndex + 1] : undefined

  const repoRoot = path.resolve(targetPath)
  const outputDir =
    outputArg !== undefined && outputArg !== ''
      ? path.resolve(outputArg)
      : path.join(repoRoot, '.codebase-viz')

  console.log(`Analyzing: ${repoRoot}`)
  await analyze(repoRoot, outputDir)
  console.log(`Output written to: ${outputDir}`)
  console.log('  rendering.md')
  console.log('  screen-component.md')
  console.log('  db-screen.md')
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  main().catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
}
