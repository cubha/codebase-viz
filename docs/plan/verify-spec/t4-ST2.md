### VERIFY-SPEC — SubTask ST2

- 기준선 요구사항: "DiagramSet.sequence?: string 필드 신설 + buildCombinedDiagram 배선. buildDiagrams
  (단일모드)는 undefined 유지 → CLI 미노출. drawableEdges 0건이면 sequence도 undefined."
- 변경 파일: `packages/renderer/src/mermaid-renderer.ts` (수정), `combined-diagram.test.ts` (수정 —
  케이스 3건 추가)
- 관찰 가능한 계약:
  - `buildDiagrams(graph)` (단일모드)는 반환 객체에 `sequence` 키를 절대 채우지 않는다(참조도 안 함
    — 코드상 buildDiagrams는 buildSequenceDiagram을 import조차 하지 않음).
  - `buildCombinedDiagram(feGraph, beGraph, crossEdges)`는 `drawableEdges.length > 0`이면
    `sequence`를 채우고, `0`이면 `sequence === undefined`.
  - beGraph가 비어(BE 미인식) FE 단독 폴백 경로로 빠지면 `sequence === undefined`(feOnly 스프레드는
    buildDiagrams 결과라 애초에 필드가 없음).
  - `sequence` 텍스트는 `emittedTexts`(nodeMap 추출용 텍스트 스캔 목록)에 포함돼 sequence 안의
    participant id도 nodeMap에 자동 편입된다.
- 구현 결정: `stripNodeMapMarkers(sequence)`를 호출하지만 buildSequenceDiagram은 nodeMap 마커를
  emit하지 않으므로 현재는 항상 no-op — 향후 마커가 필요해지면(예: sequence 전용 합성 노드) 이미
  경유하도록 미리 걸어둔 것.
- 인접 경계: `webview.ts`(ST3이 diagrams.sequence를 그대로 클라이언트에 전달) / `diagram-cache.ts`
  (ST3이 shape 가드 확인) / CLI `renderMermaid`(변경 없음 — buildDiagrams만 쓰므로 영향 없음, 회귀
  테스트는 기존 CLI 스냅샷 테스트가 그대로 커버).
- 미확인 사항: 없음 — 3개 신규 테스트(매칭 있음/매칭 0건/beGraph 빈 폴백)로 분기 전부 커버했고
  기존 18개 테스트(nodeMap·tab3Kind·chunk fallback 등)도 회귀 없이 GREEN.
