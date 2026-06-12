import type { IREdge, ComponentNode, RouteNode } from '@codebase-viz/types'
import { sanitizeId, modeClass } from '../helpers/ids.js'
import { RENDERING_INIT, CLASS_DEFS } from '../helpers/constants.js'
import { joinChunks } from '../_shared/wrap-fallback.js'
import {
  type PkgTreeNode,
  buildPkgTree,
  emitTreeNodes,
  chunkByTopLevelPackage,
} from '../be/pkg-tree.js'

// v1.2.50 B-ST2 (RR-3): React Router(config-based) Tab2를 src/pages/<Root 도메인> 파일경로
// 트리로 레이어링한다. BE Tab2가 패키지 트리를 top-level 패키지 chunk로 분리하는 방식과 동일하게,
// 컴포넌트가 위치한 src/pages 하위 도메인 폴더 기준으로 chunk를 분리한다.
// URL 그룹핑은 URL이 폴더 구조와 divergent할 때(평탄한 URL ↔ 깊은 도메인 폴더) 도메인을 드러내지 못한다.
// 표준: docs/design/FE-DIAGRAM-STANDARD.md §RR-Domain.

// 컴포넌트 filePath에서 `pages/` 이후 폴더 segments(파일명 제외)를 추출.
function pagesSegments(filePath: string): string[] {
  const norm = filePath.replace(/\\/g, '/')
  const m = norm.match(/(?:^|\/)pages\/(.+)$/)
  if (m === null) return []
  const segs = (m[1] ?? '').split('/').filter(Boolean)
  if (segs.length > 0) segs.pop() // 파일명 제거
  return segs
}

function pagesDomainOf(filePath: string): string | undefined {
  return pagesSegments(filePath)[0]
}

// 도메인 레이어링 적격: src/pages 하위에 ≥2개 도메인 폴더가 존재하는 깊은 구조일 때만.
// 평탄(src/pages/Home.tsx 직속)하면 도메인 분리 의미가 없으므로 URL 그룹핑으로 fallback.
export function isPagesDomainEligible(componentNodes: ComponentNode[]): boolean {
  const domains = new Set<string>()
  for (const c of componentNodes) {
    const d = pagesDomainOf(c.filePath)
    if (d !== undefined) domains.add(d)
  }
  return domains.size >= 2
}

function fileBaseName(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').pop() ?? filePath
}

function routeDisplay(r: RouteNode): string {
  return r.path.split('/').filter(Boolean).pop() ?? r.path
}

function feHeaderOpen(label: string): string[] {
  return [`  subgraph HDR_PAGES ["📁 ${label}"]`, '    direction TB']
}

interface DomainFile {
  filePath: string
  routes: RouteNode[]
}

export function buildFeDomainLayeredScreenDiagram(
  pageRoutes: RouteNode[],
  rendersEdges: IREdge[],
  componentNodes: ComponentNode[],
): string {
  const compById = new Map(componentNodes.map(c => [c.id, c]))
  // route → 렌더 컴포넌트 filePath. 컴포넌트 미해결 시 라우트 자체 filePath로 fallback.
  const fileRoutes: Array<{ filePath: string; segments: string[]; routes: RouteNode[] }> = []
  const byFile = new Map<string, DomainFile>()
  for (const r of pageRoutes) {
    const edge = rendersEdges.find(e => e.from === r.id)
    const comp = edge !== undefined ? compById.get(edge.to) : undefined
    const filePath = comp?.filePath ?? r.filePath
    const existing = byFile.get(filePath)
    if (existing !== undefined) existing.routes.push(r)
    else byFile.set(filePath, { filePath, routes: [r] })
  }
  for (const { filePath, routes } of byFile.values()) {
    fileRoutes.push({ filePath, segments: pagesSegments(filePath), routes })
  }

  const tree = buildPkgTree(fileRoutes)
  const chunks = chunkByTopLevelPackage(tree)

  const emitChunk = (topSeg: string, subtree: PkgTreeNode): string[] => {
    const headerLabel = topSeg === '_root' ? 'src/pages' : `src/pages/${topSeg}`
    const chunkPath = topSeg === '_root' ? [] : [topSeg]
    const lines: string[] = [RENDERING_INIT, 'graph TD', CLASS_DEFS]
    lines.push(...feHeaderOpen(headerLabel))
    const treeEmit = emitTreeNodes(subtree, 'HDR_PAGES', chunkPath, { clusterRoot: true })
    lines.push(...treeEmit.lines)

    const walkFiles = (node: PkgTreeNode, parentId: string, pathSegs: string[], depth: number): void => {
      for (const [seg, child] of node.children) {
        const segs = [...pathSegs, seg]
        const pkgId = treeEmit.nodeIdByPath.get(segs.join('.')) ?? parentId
        walkFiles(child, pkgId, segs, depth + 1)
      }
      for (const f of node.files) {
        const base = fileBaseName(f.filePath)
        const hasFile = /\.[jt]sx?$/.test(base)
        for (const r of f.routes) {
          const leafId = `pageleaf_${sanitizeId(r.id)}`
          const badge = r.renderingMode === 'unknown' ? '?' : r.renderingMode
          const label = hasFile
            ? `${routeDisplay(r)} · ${badge}<br/>📄 ${base}`
            : `${routeDisplay(r)} · ${badge}`
          lines.push(`  ${leafId}["${label}"]:::${modeClass(r.renderingMode)}`)
          // depth 0(도메인 직속 파일)은 HDR_PAGES cluster 안에 노드만 두고 edge 생략(BE clusterRoot 동일).
          if (depth !== 0) lines.push(`  ${parentId} --> ${leafId}`)
        }
      }
    }
    walkFiles(subtree, 'HDR_PAGES', chunkPath, 0)
    lines.push('  end')
    return lines
  }

  if (chunks.length === 0) return 'graph TD\n  empty["(no screen/component data)"]'
  if (chunks.length === 1) {
    const c = chunks[0]!
    return emitChunk(c.topSeg, c.subtree).join('\n')
  }
  return joinChunks(chunks.map(c => emitChunk(c.topSeg, c.subtree).join('\n')))
}
