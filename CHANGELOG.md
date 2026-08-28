# Changelog

## [1.2.66] — 2026-08-28

### Added — Sequence 탭 (FE↔BE 페어 분석 전용, Wave B T4)

FE 컴포넌트 → BE 엔드포인트 → Controller → Service/Repository → Table 호출 흐름을 시간순
mermaid `sequenceDiagram`으로 그리는 4번째 탭. 기존 3탭 어디에도 없던 축(시간순 흐름)이라
같은 데이터를 문법만 바꿔 다시 그리는 T5(classDiagram)와 구분된다.

- **입력은 이미 계산된 것만 소비** — `buildCombinedDiagram`의 `drawableEdges`(matched-only
  `fe-be-call`)를 그대로 받는다. 신규 매칭·임계 계산 없음(v1.2.49 freeze 재발 방지).
- **Evidence-First 유지** — 화살표 모양이 근거 강도다. `verified`는 실선(`->>`),
  `inferred`는 점선(`-->>`). 노드/엣지의 provenance·confidence를 그대로 계승하며 신규 추정 0.
  IR(`packages/types/src/ir.ts`) 확장 없음 — 신규 `EdgeKind`·노드 kind 0건.
- **딥링크 무배선 상속** — participant 별칭을 접두사 없는 `sanitizeId(node.id)`로 두면
  `buildNodeMap`의 텍스트 스캔에 자동 편입된다.
- **단일 프로젝트에서는 탭이 뜨지 않는다** — `buildDiagrams`는 `sequence`를 채우지 않고,
  webview는 새 `META.isPair`로 "단일모드라 원래 없음"과 "페어인데 데이터 없음"을 구분한다.
  CLI(`renderMermaid`) `.md` 산출물에도 노출되지 않는다.
- `sequence`는 `isDiagramCache` 필수 shape에 넣지 않았다 — 넣으면 기존 pair 캐시가 전량
  무효화된다(nodeMap·tab3Kind 도입 때 실제로 겪은 실패).
- i18n `tab.sequence` 4로케일(ko/en/ja/zh-cn).

### Fixed — 시퀀스 다이어그램 가독성 2건 (실측 기반)

- **참가자 박스 상하 중복 + 저대비** (사용자 보고) — mermaid 기본값 `mirrorActors:true`가 박스를
  위아래로 복제해 흐름이 가운데 좁은 띠에 몰렸고, init 지시자를 안 주면 기본 회색 화살표가 이 앱의
  어두운 배경에 묻혔다. 다른 탭과 동일한 컨벤션으로 `SEQUENCE_INIT`(다크 themeVariables +
  `mirrorActors:false` + `showSequenceNumbers:true`)을 신설했다.
- **대형 입력 판독불가** — 청킹 없이 emit하면 100 라우트(참가자 501)에서 fit 배율이 1/60로 떨어져
  탭이 사실상 백지였다(실렌더 확인). `sequenceDiagram`은 폭이 O(participant)인 1차원 레이아웃이라
  flowchart의 노드 예산(50)을 쓸 수 없다. 청크당 participant ≤ 12로 분할하고 기존 행 그리드
  렌더러에 태운다(viewer 변경 0 — `splitChunks`·`ROW_ST`가 이미 탭 범용). 체인은 청크 경계에서
  쪼개지 않으며, 청크마다 `SEQUENCE_INIT`을 재부착한다(첫 청크에만 붙이면 2번째 행부터 기본
  테마로 되돌아간다). 20~1200 crossEdge 전 구간 회귀 가드를 stress test로 기계 강제.

### Notes

- `ANALYZER_VERSION`은 범프하지 않았다. `sequence`는 옵셔널이고 `isDiagramCache` 필수 shape에도
  없어 구캐시가 유효하게 로드된다(재분석하면 채워진다). 청킹은 내용만 바뀐 변경이지만 청킹 안 된
  sequence를 emit한 빌드가 릴리스된 적이 없어 무효화할 캐시 자체가 존재하지 않는다.
- 범위 밖(후속): 시퀀스 탭 검색·클릭 딥링크·hover(mermaid `.actor` 구조가 `.node` 셀렉터에
  안 걸림) · 동일 BE 라우트의 DI 체인이 FE 호출자마다 반복 emit되는 증폭.

## [1.2.65] — 2026-08-18

### Fixed — react-router 딥링크 오점프 (provenance 3종 결함)

딥링크 좌표의 원천은 `node.filePath`가 아니라 `provenance.file`/`.line`이다(`node-map.ts::toEntry`).
react-router 어댑터가 이 값을 세 방식으로 틀리게 기록해, `routes.map(...)`으로 뿌린 라우트가
페이지가 아니라 **router의 map 호출 지점**으로 점프했다(사용자 보고).

- **ComponentNode.provenance가 router 파일을 가리키던 결함** — `route-parser.ts` 3곳(createBrowserRouter
  분기·JSX 분기·하위 컴포넌트 분기). RR fixture 컴포넌트 노드 54/54 전부 `filePath ≠ provenance.file`
  이었다(대조군 Next.js는 일치). 하위 컴포넌트 건은 자기 파일이 아닌 **자기를 import한 부모 페이지**를
  가리켰고, 회귀 테스트를 추가하는 과정에서 발견됐다. `renders` 엣지의 provenance는 부모 파일이
  맞으므로 그대로 뒀다 — import 문이 실제로 거기 있다.
- **유령 좌표(file과 line이 서로 다른 파일에서 옴)** — `JsxRouteRaw`는 `line`만, `RouteEntry`는
  `sourceFilePath`만 갖고 있어, 외부 모듈 1-hop 추적 시 file은 바깥 router / line은 외부 파일 기준으로
  짝이 어긋났다. 실측: 기록된 `index.tsx:5`는 `return <div>404</div>`로 라우트와 무관했고, line 5의
  실제 출처는 `appRouteElements.tsx`였다. `JsxRouteRaw.sourceFilePath`를 신설해 좌표 짝을 항상 같은
  파일로 묶는다.
- **map 붕괴** — `RouteEntry.declLine`/`declFilePath` 신설로 각 라우트가 자기 배열 원소를 가리킨다
  (`appRoutes.ts:10`; map-prefix fixture는 5·6·14·15로 분리). 기존 `sourceFilePath`와 겸용하지 않은
  이유: 후자는 "컴포넌트 resolve용 importMap 파일"이라는 별개 의미라 얽으면 두 용도가 드리프트한다.

### Changed — 라우트 딥링크 해석 (react-router 한정)

- `node-map.ts::buildRouteJumpTargets` — 라우트 노드의 딥링크를 `renders`로 연결된 페이지 컴포넌트
  좌표로 치환한다. **f·l만 치환하고 n·c·i는 라우트 것을 유지** — 라벨은 라우트인데 툴팁 근거가
  컴포넌트 것이면 라벨-마커 불일치가 된다(v1.2.63 ST4 선례). 마커 경로(폴더 박스 대표 라우트)도
  동일 치환을 받아 탭별로 점프 지점이 갈리지 않는다.
- **react-router로 범위를 좁힌 근거는 실측이다**: 전 어댑터 스윕 결과 vue-spa·angular는 좌표가 4/4
  전부 바뀌어 잘 동작하던 링크가 조용히 재타겟되고, Next.js는 layout 라우트가 여러 컴포넌트를
  renders해 대표 선정이 모호했다(다중타겟 1). file-based 어댑터는 `route.filePath`가 곧 페이지라
  애초에 이 문제가 없다. IR의 provenance를 페이지 파일로 덮어쓰는 안은 "근거 위치"라는 의미가 깨져
  Evidence-First와 충돌하므로 기각하고, 딥링크 계층에서만 치환했다.

### Changed — 캐시 무효화

- `ANALYZER_VERSION` `codebase-viz@1.2.63` → `@1.2.65`. 이번 변경은 **shape는 그대로 두고 내용만**
  바꿔(provenance 좌표·nodeMap `f`/`l`) `isDiagramCache`의 shape 가드(nodeMap·tab3Kind 존재 확인)를
  구조적으로 통과한다 — 이 상수 범프가 **유일한** 무효화 수단이다. 범프하지 않으면 사용자는 수정
  이후에도 낡은 캐시로 map 지점에 계속 착지한다. (v1.2.46·v1.2.61에 이어 같은 함정의 3번째 반복.)
- v1.2.64가 `@1.2.63`에 머문 것은 정상이다 — 그 릴리스는 산출물의 shape도 내용도 바꾸지 않았다.

### Testing — 이 결함이 살아남은 이유

- RR 라우트/컴포넌트 좌표를 단언하는 테스트가 **0건**이었다(`nodemap-coverage.test.ts`·`node-map.test.ts`
  어디에도 없음). 수정 후 verify가 그냥 통과했다 — 통과가 곧 커버리지가 아니다.
- 추가한 가드 전부를 "수정을 되돌리면 FAIL하는가"로 실험 검증했고, **1차 시도는 실제로 허수였다**:
  대상 fixture가 JSX 분기를 타는데 createBrowserRouter 분기를 되돌려 그대로 통과했다. 분기별로 따로
  되돌려 보고서야 두 분기가 각각 독립적으로 같은 결함을 갖고 있었음이 드러났다.
- E2E(`node-deeplink-real-output.spec.mjs`)는 기존에 `nextjs-app-router`만 태워 RR 케이스를 구조적으로
  못 잡았다 — RR map 케이스를 추가(되돌림 실험으로 확인). Playwright 43/43 PASS.

## [1.2.64] — 2026-08-11

### Fixed — v1.2.63 실검증 후속 조치

- **딥링크 클릭 실동작 E2E 확인**: v1.2.63의 D0/D5/D8을 render-harness + Playwright로 재검증 —
  Wave A(T1/T2/T3) 무회귀, ep_* endpoint 클릭·hover 실동작(9/9), Tab3 검색 실동작, MD export
  무결성 전부 실측 통과(23/23). 전 fixture(36개) 스윕으로 `tab3Kind` 선언/실물 불일치·캐시 가드가
  신규 정상 캐시를 오탐 거부하는 회귀가 없음을 확인.
- **`handleOpenNode` 판정 로직을 순수 함수로 추출**(`message-guard.ts::resolveOpenNodeTarget`):
  webview 클릭 → 메시지 전송까지는 Playwright harness로 검증됐지만, 확장이 그 메시지를 받아
  "올바른 파일:라인을 여는지"는 vscode API에 묶여 있어 단위테스트가 불가능한 검증 공백이었다.
  nodeMap 조회(own-property 가드)·`r:'pair'` root 선택·경로 이탈 차단·1-based→0-based 라인
  변환을 순수 함수로 분리해 9개 케이스로 고정(동작 변경 없음, 프로토타입 오염·off-by-one 가드
  실효성을 실제로 깨뜨려 FAIL하는지 실증 후 원복).

## [1.2.63] — 2026-08-10

### Fixed — Wave A 완전종결: react-router FE Tab3(Data Flow) webview 렌더 결함 (D0, P0)

- **react-router FE 프로젝트의 Tab3가 webview에서 항상 "(No data)"였던 결함 복구**: `viewer.html`의 `renderDbView()`가 Tab3(dbScreen) 텍스트를 항상 erDiagram 파서로 재해석했다 — react-router FE의 Tab3(`buildFeApiCallDiagram`, `graph LR` flowchart)를 이 파서에 넣으면 테이블 0개로 잡혀 통째로 빈 화면이 됐다. 렌더러가 산출물 종류(`DiagramSet.tab3Kind: 'erd'|'flow'`)를 명시 선언하고, webview는 flow면 원문을 그대로 렌더하도록 분기했다. **CLI `.md` 산출물에는 이미 정상 존재해 텍스트 검증만으론 발견되지 않았던 결함**이었다 — 이 원인 도입(v1.2.47) 이래 webview에서 한 번도 정상 렌더된 적이 없었다.
  - MD/SVG export(온디맨드 렌더 경로)도 동일 결함이 있어 함께 수정 — Tab3를 화면에 띄우지 않고 바로 MD export하면 항상 빈 껍데기가 export됐다.
  - `tab3Kind` 필드가 없는 구버전 캐시(v1.2.62 이전 산출물)는 shape 가드로 무효화해 필드 누락으로 인한 재발을 막았다(`nodeMap` 가드와 동일 기법).
- **endpoint 박스(`ep_*`) 딥링크 복구**: endpoint는 `graph.nodes`에 없는 합성 노드라 nodeMap 마커로 표현할 IR 노드가 없었다 — `api-call` 엣지(실제 axios/fetch 호출 지점 file:line) 자체를 마커 대상으로 삼는 경로를 추가했다. 여러 컴포넌트가 같은 endpoint를 호출하면 대표 근거(verified 우선, 동순위는 id 사전순)를 순회 순서와 무관하게 사전 선정 — 화면 라벨과 클릭 시 점프 위치가 항상 같은 호출을 가리킨다.
- **Tab3 검색 지원(flow 모드)**: Tab1/2에 있던 검색바가 Tab3(react-router FE)에도 추가됐다. erDiagram 모드(테이블 기반 Tab3)는 여전히 검색 대상이 아니다(`.node` 요소가 없는 구조적 한계).

### Performance

- **대형 BE 패키지 트리 분석 성능 개선**: 패키지 계층이 깊은(체인형) Spring Boot 프로젝트에서 Tab1/Tab2 렌더가 비정상적으로 느려질 수 있던 결함을 고쳤다. 대표 라우트·대표 파일 판정 로직이 트리의 모든 노드마다 하위 서브트리 전체를 매번 새로 순회해, 깊이 N짜리 선형 패키지 구조에서 총 비용이 제곱으로 늘었다(실측: 깊이 3000 체인 18.3초 → 메모이제이션 후 1초 미만).

### Added — 검증 사각지대 보강

- 마커 누출(`%% nodemap:`) 회귀 가드를 `buildDiagrams`/`buildCombinedDiagram`/`renderMermaid`(CLI 경로)의 전체 반환 지점에 통합 — 특히 `renderMermaid`(CLI `.md` 출력)와 `buildCombinedDiagram`의 노드수초과 fallback 분기는 이전까지 어떤 테스트도 강제 트리거한 적이 없던 사각지대였다.
- webview 결함(D0류)은 렌더러 텍스트 검증만으로는 잡히지 않는다는 교훈 — 이번 검증은 `scripts/render-harness.mjs` + Playwright 스크린샷을 완료조건으로 삼았다.

### Docs

- `docs/analysis/ANALYSIS-v1262-requirements-verification-2026-08-08.md` §3-5(D5)에 정정 주석 추가 — 원 서술("라우트 박스는 딥링크되고 endpoint만 무반응")은 렌더러 텍스트 기준 관측이었고, webview 실물에서는 라우트 박스조차 렌더되지 않았다(D0).

## [1.2.62] — 2026-08-08

### Fixed — Wave A 실사용 결함 3건 (딥링크 전량 무반응 · 검색 오탐 · 대비 부족)

- **딥링크 전 노드 무반응 복구**: v1.2.61의 `nodeMap` 키는 bare `sanitizeId(node.id)`였으나 빌더는 접두사를 붙이거나(`leaf_`/`file_`/`pageleaf_`/`pkg_`) IR 노드와 무관한 합성 id(`T1_*`)로 노드를 선언해 **전량 키 미스**였다(실측 Tab1 0/5·Tab2 1/5). 두 갈래로 해소 — ① `resolveBySuffix`가 `_` 경계 **최장** suffix로 접두사 id를 역해석(짧은 suffix 우선 시 전혀 다른 노드로 오매핑되므로 최장 우선이 필수) ② IR 노드가 없는 집계 박스는 `%% nodemap:<declId>=<percent-encoded IR id>` 주석 마커로 **대표 노드를 명시 선언**(`%% table:` 선례와 동일 기법 — IR 확장 0, 빌더 시그니처 변경 0). 대표 = 하위 라우트 중 URL 세그먼트 최단, 동수는 id 사전순으로 결정론 고정. 마커는 `buildNodeMap` 추출 직후 3개 반환 경로 전부에서 제거되어 CLI `.md` 산출물은 byte-identical.
  - 마커 값은 분석 대상 리포의 파일·라우트 경로로 조립되는 **신뢰 불가 입력**이라 percent-encoding으로 `[A-Za-z0-9%._~()!*'-]` 안에 가둬 구조적으로 단일 라인·단일 토큰이 되게 했다. 원문을 그대로 실으면 파일명 하나의 개행만으로 마커가 여러 물리 라인으로 쪼개지고 strip이 첫 줄만 지워 나머지가 생 mermaid 소스로 남는다(실측 재현: `app/evil\nEVIL_NODE["pwned"]\n/page.tsx`가 노드 선언으로 렌더됨).
  - 실측 커버리지 14개 fixture **362/363 노드**(미매핑 1건은 IR 노드가 없는 `empty` 플레이스홀더). 비청킹·강제 청킹·FE↔BE 결합 3분기 전부 동일.
