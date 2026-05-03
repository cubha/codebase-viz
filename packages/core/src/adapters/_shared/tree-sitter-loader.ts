import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import Parser from 'web-tree-sitter'

let wasmDir: string | undefined
let initialized = false
let pythonLanguage: Parser.Language | undefined
let javaLanguage: Parser.Language | undefined

// Allows the extension (CJS bundle) to override WASM directory at startup.
export function setWasmDir(dir: string): void {
  wasmDir = dir
  initialized = false
  pythonLanguage = undefined
  javaLanguage = undefined
}

function resolveWasmDir(): string {
  if (wasmDir !== undefined) return wasmDir
  // import.meta.url is valid in ESM (vitest). In CJS bundles it may be empty.
  // The extension always calls setWasmDir() before using tree-sitter.
  const metaUrl: string = import.meta.url ?? ''
  if (metaUrl === '') throw new Error('Call setWasmDir() before using tree-sitter in CJS bundles')
  // From packages/core/src/adapters/_shared/, 3 levels up = packages/core/
  const here = path.dirname(fileURLToPath(metaUrl))
  return path.resolve(here, '..', '..', '..', 'wasm')
}

async function ensureInit(): Promise<void> {
  if (initialized) return
  const dir = resolveWasmDir()
  await Parser.init({
    locateFile: (file: string) => path.join(dir, file),
  })
  initialized = true
}

export async function getPythonLanguage(): Promise<Parser.Language> {
  if (pythonLanguage !== undefined) return pythonLanguage
  await ensureInit()
  pythonLanguage = await Parser.Language.load(path.join(resolveWasmDir(), 'tree-sitter-python.wasm'))
  return pythonLanguage
}

export async function getJavaLanguage(): Promise<Parser.Language> {
  if (javaLanguage !== undefined) return javaLanguage
  await ensureInit()
  javaLanguage = await Parser.Language.load(path.join(resolveWasmDir(), 'tree-sitter-java.wasm'))
  return javaLanguage
}

export async function createPythonParser(): Promise<Parser> {
  const lang = await getPythonLanguage()
  const parser = new Parser()
  parser.setLanguage(lang)
  return parser
}

export async function createJavaParser(): Promise<Parser> {
  const lang = await getJavaLanguage()
  const parser = new Parser()
  parser.setLanguage(lang)
  return parser
}
