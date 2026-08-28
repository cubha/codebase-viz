import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { ANALYZER_VERSION } from '@codebase-viz/types'
import type { DiagramSet } from '@codebase-viz/renderer'

export interface DiagramCache {
  analyzerVersion: string
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

// T4(Wave B): DiagramSet.sequence는 여기서 의도적으로 검사하지 않는다 — 옵셔널 필드라 구캐시가
// 없이도 유효하게 로드돼야 한다(analyzer-version.ts의 ANALYZER_VERSION 비범프 결정과 짝).
function isDiagramCache(value: unknown): value is DiagramCache {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.analyzerVersion === 'string' &&
    typeof v.savedAt === 'number' &&
    typeof v.projectName === 'string' &&
    typeof v.diagrams === 'object' &&
    v.diagrams !== null &&
    // nodeMap 사이드채널(T1 딥링크·T2 hover)이 없는 캐시는 v1.2.61 이전 산출물이다. shape로도
    // 걸러 둔다 — analyzerVersion 범프를 한 번이라도 빠뜨리면 기능이 조용히 죽는 구조였다.
    typeof (v.diagrams as Record<string, unknown>).nodeMap === 'object' &&
    (v.diagrams as Record<string, unknown>).nodeMap !== null &&
    // tab3Kind(webview Tab3 erd/flow 분기 선언, v1.2.63 D0)가 없는 캐시는 v1.2.62 이전 산출물이다.
    // 없는 채로 로드되면 viewer가 flow 산출물을 erDiagram 파서로 재해석해 D0가 재발한다.
    ((v.diagrams as Record<string, unknown>).tab3Kind === 'erd' ||
      (v.diagrams as Record<string, unknown>).tab3Kind === 'flow')
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
      // A3: graph 캐시(analyzer.ts::loadCachedGraph)엔 이미 있던 analyzerVersion 검증이 diagram
      // 캐시엔 없어, 확장 업데이트 후에도 구 pair 결합 다이어그램이 계속 재생되던 결함.
      if (parsed.analyzerVersion !== ANALYZER_VERSION) continue
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
