# Changelog

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
