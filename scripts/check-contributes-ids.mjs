#!/usr/bin/env node
// package.json contributes(commands/views/configuration) ID가 src에서 실사용되는지 검사한다.
// v1.2.56 교훈: verify.sh(tsc+vitest)는 명령/뷰/설정 ID 문자열 drift를 못 잡는다 — 이 스크립트가 그 갭을 메운다.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const extRoot = path.join(root, 'packages', 'extension')
const pkg = JSON.parse(fs.readFileSync(path.join(extRoot, 'package.json'), 'utf8'))

function walkTsFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkTsFiles(full))
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full)
  }
  return out
}

const srcFiles = walkTsFiles(path.join(extRoot, 'src'))
const srcText = srcFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n')

const errors = []

const declaredCommands = (pkg.contributes?.commands ?? []).map(c => c.command)
for (const id of declaredCommands) {
  if (!srcText.includes(`'${id}'`)) errors.push(`command 미사용(소스 참조 없음): ${id}`)
}

const declaredViewIds = Object.values(pkg.contributes?.views ?? {}).flat().map(v => v.id)
for (const id of declaredViewIds) {
  if (!srcText.includes(`'${id}'`)) errors.push(`view ID 미사용: ${id}`)
}

const containerIds = new Set([
  ...(pkg.contributes?.viewsContainers?.activitybar ?? []).map(c => c.id),
  ...(pkg.contributes?.viewsContainers?.panel ?? []).map(c => c.id),
])
for (const key of Object.keys(pkg.contributes?.views ?? {})) {
  if (!containerIds.has(key)) errors.push(`views 매핑 키가 viewsContainers에 없음: ${key}`)
}

// configuration: getConfiguration('NS') 네임스페이스 집합 × .get/.update('KEY') 키 집합의
// 교차조합으로 선언된 dotted ID(NS.KEY)가 실사용되는지 판정한다(변수 경유 체이닝도 포용하는
// best-effort 매칭 — 완전한 AST 정밀도는 아니지만 rename/제거로 인한 ID drift는 잡는다).
const configIds = Object.keys(pkg.contributes?.configuration?.properties ?? {})
const namespaces = new Set()
const nsRe = /getConfiguration\(\s*['"]([^'"]+)['"]\s*\)/g
let m
while ((m = nsRe.exec(srcText)) !== null) namespaces.add(m[1])

const keys = new Set()
const keyRe = /\.(?:get|update)(?:<[^>]*>)?\(\s*['"]([^'"]+)['"]/g
while ((m = keyRe.exec(srcText)) !== null) keys.add(m[1])

for (const id of configIds) {
  const matched = [...namespaces].some(
    ns => id === ns || (id.startsWith(ns + '.') && keys.has(id.slice(ns.length + 1))),
  )
  if (!matched) errors.push(`configuration 키 미사용(추정): ${id}`)
}

if (errors.length > 0) {
  console.error('❌ contributes ID 매칭 실패:')
  for (const e of errors) console.error('  - ' + e)
  process.exit(1)
}
console.log(
  `✅ contributes ID 매칭 PASS (commands ${declaredCommands.length}, views ${declaredViewIds.length}, config ${configIds.length})`,
)