- **`ANALYZER_VERSION` v1.2.46 → v1.2.62**: 캐시 유효성 키가 15개 릴리스 동안 방치돼 `nodeMap`이 신설된 뒤에도 구버전 캐시가 "유효" 판정을 받아 nodeMap 없는 다이어그램이 재생됐다(딥링크·hover 무반응의 2차 원인). 버전 규율만으로는 사람이 빠뜨리는 순간 조용한 기능 사망이 되므로 `isDiagramCache`에 **`nodeMap` 존재 shape 가드**를 함께 걸어 이중화.
- **검색 매칭 규칙 교체 — 임의 부분열 폐기**: 구 매처는 쿼리 문자가 순서만 맞으면 흩어져 있어도 매치해(`customerMgmt`가 `user`에, `ProcCodeMgmtController`가 `order`에 매치) 무관한 노드가 대량 활성화됐다. **Tier 1 연속 부분문자열 → Tier 2 공백 구분 다중 term AND(순서 무관) → Tier 3 단어경계/camelCase 약어(2자 이상)** 3단계로 교체. tier별 base(200/100/10)를 품질 점수(0~30: 단어경계 시작 +20, 밀도 보정)와 분리해 tier 간 순위가 품질에 의해 뒤집히지 않게 했다. Tier 3 이니셜은 라벨 장식(`📁`·`SSR`·`2 routes`)을 뺀 의미 있는 이름에서만 뽑는다.
  - 실측(partner-mock 86노드): `deco` 44→11, `order` 32→1, 약어 `dsc` 40→3. Tier 2는 순서 무관이라 신규 매치도 생긴다(`mgmt agency` 2→4 — 전부 두 term을 실제 포함하는 정상 매치).
- **매칭/비매칭 대비 강화**: 비매칭 `opacity .15 → .08 + grayscale(1)`(`.cluster`에도 적용), 매칭에 `stroke-width 2.5px` + 시안 글로우 신설, 검색 중 엣지는 `opacity .12`로 후퇴, "N건 일치"/"일치 없음" 카운트 표시(`aria-live`, 4개 로케일). 매칭 하이라이트가 stroke **색**을 건드리지 않는 것은 의도 — mermaid가 `classDef`를 inline style로 박아 stylesheet가 못 이기고, 애초에 그 색은 렌더링 모드(SSR/CSR/SSG) 정보라 덮으면 의미가 소실된다.
- **청킹 임계 판정에서 마커 제외**: `shouldChunk`가 webview가 받지 않는 마커 텍스트까지 세면 사용자가 안 보는 바이트 때문에 row-mode가 켜진다. 현재 실측 영향은 임계의 0.16%(최대 Δ7,900자)지만 결합 자체를 제거.

### Added — 검증 사각지대 보강

- `packages/renderer/src/nodemap-coverage.test.ts` — **실제 `buildDiagrams` 출력**의 선언 id를 nodeMap과 대조하는 커버리지 스펙(14 tests). 기존 Playwright 스펙은 손으로 쓴 `graph TD\n <sid>["..."]` 하니스만 태워 실제 빌더 id를 한 번도 지나지 않았고, 그래서 전 노드 클릭 무반응이 전 게이트 GREEN 상태로 배포됐다. 강제 청킹 케이스 4건 포함(`chunked=true` 전제를 먼저 단언 — 없으면 비청킹을 두 번 재고 통과한다).
- `tests/playwright/node-deeplink-real-output.spec.mjs` — 실 산출물을 렌더해 클릭까지 태우는 E2E.

### Known issues

- react-router FE 프로젝트의 Tab3(API 호출 다이어그램)는 `graph LR` flowchart라 클릭 리스너가 붙지만, endpoint 박스(`ep_*`)는 IR 노드로 등록되지 않는 합성 노드라 클릭해도 반응이 없다. 라우트 박스는 정상 동작.

## [1.2.61] — 2026-08-05

### Added — UX Wave A: 딥링크·hover·검색 (T1/T2/T3)

