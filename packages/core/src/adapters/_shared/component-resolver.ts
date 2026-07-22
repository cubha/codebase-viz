import * as path from 'node:path'
import { SyntaxKind, type SourceFile, type Project } from 'ts-morph'
import { resolveModuleSpecWithPaths, type PathsMap } from './ts-config-loader.js'

const EXTS = ['.tsx', '.ts', '.jsx', '.js']
// importedAbsBase가 디렉토리인 경우(barrel: '@/pages' → src/pages/index.{ext})
const INDEX_SUFFIXES = ['/index.tsx', '/index.ts', '/index.jsx', '/index.js']
const MAX_DEPTH = 2

export type ResolverHops = 'direct' | 'barrel' | 'lazy' | 'alias-chain'

export interface ComponentResolveResult {
  absBase: string
  hops: ResolverHops
  inferenceChain?: string[]
}

export interface ResolveContext {
  project: Project
  repoRoot: string
  paths: PathsMap
}

// 식별자(componentName)를 sourceFile 내에서 시작하여 정의 파일의 절대경로(확장자 미포함)로 추적.
// (a) ImportDeclaration default/named + alias rename, (b) tsconfig paths alias resolve,
// (c) barrel 1-hop (export {X} from './Y'), (d) lazy(() => import('...')) / 단일 Identifier alias-chain.
// depth ≥ 2 또는 cycle → undefined.
export function resolveComponentToAbsBase(
  componentName: string,
  sf: SourceFile,
  ctx: ResolveContext,
  depth = 0,
  visited: Set<string> = new Set(),
): ComponentResolveResult | undefined {
  if (depth >= MAX_DEPTH) return undefined
  const visitKey = `${sf.getFilePath()}::${componentName}`
  if (visited.has(visitKey)) return undefined
  visited.add(visitKey)

  const sfDir = path.dirname(sf.getFilePath())

  for (const decl of sf.getImportDeclarations()) {
    const spec = decl.getModuleSpecifierValue()
    const di = decl.getDefaultImport()
    if (di !== undefined && di.getText() === componentName) {
      const resolved = resolveSpecToBase(spec, sfDir, ctx.paths)
      if (resolved !== undefined) return { absBase: resolved, hops: 'direct' }
      return undefined
    }
    for (const ni of decl.getNamedImports()) {
      const localName = ni.getAliasNode()?.getText() ?? ni.getName()
      if (localName !== componentName) continue
      const originalName = ni.getName()
      const resolvedBase = resolveSpecToBase(spec, sfDir, ctx.paths)
      if (resolvedBase === undefined) return undefined
      const barrel = tryBarrelReExport(originalName, resolvedBase, ctx, depth + 1, visited)
      if (barrel !== undefined) return barrel
      return { absBase: resolvedBase, hops: 'direct' }
    }
  }

  for (const varDecl of sf.getVariableDeclarations()) {
    if (varDecl.getName() !== componentName) continue
    const init = varDecl.getInitializer()
    if (init === undefined) continue
    if (init.isKind(SyntaxKind.CallExpression)) {
      const m = init.getText().match(/import\(['"`]([^'"`]+)['"`]\)/)
      if (m !== null) {
        const importSpec = m[1]!
        const resolved = resolveSpecToBase(importSpec, sfDir, ctx.paths)
        if (resolved !== undefined) {
          return {
            absBase: resolved,
            hops: 'lazy',
            inferenceChain: [`${componentName} = lazy(() => import('${importSpec}'))`],
          }
        }
      }
    }
    if (init.isKind(SyntaxKind.Identifier)) {
      const target = init.getText()
      const next = resolveComponentToAbsBase(target, sf, ctx, depth + 1, visited)
      if (next !== undefined) {
        return {
          absBase: next.absBase,
          hops: 'alias-chain',
          inferenceChain: [`${componentName} → ${target} (alias chain)`, ...(next.inferenceChain ?? [])],
        }
      }
    }
  }

  return undefined
}

function resolveSpecToBase(spec: string, fromFileDir: string, paths: PathsMap): string | undefined {
  return resolveModuleSpecWithPaths(spec, fromFileDir, paths)
}

function tryBarrelReExport(
  originalName: string,
  importedAbsBase: string,
  ctx: ResolveContext,
  depth: number,
  _visited: Set<string>,
): ComponentResolveResult | undefined {
  if (depth >= MAX_DEPTH) return undefined
  let barrelSf: SourceFile | undefined
  let barrelAbsPath: string | undefined
  const candidates: string[] = [
    ...EXTS.map(e => importedAbsBase + e),
    ...INDEX_SUFFIXES.map(s => importedAbsBase + s),
  ]
  for (const candidate of candidates) {
    barrelSf = ctx.project.getSourceFile(candidate)
    if (barrelSf === undefined) {
      try { barrelSf = ctx.project.addSourceFileAtPath(candidate) } catch { continue }
    }
    if (barrelSf !== undefined) { barrelAbsPath = candidate; break }
  }
  if (barrelSf === undefined || barrelAbsPath === undefined) return undefined
  const barrelDir = path.dirname(barrelAbsPath)

  for (const ed of barrelSf.getExportDeclarations()) {
    const spec = ed.getModuleSpecifierValue()
    if (spec === undefined) continue
    for (const ne of ed.getNamedExports()) {
      const exportedName = ne.getAliasNode()?.getText() ?? ne.getName()
      if (exportedName !== originalName) continue
      const targetAbs = resolveModuleSpecWithPaths(spec, barrelDir, ctx.paths)
      if (targetAbs === undefined) continue
      return {
        absBase: targetAbs,
        hops: 'barrel',
        inferenceChain: [`barrel re-export: '${spec}' 에서 ${originalName} 추적`],
      }
    }
  }
  return undefined
}

// componentName이 sf 내 inline arrow/function decl이면 sf 자체를 absBase로 반환 (파일 단위 collapse).
// 외부 hop 추적 실패 시 호출자 폴백용. .ts/.tsx 확장자 제거된 절대경로 반환.
export function resolveInlineDefinitionFallback(
  componentName: string,
  sf: SourceFile,
): ComponentResolveResult | undefined {
  for (const varDecl of sf.getVariableDeclarations()) {
    if (varDecl.getName() !== componentName) continue
    const init = varDecl.getInitializer()
    if (init === undefined) continue
    if (
      init.isKind(SyntaxKind.ArrowFunction) ||
      init.isKind(SyntaxKind.FunctionExpression)
    ) {
      const filePath = sf.getFilePath()
      const ext = path.extname(filePath)
      return { absBase: filePath.slice(0, filePath.length - ext.length), hops: 'direct' }
    }
  }
  for (const fn of sf.getFunctions()) {
    if (fn.getName() === componentName) {
      const filePath = sf.getFilePath()
      const ext = path.extname(filePath)
      return { absBase: filePath.slice(0, filePath.length - ext.length), hops: 'direct' }
    }
  }
  return undefined
}
