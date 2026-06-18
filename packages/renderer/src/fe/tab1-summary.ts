import type { NestedGroup } from '../url-grouper.js'
import { sanitizeId } from '../helpers/ids.js'
import { collectNestedRoutes, emitInnerRowSubgraphs, GROUPS_PER_ROW } from '../helpers/layout.js'

// FE 표준 v1.2 (R-T1.2): Tab1은 top-level URL 도메인의 "요약 박스"(도메인명 + 라우트 수 배지)만 표시한다.
// 하위 세그먼트 중첩·라우트 leaf 열거는 Tab2의 역할(표준 2 탭 차별성). 노드 수가 O(도메인 수)로 작아
// 항상 단일 다이어그램 → wrapper(R-T1.1)·외부분기(R-T1.5)가 청킹으로 폐기되던 결함(v1.2.51 C2) 해소.
// 사유·실측: docs/design/FE-DIAGRAM-STANDARD.md §9.

function domainName(groupKey: string): string {
  const segs = groupKey.split('/').filter(Boolean)
  return segs.length > 0 ? segs[segs.length - 1]! : '/'
}

function domainNodeId(groupKey: string): string {
  const segs = groupKey.split('/').filter(Boolean)
  return 'DOMAIN_' + (segs.length > 0 ? sanitizeId(segs.join('_')) : 'root')
}

function domainLabel(g: NestedGroup): string {
  const n = collectNestedRoutes([g]).length
  const unit = n === 1 ? 'route' : 'routes'
  return `📁 ${domainName(g.groupKey)} · ${n} ${unit}`
}

// top-level 도메인 그룹 → 요약 박스 lines. 도메인 ≤ GROUPS_PER_ROW면 `~~~` chain(X축 보장),
// 초과 시 inner-row wrapper로 줄넘김(청킹 아님 — 단일 다이어그램 내 grid).
export function buildDomainSummaryLines(domains: NestedGroup[], indent: string): string[] {
  if (domains.length === 0) return []
  const lines: string[] = []
  const emitBox = (i: number, ind: string): string =>
    `${ind}${domainNodeId(domains[i]!.groupKey)}["${domainLabel(domains[i]!)}"]:::pkg`

  if (domains.length <= GROUPS_PER_ROW) {
    for (let i = 0; i < domains.length; i++) lines.push(emitBox(i, indent))
    if (domains.length >= 2) {
      const chain = domains.map(d => domainNodeId(d.groupKey)).join(' ~~~ ')
      lines.push(`${indent}${chain}`)
    }
  } else {
    lines.push(...emitInnerRowSubgraphs(indent, 'DOMAINS', domains.length, emitBox))
  }
  return lines
}
