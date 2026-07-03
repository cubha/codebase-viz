import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const sidebarSrc = fs.readFileSync(path.join(__dirname, 'sidebarProvider.ts'), 'utf8')
const panelSrc = fs.readFileSync(path.join(__dirname, 'panelProvider.ts'), 'utf8')

describe('sidebarProvider/panelProvider CSP (ST3)', () => {
  it.each([
    ['sidebarProvider.ts', sidebarSrc],
    ['panelProvider.ts', panelSrc],
  ])('%s — inline onclick/onchange 속성이 없다', (_name, src) => {
    expect(src).not.toMatch(/onclick=/)
    expect(src).not.toMatch(/onchange=/)
  })

  it.each([
    ['sidebarProvider.ts', sidebarSrc],
    ['panelProvider.ts', panelSrc],
  ])('%s — CSP script-src가 nonce 기반이며 unsafe-inline을 포함하지 않는다', (_name, src) => {
    const meta = src.match(/Content-Security-Policy[\s\S]*?script-src[^;]*;/)
    expect(meta, 'CSP script-src 지시문을 찾을 수 없음').not.toBeNull()
    expect(meta?.[0]).toMatch(/'nonce-\$\{nonce\}'/)
    expect(meta?.[0]).not.toMatch(/unsafe-inline/)
  })

  it.each([
    ['sidebarProvider.ts', sidebarSrc],
    ['panelProvider.ts', panelSrc],
  ])('%s — 모든 <script> 태그가 렌더 시 nonce 속성을 받는다', (_name, src) => {
    expect(src).toMatch(/\.replace\(\/<script>\/g, `<script nonce="\$\{nonce\}">`\)/)
  })
})
