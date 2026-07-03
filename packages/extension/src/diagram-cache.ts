import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { DiagramSet } from '@codebase-viz/renderer'

export interface DiagramCache {
  savedAt: number
  projectName: string
  routeCount: number
  tableCount: number
  diagrams: DiagramSet
}

// v1.2.57 이전: extension이 analyzer.ts와 같은 파일명(cache.json)을 써서 서로 다른 shape로
// 덮어쓰던 결함(ARCH-1) — analyzer가 저장한 직후 extension이 diagram cache로 overwrite해
// graph 캐시가 analyzerVersion 불일치로 상시 미스됐다. cache-diagrams.json으로 분리한다.
const LEGACY_CACHE_FILE = 'cache.json'

function isDiagramCache(value: unknown): value is DiagramCache {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.savedAt === 'number' &&
    typeof v.projectName === 'string' &&
    typeof v.diagrams === 'object' &&
    v.diagrams !== null
  )
}

function cacheFileName(pairRepoRoot?: string): string {
  if (pairRepoRoot === undefined) return 'cache-diagrams.json'
  const suffix = path.basename(pairRepoRoot).replace(/[^a-z0-9]/gi, '_').toLowerCase()
  return `cache-diagrams-pair-${suffix}.json`
}

export async function readDiagramCache(repoRoot: string, pairRepoRoot?: string): Promise<DiagramCache | undefined> {
  const dir = path.join(repoRoot, '.codebase-viz')
  const candidates = [path.join(dir, cacheFileName(pairRepoRoot))]
  // 구 파일명은 pair 여부를 구분하지 않았으므로 non-pair 케이스에서만 마이그레이션 후보로 조회한다.
  if (pairRepoRoot === undefined) candidates.push(path.join(dir, LEGACY_CACHE_FILE))
  for (const file of candidates) {
    try {
      const raw = await fs.readFile(file, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (!isDiagramCache(parsed)) continue
      return parsed
    } catch {
      continue
    }
  }
  return undefined
}

export async function writeDiagramCache(repoRoot: string, data: DiagramCache, pairRepoRoot?: string): Promise<void> {
  try {
    const dir = path.join(repoRoot, '.codebase-viz')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, cacheFileName(pairRepoRoot)), JSON.stringify(data))
  } catch {
    // best-effort
  }
}
