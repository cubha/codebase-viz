import { describe, it, expect } from 'vitest'
import { createRouteNode, makeNodeId } from '@codebase-viz/types'
import { emitControllerFileLeaf } from './leaf.js'
import { stripNodeMapMarkers, nodeMapMarker } from '../helpers/node-map.js'

function makeRoute(filePath: string, urlPath: string, httpMethod: string) {
  return createRouteNode({
    id: makeNodeId('route', filePath, `${urlPath}:${httpMethod}`),
    path: urlPath,
    filePath,
    routeFileKind: 'page',
    dynamicSegmentType: 'static',
    isGroupRoute: false,
    renderingMode: 'SSR',
    httpMethod,
    provenance: { file: filePath, line: 1, adapter: 'test', analyzerVersion: '0.1' },
    confidence: 'verified',
  })
}

const FILE = 'src/main/java/com/example/deco/controller/DecoSheetController.java'

describe('emitControllerFileLeaf — endpoint collapse (개선 C: 메서드 bold + 1행)', () => {
  it('endpoints subgraph를 폐기하고 leaf 노드 안 markdown multiline으로 흡수', () => {
    const routes = [
      makeRoute(FILE, '/api/deco', 'GET'),
      makeRoute(FILE, '/api/deco/list', 'GET'),
      makeRoute(FILE, '/api/deco', 'POST'),
    ]
    const { leafId, lines } = emitControllerFileLeaf('  ', FILE, routes)
    const out = lines.join('\n')

    // 구 구조 폐기
    expect(out).not.toMatch(/subgraph endpoints_/)
    expect(out).not.toMatch(/ --- /) // route 간 체인 폐기
    expect(out).not.toMatch(/--> endpoints_/) // leaf→subgraph 엣지 폐기

    // 신규: 단일 leaf 노드 + mermaid markdown 문자열(htmlLabels:false 호환)
    expect(out).toContain(`${leafId}["\``)
    expect(out.trimEnd()).toMatch(/`"\]:::ctrl$/)

    // 메서드 bold + suffix (prefix /api/deco strip 후 /, /list)
    expect(out).toContain('**GET** /')
    expect(out).toContain('**GET** /list')
    expect(out).toContain('**POST** /')

    // 컨트롤러 헤더 보존 (개선 C: 이름 bold)
    expect(out).toContain('📄 **DecoSheetController**')
  })

  it('markdown 메타문자(_ * `)를 이스케이프해 italic/bold 오해석 방지', () => {
    const routes = [makeRoute(FILE, '/api/user_profile/detail_view', 'GET')]
    const { lines } = emitControllerFileLeaf('  ', FILE, routes)
    // `%% nodemap:` 마커는 IR 노드 id 원문을 담는 딥링크 사이드채널이라 markdown 이스케이프 대상이
    // 아니다(렌더 전 제거됨) — 라벨 이스케이프만 검사하도록 제외한다.
    const out = stripNodeMapMarkers(lines.join('\n'))
    expect(out).toContain('\\_') // _ 이스케이프
    expect(out).not.toMatch(/[^\\]_[a-z]/) // 비이스케이프 _ 없음
  })

  // leafId는 컨트롤러 *파일명* 기반이라 IR 노드 id와 대응이 없다 — 마커가 없으면 BE Tab1
  // 전체가 딥링크 불가가 된다(v1.2.61 결함).
  it('대표 endpoint(최단 경로)를 %% nodemap: 마커로 명시한다', () => {
    const routes = [
      makeRoute(FILE, '/api/deco/list/detail', 'GET'),
      makeRoute(FILE, '/api/deco', 'GET'),
    ]
    const { leafId, lines } = emitControllerFileLeaf('  ', FILE, routes)
    const marker = lines.find(l => l.includes('%% nodemap:'))
    expect(marker).toBeDefined()
    expect(marker).toContain(`%% nodemap:${leafId}=`)
    // 최단 경로 '/api/deco'가 대표 — 깊은 '/api/deco/list/detail'이 아니다.
    // 마커 인코딩은 nodeMapMarker의 책임이라 여기서 직접 조립하지 않는다(인코딩 방식 변경에 무관).
    expect(marker).toBe(nodeMapMarker('  ', leafId, routes[1]!.id))
  })

  it('route 0개면 endpoint 라인 없이 단일 leaf 노드만', () => {
    const { leafId, lines } = emitControllerFileLeaf('  ', FILE, [])
    const out = lines.join('\n')
    expect(out).toContain('📄 DecoSheetController')
    expect(out).not.toMatch(/subgraph/)
    expect(out).not.toContain('**')
    expect(lines.length).toBeGreaterThan(0)
    expect(leafId).toBe('leaf_DecoSheetController')
  })
})

describe('emitControllerFileLeaf — 테이블 뱃지 (C4/K4)', () => {
  it('테이블 목록이 있으면 route와 함께 🗄 뱃지 1행을 추가한다', () => {
    const routes = [makeRoute(FILE, '/api/deco', 'GET')]
    const { lines } = emitControllerFileLeaf('  ', FILE, routes, ['deco_sheet', 'deco_item'])
    const out = lines.join('\n')
    expect(out).toContain('🗄 deco\\_sheet, deco\\_item')
    expect(out).toContain('**GET** /')
  })

  it('테이블 목록이 없으면 뱃지 라인을 추가하지 않는다', () => {
    const routes = [makeRoute(FILE, '/api/deco', 'GET')]
    const { lines } = emitControllerFileLeaf('  ', FILE, routes, [])
    const out = lines.join('\n')
    expect(out).not.toContain('🗄')
  })

  it('route 0개 + 테이블 있음 — multiline으로 전환해 뱃지를 표시한다', () => {
    const { lines } = emitControllerFileLeaf('  ', FILE, [], ['deco_sheet'])
    const out = lines.join('\n')
    expect(out).toContain('🗄 deco\\_sheet')
    expect(out).toContain('📄 **DecoSheetController**')
  })

  it('테이블명의 markdown 메타문자도 이스케이프한다', () => {
    const routes = [makeRoute(FILE, '/api/deco', 'GET')]
    const { lines } = emitControllerFileLeaf('  ', FILE, routes, ['user_profile'])
    const out = lines.join('\n')
    expect(out).toContain('user\\_profile')
  })
})
