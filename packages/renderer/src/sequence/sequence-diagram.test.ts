import { describe, it, expect } from 'vitest'
import {
  createIRGraph,
  createRouteNode,
  createComponentNode,
  createTableNode,
  createEdge,
  makeNodeId,
  makeEdgeId,
  type IRGraph,
  type IREdge,
} from '@codebase-viz/types'
import { buildSequenceDiagram } from './sequence-diagram.js'
import { sanitizeId } from '../helpers/ids.js'

const PROV = { file: 'x', line: 1, adapter: 'test@0.1', analyzerVersion: 'test' }

function verified() {
  return { confidence: 'verified' as const }
}

describe('buildSequenceDiagram — FE→BE→Controller→Service→Repository→Table 체인', () => {
  const feCompId = makeNodeId('component', 'src/widgets/UserWidget.tsx', 'UserWidget')
  const feComp = createComponentNode({
    id: feCompId, name: 'UserWidget', filePath: 'src/widgets/UserWidget.tsx',
    runtime: 'client', provenance: PROV, ...verified(),
  })
  const feGraph: IRGraph = createIRGraph({
    analyzerVersion: 'test', repoRoot: '/fe', projectName: 'fe-app',
    nodes: [feComp], edges: [],
  })

  const beRouteId = makeNodeId('route', 'src/main/java/UserController.java', '/api/users')
  const beRoute = createRouteNode({
    id: beRouteId, path: '/api/users', filePath: 'src/main/java/UserController.java',
    routeFileKind: 'page', dynamicSegmentType: 'static', isGroupRoute: false,
    renderingMode: 'SSR', provenance: PROV, ...verified(),
  })
  const ctrlId = makeNodeId('component', 'src/main/java/UserController.java', 'UserController')
  const ctrl = createComponentNode({
    id: ctrlId, name: 'UserController', filePath: 'src/main/java/UserController.java',
    runtime: 'server', provenance: PROV, ...verified(),
  })
  const svcId = makeNodeId('component', 'src/main/java/UserService.java', 'UserService')
  const svc = createComponentNode({
    id: svcId, name: 'UserService', filePath: 'src/main/java/UserService.java',
    runtime: 'server', provenance: PROV, ...verified(),
  })
  const repoId = makeNodeId('component', 'src/main/java/UserRepository.java', 'UserRepository')
  const repo = createComponentNode({
    id: repoId, name: 'UserRepository', filePath: 'src/main/java/UserRepository.java',
    runtime: 'server', provenance: PROV, ...verified(),
  })
  const tableId = makeNodeId('table', 'schema.sql', 'users')
  const table = createTableNode({
    id: tableId, name: 'users', columns: [], provenance: PROV, ...verified(),
  })

  const handlesEdge = createEdge({
    id: makeEdgeId('handles', beRouteId, ctrlId), from: beRouteId, to: ctrlId,
    kind: 'handles', provenance: PROV, ...verified(),
  })
  const ctrlToSvc = createEdge({
    id: makeEdgeId('calls', ctrlId, svcId), from: ctrlId, to: svcId,
    kind: 'calls', provenance: PROV, ...verified(),
  })
  const svcToRepo = createEdge({
    id: makeEdgeId('calls', svcId, repoId), from: svcId, to: repoId,
    kind: 'calls', provenance: PROV, confidence: 'inferred', inferenceChain: ['di-heuristic'],
  })
  const repoToTable = createEdge({
    id: makeEdgeId('queries', repoId, tableId), from: repoId, to: tableId,
    kind: 'queries', provenance: PROV, ...verified(),
  })

  const beGraph: IRGraph = createIRGraph({
    analyzerVersion: 'test', repoRoot: '/be', projectName: 'be-app',
    metadata: { framework: 'springboot', hasSupabase: false, hasPrisma: false, hasDexie: false, hasFirebase: false, adapterCategory: 'BE' },
    nodes: [beRoute, ctrl, svc, repo, table],
    edges: [handlesEdge, ctrlToSvc, svcToRepo, repoToTable],
  })

  const crossEdge: IREdge = createEdge({
    id: makeEdgeId('fe-be-call', feCompId, beRouteId), from: feCompId, to: beRouteId,
    kind: 'fe-be-call', provenance: PROV, ...verified(),
  })

  it('mermaid init 지시자 다음 줄에 sequenceDiagram 헤더가 온다(다크테마+mirrorActors:false 적용, 사용자 실측 지적 반영)', () => {
    const out = buildSequenceDiagram(feGraph, beGraph, [crossEdge])
    const lines = out.split('\n')
    expect(lines[0]).toMatch(/^%%\{init:/)
    expect(lines[0]).toContain("'mirrorActors':false")
    expect(lines[1]).toBe('sequenceDiagram')
  })

  it('participant 별칭이 sanitizeId(node.id)와 정확히 일치한다', () => {
    const out = buildSequenceDiagram(feGraph, beGraph, [crossEdge])
    for (const id of [feCompId, beRouteId, ctrlId, svcId, repoId, tableId]) {
      expect(out).toContain(`participant ${sanitizeId(id)} as `)
    }
  })

  it('체인 순서대로 메시지가 생성된다: FE→Route→Controller→Service→Repository→Table', () => {
    const out = buildSequenceDiagram(feGraph, beGraph, [crossEdge])
    const feSid = sanitizeId(feCompId)
    const routeSid = sanitizeId(beRouteId)
    const ctrlSid = sanitizeId(ctrlId)
    const svcSid = sanitizeId(svcId)
    const repoSid = sanitizeId(repoId)
    const tableSid = sanitizeId(tableId)

    const feIdx = out.indexOf(`${feSid}->>${routeSid}`)
    const ctrlIdx = out.indexOf(`${routeSid}->>${ctrlSid}`)
    const svcIdx = out.indexOf(`${ctrlSid}->>${svcSid}`)
    const repoIdx = out.indexOf(`${svcSid}-->>${repoSid}`) // inferred edge → dashed
    const tableIdx = out.indexOf(`${repoSid}->>${tableSid}`)

    expect(feIdx).toBeGreaterThan(-1)
    expect(ctrlIdx).toBeGreaterThan(feIdx)
    expect(svcIdx).toBeGreaterThan(ctrlIdx)
    expect(repoIdx).toBeGreaterThan(svcIdx)
    expect(tableIdx).toBeGreaterThan(repoIdx)
  })

  it('verified 엣지는 실선(->>) 화살표를, inferred 엣지는 점선(-->>) 화살표를 쓴다', () => {
    const out = buildSequenceDiagram(feGraph, beGraph, [crossEdge])
    const svcSid = sanitizeId(svcId)
    const repoSid = sanitizeId(repoId)
    expect(out).toContain(`${svcSid}-->>${repoSid}`)
    expect(out).not.toContain(`${svcSid}->>${repoSid}`)
  })

  it('라벨의 콜론(:)을 이스케이프해 메시지 구분자와 충돌하지 않는다', () => {
    const evilComp = createComponentNode({
      id: feCompId, name: 'Evil: Widget', filePath: 'src/widgets/UserWidget.tsx',
      runtime: 'client', provenance: PROV, ...verified(),
    })
    const evilFeGraph: IRGraph = createIRGraph({
      analyzerVersion: 'test', repoRoot: '/fe', projectName: 'fe-app',
      nodes: [evilComp], edges: [],
    })
    const out = buildSequenceDiagram(evilFeGraph, beGraph, [crossEdge])
    const feSid = sanitizeId(feCompId)
    // participant 선언 줄에 원본 콜론이 그대로 남아 있으면 안 된다(구분자 충돌 방지)
    const participantLine = out.split('\n').find(l => l.trim().startsWith(`participant ${feSid} as`))
    expect(participantLine).toBeDefined()
    expect(participantLine).not.toMatch(/Evil:/)
  })

  it('메시지 라인도 이스케이프된다 — 콜론·개행·U+2028이 statement를 쪼개지 않는다', () => {
    // v1.2.60에서 mermaid 라벨 이스케이프 누락이 실제로 발견된 전례가 있고, 기존 테스트는
    // participant 선언 줄만 봤다(보안 검토 지적). 메시지 줄은 `A->>B: label` 구조라
    // 라벨의 `:`가 남으면 파서가 라벨을 조기 절단한다.
    const evilCtrl = createComponentNode({
      id: ctrlId, name: 'Ctrl: A\nrect rgb(255,0,0)\u2028link A: javascript -x',
      filePath: 'src/main/java/UserController.java',
      runtime: 'server', provenance: PROV, ...verified(),
    })
    const evilBeGraph: IRGraph = {
      ...beGraph,
      nodes: beGraph.nodes.map(n => (n.id === ctrlId ? evilCtrl : n)),
    }
    const out = buildSequenceDiagram(feGraph, evilBeGraph, [crossEdge])
    const routeSid = sanitizeId(beRouteId)
    const ctrlSid = sanitizeId(ctrlId)
    const msgLine = out.split('\n').find(l => l.trim().startsWith(`${routeSid}->>${ctrlSid}:`))
    expect(msgLine).toBeDefined()
    // 라벨 부분(첫 `:` 이후)에 원본 구분자·라인 종결자가 남아 있으면 안 된다.
    const label = msgLine!.slice(msgLine!.indexOf(':') + 1)
    expect(label).not.toMatch(/[:\r\n\u2028\u2029]/)
    // 페이로드가 자기 statement로 새어나가지 않았는지 — 어떤 줄도 mermaid 지시어로 시작하면 안 된다
    // (participant 선언 줄과 메시지 줄 안에 문자열로 들어 있는 것은 정상).
    for (const line of out.split('\n')) {
      expect(line.trim()).not.toMatch(/^(rect |link |note |activate |loop )/)
    }
  })

  it('동일 노드가 여러 체인에서 재등장해도 participant 선언은 한 번만 한다', () => {
    const otherFeCompId = makeNodeId('component', 'src/widgets/OtherWidget.tsx', 'OtherWidget')
    const otherFeComp = createComponentNode({
      id: otherFeCompId, name: 'OtherWidget', filePath: 'src/widgets/OtherWidget.tsx',
      runtime: 'client', provenance: PROV, ...verified(),
    })
    const feGraph2: IRGraph = createIRGraph({
      analyzerVersion: 'test', repoRoot: '/fe', projectName: 'fe-app',
      nodes: [feComp, otherFeComp], edges: [],
    })
    const otherCrossEdge: IREdge = createEdge({
      id: makeEdgeId('fe-be-call', otherFeCompId, beRouteId), from: otherFeCompId, to: beRouteId,
      kind: 'fe-be-call', provenance: PROV, ...verified(),
    })
    const out = buildSequenceDiagram(feGraph2, beGraph, [crossEdge, otherCrossEdge])
    const routeSid = sanitizeId(beRouteId)
    const occurrences = out.split('\n').filter(l => l.trim().startsWith(`participant ${routeSid} as`))
    expect(occurrences.length).toBe(1)
  })

  it('순환 calls 그래프에서도 무한루프 없이 종료한다', () => {
    const cyclicEdge = createEdge({
      id: makeEdgeId('calls', repoId, ctrlId), from: repoId, to: ctrlId,
      kind: 'calls', provenance: PROV, ...verified(),
    })
    const cyclicBeGraph: IRGraph = {
      ...beGraph,
      edges: [...beGraph.edges, cyclicEdge],
    }
    expect(() => buildSequenceDiagram(feGraph, cyclicBeGraph, [crossEdge])).not.toThrow()
  })
})