- **T1 노드 클릭 → 소스 코드 딥링크**: Tab1/Tab2 SVG 노드를 클릭하면 원본 파일의 해당 라인으로 바로 이동한다. 렌더러가 다이어그램 emit 시점에 `Map<sanitizedId, {filePath, line, confidence, ...}>` 사이드채널(`DiagramSet.nodeMap`)을 생성해 webview에 함께 전달 — webview는 경로를 전혀 다루지 않고 sanitized id만 확장으로 보내며, 확장이 자기 nodeMap으로 조회해 `resolveWithinRoot`로 root 이탈을 방어한 뒤 `showTextDocument`로 jump한다. 전달 기구는 계획 단계의 mermaid `click` 지시자 emit 대신 **DOM 이벤트 위임**으로 확정(기존 보안 회귀 테스트·mermaid #4346과 충돌 회피). row-mode(다중 청크)에서도 chunk-local로 정상 동작.
- **T2 노드 hover → tooltip**: filePath:line + confidence 배지(verified/manual/inferred) + inferred 시 inferenceChain 첫 항목을 노출. T1과 동일한 nodeMap 사이드채널 재사용.
- **T3 라우트/컴포넌트 fuzzy 검색바**: Tab1/Tab2 상단 검색 입력, 미매칭 노드는 opacity 0.15로 dim 처리, ESC로 초기화. 매치 밀도 보정(`+(query.len/text.len)*10`)으로 동점 정렬 퇴화 방지. Tab3(ERD)는 `.node` 클래스가 없어 범위 밖.
- FE/BE 페어 분석 시 nodeMap 병합은 confidence 랭크(verified/manual > inferred) 우선 — Evidence-First 준수, IR(`IRGraph`) 확장 없음(`DiagramSet` 산출물 확장).

### Added

- GitHub star 배지를 `package.json` badges 필드(마켓플레이스 미노출 결함) 대신 README.md 마크다운 배지로 이전.

## [1.2.60] — 2026-08-03

### Fixed — MyBatis queries 엣지 부재 복구 (C4 커버리지 갭)

- **Repository→table `queries` 엣지 신설**: MyBatis 경로가 Tab3 ERD 렌더러(`erd/db-diagram.ts`)를 관계선 0건으로 굶기던 결함 복구(partner-mock 실측: 엔티티 19개·관계선 0 → 관계선 정상 생성, 신규 프록시 엔티티 0개). `mapper-xml-parser`가 namespace 매칭 시점에 XML SQL 본문에서 접근 테이블명을 Repository 단위로 1-pass 추출(`repoTableRefs`) → adapter가 최종 `tableNodes`(ORM·Flyway 2중 dedup 후) 기준 정확 이름매칭으로 엣지 생성(`repo-table-edges.ts`, 실패 시 침묵). statement 단위 2-pass 브리지는 Tab3 §4 "변경 없음" 위반·depth 예산 부족으로 기각.
- **`extractTablesFromSql` 위생 강화**: SQL 라인주석(`--`)·문자열 리터럴·`WITH [RECURSIVE] ... AS(...)` CTE 별칭을 결과에서 차감해 유령 테이블 오탐 제거(리터럴 제거를 주석 제거보다 먼저 수행해야 `'a--b'` 같은 리터럴이 뒤 FROM절을 삼키지 않음).

### Fixed — FE↔BE cross-edge 렌더링 결함

- **결합(pair) 다이어그램 실제 배선**: `buildCombinedDiagram`이 계산만 되고 익스텐션 실행 경로(`analyzer.ts::runAnalysis`)에서 한 번도 호출되지 않던 결함 수정. pair 분석 시 Tab1이 결합 다이어그램으로 치환된다.
- **matched-only 필터**: crossEdges에 실제 참여(verified 또는 dynamic-segment-match)하는 라우트만 렌더 — 노드 수가 O(전체 라우트)가 아닌 O(crossEdges)가 되어 대형 페어에서도 노드 임계 문제가 구조적으로 소멸.
- **Tab2/Tab3 chunk fallback 경유**: 대형 BE 페어에서 raw 호출로 인한 webview freeze 재발 방지.
- **Tab3 FE·BE 테이블 합집합**: 이전엔 BE 테이블만 전달해 FE(Supabase 등) 테이블이 전량 누락되던 결함 수정.
- **조용한 강등 금지**: BE 미인식 페어는 FE 단독 뷰 + 안내 노트로 폴백, crossEdges 전량 dangling이면 "매칭 없음" 안내 노드 표시(빈 다이어그램 없음).
- **pair 캐시 도달 경로**: `openViewer`·`selectFolder`·`activate` 커맨드가 마지막 pair 상태를 몰라 pair 캐시를 못 읽던 결함 — 메인 폴더별로 스코프된 pair map(`codebaseViz.pairFolderMap`)으로 정확히 조회. `DiagramCache`에 `analyzerVersion` 검증 추가(구 버전 pair 캐시 재생 방지).

### Added

- GitHub star 배지(`package.json` badges 필드, shields.io).

## [1.2.59] — 2026-07-22

### Added — BE Adapter Phase 2 (Task7, BE-DIAGRAM-STANDARD v1.1→v1.2)

- **C1 — MyBatis statement 노드**: Mapper XML의 `<select>/<insert>/<update>/<delete>`를 `statementId [SQL_TYPE]` ComponentNode로 추출(ST7-2 옵션A — 신규 NodeKind 없이 naming convention, IR 확장 0). Tab2 DI 체인이 Controller→Service→Impl→Repository→XML→Statement 6단까지 실명 노드로 렌더. cross-pkg ghost-node 게이트는 `isPackagelessNode` 단일 판정으로 통합(렌더링+cost추정 recurse 양쪽).
- **C2 — Route→Controller `handles` 엣지**: 신규 EdgeKind `handles` (springboot 전용, 파일경로+Controller 접미 매칭). endpoint와 처리 컨트롤러의 관계를 IR에 명시.
- **C3 — `@FeignClient` 외부시스템 노드**: Feign 인터페이스를 ComponentNode로 등록(`provenance.adapter` 마커) → 기존 di-parser 타입명 매칭이 무변경으로 DI 엣지 생성. Tab2에서 `:::ext`(주황) 렌더. 동명 일반 컴포넌트 존재 시 Feign 쪽 조용히 제외(거짓 DI 엣지 방지, 테스트 2건). RestTemplate/WebClient/SAP RFC/`@JmsListener`는 정적추출 신뢰도 문제로 defer.
- **C4 — 테이블 cluster 뱃지**: Tab1 컨트롤러 leaf에 DI 체인(`calls`, depth≤6) 도달 `queries` 엣지의 테이블 목록을 `🗄` 1줄로 표시. IR 변경 0. (알려진 갭: MyBatis는 파일명↔테이블명 토큰 매칭 불가로 queries 엣지가 없어 뱃지 미표시 — stmt→table queries 엣지가 후속 후보)
- **K3 — Controller 색 분리**: BE Controller가 FE SSR `ssr`(녹색)을 재사용하던 충돌 해소 — 신규 `ctrl`(teal) 클래스, 모든 BE 어댑터 적용. Fullstack pair-analysis 모호성 제거.

### Security — Tab2 라벨 이스케이프 (ship 전 보안검토 반영)

- BE Tab2 DI 체인의 plain quoted 라벨(`["${name}"]`)에 신뢰 불가 이름(MyBatis XML statement id 등 분석 대상 리포 통제 값)이 그대로 삽입되던 것을 `escapePlainLabel`(개행 제거·`"`→`'`)로 차단 — 라벨 조기 종료 후 mermaid 구문 주입 여지 제거. leaf.ts 사설 `escapeMd`를 `helpers/label-escape.ts`로 공용화. 주입 차단 테스트 추가(RED→GREEN), 기존 fixture 스냅샷 byte-identical(정상 이름엔 no-op).

### Changed — 툴체인 (Task1~4, 6)

- mermaid 번들 11.14.0→**11.16.0**(upstream per-subgraph direction Dagre fix 포함) + nested-LR 재실측(동작 불변 — 표준 유지, `tests/playwright/subgraph-direction.spec.mjs` 신설).
- Node engines 20→**22** · vitest 2→**4** · ts-morph 23→**28**.
- **oxlint correctness 게이트** verify.sh [2/4] 편입(`.oxlintrc.json`, deny 위반 시 실패). 전 패키지 correctness 위반 정리(기계적 수정만, 동작 변화 0).
- extension 레이어 테스트 커버리지 확충: `vscode` mock 하니스(`test-support/vscode-mock.ts` + vitest alias) 신설, sidebar/panel/webview/extension(analyze·cache·LLM 흐름) ~50 테스트 추가.
- ast-grep 하이브리드 PoC(Task5)는 parity 검증 후 **NO-GO** 종결(fine-grained 추출에서 ts-morph 대비 이점 없음) — 스파이크 코드 미반입.



### Security — 웹뷰 보안 강화 (ST0~ST3)

- **ST0**: webview.ts↔viewer.html `window.__X__` 전역 쌍 매칭 vitest 테스트 + package.json contributes ID(commands/views/configuration) 실사용 여부 검사 스크립트를 verify.sh에 편입. 최초 실행에서 죽은 전역 `__CODESIGHT_LOCALE__`(webview.ts + 3개 harness 스크립트) 실제 발견·제거.
- **ST1**: 분석 대상 코드베이스 유래 문자열(테이블/컬럼명·FK·에러메시지)을 webview DOM에 삽입하기 전 이스케이프(`webview-escape.ts` safeJson/escapeHtml, viewer.html `esc()`). 렌더러가 만드는 다이어그램 소스 문자열(`<br/>`, `**bold**` 등 mermaid 의도적 마크업)은 불변 — Playwright로 3탭 렌더 확인. mermaid fallback 경로에 `htmlLabels:false` 추가(SEC-4).
- **ST2**: postMessage 핸들러 명시 화이트리스트(`message-guard.ts`) + `openExternal`을 `https://`만 허용(기존엔 임의 스킴 허용).
- **ST3**: CSP `script-src`에서 `'unsafe-inline'`·`'unsafe-eval'` 제거, 매 렌더 nonce 발급(웹뷰 3종 — 메인 뷰어·사이드바·분석 패널 전부). onclick/onchange 인라인 핸들러 33곳(extension webview 3종 한정)을 addEventListener로 전환. `unsafe-eval` 제거는 mermaid.min.js `eval(`/`new Function(` 0건 확인 + 실제 프로덕션 CSP를 재현한 Playwright 실측(3탭 렌더·탭전환·줌·DB뷰 전환 무위반)으로 검증 후 적용. v1.2.40부터 이미 죽은 코드였던 ELK(`mermaid-layout-elk`) 레이아웃 번들(1.6MB, 매 vsix에 실렸음) 완전 제거.

### Fixed — graph 캐시 상시 미스 (ST6)

- `.codebase-viz/cache.json`을 extension의 diagram 캐시와 analyzer의 graph 캐시가 같은 파일명으로 공유해, 분석 직후 diagram 캐시가 graph 캐시를 덮어써 `analyzerVersion` 필드가 사라지고 매번 전체 재분석되던 결함(ARCH-1). `cache-graph.json`/`cache-diagrams.json`으로 분리 + shape 가드 + 구 파일 마이그레이션.

### Changed — 내부 위생 (ST4/ST5/ST7)

- `codesight` 잔재 전면 정리 완료: 남아있던 `window.__CODESIGHT_*__` 전역 3종(webview + dev harness 스크립트), CLI `CODESIGHT_API_KEY`(신규 `CODEBASE_VIZ_API_KEY`, 구명 fallback 유지), fallback 뷰어의 "CodeSight" 로고 텍스트.
- extension host의 동기 `fs` 호출(캐시 읽기/쓰기, 뷰어 템플릿 읽기)을 `fs/promises`로 전환(PERF-1).
- LLM 클라이언트가 에러 종류를 구분하지 않고 무조건 1회 재시도하던 것을 4xx(인증/잘못된 요청)는 즉시 표면화, 429/5xx 등만 재시도하도록 수정. 재시도도 실패하면 첫 에러를 보존해 함께 노출(ERR-1).
- provider 기본값(`'anthropic'`) 하드코딩이 3곳(llm/client.ts·extension.ts·core/pipeline.ts)에 중복돼있던 것을 단일 상수로 통일(ARCH-2). FE Tab1(Rendering Architecture) 다이어그램 빌더를 `fe/tab1.ts`로 분리(v1.2.47 모듈 분리의 마지막 잔여물 — 출력 byte-identical, 기존 회귀 테스트 전부 GREEN).
- `.gitignore`에 이미 있었지만 무의미했던 vsix 추적 잔재(구버전 4개 tracked + 로컬 빌드 산출물 57개 237MB) 정리.

## [1.2.57] — 2026-06-29

### Changed — 백엔드 Tab1 endpoint collapse (BE-DIAGRAM-STANDARD R-T1.6 amendment)

- **BE Tab1**: 컨트롤러 endpoint를 별도 `endpoints_<Ctrl>` subgraph(개별 노드 Y축 적층 + `---` 체인)에서 **leaf 컨트롤러 노드 안 markdown multiline collapse**로 전환. `📄 **ControllerName** [prefix]` + 구분선 + `**METHOD** /suffix` 1행씩. endpoint 많은 컨트롤러의 Y축 비대 해소(12-endpoint 컨트롤러 기준 다이어그램 높이 ~2.7× 단축) + 메서드 bold로 항목 구분 명확.
- **근거**: 사용자 제기 — 최종 depth(endpoint)가 Y축 적층되어 endpoint 많은 컨트롤러 열이 무의미하게 비대. 축 회전(LR/grid)은 mermaid v11 nested subgraph LR 미지원으로 폐기, materialize 양 축소(collapse)가 정답.
- `be/leaf.ts emitControllerFileLeaf` 재작성 + `be/tab1.ts leafCost` route당 `*2+2` → 상수 2(endpoint가 노드/엣지 아님). URL 경로 markdown 메타문자(`_ * \``) escape. viewer `htmlLabels:false`(SVG 텍스트)에서 markdown bold 정상 렌더 확인.
- 모든 BE 어댑터(Spring Boot·Django·NestJS·FastAPI·Flask) 적용. FE 다이어그램 불변. 신규 `be/leaf.test.ts`(3 TDD), CLI fixtures 스냅샷 9건 재생성(net -188라인). 분석 문서 `docs/analysis/be-tab1-y-axis-depth-bloat.md`. verify.sh ALL PASS · 회귀 0.

## [1.2.56] — 2026-06-24

### Changed — `codesight` 잔재 전면 제거 (브랜드 정리)

- 명령어·설정·뷰 ID `codesight.*` → `codebaseViz.*`, 뷰 컨테이너 `codesight-{sidebar,panel}` → `codebaseViz-*`. **Breaking**: 기존 `codesight.*` 설정·키바인딩·저장된 API 키가 리셋됨(마이그레이션 없음) — API 키는 1회 재입력 필요.
- 캐시 `.codesight/` read fallback 제거(`.codebase-viz/` 단일 경로). 게시 vsix에 섞이던 `.codesight/` 잔재 캐시 제거.
- GitHub 레포 `cubha/codesight` → `cubha/codebase-viz`. 옛 vsix·legacy 키 마이그레이션 코드 제거.
- 동작·다이어그램 출력 변화 없음. verify.sh PASS.

## [1.2.55] — 2026-06-24

### WINA-FE Tab1/Tab2 재설계 — 516라우트 반복 래퍼·도메인 누락 근본 수정 + 폴더 박스 반복 완화 (회귀 0)

사용자 보고: 실 레포(react-router 516라우트·24테이블 WINA)에서 Tab1이 도메인마다 아키텍처 래퍼(`Browser›Router›React`)를 **반복** 그리드로 그리고("32 rows"), 박스 granularity가 top-level 도메인이 아닌 하위 세그먼트(`role`/`notice`/`bbs`)로 산란 + **도메인 일부 누락 체감**. 요구: 단일 아키텍처 래퍼 안에 root→대→중→소 디렉터리 구조, 누락 0.

- **근본 원인**: `buildDiagrams`(mermaid-renderer.ts)가 v1.2.53에서 이미 단일·소형이 된 `buildRenderingDiagram`을 `rendering` 필드에서 **routeCount(516)>nodeThr(300) 게이트로 `buildWithChunkFallback` 재청킹** → ① 청크마다 wrapper 반복 ② `findBranchingGroups`가 단일 도메인 부분트리를 하강해 sub-segment 산란 ③ top-level 도메인이 박스로 안 보여 누락 체감. 단일 원인이 3증상 전부 유발(v1.2.53 "Tab1 청킹 폐지" 의도가 누수).
- **ST0 안전픽스**: `rendering`을 `buildWithChunkFallback`에서 **직접 `buildRenderingDiagram(graph)` 호출로 교체** — routeCount>300 재청킹 누수 차단.
- **ST1 Tab1 재정의**: 도메인 요약 박스(v1.2.53) → **full-depth 폴더 개요**(신규 `fe/tab1-tree.ts` `buildNestedFolderOverviewLines`). 단일 래퍼 안에 URL 디렉터리를 root→대→중→소 중첩 폴더 subgraph로 emit, 폴더 헤더 = `📁 /name · N routes`(하위 route 재귀 합 배지). top-level 형제는 단일 `~~~` chain으로 X축 분포(render-check 실측: chain aspect 1.95 vs row-wrapper 0.05 mermaid v11 무시 재확인). 개별 route URL 열거는 Tab2 위임(탭 차별성).
- **ST2 Tab2 보강**: leaf에 **전체 라우트 URL**(`🔗 /full/path`) 병기(`labels.ts routeUrlLine` 공유 헬퍼, Tab2 4경로). 마지막 세그먼트 유지(추가). IR/provenance 무변경.
- **ST6 폴더 박스 반복 완화**(사용자 후속 피드백 "여러 폴더박스 반복이 별로"): collapse 기준을 **하위 재귀 라우트 수**로 재정의(`isCollapsed`). 자식이 전부 단일라우트면 카운트 박스 1개로 collapse. 혼합 폴더는 다중(≥2) 자식만 구조로 펼치고, **단일라우트 자식 2개+는 하나의 `📄 name1·name2·name3 +N (M pages)` 집계 박스**로 묶음(이름 최대 3 노출). WINA Dummy 실측: "·1 route" 박스 **141→17**, subgraph 57→42, 카운트박스 184→117, 집계박스 13 신설. **도메인 누락 0·chain ref 19 불변.**
- **검증**: 사용자 제공 실 WINA 라우터 paste로 Dummy Repo(`/tmp/wina-dummy`, 283 route·245 component·20 도메인) 직접 분석(vsix 빌드 불가 환경) → Tab1 BROWSER wrapper 1개(반복0)·청크 false·도메인 누락 0·특수패턴(camelCase headOffice·partner dual-prefix matMgmt+materialMgmt·agency import.meta.glob+file 분기) 전부 OK. verify.sh **PASS**(tsc+vitest)·회귀 0·스냅샷 Tab1만 재생성. ST1~ST5 + ST6 TDD(유효 RED→GREEN). 표준 FE-DIAGRAM-STANDARD v1.2.55 re-amendment(§10, R-T1.2/R-T1.7 정정 + §10.4 collapse·집계).

## [1.2.54] — 2026-06-22

### WINA-FE Tab1 LLM 오분석 근본 수정 — deployTarget 뒷문 차단 + 백엔드 환각 corroboration 게이트 (회귀 0)

사용자 보고: 실 레포(react-router 516라우트 웹 SPA)가 LLM=true에서 Tab1 "전체 아키텍처"를 전부 `📱 Mobile · iOS/Android / ⚛ React Native · Expo` + `WINA Backend API · spring-boot` + `🐘 PostgreSQL`로 오분석(LLM=false면 정상 `🌐 Browser · React Router · SPA`). 근본 원인: 정적 어댑터가 결정한 `framework`는 LLM이 덮어쓰지 못하게 가드(`pipeline.ts:97`)가 있으나, **인접 메타 필드(`deployTarget`·`backends`)가 가드 밖으로 무조건 주입**되어 뒷문 우회.

- **Fix1 (플랫폼 오분류)**: `renderer/src/fe/infra.ts`의 `hasExpo` 판정에서 `|| meta.deployTarget === 'mobile'` 절 삭제 → `fw === 'expo'`만. LLM이 발명한 `deployTarget='mobile'`이 react-router framework 가드를 우회해 전체를 Mobile/RN으로 래핑하던 결함 해소. 진짜 Expo는 `stack-detector.ts:79`가 `expo` deps를 `framework='expo'`로 정적 감지하므로 **무손실**. (`deployTarget`은 이후 inert 메타데이터 — 읽는 곳 0.)
- **Fix2 (백엔드 환각, Evidence-First)**: LLM `backendServices` 주입을 순수 헬퍼 `core/src/backend-corroborate.ts`로 추출 + corroboration 게이트 적용. 상세 백엔드 블록(framework·modules·dbType)은 **수집 fileContents에 실제 서버 코드 증거가 있을 때만** 렌더(package.json server-dep `@nestjs/express/fastify/koa/...` 또는 `.controller.ts` 키). FE-only 레포의 발명 백엔드(`collectFiles`가 `.java`/`.py` 미수집 → Spring/Django는 구조적 항상 환각)는 드롭 → renderer가 증거 기반 generic gateway(External REST API)로 fallback. **설계 결정**: 원 계획의 "BE파일 OR api-call edge" 게이트를 **api-call edge 제외(Design B)**로 정정 — api-call edge는 "백엔드 존재"만 증명하지 "framework=express+모듈"을 증명하지 못하며, 그 신호는 이미 renderer가 별도 generic gateway 분기로 처리(절대원칙 Evidence-First·Less is More 부합). 이에 따라 v1.2.43 ST3의 "LLM backends 무조건 우선" 명세를 "FE-only 환각→드롭+gateway fallback"으로 정정.
- 검증: verify.sh **PASS**(tsc+vitest) · **817 passed/1 skip/0 fail** · 회귀 0 · 기존 스냅샷 byte-identical. 3 SubTask 전부 TDD(유효 RED→GREEN). 신규 단위 `fe/infra.test.ts`(4) + `core/backend-corroborate.test.ts`(6), 통합 e2e: WINA 완전 재현(`deployTarget=mobile` + express/PostgreSQL 환각을 FE-only react-router fixture에 주입 → React Router·SPA 분류 유지 + BACKEND_0 미렌더 + gateway fallback) + 무-api-call-edge 깨끗한 SPA 출력 봉인.

## [1.2.53] — 2026-06-18

### React Tab1 도메인 요약 재정의 + FE Tab2 Y축 연결선 표준화 (사용자 v1.2.52 후속 3현상 · 회귀 0)

사용자 보고(1.2.52 결과): ①Tab1·Tab2 레이어 불일치(partner 내부 matMgmt 별도 레이어) ②Tab1 프레임워크·BE 연계 누락(URL만 분석) ③레이어 내부 Y축 연결선 과대·불균일. 코드레벨 분석으로 real-bug vs 구조적 판정 → `docs/analysis/v1.2.52-fe-tab1-yaxis-findings.md`.

**진단(귀속 정정)**: v1.2.52는 viewer 단독이라 무관. 실제 원인은 v1.2.51 C2 청킹 게이트(`branchingGroups>5`)가 chunked 경로(`buildRouteRowDiagram`)로 빠뜨려 **Tab1 인프라 wrapper(R-T1.1)·외부분기(R-T1.5)를 통째로 폐기**시킨 것 + Tab1이 URL 전 세그먼트를 중첩 레이어링하던 설계.

- **Phase A — Tab1 도메인 요약 재정의 (1b·1a 해소)**: Tab1을 top-level URL 도메인 **요약 박스**(`📁 <도메인> · N routes`, `buildDomainSummaryLines`)로 재정의. 라우트 leaf 열거·하위 세분화는 Tab2로 위임 → 노드 수 O(도메인)라 **청킹 폐지**(R-T1.7 v1.2), wrapper·외부분기 항상 유지. 도메인>`GROUPS_PER_ROW`는 inner-row wrapper 줄넘김(청킹 아님). 실측: 7도메인 앱 0 청크·`BROWSER/ROUTER/REACT`+`API LAYER` 유지, partner 내부 matMgmt 별도 레이어 소멸. FE-DIAGRAM-STANDARD R-T1.2/R-T1.3/R-T1.4/R-T1.7 amendment(§9).
- **Phase B — FE Tab2 Y축 표준화 (2)**: Tab2(도메인 트리·file-tree)는 평탄 subgraph + visible `pkg-->leaf` edge라 spacing 옵션 정상 반영(BE Tab2 선례). 신규 `FE_TREE_INIT`(`rankSpacing:24, nodeSpacing:40, padding:8`)로 기본(≈50)이 깊이마다 Y축 연결선을 과도·불균일하게 늘리던 문제 표준화. webview 실측(before/after): `matMgmt→decoSheet→leaf` 세로 간격 ~114/127px→~89/100px, 겹침 0. Tab1(nested+`~~~`+외부edge)은 spacing 무시 케이스라 미적용(RENDERING_INIT 유지).
- 검증: verify.sh **PASS**(tsc+vitest) · **806 passed/1 skip/0 fail** · 스냅샷 재생성(Tab1 rendering 도메인박스 + Tab2 init 라인, Tab3/summary byte-identical) · 신규 단위테스트(tab1-summary 4 + tab2 spacing 1). 구 Tab1 청킹/leaf 계약 단언 8건은 표준 v1.2 변경에 맞춰 갱신(명시).

## [1.2.52] — 2026-06-17

### 대형 라우트 viewer perf 개선 — 점진 주입 + content-visibility (레버 1+2 · 회귀 0)

사용자 보고(1112 route 분석 결과 viewer 버벅임·로딩 지연)의 backlog 항목. **viewer.html 단독** 변경 — analyzer/IR/diagram 출력 무변경. baseline 실측으로 scope를 확정(advisor 검증).

근본 진단: 기존 `renderChunked`가 청크(~22개)를 **전부 렌더 → 문자열 누적 → 마지막 1회 `innerHTML`** 주입. → ①첫 행과 전체가 동시 노출(빈 화면 대기 = "로딩 오래걸림") ②전 SVG 동시 DOM 상주로 스크롤/줌/팬마다 화면 밖까지 repaint(버벅임).

- **레버1 (content-visibility)**: `.row-diagram { content-visibility:auto }` + fit 단계에서 실측 높이로 `contain-intrinsic-height:auto <N>px` 갱신(height축만 — 폭은 grid `minmax(560px,1fr)` track 결정). off-screen 청크 paint/hit-test 스킵 → 상호작용 비용이 청크 수에 비례하지 않음. `fitS=1` hardcode·`cellW` dead라 size containment가 fit 비간섭(unblock 근거).
- **레버2 (점진 주입)**: `renderChunked` → `renderChunkedInto(t, inner, idPrefix, diagram, onSvg)`. 다중청크는 row-mode grid를 루프 전 켜고 청크별 즉시 `append`+rAF yield, 루프 후 `activateRowMode` 1회로 배선 재사용. 단일청크·최종 레이아웃은 기존과 동일.
- **측정 delta** (`scripts/viewer-perf.mjs`, headless, 22청크≈1100route): time-to-first-row **1459ms→333ms (−77%)** · time-to-all-rendered 1459→1559ms(+100ms, 비차단 스트리밍).
- **레버3(IntersectionObserver 가상화) 보류**: baseline상 총 렌더가 wall이 아니고 progressive로 비차단화됨 → 100+청크 초대형에서만 가치. 실 프로젝트 재실측에서 총 스크롤이 여전히 느리면 후속 진입.
- **부수**: `playwright` devDep 1.59.1→1.60.0 (러너/`@playwright/test` 버전 skew로 viewer spec이 실행조차 안 되던 latent 버그 해소).
- 검증: verify.sh **PASS**(tsc+vitest) · Playwright **6/6**(기존 결함1·2·3 회귀 0 + 신규 content-visibility assertion + 스크롤활성 청크 zoom/drag/rz 동작) · 9청크 그리드 시각 정상(에러박스 0).

**알려진 한계**: 1+2는 첫 페인트 지연 + 상호작용 jank를 고침. 초대형 입력의 **총 dagre 레이아웃 시간 자체는 불변**(레버3 후속).

## [1.2.51] — 2026-06-16

### 사용자 단일검증 3건 통합 (A: React Router · B: Spring Boot · C': Tab1 가독성 · 회귀 0)

사용자 실제 React Router·Spring Boot 프로젝트 단일검증 보고 3건을 FAIL 재현 fixture로 근본 원인 확정 후 통합 수정. verify.sh **801 PASS** · 1 skipped · 회귀 0(스냅샷 byte-identical).

#### 묶음 A — React Router 라우트 통째 누락 + agency 도메인 레이어 (`adapters/_shared/ts-config-loader.ts` · `renderer/fe/tab2-domain.ts`)

근본 원인: 파서가 아니라 **tsconfig path alias 해석**. `loadTsConfigPaths`가 `baseUrl` 미반영 + `"*"` 타겟 오처리 + `extends`/`references`(Vite `tsconfig.app.json` 스플릿) 미추적 + JSONC 주석 throw. 사용자 `baseUrl:"src"`+`"@/*":["*"]`에서 `appRoutes.map()` 통과 240 라우트 전멸(하드코딩 `<Route>`만 생존).

- **A-1** `stripJsonComments` + `buildPathsMap`(baseUrl 기준 디렉토리 + `"*"`→빈 suffix) + `extends`/`references` 1-hop 추적(depth≤5).
- **A-2** agency 등 `import.meta.glob` 동적 컴포넌트 라우트 → `fe/tab2-domain.ts` URL path 폴더 세그먼트로 도메인 레이어링(다른 도메인과 동일 분리). 재현 fixture `mini-react-router-baseurl-app`·`mini-react-router-tsref-app`·`mini-react-router-wina-app`.

#### 묶음 B — Spring Boot Tab2 대형 도메인 "Maximum text size exceeded" (`renderer/be/pkg-tree.ts` · `be/tab1.ts` · `be/tab2.ts`)

근본 원인: BE chunking이 top-level 패키지 1단계만 분할 → 큰 도메인 1개가 webview cap(maxTextSize 1M / maxEdges 2000) 초과. v1.2.50 N-ary DI fan-out이 컨트롤러당 노드/엣지 증폭으로 발현. FE는 이미 `splitGroupsByNodeBound` 2차 분할 보유, BE만 부재(비대칭).

- **B-1** `pkg-tree.ts`: `estimateChunkCost` + `splitTreeByBudget`(서브패키지 재귀 분할, `BE_CHUNK_COST_BUDGET=1500`) + `onOverflow` 로그(silent truncation 금지). Tab1·Tab2 적용. **예산 초과 시에만** 분기 → 기존 출력 byte-identical.
- 검증: 합성 800·3000 컨트롤러 게이트 테스트(각 청크 edges<2000·bytes<1M) + 700-feature 실제 fixture 화면 스모크(1.15MB 단일 도메인 → 5 rows, 에러박스 0).

#### 묶음 C' — Tab1 소형-다도메인 가독성 (`renderer/helpers/layout.ts` · `mermaid-renderer.ts`)

근본 원인: top-level 형제 그룹>5인데 route<100이면 단일 `graph LR`로 강제 → 모든 도메인을 한 가로줄에 깔아 ~20:1 띠로 압축(전 도메인 렌더되나 가독성 X). 게이트 `routeCount>100` 단독 + 분할기 route 수만 bound.

- **C'-1** `splitGroupsByNodeBound`에 `maxGroups` bound 추가(top-level 형제 수, 재귀엔 미전파 — 938 route 과분할 회피). Tab1 게이트 `routeCount>100 OR branchingGroups>GROUPS_PER_ROW(5)` → chunked grid. viewer row-mode CSS 그리드가 readable 배치.
- **v1.1.53 게이트 반전**: 'Y축 단조 나열' dump는 v1.1.6 T3 grid로 이미 해소(실측 확인). 스펙-반전 테스트 2건 명시 갱신.
- **알려진 delta**: chunked Tab1은 SPA 래퍼·data-layer framing 드롭(>100 route 경로와 동일 동작). Tab2 url-grouping 다도메인은 후속 scope.

## [1.2.50] — 2026-06-12

### Spring Boot DI 체인 5단 fan-out + React Router 도메인 레이어 (사용자 단일검증 보강 2건 · 회귀 0)

사용자 실제 Spring Boot·React 프로젝트 단일검증에서 보고된 2건을 통합 수정. 각각 FAIL 재현 fixture로 근본 원인 확정. verify.sh **778 PASS** · 1 skipped · 회귀 0 · IR EdgeKind 확장 0.

#### 묶음 A — Spring Boot Tab2 "Controller에서 끊김" (`adapters/springboot/*` · `renderer/be/tab2.ts`)

근본 원인: Lombok `@RequiredArgsConstructor` 미인식으로 DI edge 0 → Tab2가 Controller에서 단절. 재현 fixture `mini-spring-lombok-mybatis-app`(DI 0 FAIL).

- **A-1 di-parser** — Lombok `@RequiredArgsConstructor`/`@AllArgsConstructor` final 필드 주입 인식(명시 초기화 제외) + `super_interfaces` `implements` 추적(`addImplementsEdge`: Service interface → ServiceImpl `calls` 엣지).
- **A-2 component-parser** — 무어노테이션 `*Service`/`*Repository`/`*Dao`/`*Mapper` interface 등록 게이트 완화(`isNamedInterfaceComponent`). 일반 interface는 제외(Less is More).
- **A-3 mapper-xml-parser (신규)** — `<mapper namespace="FQN">` ↔ 컴포넌트 FQN(`java/` 이후) 정확 매칭 → XML ComponentNode(`*.xml`) + Repository→XML `verified` `calls` 엣지. `adapter.ts` 배선.
- **A-4 renderer** — 고정 2-hop DiChain 폐기 → **N-ary 재귀 emitter**(깊이 가드 6, `di_<ctrl>__<compId>` namespace, visited 순환 가드). 다중 Service 인라인 + ServiceImpl→다중 Repository fan-out + Repository→XML 5단. cross-pkg는 `(external)` placeholder, XML은 terminal 실노드. BE-DIAGRAM-STANDARD v1.1(§3 R-T2.2·2.5·2.7).

#### 묶음 B — React Router route 누락 + src/pages 도메인 레이어 (`adapters/reactrouter/parsers/route-parser.ts` · `renderer/fe/tab2-domain.ts`)

근본 원인: `` path: `${ORD_PROD_PLAN}/spec` `` 같은 template literal path를 파서가 `StringLiteral`만 허용해 전부 drop. 재현 fixture `mini-react-router-domain-app`(`ROUTES:0` FAIL, URL이 폴더와 divergent).

- **B-1 path 정적 평가** — `extractRoutesFromArray`의 path StringLiteral 강제 제거 → `evalPathExpression`(NoSubstitutionTemplate · TemplateExpression const 치환 · bare Identifier). `evalStringConst`/`evalKeyExpression`에 **cross-file 1-hop** ctx 인지 추가(`locateVarInitializer`+`buildResolverCtxForFile` 재사용). spread 자식 ctx도 평가. reactrouter 73 test 회귀 0.
- **B-2 FE Tab2 도메인 레이어 (신규 `fe/tab2-domain.ts`)** — 컴포넌트 filePath의 `src/pages/<Root 도메인>` 파일경로 트리로 레이어링. BE `pkg-tree`(`buildPkgTree`/`emitTreeNodes`/`chunkByTopLevelPackage`) 재사용해 도메인별 chunk 분리(BE Tab2 동일 사상). `framework==='react-router'` **AND** `isPagesDomainEligible`(≥2 도메인 폴더) 게이트 — 평탄(`src/pages/Home.tsx` 직속) fixture는 URL 그룹핑 fallback(회귀 0). chunk 분리로 프리즈 회피 → >100 route 게이트 이전 분기. FE-DIAGRAM-STANDARD v1.2(§3.4 R-T2.10·2.11).
- **검증** — URL이 평탄(`/order-plan`·`/material`·`/perf`)이어도 5개 페이지가 `📁 src/pages/partner`/`agency`/`headoffice` 도메인 레이어로 정확히 묶임. partner-mock Tab2 snapshot 도메인레이어 갱신 + domain-app 4 베이스라인.

#### 기타

- **verify.sh 하드닝** — 단위 테스트 게이트를 fail-loud로 강화(테스트 파일 존재 시 러너/`test` 스크립트 부재면 exit 1, 실패 로그 캡처). reward-hacking 가드 정합.

## [1.2.49] — 2026-06-01

### React Router 파서 3결함 + 대형 프로젝트 webview 프리즈 수정 (회귀 0)

사용자 보고 2건 통합 수정. (A) React Router 분석에서 mobile/agency/partner sub-router가 별도 레이어로 분리 표시되던 것이 회귀(v1.2.47이 `appRoutes.map()` alias만 고치고 spread는 미처리). (B) 대형 프로젝트(1031 routes·440 tables) 분석 후 webview가 "랜더링 중..."에서 멈추고 탭 전환 불가. 재현 fixture `mini-react-router-spread-app`(실제 repo 구조 1:1)로 3결함 실측 확정. verify.sh **750 PASS** · 1 skipped · 회귀 0.

#### 묶음 A — React Router 파서 3결함 (`reactrouter/parsers/route-parser.ts`)

- **① pathless layout `<Route>` 가짜 `/` 노드 제거** — `<Route element={<Layout/>}>`(path·index 둘 다 없음)가 `else` 분기에서 `parentPath || '/'`로 무조건 노드 emit하던 것을 suppress. 화면이 아닌 layout wrapper는 노드 생성 없이 children만 같은 parentPath로 재귀(Less is More). 실제 repo `/` ×4 → ×1.
- **② 부모 path + index 자식 동일 path 중복 제거** — `routeNodes.push` 4개 site(`parseReactRouterFull` 양 분기 + `parseReactRoutes` twin 양 분기)에 `seen Set` nodeId dedup(first-wins). `<Route path="/login"><Route index/></Route>` → `/login` ×2 → ×1.
- **③ 배열 spread(`...routes`) 침묵 skip 해소** — `extractRoutesFromArray`가 `getElements()` 순회 중 `SpreadElement`를 버리던 것을 `spreadCtx` 주입으로 resolve. **③a** 배열 리터럴 spread(`...partnerRoutes`)는 `resolveArrayLiteralFromIdentifier`로 inline. **③b** `Object.entries(obj).map()` spread(`...agencyRoutes`)는 신규 `resolveObjectEntriesMapEntries`로 객체 키(템플릿 리터럴 + same-file const 정적 평가)를 path 추출(component는 콜백 동적 매핑이라 생략·Evidence-First). spread entry는 `sourceFilePath` 필드로 정의 파일을 추적해 컴포넌트 resolve 정확도 유지. `spreadCtx` 미주입 시 기존 skip 유지(하위호환).
- **신규 fixture + 테스트** — `fixtures/mini-react-router-spread-app` 정식 승격(package.json 포함) + `route-parser-spread.test.ts` 8건. 실측: 14 routes 전부 추출(`/`×1·`/login`×1·`/partner/*`×2·`/agency/masterMgmt/customerMgmt`·mobile 3종·inline 5종).

#### 묶음 B — 대형 프로젝트 webview 프리즈 (`renderer` + `extension/media/viewer.html`)

- **근본 원인** — webview가 단일 거대 다이어그램을 `mermaid.render()`로 메인 스레드 동기 dagre 레이아웃 실행 → 1031 노드 레이아웃이 스레드 점유 → 단일 스레드라 탭 클릭까지 freeze.
- **B-6 청킹 게이트 완화** — `buildRenderingDiagram`/`buildScreenComponentDiagram` 게이트가 `branchingGroups.length > 5` **AND** `routeNodes > 100`을 요구해, 소수 top-level 브랜치에 깊게 중첩된 대형 라우트가 게이트를 통과 못 하던 결함 → `routeNodes > 100` **단독** 발동으로 완화.
- **B-7 노드-바운드 청킹** — 청크 입자가 브랜치 단위(노드 수 무바운드)라 한 거대 브랜치가 단일 거대 청크가 되던 결함 → 신규 `splitGroupsByNodeBound` + `CHUNK_ROUTE_BUDGET=50`. 작은 브랜치는 패킹, 거대 브랜치는 children 단위 재귀 분할(groupKey full path라 nested subgraph 계층 보존). Tab1·Tab2 동시 적용. dead code `TAB2_GROUPS_PER_ROW` 제거.
- **B-8 webview 점진 렌더** — `renderChunked`가 청크 사이 `requestAnimationFrame` 양보 + 첫 탭 렌더를 `requestAnimationFrame`으로 지연(탭바·헤더·"렌더링 중..." UI 선 paint). `mermaid-renderer.stress.test.ts` +5건(단일 대형 브랜치 112 routes → 청킹 발동·청크당 노드 ≤50 단언).

## [1.2.48] — 2026-05-30

### POLISH 잔여 6건 + M11 FW 분기 config화 — 코드 품질 정리 (회귀 0 · snapshot byte-identical)

v1.2.47에서 격상·보류된 잔여 POLISH 6건과 M11을 일괄 처리. 기능 변경 없음 · 외부 동작 보존. verify.sh **737 PASS** · snapshot byte-identical · 회귀 0.

- **E-1 (BE Tab2)** — `buildBeArchitectureDiagram` `emitChunk` 내부 `buildPkgTree` 재구축 제거. `chunkTree`가 항등 intersect임을 증명(`emitTreeNodes` nodeIdByPath 키 정합성 검증)하여 `intersect()` 함수 및 `alignedFiles` 탐색 로직 일괄 제거. `walkFiles(chunkTree, ...)` 직접 호출.
- **R4 (nextjs/component-parser)** — 로컬 `EXCLUDE_DIRS`(build 누락) → `file-finder.ts`의 `NEXTJS_EXCLUDE_DIRS` 참조. `build/` 디렉토리 스캔 방지.
- **R6 (remix/route-parser)** — 로컬 `EXCLUDE_DIRS` → `REMIX_EXCLUDE_DIRS` 참조. `walkRoutesDir` 구조(relToRoutes 반환 패턴) 유지.
- **R5 (vue-spa/route-parser)** — inline `findTsFiles` recurse 루프 → `walkDir(VUE_SPA_EXCLUDE_DIRS)`. `.nuxt/.vite/build` 제외 강화.
- **R7 (sveltekit/component-parser)** — inline `collectSvelteAndServerFiles` recurse 루프 → `walkDir(SVELTEKIT_EXCLUDE_DIRS)` + `nameFilter`. `file-finder.ts`에 `VUE_SPA_EXCLUDE_DIRS`·`SVELTEKIT_EXCLUDE_DIRS` 상수 추가.
- **M11 (mermaid-renderer — buildRenderingDiagram config화)** — 7+1 FW if-else 체인 → `FW_CONFIGS: readonly FwConfig[]` 배열. `FwWrapper`·`FwConfig` 인터페이스 추가. 출력 문자열 7개 FW 케이스 수치 검증으로 byte-identical 확인. 신규 FW 어댑터 추가 시 config 항목 1개 추가만으로 확장 가능.

## [1.2.47] — 2026-05-28

두 사이클 통합 릴리스 — **/refactoring 후속 12건** + **React Router 외부 import 라우트 추적 일반화**. verify.sh **737 PASS** · 회귀 0 · snapshot byte-identical · obsolete 0.

### Refactoring 후속 — /refactoring 사이클 후속 12건 (PR-A~D + POLISH 8건)

v1.2.46 `/refactoring` 사이클이 권장한 후속 12건을 4 PR + POLISH로 일괄 처리. **34 modified + 11 new files**, +346 / -1956 라인 (-1610 net). 외부 export 표면 변경 0 · 순수 책임 분리.

- **PR-A (M9·M2·M4·M10)** — `analyzWithLLM → analyzeWithLLM` rename(6 파일) · `_shared/ts-config-loader.ts` 신규(nextjs·nextjs-pages·remix·vue-spa 4 어댑터 통합) · `_shared/ts-morph-utils.ts` 신규 + `buildImportMap` 6 위치 통합(angular·reactrouter×3·vue-spa) · `docs/design/NODE-ID-CONVENTIONS.md` 12 컨벤션 분류표.
- **PR-B (M1·M3·M6)** — `_shared/file-finder.ts`에 `walkDir({extensions, excludeDirs, nameFilter})` + 어댑터별 EXCLUDE 상수 7종 export. 11곳 walkDir 통합. `_shared/vue-sfc-utils.ts` 신규(정규식 3개 + findVueFiles). `getDynamicSegmentTypeFromSegments(segments[])` _shared 통합(nextjs+sveltekit).
- **PR-C (M8 8단계)** — `mermaid-renderer.ts` **1760 → 472 라인 (-72%, -1288줄)**. 신규 디렉토리 `helpers/`(constants/ids/layout), `fe/`(labels/infra/nested/tab2/tab2-file/tab3-api), `be/`(pkg-tree/leaf/tab1/tab2), `erd/`(db-diagram). 외부 export 표면 0 변경 / 순수 이동 / snapshot byte-identical.
- **PR-D (M7·M12 + CLI 잠복 회귀 hotfix)** — `packages/core/src/pipeline.ts` 신규 `buildIRGraph(repoRoot, llmOptions?)`. cli `analyze` 87→11줄, extension `runAnalysis` 115→60줄. **v1.2.43/v1.2.45 hotfix가 CLI에 미반영이었음을 자동 흡수** (skipComponents · framework override · LLM 에러 wrap). 3 파일 5 함수에 Context 객체(`ScreenCtx`/`FileTreeCtx`/`ApiCallCtx`) — T1 lookup table·T4 시퀀스 신규 빌더가 ctx 필드 1개 추가만으로 주입 가능.
- **POLISH 8건** — R8(reactrouter:1003 인라인 buildImportMap 잔여) · R2/R3(wrap-fallback chunkArray·collectGroupRoutes 제거 → 단일 출처 helpers/layout) · D1/R9(tab2-file 파일 라벨 4중 → formatFileLeafLabel) · D2(LLMOptions = LLMClientOptions alias) · E-2/E-3(BE Tab2 O(C×E) Map화) · D6(`_shared/component-name.ts` 신규 — 4 호출 `path.basename(...)` → `componentNameFromPath()`).
- **사용자 결정 보류** — M11(7+1 FW 분기 config화)은 v1.2.48 격상(21 snapshot 영향). M5/M10은 폐기/docs only로 결정(통합 부적합·필연적 차이).

### React Router 외부 import 라우트 추적 일반화 — 추가 사이클

사용자 보고 회귀: REPO-SHARED-B2B-WINA-APP-FE에서 `appRoutes.map()` 패턴 라우트 다수의 `rendersEdge` 누락. 진짜 root cause는 v1.2.44 hotfix가 다루지 못한 **3종 결함** + 1건 잠복 결함 (advisor 정정 거침).

- **Root cause 3건** — (1) `resolveElementComponentAbsBase`의 `spec.startsWith('.')` 가드가 **path alias(`@/...`) 차단** · (2) `buildImportMap`이 `ni.getName()`(원본명)을 키로 써서 **named import rename(`as`)** 미인식 · (3) `createBrowserRouter` 분기가 **외부 import 라우트 배열 추적 부재** (JSX `<Routes>` 분기와 비대칭, advisor 지적).
- **신규 `_shared/component-resolver.ts`** — `resolveComponentToAbsBase(name, sf, ctx)` 통합 resolver. (a) ImportDeclaration default/named + alias rename, (b) tsconfig paths alias 해석, (c) barrel re-export 1-hop (`export { X as Y } from`, directory index 포함), (d) `lazy(() => import('...'))` / 단일 Identifier alias-chain, depth=2 cycle 가드. 반환 메타 `{absBase, hops: 'direct'|'barrel'|'lazy'|'alias-chain', inferenceChain?}` — Evidence-First 원칙 준수.
- **route-parser 가드 7곳 일괄 alias 인식** — `resolveModuleSpecWithPaths` 적용 위치: 외부 배열 1-hop(322) · element 컴포넌트 추적(357·362) · 외부 JsxExpression 1-hop(430) · createBrowserRouter element resolution(692) · sub-component recursion(726) · JSX Pass 2 직접 fallback(862) · sub-router 감지 Pass(1017).
- **양 분기 일관성 (advisor 권고)** — `createBrowserRouter` 분기에 외부 import 1-hop 추가(`resolveArrayLiteralFromIdentifier` 동등). ComponentNode 매핑 통합 resolver 위임 (`lazyModuleSpec` 분기 자동 흡수).
- **부수 결함 1건** — `extractMapElementPropName`이 `<React.Suspense>` wrapper의 outer tag를 PropertyAccess로 잘못 매칭. 정정: ArrowFunction/FunctionExpression 첫 파라미터 이름(`route`) 추출 후 callback 전체 JSX descend로 `paramName.X` 형태만 매칭. lowercase 'component' fallback이 가려주던 잠복 결함 표면화.
- **신규 fixture 3종** — `mini-react-router-alias-app`(사용자 케이스 1:1 reproducer, @/ alias + as rename + nested 2겹 Routes + appRoutes.map + Suspense wrapper) · `mini-react-router-createbrowser-alias-app`(createBrowserRouter 분기 회귀 가드) · `mini-react-router-barrel-app`(barrel re-export 회귀 가드).
- **단위 테스트 +19건** — component-resolver 9 · ts-config-loader 9 · ts-morph-utils 6 · route-parser describe 박제 활성화 3 · ST6b 3 · ST7 1 · ST8 2.

### 영향 어댑터 회귀 검증 (buildImportMap consumer)

- angular · vue-spa · reactrouter · nestjs 4 어댑터 일괄 검증 161 PASS · 회귀 0
- 영향 범위: `buildImportMap`이 `getAliasNode()?.getText() ?? getName()` 정정으로 `import { X as Y }`에서 Y가 키로 등록 — 기존 어댑터가 원본명을 키로 lookup하면 누락이 발생할 수 있으나 회귀 0 (실제 import 후 rename 사용 케이스가 reactrouter 외엔 없음).

### 후속 (v1.2.48+)

- M11 FW 분기 config화 + POLISH 잔여 6건(R4·R5·R6·R7·R10·E-1)
- BE 모듈 위계 정정(D3·D4·D5·R1)


## [1.2.46] — 2026-05-26

### Refactoring — 전체 src 코드 품질 정리 (98 파일 review · 36건 수정 · 회귀 0)

`/refactoring` 파이프라인으로 전체 src를 5개 그룹 병렬 review → 48건 이슈 발견 → Critical 9 + Important 27 일괄 처리. 기능 변경 없이 코드 품질·정확성·일관성 개선만 수행.

### Critical — 데이터 정확성·동작 버그 (9건)

- **ANALYZER_VERSION 통일** — `@codebase-viz/types/analyzer-version.ts`로 이동 + cli/extension 모두 import. 기존 5곳 하드코딩 (`'codebase-viz@0.1.0'` 등) 정정 → IR Provenance가 실제 버전과 일치, CLI 캐시가 extension에서 무효화되지 않음.
- **nextjs/nuxt/sveltekit parseRoutes·parseComponents** — `analyzerVersion: string` 필수 인자화 (이전 default `'codebase-viz@0.1.0'` 또는 누락 → 영구히 stale 버전). Evidence-First 원칙 위반 해소.
- **flyway-parser analyzerVersion 인자화** — django/springboot 어댑터에서 명시 전달.
- **nestjs/adapter.ts EMPTY_ADAPTER_RESULT 적용** — `...EMPTY_ADAPTER_RESULT` spread로 향후 필드 추가 시 누락 컴파일 검출.
- **extension.ts setApiKey race condition** — `showInputBox` 사이 `getProvider()` 두 번 호출 → 1회 캡처 변수 재사용 (잘못된 provider 슬롯에 키 저장 차단).
- **sveltekit/component-parser dirCache 지역화** — 모듈 스코프 mutable → 함수 지역 변수 (동시 호출·테스트 격리·reanalyze 정확성).
- **webview setReanalyzeCallback silent failure** — 등록되지 않던 callback 제거, 'reanalyze' 메시지가 `vscode.commands.executeCommand('codesight.reanalyze')` 직접 호출.

### Dead code 제거 (10건)

- `mermaid-renderer.ts`: `ELK_MRTREE_PRAGMA`, `buildSectionsFromRoutes` 클러스터 3함수, `ENDPOINTS_AS_SUBGRAPH=true` 고정 + dead else 브랜치, `emittedNodeIds` Set `void` 처리
- `url-grouper.ts`: `minGroupSize` 사용되지 않는 옵션 파라미터
- `extension/analyzer.ts`: `getCacheDir` export 호출처 0
- `extension/webview.ts`: `setReanalyzeCallback` 등록되지 않던 callback
- `extension/i18n/dict.ts`: `msg.languageChanged`·`reloadNow`·`setApiKeyPlaceholder*` 5키 × 4 로케일 미사용
- `llm/converter.ts`: `void repoRoot` 미사용 파라미터
- `fastapi/orm-parser.ts`: `pyFiles.filter(f => true)` 무효 필터
- `extension/analyzer.ts`: 레거시 `LLMOptions` 유니온 hack 분기

### 중복 제거 (5건)

- **`findTsFiles` 단일 traverse 옵션화** — `_shared/file-finder.ts`에 `FindTsFilesOptions` (`includeTsx`, `excludeDeclarations`, `excludeTests`) 추가. drizzle/typeorm 후처리 filter 제거, 트리 traverse 1회로 단축.
- **`pathExists` 추출** — `_shared/file-finder.ts`. `fs.access().then(true).catch(false)` 패턴 2곳 (supabase-parser, nextjs/db-parser) 통합. TOCTOU 회피.
- **`getDynamicSegmentType` _shared 통합** — `_shared/url-path-normalizer.ts`. fastapi/nestjs/springboot 3곳 inline 정의 제거.

### 주석 정리 (10건)

- `mermaid-renderer.ts`: 버전 prefix(`v1.2.X 결함 #N (회귀 해소):`) 41건 일괄 제거
- `extension/analyzer.ts`·`webview.ts`·`llm/converter.ts`: v1.2.45 버전 스탬프 주석 정정
- `django/adapter.ts`·`springboot/adapter.ts`·`nextjs/component-parser.ts`: WHAT-not-WHY 주석 제거
- `_shared/mapper-utils.ts`·`tree-sitter-loader.ts`·`cross-graph-matcher.ts`: 파일 헤더·brittle 경로 주석·빈 wrapper 정리

### 부수 정리 (4건)

- `db/index.ts`: `detectTsOrmTables` 범위 주석 명시 (TS ORM 전용, Flyway/Supabase 미포함)
- `db/supabase-parser.ts`·`nextjs/db-parser.ts`: `node:fs` 동기 → `node:fs/promises` + `pathExists` 통일
- `springboot/di-parser.ts`: Interface→Impl fallback 사용 시 `inferenceChain`에 명시 기록 (Evidence-First)
- `screen-mapper.test.ts`: 6 it 개별 `{ timeout: 30000 }` → describe-level 1회

### Tested

- `verify.sh` **703 PASS** / 1 skipped · 회귀 0
- BE Tab1/Tab2 snapshot 영향 0건
- FE fixture snapshot 변경 0건
- 수정 파일 42개 · `+285 / -437` 라인 (-152 net)

### 후속 사이클 권장 (12건)

광범위 영향으로 별도 처리:
- walkDir / EXCLUDE_DIRS 약 9중 복제 (FE 어댑터 8종)
- loadTsConfigPaths 4중 복제 (nextjs/nextjs-pages/remix/vue-spa)
- Vue SFC 정규식 2중 / importMap 3중 / rendersEdge 2중
- getDynamicSegmentType 추가 5곳 (angular/django/flask/nextjs-pages/nextjs)
- cli/extension runAnalysis 파이프라인 중복
- `analyzWithLLM` → `analyzeWithLLM` 오타 rename (breaking change)
- mermaid-renderer.ts 1842라인 → 4 모듈 분리
- `buildRenderingDiagram` FW별 7 if-else 통합 + emit 함수 Context 객체화

## [1.2.45] — 2026-05-23

### Changed — FE 표준 v1.1 amendment (R-T1.2 X축 보장 범위 정정)

`mini-react-partner-mock-app` + `fa-support` webview 실측을 통해 **mermaid v11이 nested subgraph LR direction을 보장하지 못함**이 일관되게 입증되었다. v1.0 표준이 "동일 directory depth = X축"을 약속했으나 라이브러리 능력 범위를 벗어남 → 표준을 라이브러리에 맞게 재설계 (자세한 사유: `docs/design/FE-DIAGRAM-STANDARD.md` §8 / [[feedback_mermaid_v11_nested_lr_limit]]).

**표준 v1.1 결정**:
- **Top-level 형제 cluster = X축 보장** (outer wrapper 안 + cluster end 직후 `~~~` chain emit)
- **Nested 자식 cluster = Y축 stack 기본** (mermaid v11 구조 한계)
- URL intermediate segment는 explicit subgraph로 보존하되 X축 보장은 약속하지 않음

→ fa-support 보고 결함 2(`/dashboard` 안 nested 자식 Y축)는 amendment 후 "결함 아닌 표준 동작"으로 정정.

### Fixed

- **출력 폴더·UI 라벨 통일** — `.codesight/` ↔ `.codebase-viz/` 출력 폴더 이원화 + UI "CodeSight" 잔존 정정. CLI/extension 모두 `.codebase-viz/`로 통일, 기존 `.codesight/cache.json` 위치는 **읽기 fallback** 유지(무자각 마이그레이션). UI 라벨(viewsContainers·views·commands·configuration title) 전 "CodeSight" → "Codebase Viz". 마켓 ID(`codebase-arch-viz`)·명령어 ID(`codesight.*`)·config key 호환성 유지.
- **로고·타이틀 'Codebase Visualizer' 통일** — `viewer.html` `Code<em>Sight</em>` 잔존(em 태그로 grep 누락) 정정. 로고·타이틀은 풀 네임, 메시지는 'Codebase Viz' 약어 유지(사용자 결정).
- **Tab1 outer wrapper top-level X축 보장** — `mermaid-renderer.ts` outer `graph LR` + outer wrapper(BROWSER/ROUTER/REACT/etc.) 안 top-level group `~~~` chain emit (`emitTopLevelSiblingChain` 헬퍼 신설, 8개 어댑터 wrapper 분기 적용). v1.1 amendment 후 표준에 부합하는 X축 보장.
- **Tab1 라벨 prefix 잔존 해소** — `stripGroupPrefix`가 `path === groupKey`일 때 leaf segment 반환 (예: `/agency/userMgmt` + groupKey 동일 → `userMgmt`). R-T1.2 v1.1 "라벨은 자기 노드 의미만" 부합.
- **Tab1 leaf wrapper 평탄화 (옵션 X.2)** — `buildNestedSubgraphLines`에서 `children=0 + routes=1 + dynamic/group route 아닌` leaf의 wrapper subgraph 생략 후 route 노드만 부모 indent로 emit. `parentGroupKey` 인자 전달로 라벨에 부모 prefix strip 적용 (root level은 full path 유지). `emitTopLevelSiblingChain` chain ID도 평탄화된 자식이면 route 노드 ID 참조하여 phantom 회피. 효과: 단일-route + 자식 0개인 leaf의 중복 wrapper 제거 + 라벨 정합성.
- **URL intermediate segment unfold** (`url-grouper.ts` Fix 1) — `groupRoutesRecursive` cluster 분기에 single-route recurse 조건 추가 (`clusterRoutes.length === 1 && deeperRoutes.length > 0`). NestedGroup tree에 intermediate URL segment를 explicit 보존 → mini-react-partner `/partner` 안 `/ordProdPlanMgmt`·`/matMgmt`·`/perfMgmt`가 명시 subgraph로 표현. v1.2.45 1차 buildup에서 누락되었던 결함 해소.
- **LLM merger dedup 정정 (라우트·컴포넌트·edge 모두)** — `merger.ts` `nodeKey`가 `route:${filePath}` 단독이라 LLM이 같은 URL을 페이지 파일로, static adapter가 라우터 정의 파일로 등록하면 별도 라우트로 중복. 변경: route는 `${path}:${routeFileKind}`(URL 정체성), component는 filePath 확장자 정규화. **edge phantom 차단**: `idRemap` Map(LLM_id → static_id)으로 edge from/to 치환 + `makeEdgeId` 재생성.
- **LLM converter component skip (config-based 어댑터)** — React Router(router.tsx 단일 파일 + 별도 src/pages dir)에서 LLM `comp.filePath` dirname vs static `comp.filePath` mismatch → 두 ComponentNode 공존 → Tab2 file-tree 잘못된 leaf emit. 해결: `convertToIR`에 `skipComponents` 옵션 추가, `analyzer.ts`에서 `result.componentNodes.length > 0`일 때 활성화(adapter가 실제 component를 만든 경우에만 LLM component skip). LLM 결과는 routes/tables/backends만 채용. monorepo (fa-support) 회귀도 함께 해소.
- **Tab2 top-level cluster X축 강제** — `buildFeFileTreeScreenDiagram`에서 top-level cluster ID들 사이 `~~~` chain 한 줄 추가 → dagre가 root rank 결정 → top-level X축 정상화. nested 자식은 v1.1 표준대로 Y축 stack.

### Discarded — 폐기 시도 (재발 방지 명시)

v1.2.45 buildup 과정에서 시도되었으나 webview 실측 또는 구조적 한계로 폐기된 패턴. **향후 hotfix가 본 목록 다시 확인 필요** (`docs/design/FE-DIAGRAM-STANDARD.md` §8.5):
- **ELK opt-in** (`layout:elk + hierarchyHandling:INCLUDE_CHILDREN`) — VS Code webview console에 loader 메시지조차 안 나타남 + `INCLUDE_CHILDREN`은 leaf 내부 Y축 표준과 구조 충돌
- **invisible row wrapper + `direction LR`** — mermaid v11에서 시각적으로 무시 (syntax는 valid, layout 영향 0)
- **chain을 부모 cluster 안(`${i2}` `end` 이전)에 emit** — Playwright 실측 회귀 (AGENCY_T 안 leaf composite도 Y축으로 깨짐)
- **"단일-plain-노드 subgraph chain X축"** — CDN(정적 HTML)에서는 작동하나 webview 비일관 (Tab1 작동 / Tab2 비작동). 표준 약속에서 제외.

### Tested

- `verify.sh` **703 PASS** / 1 skipped · 회귀 0
- BE Tab1 snapshot 영향 0건 (FE 변경 한정)
- snapshot 19+ 갱신 (top-level `~~~` chain + leaf composite + leaf 평탄화 + intermediate unfold 반영)
- 신규 테스트: `merger.test.ts` URL 정체성 dedup 2건 + LLM edge remap 1건 + `analyzer.test.ts` 옛 `.codesight` fallback 1건. `mermaid-renderer.test.ts` 2건은 leaf 평탄화 의도에 맞춰 갱신.
- `mini-react-partner-mock-app` Playwright + webview 시각 검증: Tab1 `/partner` 자식 X축 정상 + 라벨 leaf segment만 표시. Tab2는 표준 v1.1 부합(top-level X축, nested Y축).

## [1.2.44] — 2026-05-21

### Fixed — React Router `.map()` 패턴 라우트 추적 회귀 해소 (사용자 실측)

사용자 실제 React Router 프로젝트(`appRoutes.map(r => <Route element={<r.component/>} />)`)에서 라우트가 0건으로 분석되던 회귀 3건 일괄 수정.

- **F-Route-1 외부 import 데이터 배열 추적** (`route-parser.ts` Case A-2) — `.map()`의 데이터 배열이 외부 파일 import인 경우 같은 파일 const만 검색하던 한계 해소. `resolveArrayLiteralFromIdentifier` 헬퍼 신설로 same-file → import 1-hop fallback. `<Routes>` children인 `{externalElementsArray}` 자체가 외부 파일의 `export const = X.map(...)` 패턴도 추적 (Case B에 swap된 ResolverCtx로 X 재resolve).
- **F-Route-2 lowercase `component` Identifier 인식** (`extractRoutesFromArray`) — React Router 공식 키 `element`/`Component`/`lazy` 외 사용자 커스텀 컨벤션 `{ path, component: PageComponent }`도 인식. 4번째 분기 + 첫 글자 대문자 가드(string/숫자/객체 prop 오인식 차단).
- **F-Route-3 `<paramName.propName />` member access 매핑** (`extractMapPathPrefix` + 신규 `extractMapElementPropName`) — map callback의 `element={<r.component />}` PropertyAccessExpression 인식. callback param + prop name 추출 → entries 동적 키 lookup (`component` 외 `page`·`view` 등 임의 키 이름도 지원). `extractRoutesFromArray`에 `extraComponentKey` 파라미터 신설.
- **외부 import 컴포넌트 abs base resolve** — 외부 모듈에서 추출된 elementComponent를 `parseReactRouterFull` JSX 분기가 현재 sourceFile importMap에서 lookup하던 한계 해소. `resolveElementComponentAbsBase` 헬퍼로 외부 sourceFile importMap에서 미리 resolve → `JsxRouteRaw.elementComponentAbsBase` 메타로 전달.

### Changed — Vue SPA · Angular Tab2 file-tree 표준 진입 + 사용자 표준 2 부합 완성

v1.2.43 SKIP 처리됐던 config-based FE 어댑터 Tab2 표준화 완료. Vue SPA·Angular도 file-based 6종과 동일한 file leaf + 1-depth import child 표시.

- **Vue SPA `route.filePath` 컴포넌트 파일 치환** (`vue-spa/route-parser.ts`) — 라우트 정의의 `component: () => import('./Foo.vue')` (dynamic) · `component: FooComp` (sync Identifier) 분석 → 모듈 경로 resolve(`.vue`·`.ts`·`.tsx`·`.js`·`.jsx` 확장자 fallback) → `route.filePath` 치환. 외부 파일 import 시 routesArray sourceFile 기준 routerDir + importMap 사용.
- **Angular `loadComponent` / `component` Identifier 추적** (`angular/route-parser.ts`) — `loadComponent: () => import('./foo').then(m => m.Foo)` (이미 v1.2.40 처리) + 신규 `component: FooComponent` Identifier 분기. `componentSpecMap`(spec + isIdentifier + resolveFromDir) 신설. `provideRouter(externalRoutes)` 패턴 시 routesArray sourceFile(외부 `app.routes.ts`) 기준 importMap으로 component Identifier resolve. fallback도 routesArraySf relPath로 통일.
- **`buildFeFileTreeScreenDiagram` 화이트리스트 확장** (`mermaid-renderer.ts:227`) — `isFileTreeTab2Eligible`에 `vue-spa` · `angular` 추가. 두 어댑터도 라우트 → 디렉터리 트리 + 파일 leaf 표현 적용.
- **`RouteNode → ComponentNode` rendersEdge 보완** (`vue-spa/adapter.ts` · `angular/adapter.ts`) — `route.filePath ↔ component.filePath` 매칭으로 rendersEdge 생성 (confidence='inferred'). Angular는 기존 loadComponentMap 우선 + seenRouteIds Set 중복 가드 + sync Identifier 패턴 fallback. Tab2 file leaf + 라우트→파일 edge 정상 표시 → 사용자 표준 2 부합 완성.

### Added — Tab2 1-depth import child component leaf (Sub-1 fan-in · Sub-2 page→page)

Tab2가 라우트→파일 1:1 매핑만 표시하던 한계 해소. page 컴포넌트의 직접 import도 child file leaf로 노출 → 사용자 표준 2 "어떤 화면이 어떤 컴포넌트들로 구성되는가" 본래 목적 부합.

- `buildFeFileTreeScreenDiagram` · `emitFeFileTreeLines` · `emitRouteAndFileLeaf` 시그니처에 `importsEdges: IREdge[]` 추가. 호출부에서 `graph.edges.filter(e => e.kind === 'imports')` 전달.
- `emitRouteAndFileLeaf`에서 page ComponentNode를 from으로 하는 importsEdges 중 `importDepth === 1` 필터 → child component file leaf emit + `file → child_file` Y축 edge. **routeFileKind === 'page' 가드**로 Next.js layout/loading 노이즈 차단. 외부 lib는 IR componentNodes 미등록이라 `compById.get → undefined`로 자동 필터.
- **Sub-1 (shared component)** — 동일 component가 N page에서 import되어도 노드 1회만 emit + page → component edge N개(fan-in). 기존 `fileNodeRendered: Set<string>` 가드 활용.
- **Sub-2 (page → page import)** — drill-down 라우트 간 page → page import도 동일하게 1-depth import edge로 표시 (routeFileKind 필터 제거).

### Changed — Tab3 라벨 'DB–Screen' → 'Data Flow' 격상 (사용자 표준 amendment)

FE-only 프로젝트(react-router SPA + 외부 API)에서 v1.2.42부터 Tab3가 `buildFeApiCallDiagram`(Screen↔API)를 렌더했으나 'DB-Screen' 라벨과 불일치하던 점 해소. 사용자 표준 2를 "Tab3 = 어떤 화면이 어떤 데이터 소스(DB 테이블 ∪ 외부 API endpoint)에 접근하는가"로 일반화.

- `packages/extension/src/i18n/dict.ts` — 4 로케일 × 2 키 격상: `tab.dbScreen` = '데이터 흐름' / 'Data Flow' / 'データフロー' / '数据流'. `export.dbScreenAll` = '데이터 흐름 (전체)' 등.
- `packages/extension/src/webview.ts:234` — HTML 탭 라벨 하드코드 'DB–Screen' → 'Data Flow'.
- `packages/renderer/src/mermaid-renderer.ts:1525` — export MD 헤더 '# DB–Screen Mapping' → '# Data Flow (Screen ↔ Data Source)'.
- 분기 로직 자체는 v1.2.42 그대로 보존 (BE 또는 tableCount>0 → ER, 그 외 react-router → API 다이어그램). 라벨만 amendment.

### Added — `docs/design/FE-DIAGRAM-STANDARD.md` v1.0 (FE 표준 단일진실)

BE-DIAGRAM-STANDARD.md(v1.2.40)와 쌍을 이루는 FE 표준 문서. R-T1.x·R-T2.x·R-T3.x 규칙 체계 + 어댑터별 적용표(file-based 6 + Vue SPA + Angular + LLM-only 2) + Tab3 'Data Flow' 격상 amendment 명시. v1.2.44 이후 모든 FE 어댑터 작업의 ground truth.

### Verified — 신규 검증 fixture 2종

- `fixtures/mini-react-router-map-import-app/` — 사용자 케이스 1:1 재현 (외부 import 배열 + lowercase `component` 키 + `<route.component/>` member access). 페이지 5종 + 라우터 3 파일. F-Route-1·2·3 회귀 가드.
- `fixtures/mini-angular-standalone-app/` — Angular v17+ standalone components + 100% `loadComponent` lazy load 패턴. Dashboard/Profile/Settings 3 라우트.

### Internal

- verify.sh: 687 → **699 PASS** (+12 신규 단위 테스트, 회귀 0).
- snapshot 갱신 11건 — Phase 2: mini-next-app Tab2(import child leaf) + mini-vue-spa-app IRGraph·Tab1·Tab2 + mini-angular-app IRGraph·Tab1·Tab2 (filePath 치환·file-tree 화이트리스트). Phase 2-b: 추가 4건 (vue/angular Tab2 file leaf 추가).
- 신규 헬퍼: `resolveArrayLiteralFromIdentifier` · `resolveElementComponentAbsBase` · `extractMapElementPropName` · `extractLoadComponentModuleSpec`.
- 신규 메타: `JsxRouteRaw.elementComponentAbsBase` (외부 import 추적 컴포넌트 abs base) · `extractRoutesFromArray.extraComponentKey` (callback 동적 propName).
- 알려진 한계: forChild `path: ''` 동일 path 중복 라우트가 mermaid 그룹핑에서 첫 라우트만 노출 (v1.2.44 이전부터의 동작, 후속 minor에서 평가).
- 사용자 결정: Phase 1(hotfix) + Phase 2(표준 완성) + Phase 2-b(rendersEdge 보완) 통합 v1.2.44 patch ship.

## [1.2.43] — 2026-05-20

### Changed — config-based FE 어댑터(Vue SPA · Angular) Tab1 wrapper 표준 적용

v1.2.42에서 file-based FE 어댑터 6종에 도입된 `Browser → Router → Engine` 3단 wrapper 표준을 config-based 화면 프레임워크 2종(Vue SPA · Angular)에 균등 적용. FE 어댑터 8종 Tab1 헤더 표현 통일 완성.

- **Tab1 (Rendering Architecture)** — `framework='vue-spa'` 어댑터에 `BROWSER → 🧭 Vue Router · SPA → 💚 Vue · CSR Engine` 3단 wrapper 신규(`InfraInfo.hasVueSpa`, `frontendRef='VUE'`). `framework='angular'` 어댑터에 `BROWSER → 🧭 Angular Router · SPA → 🅰 Angular · CSR Engine` 3단 wrapper 신규(`InfraInfo.hasAngular`, `frontendRef='ANGULAR'`). 도메인별 라우트 nested 트리는 유지. **외부 REST API Gateway 데이터 레이어 분기는 frontendRef 정의로 자동 발동** — Vue SPA·Angular도 axios/fetch 호출 시 `DATALAYER → 🔌 External REST API → API_GATEWAY` 노출(v1.2.42 통합 동작 흡수, 별도 코드 작업 불필요).
- **Tab2 (Screen–Component Mapping)** — config-based 어댑터(`vue-spa`·`angular`)는 `route.filePath`가 라우터 정의 파일(`src/router/index.ts`·`src/app/app.routes.ts` 등)로 통일되어 있어 파일경로 노드 적용 시 모든 라우트가 같은 파일을 가리키게 됨 → 시각 가치 부족. 어댑터에서 컴포넌트 파일을 추적해 route.filePath를 컴포넌트로 매핑하는 보강 작업이 선행 필요. **v1.2.43 SKIP**, v1.2.44+ 어댑터 보강 patch로 분리.
- **Tab3 (DB–Screen Mapping)** — 현행 ER 다이어그램 유지(회귀 0). Vue SPA·Angular는 tables>0 케이스에서 표준 ER 분기 적용.

### Fixed — Expo adapterId 죽은 참조 + over-defensive 분기 정리

v1.2.43 진입 전 화면 프레임워크 vs 플랫폼/빌드 도구 분류 정합성 정리. Expo·Vite는 화면 프레임워크가 아닌 RN 모바일 플랫폼/빌드 도구이므로 별도 어댑터 분기 신설 부적합 — Tab1 메타 표현만 유지.

- `stack-detector.ts:31` — `'expo': { adapterId: 'expo', ... }` 죽은 참조 제거 (registry에 `expo` 어댑터 미등록). `expo`·`vite-react`를 LLM-only 그룹으로 명시 ("화면 프레임워크가 아닌 플랫폼/빌드 도구" 주석).
- `mermaid-renderer.ts:208-209` — `fw.includes('vite')`, `fw.includes('expo')` redundant fallback 제거 (`FrameworkKind` union이 닫혀 있어 unreachable). 명시 `fw === 'vite-react'`, `fw === 'expo'`만 유지. `deployTarget === 'mobile'` LLM fallback은 보존.
- `mermaid-renderer.ts:761-773` — `hasVite`·`hasExpo` wrapper 분기에 의도 주석 보강. "빌드/플랫폼 메타 표현용, 별도 화면 프레임워크 아님. LLM-only 경로에서만 routes 채워짐" 명시.

### Internal

- snapshot: `mini-vue-spa-app` · `mini-angular-app` Tab1 rendering diagram 갱신 (2건).
- verify.sh: 687 PASS · 1 skipped · 회귀 0.
- 폐기 결정(부활 금지): Expo·Vite 별도 화면 프레임워크 어댑터 신설. 두 케이스는 Tab1 메타(빌드/플랫폼)로 충분. 실제 화면은 RN/React/Vue 등이 담당.

## [1.2.42] — 2026-05-20

### Changed — React (react-router) 분석 결과 전면 재설계 + file-based FE 어댑터 6종 Tab2 표준화 + Tab1 외부 API Gateway 분기

React Router SPA 프로젝트 분석에서 Tab1/2/3 콘텐츠가 본질적으로 잘못된 방향이었던 점(단순 라우트 나열·Screen-Component 노드 그래프·React SPA에서 빈 ER 다이어그램)을 해소.

- **Tab1 (Rendering Architecture)** — `framework='react-router'` 어댑터에 한해 `BROWSER → 🧭 React Router · SPA → ⚛ React · CSR Engine` 프레임워크 헤더 wrapper 추가. 도메인별 라우트 nested 트리는 유지. (`InfraInfo.hasReactRouter` 신규). **추가: 외부 REST API Gateway 데이터 레이어 노드** — `apiCallEdges.length > 0` && backends/Supabase/Prisma/Firebase/Dexie/hasExternalAPI 모두 미설정 시 `subgraph DATALAYER → 🔌 External REST API → API_GATEWAY` 신규 분기 발동, library별 라벨 자동 합성(`axios · fetch` 등). 분기 우선순위 = **backends > Supabase > Prisma > Firebase > Dexie > hasExternalAPI > apiCallEdges(신규)** — LLM enabled에서 `metadata.backends` 항상 우선 (회귀 0).
- **Tab2 (Screen–Component Mapping)** — 도메인 nested 트리 + 각 라우트 leaf 옆에 **파일경로 노드(디렉터리 + 파일명)** 노출. Mermaid `<br/>` HTML 라벨로 두 줄 표시. 기존 컴포넌트 이름만 보여주던 방식 폐기. **file-based FE 어댑터 6종 표준화** — `framework='react-router'` 단독에서 **file-based 어댑터 화이트리스트**(`nextjs-app-router` · `nextjs-pages` · `nuxt` · `sveltekit` · `remix` · `react-router`)로 확장. `buildReactRouterScreenDiagram` → **`buildFeFileTreeScreenDiagram`** 개명 + `isFileTreeTab2Eligible(meta)` 헬퍼. **그룹 라우트 `app/(marketing)/about/page.tsx`** · **동적 라우트 `app/blog/[slug]/page.tsx`** 처럼 URL≠파일경로 케이스에서 디렉터리 정보 시각 노출. config-based(`vue-spa`·`angular`)는 v1.2.43+ 평가.
- **Tab3 (DB–Screen Mapping)** — **분기 표준 도입**. `adapterCategory==='BE'` → 현행 ER + Repository 합성 / `framework==='react-router' && tableNodes.length===0` → 신규 **FE API 호출 다이어그램** (axios/fetch/react-query) / 그 외(Next.js+Supabase·Prisma·Vite 등 FE+tables>0) → 현행 ER 그대로 (회귀 0). 사용자 결정: "supabase 등 분석에 대한 내용은 재사용 및 분석 분기 명확하게 구분".

### Added — FE API 호출 정적 분석

- `IREdge.kind`에 `'api-call'` 신규 추가 + `ApiCallInfo { method, path, library }` 메타 필드. 기존 `'calls'`(Spring DI)와 의미 분리.
- `makeNodeId`에 `'endpoint'` 가상 kind 추가 — graph.nodes에는 등록하지 않고 edge target 식별자로만 사용 (method+path 동일 호출 자동 dedupe).
- 신규 `packages/core/src/adapters/reactrouter/parsers/api-call-parser.ts` — `_shared/fe-call-extractor`를 재사용하여 axios.{get,post,put,delete,patch}·fetch·useSWR 호출 추출. `useQuery({queryFn:...})`·`useMutation({mutationFn:...})` 콜백 안의 axios 호출은 ts-morph `forEachDescendant`로 자동 캡처.
- `FeCall`에 `library: 'axios' | 'fetch' | 'react-query'` 필드 신규. Tab3 다이어그램에서 library별 클래스(`apiAxios`/`apiFetch`/`apiQuery`)로 색상 차등.
- template literal 인터폴레이션(`` `/api/x/${id}` ``)은 `confidence='inferred'` + `inferenceChain` 보존 (점선 화살표 표시).

### Fixed — Fixture 보강

- `fixtures/mini-react-partner-mock-app` 7개 Page에 현실적 API 호출 패턴 분산 주입 (axios.{get,post,put,delete} / fetch(POST) / useQuery / useMutation / template literal). package.json에 `axios`·`@tanstack/react-query` 추가.

### Verified — LLM enabled 정적 파서 무손상

`analyzer.ts` mergeGraphs 경로에서 정적 routeNodes·componentNodes·tableNodes·edges는 보존만 되고 변형되지 않음을 회귀 테스트 2건으로 명시:
- LLM `backendServices` 반환 시 `BACKEND_0` 분기 우선, 신규 External API Gateway 분기 미발동
- LLM `backendServices` 없을 때 정적 `api-call` edges 보존되어 External API Gateway 분기 정상 발동

### Verification

- verify.sh **687 PASS**, 1 skipped (회귀 0, 신규 5 케이스 — api-call 파서 3 + LLM 무손상 2)
- snapshot 갱신: mini-react-router-app·mini-react-partner-mock-app Tab1·Tab2·Tab3 + IRGraph summary / file-based 어댑터 5종 Tab2 (mini-next-app·mini-nextpages-app·mini-nuxt-app·mini-sveltekit-app·mini-remix-app)
- 회귀 무영향 검증: mini-spring-*(BE) / mini-vue-spa-app·mini-angular-app(config-based SPA) / Supabase·Prisma·Firebase·Dexie 데이터 레이어 분기

### Scope

본 버전은 **file-based FE 어댑터 6종 + React Router**의 Tab1/2 표준화. **config-based 어댑터(Vue SPA·Angular)와 Expo·Vite 등 다른 FE 스택의 표준 구현은 v1.2.43에서 진행** (project_v143_fe_standard.md). 향후 useQuery/useMutation 자체 hook detection (caller 추적), Next.js Client Component의 react-query 분석 등은 v1.2.44+에서 별도 평가.

## [1.2.41] — 2026-05-19

### Fixed — BE Tab1/Tab2 cluster 영역 어긋남 (v1.2.40 ELK mrtree 결함)

v1.2.40에서 도입된 BE Tab1/Tab2 트리 다이어그램이 ELK mrtree 활성 환경(실제 사용자 webview)에서 cluster wrapper와 자식 트리의 좌표가 어긋남. 패키지 라벨이 박스 좌상단 모서리에 박히고 top-level pkg 노드가 박스 외곽으로 비어져 나오는 시각 결함.

- 근본 원인: `elk.mrtree` 알고리즘이 cluster(subgraph) 내부의 top-level pkg 노드를 floating root로 인식하여 cluster 외곽과 별개 좌표계로 배치. mermaid `~~~` invisible link 폴백 시도도 mrtree에 의해 무력화됨(실측 확인).
- 해결: BE 어댑터의 `buildBeRenderingDiagram`·`buildBeArchitectureDiagram` emitChunk에서 `ELK_MRTREE_PRAGMA` 미emit. dagre layout이 cluster wrapper와 자식 트리를 올바르게 정렬. **v1.2.40 ST4(elk mrtree opt-in)의 BE 적용은 폐기**, FE 다이어그램 영향 없음.
- `HDR_PKG` 헤더는 일반 노드 → `subgraph` wrapper로 전환 + `clusterRoot` edge skip(외곽선은 wrapper가 담당) 패턴 유지.

### Fixed — Tab1 endpoints 가로배치 + Tab2 DI 체인 간격 과대 (ST-FIX-2)

- **Tab1 endpoints subgraph 가로배치**: mermaid v11에서 외부 edge가 들어오는 subgraph는 immediate `direction TB`가 무시되고 outer graph direction을 상속 → dagre가 endpoint route 노드들을 같은 rank(가로)로 정렬하던 결함. `endpoints` 내부 route 노드 사이에 line chain(`---`)을 추가하여 dagre rank 강제 수직 정렬.
- **Tab2 DI 체인 노드 간격 과대**: dagre 기본 rankSpacing=50이 DI subgraph 안의 `Controller → ServiceImpl → Repository` vertical chain을 stretched하고 outer chain 간격까지 키우던 결함. **`BE_RENDERING_INIT`** 신규 정의 — `flowchart.nodeSpacing=25, rankSpacing=8, padding=4` 명시. BE Tab1/Tab2 emitChunk에서 사용, FE 다이어그램 init은 유지(회귀 0).
- **Tab2 DI 간격은 1/3 축소 성공 ✅** / **Tab1 endpoints 내부 Y간격은 통제 불가 ⚠️**: mermaid v11의 nested subgraph가 외부 edge incoming + 내부 chain edge 조합에서 init directive·`mermaid.initialize` 전역 flowchart spacing 옵션 둘 다 무시(실측 확정 — `rankSpacing` 50→8→1 어느 값에도 endpoints 내부 노드 간격 불변). endpoints subgraph 제거(leaf→route vertical chain) 안은 v1.2.41 사용자 검증에서 시각 의미 저하 판단으로 폐기. **endpoints 내부 gap 축소는 v1.3.x BE Phase 2에서 별도 탐색** (mermaid 소스 추적·SVG 후처리·대체 layout 등). 토글 상수 `ENDPOINTS_AS_SUBGRAPH` (mermaid-renderer.ts:38)로 향후 실험 진입 경로 보존.

### Improved — Spring 부수 보강

- DI 파서가 interface 타입 주입(`Controller → Service interface → ServiceImpl`)을 못 잡던 결함에 `${toTypeName}Impl` convention fallback 추가. Spring 표준 패턴(Service interface + Impl) 완전 인식.
- `@Mapper` 어노테이션을 `COMPONENT_ANNOTATIONS`에 추가 — MyBatis Mapper interface가 ComponentNode로 등록.
- `analyzer.ts`가 `metadata.adapterCategory`를 전달하여 BE 렌더러 분기 신뢰성 강화.

### Tests

- 회귀 fixture 2종 신규: `fixtures/mini-spring-partner-mock-app/` (7도메인 21라우트 + MyBatis XML 7개) / `fixtures/mini-react-partner-mock-app/`.
- snapshot 13건 갱신 (mrtree pragma 제거 반영). `verify.sh` 682 PASS, 회귀 0.
- Playwright 시각검증: cluster 영역 어긋남 완전 해소 확인.

## [1.2.40] — 2026-05-19

### Added — BE Tab1/Tab2 트리 다이어그램 표준화 (`docs/design/BE-DIAGRAM-STANDARD.md`)

대규모 BE 프로젝트(985 routes / 422 tables) Tab1/Tab2의 X축 폭발·nested subgraph 가독성 한계를 트리 다이어그램으로 전환. `graph TD` 패키지 트리(패키지=노드, 부모-자식=엣지) + Controller leaf 옆 endpoints subgraph + Tab2 leaf에 Controller→Service→Repository 수직 DI 체인 + top-level 패키지 단위 chunking + **ELK mrtree opt-in**(R-T1.9). FE 회귀 0.

## [1.2.31] — 2026-05-19

### Fixed — LLM 빈 model 문자열 fallback (Gemini "Not Found" 근본 원인)

- **`codesight.model` 설정 default가 빈 문자열(`""`)**이라 VS Code config가 항상 빈 값을 반환 → `analyzWithLLM`에 빈 model이 전달 → Google AI SDK가 empty model path로 호출 → API가 `AI_APICallError: Not Found` (404) 응답. v1.2.3 진단 로깅으로 `model=` 빈 값이 드러나 근본 원인 확정.
- 수정 두 곳: (1) `extension.ts`에서 빈 문자열·공백을 `undefined`로 변환하여 전달, (2) `llm/client.ts`의 `createModel`도 trimmed falsy 가드 추가 → 두 단계 모두 provider별 `DEFAULT_MODELS`로 fallback.
- Provider 미지정 + key 없는 사용자 모두에게 영향이 있었으나 진단 surface 부족으로 Gemini 사례에서만 표면화됨. 본 hotfix로 anthropic/google/openai 모두 동일 보호.

## [1.2.3] — 2026-05-19

### Fixed — v1.2.2 후속 BE 결함 3건

대용량 실제 Spring Boot 프로젝트(985 routes / 422 tables)에서 노출된 결함 일괄 수정.

- **Tab2 "(no BE components found)" × N chunks**: `buildWithChunkFallback`이 라우트 기준으로 graph를 chunk 분할하면서 컴포넌트가 누락된 각 chunk마다 `buildBeArchitectureDiagram`을 호출 → 빈 결과 N회 반복. BE 어댑터인 경우 Tab2의 chunking을 우회하도록 가드 추가.
- **Spring Data JPA `interface Repository` 누락**: `parseSpringComponents`가 `class_declaration`만 처리해 `public interface XxxRepository extends JpaRepository<...>` 패턴(어노테이션 없는 표준)을 인식 못 함 → DI `calls` 엣지의 `to` 매핑 실패. `interface_declaration` 추가 처리 + 이름 패턴(`*Repository|Dao|Mapper`) fallback. 사전 필터에 `JpaRepository`/`CrudRepository`/`PagingAndSortingRepository`/`MongoRepository`/`ReactiveCrudRepository` 키워드 추가.
- **Gemini "Not Found" 에러 표면화 부족**: `analyzWithLLM` 호출부에 try-catch 보강 — provider/model 컨텍스트 + raw 에러 메시지를 사용자에게 surface (`LLM 호출 실패 [provider=… model=…]: …`). 모델 ID 변경/키 권한/엔드포인트 문제를 즉시 식별 가능.

### Improved — Tab1 BE 패키지 경로 기반 nested grouping

기존 File-First 단일 subgraph → 패키지 경로 트리 nested subgraph로 개선. 깊은 패키지 구조(`com.wina.partner.matMgmt.decoSheet.controller.DecoSheetController`)의 도메인 계층이 시각적으로 드러남.

- `src/main/{java,kotlin}/` 자동 감지 후 패키지 segments 추출.
- 모든 Controller가 공유하는 공통 prefix(예: `com.wina`) 자동 strip.
- 마지막 segment가 모두 `controller(s)`이면 strip (Spring 패키지 컨벤션).
- 트리 leaf = Controller 파일 단위 subgraph + URL prefix LCP 자동 추출 유지.

### Added — fixture: `mini-spring-deep-pkg-app`

깊은 패키지(4단계) + interface Repository + 다중 도메인(admin / partner.order / partner.matMgmt.decoSheet) 검증용 픽스처. Tab1 nested grouping + 컴포넌트 파서 interface 처리 회귀 방지.

## [1.2.2] — 2026-05-18

### Added — Spring Boot DI 분석기 + BE 전용 렌더러 3종

기존 어댑터에 BE 카테고리 분기를 도입. FE 렌더러 동작은 변경 없음(회귀 0).

- **`AdapterCategory` 도입 (`FE` | `BE` | `Fullstack`)**: `IAdapter.category` + `IRGraphMetadata.adapterCategory` 추가. 13개 어댑터(Next.js / Next.js Pages / Remix / React Router / Nuxt / SvelteKit / Vue SPA / Angular / NestJS / Spring Boot / Django / FastAPI / Flask)에 카테고리 부여.
- **Spring Boot DI 파서**: tree-sitter Java AST 기반. 필드 주입(`@Autowired private X x`), 생성자 주입(단일 ctor 자동 + `@Autowired` ctor), setter 주입(`@Autowired setX()`) 3종을 감지하여 `calls` 엣지 생성. `confidence:'inferred'` + `inferenceChain` 기록, 중복 엣지 제거.
- **Tab1 BE 렌더러 (File-First grouping)**: Controller 파일 단위로 subgraph를 생성하고 경로 LCP(longest-common-prefix)를 추출해 subgraph 제목에 prefix를 표기, 노드 라벨에는 suffix만 표시 (`📄 UserController [/api/users]` → `GET /:id`).
- **Tab2 BE 렌더러 (3-tier DI architecture)**: Controllers / Services / Repositories / Components 4-tier subgraph + DI `calls` 엣지 렌더링. 이름 휴리스틱(`*Controller` / `*Service(Impl)?` / `*Repository|Dao|Mapper`)으로 자동 분류.
- **Tab3 BE 확장 (Repository cross-ref)**: Repository / Dao / Mapper 컴포넌트를 queries 엣지가 없어도 ER 다이어그램에 표시해 Tab2와 cross-tab 추적이 가능.

### Improved — Tab3 ER 테이블 디자인 (MySQL Workbench 스타일)

- **헤더 / 필드 콘트라스트 강화**: 헤더는 어두운 청회색(`#2a4055`) + 밝은 폰트(`#f8fafc`), 필드(td)는 밝은 배경(`#ffffff` / `#f1f5f9`) + 어두운 폰트(`#1e293b`).
- **`textColor` themeVariable 추가**: 외부 mermaid 렌더러(viewer CSS 인젝션이 없는 환경)에서도 동일한 td 텍스트 색상 보장.

### Fixed

- **CLI에서 `adapterCategory` 누락**: `packages/cli/src/index.ts`가 `IRGraph.metadata`에 `adapterCategory`를 주입하지 않아 CLI 경로에서 BE 분기가 무시되고 FE URL grouping으로 fall-through 되던 결함 수정. `packages/extension/src/analyzer.ts`와 동일 패턴으로 정렬.
- **URL grouper 무한 재귀 가드**: `groupRoutesRecursive`의 `shouldRecurse` 조건을 `routes.length > minGroupSize`에서 `distinctPaths > 1`로 변경. 동일 경로 N개 라우트(예: Spring `@RequestMapping` 동일 경로 여러 HTTP 메서드)에서 더 이상 분기하지 않음.

## [1.2.1] — 2026-05-18

### Fixed

- **Sidebar API key guide for all providers**: Previously only Google (Gemini) showed a key-generation link. Now Anthropic (`console.anthropic.com`) and OpenAI (`platform.openai.com/api-keys`) also display a provider-specific guide link when selected.
- **React Router `.map()` path prefix extraction**: Routes declared as `appRoutes.map(r => <Route path={'/' + r.path} />)` or template-literal form `` path={`/${r.path}`} `` now correctly extract the prefix and produce `/dashboard`, `/settings`, etc. instead of bare `dashboard`.
- **Row-mode initial zoom fixed at 1.0**: Large BE projects (e.g. 975 routes / 33 chunks) were auto-scaled to an unreadable size. Each chunk SVG now starts at 1:1 scale; use scroll-wheel zoom and drag-pan to navigate.

## [1.2.0] — 2026-05-17

### Added — Multi-provider LLM (BYOK 확장)

Anthropic 단일 의존에서 3-provider 지원으로 확장. `@anthropic-ai/sdk` 제거 → Vercel AI SDK (`ai` + `@ai-sdk/anthropic` + `@ai-sdk/google` + `@ai-sdk/openai`).

- **Google Gemini 무료 키 지원**: `gemini-2.5-flash` 기본 모델. Free Tier 1,500 RPD · 1M TPM — 비용 없이 LLM 분석 가능.
- **OpenAI 지원**: `gpt-4o` 기본 모델.
- **Zod 스키마 검증 + 1회 retry**: LLM 응답 파싱 실패 시 자동 재시도.
- **사이드바 AI Provider 드롭다운**: Anthropic / Google (Gemini 무료) / OpenAI 선택. Google 선택 시 aistudio.google.com 발급 안내 링크 표시.
- **기존 Anthropic 키 자동 무중단 마이그레이션**: 첫 실행 시 `codesight.anthropicKey` → `codesight.llm.apiKey.anthropic` 슬롯으로 자동 이전.
- **`codesight.llm.provider` 설정 키 추가**: VS Code Settings에서 provider 전환 가능 (default: `anthropic`).
- **i18n 4로케일 provider 키 추가**: 한국어 · 영어 · 일본어 · 중국어 간체.
- **README LLM Analysis 섹션 추가**: provider 비교 표 · Gemini 3단계 발급 가이드 · Free Tier 한계 명시.

## [1.1.6] — 2026-05-15

### Improved — React Router 분석기 (T1)

`<Routes>` 안의 JSX expression child(`{appRouteElements}`, `{MobileRoutes}` 등)를 1-hop으로 추적해 누락된 라우트를 회수한다.

- **named import 추적**: 기존엔 default import만 importMap에 등록 → named export 라우트 fragment 미발견. 이제 `import { MobileRoutes } from './...'` 패턴도 수집.
- **`{identifier}` 분기**: `extractJsxRouteChildren`에 `JsxExpression` 분기 추가. same-file const, `.map()` 결과, 외부 모듈 export 등 1-hop 케이스 처리.
- **`ParenthesizedExpression` unwrap**: `export const X = ( <>...</> )` 처럼 괄호로 감싼 fragment도 정상 추출.
- **`.map()` 결과는 `inferred`**: 정적 평가 추론임을 명시.
- **미해결 식별자는 stderr 진단**으로 표면화 (RouteNode 미생성 — Less is More).

### Improved — Viewer chunk별 독립 조작 + 그리드 레이아웃 (T3)

`row-mode`의 시각 흐름을 개편: 수직 단일 컬럼 → 화면 폭 기반 자동 wrap 그리드(`repeat(auto-fit, minmax(560px, 1fr))`).

- **chunk별 독립 zoom/pan**: 각 `.row-diagram`이 자체 `ST` 상태(`fitS` × 사용자 `s`)를 가지며, hover된 chunk에만 wheel/drag 적용. `+/-/⌂` 버튼은 모든 chunk에 동일 비율 적용.
- **노드 폰트 floor**: `themeVariables.fontSize='14'` (Tab1/2/3) — 다운스케일된 chunk에서도 텍스트 가독성 확보.
- **fit 모델 변경**: 초기 cell 폭에 맞춰 SVG 다운스케일만, 이후 사용자 조작은 chunk-local. 큰 chunk가 작은 chunk를 가리는 비율 폭발 제거.

### Improved — 트리 X/Y 축 정렬 (T4)

`buildNestedSubgraphLines` / `buildScreenSubgraphLines`에서 자식 subgraph가 `GROUPS_PER_ROW(5)` 초과 시 5개씩 invisible row 래퍼 + `direction LR`로 묶어 "부모 안에서 자식 가로 정렬, depth 변화 시 Y 줄넘김"을 구현.

- mermaid v11 공식 문서 확인: 외부 edge는 **immediate parent subgraph**의 direction만 무시 → ROW wrapper(ancestor) `direction LR`은 유효. Tab2 (route→comp edge 존재)에서도 작동.
- `NestedGroup` tree 구조 보존 — `feedback_render_chunked_path_nested.md` 원칙 준수.

### Fixed — Spring Boot 테스트 디렉토리 노이즈 (T2)

`JAVA_EXCLUDE_DIRS`에 `test` 추가 → `src/test/**`의 `@WebMvcTest` mock controller, integration test stub이 라우트 카운트에 합산되던 결함 해소.

### Removed — Cytoscape PoC

`feature/v2.0-cytoscape-poc` 브랜치의 PoC 자산(`cytoscape-mapper`, `cytoscape-renderer`, `CytoscapePocPanel`, `media/cy/*`, 관련 deps) 일괄 제거. 보류 결정에 따라 mermaid 측 개선(T3/T4)으로 본질 동기 흡수.

---

## [1.1.4] — 2026-05-09

### Improved — Stack Detection

**모노레포 / 멀티서비스 프레임워크 자동 감지**

- **Turbo/Lerna/Nx 모노레포**: 루트 `package.json`에 빌드툴(`turbo`, `concurrently`)만 있는 경우 `apps/`, `packages/`, `services/` 하위 디렉터리를 자동 스캔. 발견된 프레임워크 중 파싱 레벨(L3 > L2 > L1)과 static adapter 보유 여부 기준으로 최적 프레임워크를 선택.
- **루트 package.json 없는 멀티서비스 구조**: `backend/`, `frontend/`, `client/`, `web/`, `server/`, `api/`, `mobile/`, `app/` 등 직접 서비스 디렉터리에서 package.json, requirements.txt, pom.xml을 탐색.
- **전체 최상위 디렉터리 fallback**: 위 두 방법으로도 감지 실패 시 모든 최상위 디렉터리를 순회하여 JS/TS·Python·Java·Flutter 프레임워크 탐색.
- **Flutter 감지 추가**: 루트 또는 하위 디렉터리의 `pubspec.yaml`에 `sdk: flutter` 포함 시 Flutter(L1, LLM recommended)로 감지.

**사이드바 프레임워크 표시명 보완**

- Django · FastAPI · Flask · Spring Boot · Angular · Vue SPA · React Router · Remix · Flutter의 표시명이 원시 식별자 대신 정식 명칭으로 표시됨.

---

## [1.1.3] — 2026-05-09

### Bug Fixes

**Viewer — Tab1/Tab2 줌 & 드래그 수정**

- **Fix #16 — drag 구현 교체**: 패널별 클로저 + `window.mousemove` × 3 방식을 단일 `drag` 객체 + `document.addEventListener` 방식으로 교체. 탭 전환 중 드래그 상태 간섭 제거.
- **Fix #17 — fitToView 수식**: `getBoundingClientRect()` (transform 후 크기 반환) → `svg.getAttribute('width')` (SVG 자연 크기 기준)으로 교체. 뷰포트 리사이즈 후 재호출 시 오차 제거.
- **Fix #18 — ⌂ 리셋 동작**: `ST[id]={s:1,x:0,y:0}` (scale 1.0 고정 리셋) → `fitToView(id)` 호출로 교체. 대형 다이어그램에서 리셋 시 fit-to-view 동작.

**Viewer — Tab3 DB ERD 토글 추가**

- **Fix #19 — DB 토글 바**: Tab3 진입 시 `전체(All)` · `FK 관계` · `페이지 쿼리` · `서버 액션` 4개 뷰 토글 추가. 기본값 `전체`.
- **Fix #20 — FK 관계 뷰**: 테이블 스키마 + FK 관계만 표시하는 전용 erDiagram 뷰.
- **Fix #21 — 페이지 쿼리 뷰**: 라우트 → 테이블 도메인 그룹 flow graph 뷰.

### Other Changes

- `README.md`: DB-Screen 4-toggle view 설명 추가
- `ANALYZER_VERSION` 상수를 `'codebase-viz@1.1.3'`으로 업데이트

---

## [1.1.2] — 2026-05-08

### Bug Fixes

**Tab1 Rendering Architecture — X축 폭발 근본 수정**

- **Fix #9 — 행 다이어그램 평탄 렌더링**: `buildRouteRowDiagram()` 내부 재귀 중첩 `subgraph` 대신 각 그룹의 모든 라우트를 1줄씩 평탄하게 나열. graph TD에서 에지 없는 노드는 줄 단위 배치 시 세로 정렬이 보장되므로 X폭발 없이 7,407px→1,380px로 개선됩니다.

**Tab2 Screen-Component — X축 폭발 근본 수정**

- **Fix #10 — Section-내 Component Subgraph 중첩**: `renderScreenSection()`에서 컴포넌트를 free node로 내보내던 방식을 route section subgraph 내부에 중첩된 component subgraph로 전환. graph TB에서 sibling subgraph 간 수평 배치 문제를 해소하며 32,035px→1,381px로 개선됩니다.
- **Fix #11 — TAB2_GROUPS_PER_ROW=2**: Tab2 행당 섹션 수를 5→2로 조정. nested comp subgraph 방식에서 섹션 1개≈580px이므로 2개 기준 약 1,200px의 안전한 폭을 유지합니다.

**Tab3 DB-Screen — renderer 버그 수정**

- **Fix #12 — dbScreen chunk 폭발**: `buildDiagrams()`에서 Tab3에 `routeCount`를 임계값으로 사용하던 버그 수정. `buildDbScreenWithFallback()`로 분리하여 `tableCount` 기준 적용 — 120개 라우트 + 8개 테이블 구성에서 125개 빈 chunk 폭발 현상이 해소됩니다.

**Tab3 viewer — Routes/Actions/ALL 뷰 Y축 개선**

- **Fix #13 — source 노드 그룹화**: `buildSingleDbGraph()`에서 route/action source를 free node 대신 `⬡ Pages` / `⚡ Actions` subgraph로 묶어 표시. 조직화된 시각 구조를 제공합니다.

**Tab3 ERD 디자인 — th/td 시각 분리**

- **Fix #14 — ERD 컬럼 행 배경색**: Mermaid 11 `row-rect-even/odd` 후처리로 테이블명 헤더(TH)는 어두운 배경/밝은 텍스트를 유지하고, 컬럼 행(TD)은 흰색(`#ffffff`) / 연회색(`#f1f5f9`) zebra 배경 + 어두운 텍스트(`#1e293b`)로 분리합니다.

**Tab3 viewer — ALL 뷰 기본값 변경**

- **Fix #15 — 전체 뷰 Default 활성화**: Tab3 진입 시 기본 토글을 `FK 관계`→`전체(FK+Routes+Actions)`로 변경. 전체 토글을 토글 바 맨 앞(구분선 왼쪽)으로 이동합니다.

### Other Changes

- `ANALYZER_VERSION` 상수를 `'codebase-viz@1.1.2'`로 업데이트 — v1.1.1 캐시가 있는 프로젝트에서 자동 무효화 후 재분석이 트리거됩니다.

---

## [1.1.1] — 2026-05-08

### Bug Fixes

**A group — WINA-APP-FE 분석 가능화 (차단 해제)**

- **Fix #3 — stack-detector 우선순위**: `vite+react` 감지가 `react-router-dom` 감지를 가로채던 문제 수정. `vite+react+react-router-dom` 조합이 이제 react-router 어댑터로 올바르게 분류됩니다.
- **Fix #5 — vite-react phantom adapterId**: 라우터 라이브러리가 없는 순수 SPA에 한해 `adapterId: undefined`로 정확히 처리. LLM OFF 상태에서 분석 시 silent empty 대신 명시적 에러 메시지를 출력합니다.
- **Fix #4 — JSX `<Routes>` 파서**: react-router v6의 JSX 패턴(`<BrowserRouter>` + `<Routes>` + `<Route>`) 정적 파서 추가. 평면/nested/index/catch-all Route 4가지 패턴을 모두 지원합니다.

**B group — 대규모 라우트 가독성 (품질 개선)**

- **Fix #1 — Multi-level 재귀 그룹핑**: `groupRoutesByUrl()` 재귀 nested 트리(`NestedGroup`) 구조로 전환. 934 라우트 규모 프로젝트에서 `/api → /v1 → /partner → ...` 형태로 깊이 중첩된 Mermaid `subgraph`가 생성됩니다. `maxDepth: 8`, `minGroupSize: 3` stop 조건으로 무한 재귀를 방지합니다.
- **Fix #2 — 노드 수 기반 chunk 트리거**: `shouldChunk()` 에 `nodeCount` / `nodeThreshold`(기본 100) 조건 추가. 1M자 미만이더라도 라우트가 100개를 초과하면 chunk 분할이 발생합니다.

**C group — 대규모 다이어그램 가독성 (UX 개선)**

- **Fix #6 — 행 기반 그리드 레이아웃**: LCP(최장공통접두사) 이후 최초 분기 지점을 자동 탐지하고 하위 그룹을 5개 단위로 행 배치합니다. `/api/v1` 하나로 수렴하는 934-라우트 규모 BE 프로젝트에서도 가로 폭 폭발 없이 다이어그램이 표시됩니다. Tab1·Tab2·Tab3 모두 적용.
- **Fix #7 — 전체 컬럼 ERD 표시**: DB 스키마 컬럼의 묵시적 8개 절단(slice)을 제거. ERD 다이어그램과 사이드바에서 테이블의 모든 컬럼이 표시됩니다.
- **Fix #8 — 멀티행 뷰어**: 다중 행 다이어그램을 동시에 표시하는 스택 뷰로 전환. 각 행 SVG를 컨테이너 너비에 맞게 자동 스케일하며 수직 스크롤로 탐색합니다.

### Other Changes

- `ANALYZER_VERSION` 상수를 `'codebase-viz@1.1.1'`로 업데이트 — v1.1.0 이전 캐시(`.codesight/cache.json`)가 있는 프로젝트에서 자동 무효화 후 재분석이 트리거됩니다.

> **캐시 주의**: LLM 분석 결과가 캐시된 프로젝트는 v1.1.1 최초 실행 시 재분석이 발생합니다. LLM API Key 설정이 되어 있으면 LLM 비용이 재발생할 수 있습니다.

---

## [1.1.0] — 2025-04-15

### New Features

- **13번째 프레임워크 지원**: Next.js Pages Router (`pages/` 디렉터리) 어댑터 추가
- **FE↔BE 멀티프로젝트 URL 매칭**: `fetch()` / `axios.*` 호출 URL을 BE 라우트와 정적 매칭, 결합 다이어그램에 점선 cross-edge 표시
- **Tab1 URL 계층 그룹핑**: `groupRoutesByUrl()` 도입으로 동일 prefix 라우트를 Mermaid `subgraph`로 묶어 표시
- **Flyway DDL 파서**: Spring Boot 프로젝트의 Flyway 마이그레이션 파일에서 테이블 스키마 추출

---

## [1.0.0] — 2025-03-01

### Initial Release

- 12개 프레임워크 정적 분석 (Next.js App Router, Nuxt, SvelteKit, NestJS, Django, FastAPI, Flask, Spring Boot, Vue SPA, Angular, Remix, React Router)
- 3-tab Mermaid 다이어그램 (Rendering Architecture / Screen–Component / DB–Screen)
- Supabase, Prisma, Drizzle, TypeORM, SQLAlchemy, JPA ORM 파서
- LLM 선택적 보강 (Claude claude-sonnet-4-6)
