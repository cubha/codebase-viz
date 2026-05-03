import { build } from 'esbuild'
import * as fs from 'node:fs'
import * as path from 'node:path'

await build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  external: ['vscode'],
  sourcemap: true,
  minify: false,
})

// Copy WASM files to dist/wasm/ for tree-sitter adapters.
const coreWasmDir = path.resolve('..', 'core', 'wasm')
const outWasmDir = path.resolve('dist', 'wasm')
fs.mkdirSync(outWasmDir, { recursive: true })
for (const f of fs.readdirSync(coreWasmDir)) {
  if (f.endsWith('.wasm')) {
    fs.copyFileSync(path.join(coreWasmDir, f), path.join(outWasmDir, f))
  }
}
