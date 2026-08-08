import * as path from 'node:path'
import type { RouteNode } from '@codebase-viz/types'
import { sanitizeId } from '../helpers/ids.js'
import { pathSegmentLcp } from './pkg-tree.js'

import { escapeMd } from '../helpers/label-escape.js'
import { nodeMapMarker, pickRepresentativeRoute } from '../helpers/node-map.js'

// leafId는 컨트롤러 *파일명*에서 만들어져 IR 노드 id와 대응 관계가 없다 — 딥링크(T1)가 BE Tab1
// 전체에서 죽지 않도록 대표 endpoint를 마커로 명시한다.
function withMarker(indent: string, leafId: string, routes: RouteNode[], declLines: string[]): string[] {
  const rep = pickRepresentativeRoute(routes)
  if (rep === undefined) return declLines
  return [nodeMapMarker(indent, leafId, rep.id), ...declLines]
}

// BE Tab1 = 패키지 트리(node+edge) + leaf = 📄 Controller [/api/prefix] + endpoint multiline.
// 표준: docs/design/BE-DIAGRAM-STANDARD.md §2 (R-T1.1~9).
// - 트리: emitTreeNodes (R-T1.4) — outer BE_ROOT subgraph 폐기 (D7)
// - 헤더: 📁 src/main/java/com.<lcp> annotation 노드 (R-T1.2)
// - suffix strip: 마지막 segment가 controller(s)면 strip (R-T1.3)
// - leaf: 📄 ControllerName [URL prefix] (R-T1.5)
// - endpoints: leaf 노드 안 markdown multiline으로 collapse, **METHOD** /suffix 1행씩 (R-T1.6 v1.2.57 amendment).
//   구 endpoints_<Ctrl> subgraph(Y축 적층)는 폐기 — 적층이 깊은 컨트롤러 열의 Y축 비대를 유발.
// - chunk: chunkByTopLevelPackage (R-T1.8)
// - tables: DI 체인으로 도달 가능한 테이블을 🗄 뱃지 1행으로 collapse (C1.6 amendment §2.2, K4).
//   Tab3 ER은 변경 없음 — R-T1.6과 동일 "leaf 안 markdown 텍스트" 기법 재사용, 신규 IR 없음.
export function emitControllerFileLeaf(
  indent: string,
  filePath: string,
  routes: RouteNode[],
  tableNames: string[] = [],
): { leafId: string; lines: string[] } {
  const controllerName = path.basename(filePath, path.extname(filePath))
  const safeName = sanitizeId(controllerName)
  const prefix = pathSegmentLcp(routes.map(r => r.path))
  const leafId = `leaf_${safeName}`
  const tableLine = tableNames.length > 0 ? `🗄 ${tableNames.map(escapeMd).join(', ')}` : undefined

  if (routes.length === 0) {
    const titleSuffix = prefix !== '' ? ` [${prefix}]` : ''
    if (tableLine === undefined) {
      return { leafId, lines: [`${indent}${leafId}["📄 ${controllerName}${titleSuffix}"]:::ctrl`] }
    }
    const title = `📄 **${escapeMd(controllerName)}**${titleSuffix}`
    const body = [title, tableLine].join('\n')
    return { leafId, lines: [`${indent}${leafId}["\`${body}\`"]:::ctrl`] }
  }


  const titleSuffix = prefix !== '' ? ` [${escapeMd(prefix)}]` : ''
  const title = `📄 **${escapeMd(controllerName)}**${titleSuffix}`
  const endpointLines = routes.map(r => {
    const suffix = prefix !== '' && r.path.startsWith(prefix)
      ? (r.path.slice(prefix.length) || '/')
      : r.path
    const method = r.httpMethod !== undefined ? `**${escapeMd(r.httpMethod)}** ` : ''
    return `${method}${escapeMd(suffix)}`
  })
  const sep = '─────────────'
  const bodyLines = [title, sep, ...endpointLines]
  if (tableLine !== undefined) bodyLines.push(sep, tableLine)
  const body = bodyLines.join('\n')
  return { leafId, lines: withMarker(indent, leafId, routes, [`${indent}${leafId}["\`${body}\`"]:::ctrl`]) }
}

export function isBeController(name: string): boolean { return name.endsWith('Controller') }
export function isBeService(name: string): boolean { return name.endsWith('Service') || name.endsWith('ServiceImpl') }
export function isBeRepository(name: string): boolean {
  return name.endsWith('Repository') || name.endsWith('Dao') || name.endsWith('Mapper')
}
