### VERIFY-SPEC — SubTask ST4

- 기준선 요구사항: "viewer.html 4번째 탭(sequence) — 기존 r/s/d 탭 DOM 패턴 재사용(zoom/fit/pan
  무료 상속). META.isPair===false면 탭 비활성화/안내. DONE 조건 = render-harness.mjs + Playwright
  스크린샷 실렌더."
- 변경 파일: `packages/extension/media/viewer.html` (수정 — 탭 버튼·패널·DIAGRAMS.q·rendered/ST/ROW_ST
  맵·isPair 가시성 토글)
- 관찰 가능한 계약:
  - `meta.isPair === true`일 때만 `#tab-q`가 보인다(기본 `display:none`, JS가 `''`로 해제).
  - 탭 클릭 시 기존 `renderTab(t)`의 범용 경로(`t==='d'` 분기 아님 → else 분기)가 그대로 타서
    `DIAGRAMS.q`를 `mermaid.render`로 그린다 — 신규 특수 분기 코드 추가 없음.
  - `DIAGRAMS.q`가 빈 문자열이면(예: isPair=true인데 sequence 없음) 기존 "no data" 안내
    (`status.noData`)가 **다른 탭과 동일한 코드 경로로** 자동으로 뜬다(신규 문구·신규 상태
    분기 추가 안 함 — VERIFY-SPEC ST3 "미확인 사항"의 3가지 원인을 구분하지 않는 이유).
    **[PLAN 정정 반영]** PLAN 원문은 최초 "재분석 필요" 별도 안내를 요구했으나, 그 3원인이
    코드로 구분 불가함이 구현 중 확인되어 PLAN-t4-sequence-diagram.md ST4 절을 이 결정으로
    갱신했다(acceptance-critic 1차 판정에서 PLAN-코드 불일치로 지적받아 소급 반영, 이 재판정
    시점 기준으로는 이미 갱신 완료 상태).
  - zoom(+/−/⌂) 버튼은 `data-arg-t="q"`로 기존 범용 위임 리스너를 그대로 탄다.
- 구현 결정:
  - **검색(D8) 미적용** — sequenceDiagram은 mermaid가 `.actor` 클래스를 쓰고 `.node`가 없어, 기존
    Tab1/2 검색·클릭딥링크·hover 델리게이션(`.node` 셀렉터 기반)이 구조적으로 걸리지 않는다. 이번
    5개 SubTask 계획에 "sequence 탭 딥링크/hover 배선"은 포함되지 않았으므로 **의도적 범위 밖**으로
    남긴다(후속 후보로만 기록, 이번 완료 조건 아님).
  - legend(SSR/CSR 등 렌더링 모드 범례)도 sequence 탭에는 없음 — 시퀀스 다이어그램에 렌더링 모드
    개념이 없어 표시할 게 없다.
  - `isPair` 계산은 `meta.isPair`(불리언) 그대로 신뢰 — `DIAGRAMS.q`가 비어도 탭 자체는 숨기지
    않는다(그 경우 "no data" 안내가 뜨는 게 맞음, 탭을 숨기면 "왜 탭이 없어졌지"라는 새 혼란).
- 인접 경계: `webview.ts`(ST3 — `isPair` META 소스) / mermaid.js 런타임(sequenceDiagram 파싱은
  기존 mermaid.min.js가 이미 지원 — 별도 번들 변경 없음, 실렌더로 확인) / 기존 `.node` 기반
  click/hover/search 델리게이션 코드(변경 없음 — sequence 탭엔 애초에 적용 안 됨을 실렌더로 확인).
- **실렌더 검증** — 1차로 Playwright MCP 연결 끊김 상태에서 임시 스크립트(레포 미반영)로 먼저
  확인했으나, acceptance-critic이 "PLAN이 지정한 검증 경로(`scripts/render-harness.mjs`)가
  실제로는 갱신되지 않아 재현 불가능한 주장"이라고 정당하게 지적 — **`scripts/render-harness.mjs`
  자체를 수정**해 문제를 근본 해결했다(변경 파일 목록에 추가):
  - `render-harness.mjs`에 옵셔널 `sequence.md` 입력 지원 추가: 존재하면 `diagrams.sequence`·
    `meta.isPair=true`·`EN_DICT['tab.sequence']`를 채우고 스크린샷 루프에 `['q','tab4-sequence']`를
    추가. **`sequence.md`가 없으면(기존 단일모드 입력) 이전과 바이트 단위로 동일하게 동작** —
    회귀 없음.
  - 합성 `sequence.md` + rendering/screen/db .md 4개로 실제 `node scripts/render-harness.mjs`를
    실행 → `tab4-sequence.png` 스크린샷 생성 확인. UserWidget→/api/users→UserController 체인이
    실제 렌더된 SVG로 눈으로 확인됨, 콘솔 에러 섹션 미출력(0건).
  - `isPair:true` + `sequence` 채워진 산출물에서 `#tab-q` visible=true, 탭 클릭 후 `#i-q svg` 존재,
    체인 순서·화살표 스타일(verified 실선/inferred 점선) 스크린샷으로 육안 확인.
  - `isPair:false`(sequence.md 없음, 기존 입력) 주입 → `#tab-q` visible=false 확인.
- **재현 확인(/verify-impl, 2026-08-28)** — acceptance-critic이 "DONE 조건 수행 여부는 정적 리뷰로
  확인 불가(❓)"로 남긴 항목을 실행으로 닫았다. 이번엔 `buildSequenceDiagram()` 직접 호출이 아니라
  **`buildCombinedDiagram()` 전체 프로덕션 경로**(dist 빌드 산출물)로 `DiagramSet.sequence`를 얻어
  `node scripts/render-harness.mjs`에 투입:
  - `isPair=true`(sequence.md 있음) → `tab4-sequence.png` 생성, Sequence 탭 노출, 다크테마·참가자
    박스 상단 단일 배치·번호 ①~⑤·4번 inferred 엣지만 점선 — 시안 B와 일치.
  - `isPair=false`(sequence.md 없음) → 탭 3개만 렌더, Sequence 탭 DOM 미노출.
  - 부산물 확인: `drawableEdges`는 `findParentRouteId`(FE `renders` 부모 라우트)를 요구하므로
    FE 라우트 없는 그래프에선 `sequence`가 정상적으로 `undefined` — 게이트가 실제로 작동함.
- 미확인 사항: 실제 대형 프로젝트(수십 개 crossEdge 매칭)에서 시퀀스 다이어그램이 매우 길어질 때의
  가독성·mermaid 렌더 성능은 합성 6-participant 케이스로만 확인했고 실측 안 됨 — chunk fallback이
  sequence에는 적용되지 않으므로(ST2에서 의도적으로 배제) 대형 입력에서 v1.2.49류 freeze 재발
  가능성이 이론상 있다. 이번 범위(계획서 명시)엔 sequence 전용 chunking이 없었다.
