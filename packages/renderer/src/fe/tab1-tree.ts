import type { NestedGroup } from '../url-grouper.js'
import { sanitizeId } from '../helpers/ids.js'
import { nodeMapMarker, pickRepresentativeRoute } from '../helpers/node-map.js'
import { collectNestedRoutes } from '../helpers/layout.js'

// FE 표준 v1.2.55 (R-T1.2 re-amendment, §9): Tab1은 단일 아키텍처 래퍼 안에 URL 도메인 트리를
// root→대→중→소 full-depth 폴더 subgraph로 중첩한다. 각 폴더 헤더는 하위 route 재귀 합 배지를
// 표시하고, 최하위 route 세그먼트(leaf-folder)는 개별 route 노드로 펼치지 않고 카운트로 collapse한다.
// 개별 route URL 전수 열거는 Tab2의 역할(2 탭 차별성). 누락 0은 top-level 도메인 전수 출력 +
// 재귀 카운트로 보장한다. v1.2.53 flat 요약 박스(하위 세분화 Tab2 위임)를 폴더 구조 보존으로 반전.

function folderName(groupKey: string): string {
  const segs = groupKey.split('/').filter(Boolean)
  return segs.length > 0 ? segs[segs.length - 1]! : 'root'
}

function folderId(groupKey: string): string {
  const segs = groupKey.split('/').filter(Boolean)
  return 'T1_' + (segs.length > 0 ? sanitizeId(segs.join('_')) : 'root')
}

function badgeLabel(g: NestedGroup): string {
  const n = collectNestedRoutes([g]).length
  const unit = n === 1 ? 'route' : 'routes'
  const nm = folderName(g.groupKey)
  const disp = nm === 'root' ? '/' : '/' + nm
  return `📁 ${disp} · ${n} ${unit}`
}

function routeCount(g: NestedGroup): number {
  return collectNestedRoutes([g]).length
}

function pushWithMarker(lines: string[], indent: string, declId: string, groups: NestedGroup[], decl: string): void {
  const rep = pickRepresentativeRoute(collectNestedRoutes(groups))
  if (rep !== undefined) lines.push(nodeMapMarker(indent, declId, rep.id))
  lines.push(decl)
}

// 자식이 전부 단일 라우트(재귀합 1)면 펼칠 구조적 분기가 없으므로 부모 카운트 박스 하나로 collapse한다.
// 이로써 deepest 단일-라우트 폴더가 형제마다 개별 박스로 반복되는 현상(v1.2.55 사용자 보고)을 제거한다.
// 다중 라우트(≥2)로 갈라지는 자식이 하나라도 있으면 그 분기는 구조로 보존해야 하므로 subgraph로 중첩.
function isCollapsed(g: NestedGroup): boolean {
  if (g.children.length === 0) return true
  return g.children.every((c) => routeCount(c) < 2)
}

// 혼합 폴더 안에서 단일 라우트 자식 ≥2개를 하나로 묶는 집계 박스 라벨. 이름은 최대 3개 노출 + `+N`.
const AGG_NAME_CAP = 3

function aggregateLabel(singles: NestedGroup[]): string {
  const names = singles.map((s) => folderName(s.groupKey))
  const shown = names.slice(0, AGG_NAME_CAP)
  const more = names.length > shown.length ? ` +${names.length - shown.length}` : ''
  return `📄 ${shown.join(' · ')}${more} (${singles.length} pages)`
}

function emitFolder(g: NestedGroup, indent: string, lines: string[]): void {
  if (isCollapsed(g)) {
    pushWithMarker(lines, indent, folderId(g.groupKey), [g], `${indent}${folderId(g.groupKey)}["${badgeLabel(g)}"]:::pkg`)
    return
  }
  // 혼합/구조적 폴더 → subgraph. 다중 자식은 구조로 재귀, 단일 자식은 1개면 이름 박스·2개+면 집계 박스.
  lines.push(`${indent}subgraph ${folderId(g.groupKey)}_G["${badgeLabel(g)}"]`)
  const inner = indent + '  '
  const multi = g.children.filter((c) => routeCount(c) >= 2)
  const singles = g.children.filter((c) => routeCount(c) < 2)
  for (const m of multi) emitFolder(m, inner, lines)
  if (singles.length === 1) {
    emitFolder(singles[0]!, inner, lines)
  } else if (singles.length >= 2) {
    pushWithMarker(lines, inner, `${folderId(g.groupKey)}_PAGES`, singles, `${inner}${folderId(g.groupKey)}_PAGES["${aggregateLabel(singles)}"]:::pkg`)
  }
  lines.push(`${indent}end`)
}

// top-level 도메인의 chain 참조 id — collapse된 폴더는 node id, 구조적 폴더는 subgraph id(_G).
function topRefId(g: NestedGroup): string {
  return isCollapsed(g) ? folderId(g.groupKey) : folderId(g.groupKey) + '_G'
}

export function buildNestedFolderOverviewLines(domains: NestedGroup[], indent: string): string[] {
  const lines: string[] = []
  for (const g of domains) emitFolder(g, indent, lines)
  // 표준 R-T1.2: top-level 형제 도메인을 단일 `~~~` invisible chain으로 X축 분포(가로 배치)한다.
  // nested 자식은 Y-stack 표준 유지(mermaid v11 nested LR 미보장, FE 표준 v1.1 amendment).
  // render-check 실측(16 deep 도메인): 단일 chain aspect 1.99 vs bare 0.04 vs row-wrapper 0.05(무시됨).
  if (domains.length >= 2) {
    lines.push(`${indent}${domains.map(topRefId).join(' ~~~ ')}`)
  }
  return lines
}
