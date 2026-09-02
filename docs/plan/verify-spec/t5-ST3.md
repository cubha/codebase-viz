### VERIFY-SPEC — SubTask ST3 (TDD 제외 — UI/webview)

- 기준선 요구사항: "`parseDbData` 마커 정규식에 `class:` 추가 → `buildSingleDbGraph` 노드 라벨 병기 →
  `buildSidebar`는 `%%` 줄을 skip하므로 별도 파싱해 카드 헤드에 병기. 배지는 inferred 출처임이
  드러나게 표기(제약 5)."
- 변경 파일: `packages/extension/media/viewer.html`
- 관찰 가능한 계약:
  - 마커 정규식이 `(?:\s+class:(\w+))?`를 추가로 받고, 조건도 `dm[4]`를 포함하도록 확장됐다.
  - 다이어그램 노드 라벨: `TB_HODS401<br/>⌗ DecoSheet`. 클래스명 없으면 기존과 **바이트 동일**.
  - 사이드바 카드 헤드: `◈ TB_HODS401` 뒤에 `.orm-class` 배지(`⌗ DecoSheet`) + `title`에
    `tr('db.ormClass')` — 추론 결과임을 문구로 밝힌다(Evidence-First).
  - 클래스명 없는 테이블은 배지 DOM 자체가 생성되지 않는다.
- 구현 결정:
  - **모듈 스코프 `ORM_CLASS_BY_TABLE` 맵을 도입**했다. `buildSingleDbGraph`는 테이블 '이름'만 받는
    시그니처라 클래스명을 넘기려면 `buildDbGraph`→`buildSingleDbGraph` 4단 스레딩이 필요했다.
    이 파일이 이미 `DIAGRAMS`·`NODE_MAP`·`ST`·`ROW_ST`를 모듈 스코프 상태로 운용하는 기존 방식을
    따랐다. **트레이드오프**: 전역 상태라 `parseDbData` 호출 전에 라벨을 그리면 배지가 비는데,
    현재 호출 순서상 `parseDbData`가 항상 선행한다(`viewer.html`의 3개 호출 지점 전부).
  - `buildSidebar`는 `parseDbData`와 **별도로 자체 파싱**한다(기존 구조가 그렇다). 맵을 공유하지 않고
    지역 `sidebarOrmClass`를 따로 만든 이유: `buildSidebar(DIAGRAMS.d)`가 인자로 받은 텍스트만 보는
    순수 함수에 가까워, 전역 맵에 의존시키면 호출 순서 결합이 하나 더 는다.
  - 배지 글리프는 `⌗`(테이블 `◈`와 시각적으로 구분). 색은 `--text-muted`+`--border-sub`로 종속 표기 —
    테이블명이 주(主)라는 위계를 유지한다.
- 인접 경계: `proxies` 판정(컬럼이 `string name` 하나뿐인 유사 테이블 제거)은 마커 파싱 이후에
  돌아가므로 배지 로직과 간섭하지 않는다 / `parseDbData` 반환 shape에 `className`이 추가됐지만
  기존 소비자(`buildDbGraph`)는 해당 키를 읽지 않아 무영향.
- **실렌더 검증(DONE 조건)**: `fixtures/mini-spring-partner-mock-app`을 실제 파이프라인
  (`buildIRGraph`→`buildDiagrams`, dist 산출물)으로 돌려 `scripts/render-harness.mjs`에 투입.
  - 마커 12개 중 **7개에 `class:`**, 나머지 5개는 클래스 개념 없음/동일값이라 미포함 — 제약 4 충족.
  - 스크린샷 육안 확인: 다이어그램 박스 `TB_HODS401 ⌗ DecoSheet`·`TWO_MOLD_CUTING_NRM ⌗ CuttingPlan`
    등 7건, 사이드바 카드 헤드에도 동일 배지. `TB_HODS408`·`TWE_ORD_I`·`TWE_WRY_SN`은 배지 없음.
  - 콘솔 에러 0건.
- **VERIFY 반영(acceptance-critic 제약5)**: 다이어그램 노드 라벨에 inferred 표기가 없다는 지적을
  받아 라벨을 `<span class='orm-anno' title='{tr(db.ormClass)}'>⌗ Name</span>`로 바꿨다 — italic +
  opacity .72로 테이블명에 종속된 주석으로 보이고, title에 "추론" 문구가 붙는다. mermaid가 HTML 라벨을
  실제로 렌더하는지는 가정이 아니라 **실렌더 스크린샷으로 확인**했다.
- 미확인 사항:
  - ~~`ORM_CLASS_BY_TABLE` 초기화 없음~~ → **VERIFY에서 해소**. scope-critic이 도달 경로를 특정했다
    (탭 전환 시 `if (!dbGraphs)` 가드로 `parseDbData`가 재호출되지 않아 이전 값이 잔존). `parseDbData`
    진입부에서 매번 `{}`로 초기화하도록 고쳤다(`const`→`let`).
  - 배지가 붙어 라벨이 2줄이 되면서 노드 박스 높이가 늘어난다 — 51테이블급 대형 ERD에서 기존
    UX-2(fit 7.3%) 증상을 **악화시킬 수 있다**. partner-mock(12테이블)에서만 실측했고 대형 실측 없음.
  - hover 툴팁·클릭 딥링크는 여전히 Tab3에서 동작하지 않는다(`resolveBySuffix` 방향 결함, 범위 밖).
    즉 배지는 보이지만 클릭해서 엔티티로 점프하는 것은 이번 범위에 없다.
