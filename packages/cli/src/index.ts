import * as path from 'node:path'
import * as process from 'node:process'
import { pathToFileURL } from 'node:url'
import { buildIRGraph, type LLMOptions } from '@codebase-viz/core'
import { renderMermaid } from '@codebase-viz/renderer'

export async function analyze(
  repoRoot: string,
  outputDir: string,
  llmOptions?: LLMOptions,
): Promise<void> {
  const graph = await buildIRGraph(repoRoot, llmOptions)
  await renderMermaid(graph, outputDir)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const subcommand = args[0]

  if (subcommand !== 'analyze') {
    console.error('Usage: codebase-viz analyze <path> [--output <dir>] [--with-llm] [--api-key <key>] [--model <model>]')
    process.exit(1)
  }

  const targetPath = args[1]
  if (targetPath === undefined || targetPath === '') {
    console.error('Error: <path> is required')
    process.exit(1)
  }

  const outputFlagIndex = args.indexOf('--output')
  const outputArg = outputFlagIndex !== -1 ? args[outputFlagIndex + 1] : undefined

  const withLLM = args.includes('--with-llm')
  const apiKeyFlagIndex = args.indexOf('--api-key')
  const apiKeyArg = apiKeyFlagIndex !== -1 ? args[apiKeyFlagIndex + 1] : undefined
  // CODESIGHT_API_KEY: v1.2.58 이전 브랜드명 잔재, 기존 사용자 스크립트 하위호환 위해 유지.
  const apiKey = apiKeyArg ?? process.env['CODEBASE_VIZ_API_KEY'] ?? process.env['CODESIGHT_API_KEY']

  const modelFlagIndex = args.indexOf('--model')
  const model = modelFlagIndex !== -1 ? args[modelFlagIndex + 1] : undefined

  const repoRoot = path.resolve(targetPath)
  const outputDir =
    outputArg !== undefined && outputArg !== ''
      ? path.resolve(outputArg)
      : path.join(repoRoot, '.codebase-viz')

  if (withLLM && (apiKey === undefined || apiKey === '')) {
    console.error('Error: --with-llm requires --api-key <key> or CODEBASE_VIZ_API_KEY env var')
    process.exit(1)
  }

  const llmOptions = withLLM && apiKey !== undefined
    ? { apiKey, ...(model !== undefined ? { model } : {}) }
    : undefined

  console.log(`Analyzing: ${repoRoot}`)
  if (llmOptions !== undefined) console.log('  LLM analysis: enabled')
  await analyze(repoRoot, outputDir, llmOptions)
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
