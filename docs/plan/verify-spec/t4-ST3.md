### VERIFY-SPEC — SubTask ST3

- 기준선 요구사항: "sequence는 isDiagramCache 필수 shape에 넣지 않는다(구 pair 캐시 전량 무효화
  방지). webview.ts META에 isPair 추가 — 단일모드/구버전캐시 구분. analyzer-version.ts에 이번 shape
  변경 사실을 주석으로 기록."
- 변경 파일:
  - `packages/extension/src/webview.ts` (수정 — `isPair` META 필드 추가)
  - `packages/extension/src/webview.test.ts` (수정 — isPair 검증 3건 추가)
  - `packages/types/src/analyzer-version.ts` (수정 — 주석만, 버전 문자열 불변)
  - `packages/extension/src/diagram-cache.ts` — **변경 없음**(이미 `sequence`를 검증하지 않으므로
    "옵셔널 취급"이 자동으로 성립. 아래 "구현 결정" 참고)
- 관찰 가능한 계약:
  - `isDiagramCache()`는 `sequence` 필드 유무와 무관하게 기존과 동일하게 통과/실패 판정한다(코드
    변경 없음 = 회귀 자체가 불가능 — 기존 diagram-cache.test.ts 전량 GREEN 유지로 증명).
  - `panel.updateGraph(graph, diagrams, pairRepoRoot)`에서 `pairRepoRoot !== undefined`이면
    `window.__CODEBASE_VIZ_META__.isPair === true`, 아니면 `false`.
  - `panel.showCached(data, repoRoot, pairRepoRoot)`도 동일 규칙.
- 구현 결정:
  - **diagram-cache.ts를 의도적으로 건드리지 않았다** — `isDiagramCache`는 애초에 `sequence`를
    required로 검사하지 않으므로(nodeMap·tab3Kind와 달리) "옵셔널 허용"이 이미 기본값이다. 여기에
    별도 가드 코드를 추가하면 오히려 불필요한 표면적 증가.
  - `ANALYZER_VERSION` 문자열은 **범프하지 않았다** — nodeMap/tab3Kind 선례(범프)와 의도적으로
    다른 선택. 이유는 analyzer-version.ts에 추가한 주석에 근거 기록(전체 캐시 무효화 비용 >
    "새 탭이 재분석 전까지 빈 채로 뜨는" 비용).
  - `isPair`는 "분석 시점에 pairRepoRoot가 지정됐는가"만 나타낸다 — "BE가 실제로 인식됐는가"나
    "매칭된 crossEdge가 있는가"는 별개 신호이며 이번 범위에서 구분하지 않는다(아래 미확인 사항).
- 인접 경계: `viewer.html`(ST4가 `meta.isPair`를 읽어 탭 표시 여부 결정) / `extension.ts`
  (updateGraph/showCached 호출부, 이미 pairRepoRoot를 항상 전달하고 있어 변경 불필요).
- 미확인 사항: `isPair=true`인데 BE 어댑터가 실제로 아무것도 못 찾아 `beGraph.nodes.length===0`인
  경우(FE 단독 폴백)와 "BE는 찾았지만 매칭 crossEdge가 0건"인 경우와 "구버전 캐시라 sequence가
  없는" 경우, 셋 다 webview 입장에서는 `isPair===true && sequence===undefined`로 **구분 불가**다.
  ST4에서 이 셋을 하나의 중립적인 "no data" 안내로 통합 처리하기로 결정했는데(과대 주장 방지),
  이게 사용자 혼란을 완전히 해소하는지는 실사용 피드백이 필요하다.
