# Changelog

## [1.2.55] — 2026-06-24

### Changed — Tab1 (Rendering Architecture) folder overview for large React/SPA projects

- **Tab1 no longer repeats the framework wrapper per domain, and shows the full folder directory.** On large multi-domain projects (e.g. 500+ routes across 20 domains) Tab1 previously re-drew the `Browser › Router › React` wrapper as a repeated grid and scattered box granularity onto sub-segments, making some top-level domains look missing. Tab1 now renders a **single architecture wrapper** containing the URL directory as a full-depth nested folder tree (root → group → sub-group), each folder header carrying a recursive route-count badge (`📁 /name · N routes`). Individual route URLs remain in Tab2 (tab separation).
- **Fewer repeated boxes.** Folders whose children are all single-route collapse into one count box; in mixed folders, multi-route children keep their structure while 2+ single-route children fold into a single aggregate box (`📄 name1 · name2 · name3 +N (M pages)`). On the WINA-scale sample this cut repeated "· 1 route" boxes from 141 to 17.
- **Tab2 (Screen-Component) leaves now show the full route URL** (`🔗 /full/path`) in addition to the file/component name.
- Zero missing domains is guaranteed by emitting every top-level domain plus recursive counts.
- Verification: build + unit tests pass · no regressions · snapshots regenerated for the new layout only.

## [1.2.54] — 2026-06-22

### Fixed — LLM mode no longer mislabels a web app as mobile or invents a backend

- **A React (web) SPA is no longer misclassified as a mobile/React Native app in LLM mode.** When AI analysis is enabled, an invented `deployTarget: mobile` could override the statically-detected framework and wrap the whole architecture as `📱 Mobile · React Native · Expo`. Tab1 now keeps the real web classification (`🌐 Browser · React Router · SPA`); genuine Expo apps are still detected from their dependencies, so nothing is lost.
- **No more hallucinated backends for frontend-only repos.** LLM mode could invent a detailed backend block (e.g. `spring-boot` + `PostgreSQL` with made-up modules) for a repo that has no backend code at all. Detailed backend blocks now render only when there's actual server-code evidence in the analyzed files (a server dependency in `package.json`, or NestJS controller files). Frontend-only repos that call an API instead show a generic "External REST API" gateway — evidence-based, not invented.
- Verification: build + unit tests pass (817 passed) · no regressions · existing snapshots byte-identical.

## [1.2.53] — 2026-06-18

### Fixed — Tab1 lost its framework/backend layers on large projects + standardized Tab2 vertical spacing

- **Tab1 now always shows the full architecture, even for large apps.** Projects with more than 5 top-level URL domains (very common) fell into a chunked path that dropped the entire infrastructure stack (`Browser → Router → React`) and the data/backend layer, leaving Tab1 as a bare URL tree — duplicating Tab2 and breaking the Tab1/2/3 hierarchy. Tab1 is now redefined as a **domain summary**: one box per top-level domain with a route-count badge (`📁 partner · 24 routes`). Detailed route/screen breakdown stays in Tab2. Because the summary is small (O(domains)), Tab1 no longer needs chunking and always keeps its framework + backend layers.
- **No more over-nested sub-domains in Tab1.** Tab1 used to nest every URL segment (e.g. `matMgmt` inside `partner` as its own layer), diverging from Tab2's folder-based view. The domain summary removes that.
- **Tab2 vertical connectors are tighter and uniform.** Domain trees and file trees used Mermaid's default rank spacing (~50), which stretched the vertical lines between layers and made them uneven across layers. A compact spacing profile standardizes them (no overlap, consistent gaps).
- Verification: build + unit tests pass (806 passed) · webview before/after confirmed tighter, non-overlapping spacing.

## [1.2.52] — 2026-06-17

### Improved — Large-project viewer loads faster, scrolls smoother

- **First diagram appears ~4× sooner on large projects.** Previously, projects that split into many chunks (e.g. 1000+ routes → ~22 chunks) rendered every chunk before showing anything — a long blank wait. Chunks now stream in progressively: the first row paints immediately and the rest fill in without blocking the UI. Measured time-to-first-row on a ~1100-route synthetic dropped 1459 ms → 333 ms.
- **Less stutter when scrolling/zooming/panning.** Off-screen chunks now skip repaint (`content-visibility`), so interaction cost no longer scales with the total number of chunks.
- Note: this improves first-paint latency and interaction smoothness; the total time to render *all* chunks of a very large project is unchanged. Viewer-only change — no analyzer/diagram-output difference.

## [1.2.51] — 2026-06-16

### Fixed — React Router bulk route omission (tsconfig alias) + Spring Boot large-domain "maximum size" error

- **React Router — entire route trees vanished.** Routes imported through a `tsconfig` path alias (`baseUrl:"src"` + `"@/*":["*"]`) and spread via `appRoutes.map(...)` were dropped — only hard-coded `<Route>` survived. Root cause was alias resolution (`loadTsConfigPaths`): it ignored `baseUrl`, mishandled the `"*"` target, and didn't follow `extends`/`references` (Vite `tsconfig.app.json` split) or strip JSONC comments. A 240-route project that rendered ~15 routes now renders all.
- **Domain layering — agency parity.** Routes with dynamically loaded components (`import.meta.glob`) now layer into `📁 src/pages/<domain>` identically to statically-imported domains (URL-path fallback).
- **Spring Boot Tab2 — "Maximum text size exceeded" on a large domain.** Backend chunking split only at the top-level package boundary, so one big domain became a single Mermaid block over the webview cap. Added node/edge-budget secondary sub-chunking — a 1.1 MB single domain now renders as multiple clean rows.
- **Tab1 — many-domain readability.** Small projects with more than 5 top-level route groups were forced into a single wide `graph LR` strip (all domains rendered but compressed ~20:1). They now chunk into a readable multi-row grid (route-count-independent gate). Note: chunked Tab1 omits the SPA-wrapper/data-layer framing, consistent with how 100+-route projects already render.

## [1.2.50] — 2026-06-12

### Fixed — Spring DI 5-level fan-out + React Router template paths

- **Spring Boot**: Lombok `@RequiredArgsConstructor`/`@AllArgsConstructor` final-field injection now recognized (was dropping DI edges → Tab2 cut off at Controller). MyBatis XML mapper (`<mapper namespace>`) linked as terminal nodes. Fixed 2-hop DI replaced with N-ary recursive chain: Controller → Service[] → Impl → Repository[] → XML.
- **React Router**: template-literal route paths (`` path: `${BASE}/spec` ``) are now statically evaluated (were dropped entirely). `src/pages/<domain>` file-path domain layering for Tab2.

## [1.2.49] — 2026-06-01

### Fixed — React Router parser + large-webview freeze

- React Router: pathless route suppression, node-id dedup, array-spread (`...routes` + `Object.entries().map()`) route extraction.
- Large projects (1000+ routes): node-bound chunking + per-frame yield eliminate the viewer freeze on big diagrams.

## [1.2.48] — 2026-05-30

### Changed

- Framework-config externalization (M11) and remaining polish items.

## [1.2.47] — 2026-05-28

### Fixed — React Router import route tracing + code-quality pass

- Generalized React Router route tracing across alias / rename / barrel / lazy imports (`component-resolver`, 4-hop + tsconfig paths).
- Full `src` refactor: `mermaid-renderer` split into modules (−72% in the largest file), dead-code removal, no behavior change.

## [1.2.46] — 2026-05-26

### Changed

- Project-wide code-quality cleanup (47 files, regression 0, snapshots byte-identical).

## [1.2.45] — 2026-05-23

### Changed — FE diagram standard v1.1

- Top-level route groups guaranteed on the X-axis; nested children stack on the Y-axis (mermaid v11 nested-LR limitation made the standard explicit). URL intermediate-node unfolding, Tab1 leaf flattening, brand/folder unification.

## [1.2.44] — 2026-05-21

### Fixed — React Router `.map()` regression + Vue/Angular Tab2

- React Router `.map()` route pattern regression resolved. Vue/Angular Tab2 component-path standard. Data Flow tab promotion. New `FE-DIAGRAM-STANDARD` v1.0.

## [1.2.43] — 2026-05-20

### Changed — config-based FE 어댑터(Vue SPA · Angular) Tab1 wrapper 표준 적용

v1.2.42에서 file-based FE 어댑터 6종에 도입된 `Browser → Router → Engine` 3단 wrapper 표준을 config-based 화면 프레임워크 2종(Vue SPA · Angular)에 균등 적용. FE 어댑터 8종 Tab1 헤더 표현 통일.

- **Tab1 (Rendering Architecture)**:
  - **Vue SPA**: `BROWSER → 🧭 Vue Router · SPA → 💚 Vue · CSR Engine` 3단 wrapper 신규 (`InfraInfo.hasVueSpa`).
  - **Angular**: `BROWSER → 🧭 Angular Router · SPA → 🅰 Angular · CSR Engine` 3단 wrapper 신규 (`InfraInfo.hasAngular`).
  - 외부 REST API Gateway 분기는 `frontendRef` 정의로 자동 발동 — Vue SPA·Angular도 axios/fetch 호출 시 데이터 레이어 자동 노출(v1.2.42 통합 동작 흡수).
- **Tab2**: config-based 어댑터는 `route.filePath`가 라우터 정의 파일(`src/router/index.ts` 등)로 통일되어 있어 파일경로 노드 가치 부족 — 어댑터에서 컴포넌트 파일 추적 보강이 선행 필요. **v1.2.43 SKIP**, v1.2.44+로 분리.

### Fixed — Expo adapterId 죽은 참조 + over-defensive 분기 정리

- `stack-detector.ts`: `'expo' adapterId: 'expo'` 죽은 참조 제거 (registry 미등록). expo·vite-react를 LLM-only 그룹으로 명시.
- `mermaid-renderer.ts`: `fw.includes('vite')`, `fw.includes('expo')` redundant fallback 제거 (FrameworkKind union 닫힘으로 unreachable). 명시 `fw === 'vite-react'`, `fw === 'expo'`만 유지. `deployTarget === 'mobile'` 보존.
- `hasVite`/`hasExpo` wrapper 분기에 의도 주석 보강 (빌드/플랫폼 메타 표현용, 별도 화면 프레임워크 아님).

### Internal

- snapshot: `mini-vue-spa-app` · `mini-angular-app` Tab1 갱신 (2건).
- verify.sh: 687 PASS · 1 skipped · 회귀 0.

## [1.2.42] — 2026-05-20

### Changed — React (react-router) Tab1/2/3 전면 재설계 + file-based FE 어댑터 6종 Tab2 표준화 + Tab1 외부 API Gateway 분기

- **Tab1**:
  - React Router SPA 프레임워크 헤더(`BROWSER → React Router · SPA → React · CSR Engine`) 추가.
  - **외부 REST API Gateway 데이터 레이어 분기 신규** — `apiCallEdges>0` && backends/Supabase/Prisma/Firebase/Dexie/hasExternalAPI 모두 미설정 시 `subgraph DATALAYER → 🔌 External REST API → API_GATEWAY` + library별 라벨 합성(`axios · fetch` 등). 분기 우선순위 = backends > Supabase > Prisma > Firebase > Dexie > hasExternalAPI > apiCallEdges(신규).
- **Tab2**:
  - 라우트 → 디렉터리 + 파일명 노드 표시. 컴포넌트 이름만 보여주던 방식 폐기.
  - **file-based 어댑터 6종 일반화** — `nextjs-app-router` · `nextjs-pages` · `nuxt` · `sveltekit` · `remix` · `react-router`. `buildReactRouterScreenDiagram` → `buildFeFileTreeScreenDiagram` 개명 + `isFileTreeTab2Eligible(meta)` 헬퍼.
  - 그룹 라우트 `app/(marketing)/about/page.tsx`·동적 라우트 `app/blog/[slug]/page.tsx` 디렉터리 시각 노출.
- **Tab3**: `framework='react-router' && tables===0`에서 **FE API 호출 다이어그램**(axios·fetch·react-query) 신규. Supabase·Prisma·BE 어댑터는 현행 ER 유지(회귀 0).

### Added — `'api-call'` edge kind

- `IREdge.kind`에 `'api-call'` 추가 + `ApiCallInfo { method, path, library }` 메타.
- `makeNodeId`에 `'endpoint'` 가상 kind — graph.nodes에 미등록, edge target 식별자 전용.
- 신규 `reactrouter/parsers/api-call-parser.ts` — `_shared/fe-call-extractor` 재사용.
- `FeCall.library` 필드 신규.
- template literal 인터폴레이션은 `confidence='inferred'` + 점선 화살표.

### Verified — LLM enabled 정적 파서 무손상 (회귀 테스트 2건 신규)

- LLM `backendServices` 반환 시 `BACKEND_0` 분기 우선, External API Gateway 미발동
- LLM `backendServices` 없을 때 정적 `api-call` edges 보존되어 분기 정상 발동

### Scope

본 버전은 file-based FE 어댑터 6종(React Router 포함) Tab1·Tab2 표준화. **config-based(Vue SPA·Angular)·Expo·Vite 등 다른 FE 스택의 표준 구현은 v1.2.43에서 진행** (별도 메모리 project_v143_fe_standard.md).

## [1.2.41] — 2026-05-19

(상위 모노레포 CHANGELOG.md 참조)

## [1.2.40] — 2026-05-19

### Changed — BE Tab1/Tab2 다이어그램 트리 표준화

대규모 Spring Boot 프로젝트(985+ routes, 30+ 도메인) 분석에서 드러난 두 가지 한계를 해소:
- **Tab2 단순 X축 나열** (Controller 30+ 도메인이 한 줄로 펼쳐져 X축 폭발, 패키지 계층·연관관계 미표현)
- **Tab1 nested subgraph** (깊은 패키지 컨테이너 중첩의 트리 직관성 부족)

표준 단일진실: `docs/design/BE-DIAGRAM-STANDARD.md` (R-T1.1~9 / R-T2.1~6).

#### Tab1 (Rendering Architecture, BE)

- **트리 레이아웃**: `graph TD` + 패키지 segment = `pkg_*` 노드 + 부모→자식 `-->` 엣지 (R-T1.4). 이전 nested subgraph 폐기.
- **헤더 annotation**: `📁 src/main/java/<공통 prefix>` 단일 헤더 노드 (R-T1.2). 모든 Controller가 공유하는 LCP 자동 strip.
- **suffix strip**: 마지막 segment가 `controller(s)`이면 자동 strip (R-T1.3).
- **leaf**: `📄 <ControllerName> [<URL prefix>]` (R-T1.5) — path-segment LCP로 자동 추출.
- **endpoints subgraph**: leaf 옆 `endpoints_<Ctrl>` subgraph, `METHOD /suffix`만 표시 (R-T1.6).

#### Tab2 (Screen–Component, BE)

- **베이스 트리**: Tab1과 동일한 패키지 트리 + 동일 chunking 정책 (R-T2.1).
- **leaf DI 수직 체인**: Controller leaf 자리에 `di_<Ctrl>` subgraph로 Controller→Service→Repository 수직 체인 (R-T2.2). 단계별 verified `-->` / inferred `-.->`.
- **(none) placeholder**: DI edge가 ≥1개 있는 Controller에서만 누락 슬롯에 `(no Service)`/`(no Repository)` 표시 (R-T2.5 Less is More — 순수 non-DI Controller는 leaf만).
- **cross-package DI**: Service가 다른 도메인 Repository를 주입받는 경우 leaf 외부 dashed edge `-.->|"cross-pkg"|` (R-T2.4). 도메인 패키지 분류는 `controller`/`service`/`repository` 컨벤션 폴더 strip 기준.
- **색상**: Controller=`:::ssr`(green), Service=`:::unk`(grey), Repository=`:::ssg`(purple) (R-T2.6 기존 색 체계 유지).

#### X축 폭발 방지

- **top-level 패키지 단위 chunking** (R-T1.8): 공통 prefix strip 후 첫 depth 노드별로 별도 다이어그램 chunk 분할. viewer row-mode가 chunk별 zoom/pan 독립 지원.
- **ELK mrtree per-diagram opt-in** (R-T1.9): `@mermaid-js/layout-elk@0.2.1` 동적 로드 + `mermaid.registerLayoutLoaders` 등록. BE Tab1/Tab2 diagram text에 `---\nconfig:\n  layout: elk.mrtree\n---` pragma prepend. 등록 실패 시 silent dagre fallback. vsix 실측 4.18MB→4.67MB (+0.49MB, minified ESM 번들 1.6MB가 vsce zip 압축으로 70% 축소). chunk 내부 leaf 자식(endpoints subgraph 등)의 가로 폭발 추가 완화.

### Added

- 신규 클래스 `:::pkg` (중립 회색 패키지 노드) · `:::muted` (점선 placeholder) · `:::hdr` (헤더 annotation).
- Fixture `fixtures/mini-spring-wide-pkg-app/` (21 controllers, 2 top-level chunks) — X축 폭발 회귀 보호.
- Fixture `fixtures/mini-spring-deep-pkg-app/` 스냅샷 추가 (deep nested 회귀).
- `all-fixtures-snapshot.test.ts`에 `adapterCategory` 메타 전파 (BE 어댑터 분기가 fixture 스냅샷에 반영되도록).

### Removed

- `buildPkgTree` 기반 nested subgraph 렌더링 (`emitPkgTreeSubgraphs`, `emitControllerFileSubgraph`).
- `buildBeArchitectureDiagram`의 단순 `CTRL_G`/`SVC_G`/`REPO_G` 단일 컬럼 그룹.
- outer `BE_ROOT` wrapper subgraph.

### Compatibility

- BE 분기(`adapterCategory==='BE'`) 한정 변경. FE 어댑터(`'FE'`/`'Fullstack'`) 회귀 0.
- 26개 FE fixture snapshot은 CLASS_DEFS에 3개 신규 classDef 추가 영향만 받음 (의도된 cosmetic 갱신).

## [1.1.54] — 2026-05-16

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

## [1.1.53] — 2026-05-14

### Fixed — 작은 프로젝트 Y축 단조 나열 (adapter-wide)

- **결함**: 28 routes / 7 top-level folder처럼 작은 프로젝트도 `GROUPS_PER_ROW = 5` (Tab1) / `TAB2_GROUPS_PER_ROW = 2` (Tab2) 임계값을 초과하면 chunked path가 발동되어, viewer의 row-mode가 7개 chunk를 `flex-direction:column`으로 vertical stack → 사용자 화면에 단조 Y축 나열로 표시되던 문제. mini-angular/fastapi/flask/next/nextpages/nuxt/react-router/remix/sveltekit/vue-spa fixture까지 모두 Tab2 chunked 상태였던 adapter-wide 결함.
- **Fix**: `SINGLE_DIAGRAM_ROUTE_THRESHOLD = 100` 추가. Tab1·Tab2의 chunked path는 `branchingGroups.length > GROUPS_PER_ROW` **AND** `routeCount > 100`을 모두 만족할 때만 발동. 작은 프로젝트는 nested subgraph 단일 다이어그램으로 emit되어 mermaid의 자연 layout이 X축 펼침을 처리한다.
- **회귀 보호**: v1.1.6의 200-route stress test는 그대로 PASS (200 > 100 게이트 통과 → chunked 유지). 새로 추가된 dev-log-portfolio 시뮬레이션(28 routes / 7 top-level) + root-only branch edge case 회귀 테스트 3개.

### Verified

- 630 tests PASS (619 + 11 신규 회귀 / 게이트 정책)
- 10개 mini-fixture Tab2 snapshot이 chunked → single로 갱신

## [1.1.52] — 2026-05-13

### Fixed

- chunk 과다 분할(collectLeafRouteArrays → collectGroupRoutes, 30 routes/chunk 정책)
- Tab3 extractModule bin/main/sql/primary 경로 처리
- viewer row-mode floating (`inner.style.left = "0px"`)
- React Router sub-router 2-pass 감지

## [1.1.51] — 2026-05-11

### Fixed — Large monorepo rendering (937+ routes)

- **Critical regression in v1.1.5 chunked diagrams**: the nested grouping result was discarded for large projects, causing all routes to be flattened under one subgraph (e.g. `/api` containing 100+ flat siblings). Mermaid layout failed → vertical compression.
- **Fix**: `buildRouteRowDiagram` (Tab1) and `renderScreenSection` (Tab2) now preserve the `NestedGroup` tree end-to-end. Depth (e.g. `/api` → `/v1` → `/admin` → `/users`) is retained in chunked output, so each leaf subgraph contains a small number of siblings (typically 4–10) and Mermaid can lay it out correctly.
- **Chunk boundary redesign**: chunks are now formed as **1 top-level branch = 1 chunk** (instead of grouping 5 branches per chunk). Semantic units (e.g. `/api`, `/admin`, `/auth`) become independent diagrams.
- **Subgraph ID collision fix**: subgraph IDs now derive from the full `groupKey` (`API_V1_ADMIN_USERS_G`) instead of just the leaf segment. Previously, `/admin/users` and `/order/users` collided into a single `USERS_G` subgraph.

### Added — Stress test fixture

- New `mermaid-renderer.stress.test.ts` synthesizes a 200-route NestJS-like pattern (`/api/v1/{module}/{resource}/{action}`) to exercise the chunked path. The mini-next-app fixture never triggered chunking, which is why v1.1.5 shipped this regression.

### Verified

- 619 tests PASS (612 existing + 7 new stress regression tests)
- 26 fixture snapshots updated to reflect new nested output structure

## [1.1.5] — 2026-05-10

### Added — i18n (4 languages)

- Full internationalization: **한국어 / English / 日本語 / 中文 (简体)**
- Sidebar Language selector — change language directly without editing settings.json
- New setting `codesight.language`: `auto` (follow VS Code) / `ko` / `en` / `ja` / `zh-cn`
- Locale changes apply instantly without window reload — sidebar + viewer re-render in real time

### Added — Demo GIFs in marketplace listing

- `demo-tab-switch.gif` — Tab1 → zoom-out → Tab2 flow
- `demo-db-toggle.gif` — Tab3 four-view toggle (All / FK / Page Queries / Server Actions)

### Fixed — Viewer interactions

- Wheel zoom + drag pan now work correctly on all tabs (previously selected text instead of panning)
- Row-mode (chunked diagrams) also supports wheel zoom + drag pan — same UX as single diagrams
- Index routes inside group subgraphs no longer collapse to `/` (preserves natural label width)

### Improved — Diagram density thresholds

- `DEFAULT_NODE_THRESHOLD`: 100 → 300 (typical projects render as a single SVG instead of chunked rows)
- `DEFAULT_CHUNK_THRESHOLD`: 1MB → 5MB (matches modern Mermaid render budget)
- Group prefix stripped from route labels inside section subgraphs (e.g. `/dashboard/admin` → `admin` inside `📁 /dashboard`)

### Removed

- Static `screenshot-rendering.png`, `screenshot-dbscreen.png`, `screenshot-marketplace*.png` — replaced by dynamic GIFs

## [1.1.4] — 2026-05-09

### Improved — Stack Detection

- Turbo / Lerna / Nx monorepos now correctly detected: scans `apps/`, `packages/`, `services/` sub-directories when root `package.json` has no framework deps
- Multi-service projects without a root `package.json` (e.g. `backend/` + `frontend/` at root) now auto-detected
- Flutter recognized via `pubspec.yaml` (`sdk: flutter`) — reported as Flutter · L1 · LLM recommended
- Last-resort fallback: all top-level directories are scanned for Python/Java/JS/TS frameworks
- Sidebar now shows proper display names for Django, FastAPI, Flask, Spring Boot, Angular, Vue SPA, React Router, Remix, Flutter (previously showed raw identifiers)

## [1.0.0] — 2026-05-07

### Fixed — Tab1 Route accuracy

- **Next.js** — `.js` and `.jsx` route files (`page.js`, `layout.js`, `route.js`) now detected alongside `.tsx`
- **Remix** — `$.tsx` splat catch-all now converted to `/*` wildcard route with `catch-all` segment type
- **Django** — `re_path(r'^api/(?P<id>\d+)/$')` regex URL patterns now parsed to `:id` notation
- **NestJS** — Template literal route prefixes (`` @Controller(`/api/${version}`) ``) now extracted correctly

### Fixed — Tab2 Component accuracy

- **Vue SPA** — `<ComponentTag>` template tags now produce `renders` edges (was incorrectly producing `imports` edges)
- **Angular** — `loadComponent: () => import('./x').then(m => m.X)` lazy routes now emit `renders` edges to the loaded component
- **All TS adapters** — `tsconfig.json` path aliases (`@/`, `~/`) resolved when building component import graphs

### Fixed — Tab3 DB accuracy

- **Flask SQLAlchemy** — `ForeignKey('table.id')` columns now populate FK arrows in the DB–Screen tab
- **FastAPI** — Relative model imports resolved relative to the current file directory
- **Spring Boot JPA** — `@Column(name="col_name")` mapped to actual DB column name (not Java field name)
- **Spring Boot JPA** — FK targets resolved via class-to-table map; `@Table(name="...")` overrides handled correctly
- **Spring Boot MyBatis** — `<resultMap extends="parent">` inheritance resolves parent columns; `<association>`/`<collection>` inner columns parsed

### Improved — Provenance

- Route/component/table nodes now carry accurate line numbers in provenance (was hardcoded `1`)
- Flask factory pattern (`create_app()`) no longer produces duplicate route nodes

---

## [0.9.0] — 2026-05-06

### Fixed — DB FK 관계 정확도 (Phase V)

- **SpringBoot `@OneToOne`**: `@OneToOne` 어노테이션을 `@ManyToOne`과 동일하게 처리 → FK edge 및 column 생성. `@JoinColumn(name=...)` 있으면 컬럼명 오버라이드.
- **Django `ManyToManyField`**: `RELATION_FIELDS`에 추가 → M2M 필드도 `references` 포함 edge 생성.
- **FastAPI/SQLAlchemy `ForeignKey`**: `ForeignKey('users.id')` 감지 시 `parseForeignKeyRef` 헬퍼로 `{ table: 'users', column: 'id' }` 추출 → Tab3 DB–Screen에 FK 화살표 표시.
- **TypeORM `@Column` nullable**: 항상 `false`이던 하드코딩을 `resolveColumnNullable()` 헬퍼로 교체. `{ nullable: true }` ObjectLiteral 파싱 + `T | null` / `T | undefined` TypeNode 감지.
- **TypeORM ArrowFunction 블록 바디**: `() => { return User; }` 형태의 relation 타입 함수 미감지 → ts-morph `SyntaxKind.Block` + `ReturnStatement` 분석으로 전환.

### Fixed — Tab1 Routes 정확도 (Phase VI)

- **Flask `methods=[...]`**: `@app.route('/path', methods=['GET', 'POST'])` keyword argument 파싱 → `httpMethod` 설정. 이전에는 모든 Flask 라우트의 HTTP method가 없었음.
- **Flask 2.0+ 단축 데코레이터**: `@app.get()`, `@app.post()`, `@app.put()`, `@app.delete()`, `@app.patch()` 인식 → 라우트 등록 + `httpMethod` 자동 설정.
- **SpringBoot `@RequestMapping(method=RequestMethod.POST)`**: `method` 인자에서 `RequestMethod.X` field access 파싱 → 올바른 HTTP method 반환. 이전에는 항상 `GET` 반환.
- **SpringBoot 다중 class prefix**: `@RequestMapping({"/api/v1", "/api/v2"})` 형태에서 첫 번째 prefix만 사용하던 문제 수정 → 각 prefix와 메서드 경로 조합으로 RouteNode 생성.
- **SvelteKit `renderingMode` 오감지**: `export const ssr = false` / `export const prerender = true`를 `.svelte` 파일에서 읽던 문제 수정 → `+page.server.ts` → `+page.ts` → `.svelte` 순서로 탐색.
- **Django `include()` 패키지 형태**: `include('myapp.urls')` 처리 시 `myapp/urls.py`만 탐색하던 문제 수정 → `myapp/urls/__init__.py` 패키지 형태도 탐색.

---

## [0.8.2] — 2026-05-06

### Added

**Supabase shared parser for all SPA adapters:**
- Nuxt, SvelteKit, Remix, Next.js Pages, Vue SPA, Angular, React Router now all parse auto-generated `supabase.ts` type files
- Reads `Database.public.Tables` structure → extracts Row columns + FK relationships
- Supabase-only projects (no Prisma/Drizzle/TypeORM) now correctly populate the DB–Screen tab

### Fixed

- **Tab1 orphan `REACT` node** (11 adapters): backend-only frameworks (Django, Flask, FastAPI, Spring Boot, NestJS) no longer emit a dangling `REACT` subgraph node in the Rendering Architecture diagram. `frontendRef` pattern introduced — data layer edges are only drawn when a frontend layer subgraph is actually defined.
- **Tab3 ERD parse error** (`→` in column type): Django/SQLAlchemy FK columns with types like `Integer→FK` caused Mermaid ERD to fail. `sanitizeId()` now applied to `col.type` as well as `col.name`.
- **Tab3 mapper edges missing** (Nuxt, Vue SPA, Angular, React Router): `buildMapperEdges` was hardcoded to `[]` — now properly called, linking route/component file names to ORM table names via token-boundary matching.
- **Regex false-positive edges** in `mapper-utils.ts`: table names with `.` or `+` characters were interpolated directly into `RegExp`, causing false matches. Proper escape applied (`replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`).

### Performance

- **tree-sitter Parser instance caching**: `createPythonParser()` and `createJavaParser()` now return module-level cached instances, avoiding redundant WASM initialization on repeated calls.

---


## [0.8.1] — 2026-05-05

### Added

**Spring Boot — MyBatis support:**
- Mapper XML (`*Mapper.xml`) parsing: `<resultMap>` column extraction + SQL `FROM/INTO/UPDATE` table name extraction
- Tier 1: single-table `<select resultMap="X">` → columns from resultMap linked to real table name
- Tier 1 fallback: unmatched resultMaps → class simple name as table name (with columns)
- Tier 2: multi-table JOINs and insert/update statements → table names registered (no columns)
- `@Mapper` Java interface supplement: SQL string literals scanned for additional table references
- Oracle-specific: schema-qualified `SCHEMA.TABLE` names → table part only; `DUAL`/`SYSDATE` filtered

### Fixed

- **Mermaid large diagram crash** (`maximum text size in diagram exceeded`): `maxTextSize: 1000000` and `maxEdges: 2000` added to `mermaid.initialize()` in both `viewer.html` and `webview.ts`
- **DB–Screen "Other NoTables" phantom entry**: removed `NoTables { string placeholder }` ERD fallback — empty DB tab now shows `(No data)` via existing viewer fallback

---

## [0.8.0] — 2026-05-05

### Added

**React Router — 13th static-analysis adapter:**
- `createBrowserRouter()` / `createHashRouter()` route arrays parsed statically
- `Component:` and `lazy:` properties resolved → renders edges
- 1-depth import chain tracked for sub-component edges

**Tab3 (DB–Screen) connected for all 13 adapters:**
- Next.js Pages Router, Remix, Nuxt, SvelteKit — Supabase support added (Prisma/Drizzle/TypeORM already had it)
- Vue SPA, React Router, Angular — Supabase · Prisma · Drizzle · TypeORM connected
- Flask — new SQLAlchemy ORM parser (`Base` / `db.Model` subclasses + `Column()` via tree-sitter)

**FK reference tracking:**
- TypeORM: `@ManyToOne` / `@OneToOne` decorators → `ColumnDef.references` (FK target arrows in DB–Screen)
- Django ORM: `ForeignKey('Model')` first argument → `ColumnDef.references`

**Django CBV HTTP method detection:**
- `class UserView(View): def get(self, request)` → `httpMethod: 'GET'` on route nodes
- Covers `get`, `post`, `put`, `patch`, `delete` methods

**Angular template-based component graph:**
- `@Component.template` / `templateUrl` strings scanned for `<selector-name>` tags
- Renders edges created between parent and child components

### Changed

- Framework count: 12 → 13 static-analysis adapters
- All adapter `parsingLevel` values now correctly set to `L2` (routes + components + DB when ORM present)

---

## [0.7.0] — 2026-05-04

### Added

**HTTP method labels in Rendering Architecture:**
- NestJS: `@Get` → `GET`, `@Post` → `POST`, etc. shown as prefix in route nodes
- FastAPI: `@router.get` / `@app.post` → `GET` / `POST` labels
- Spring Boot: `@GetMapping` → `GET`, `@PostMapping` → `POST`, etc.

**SvelteKit component runtime detection:**
- `+page.svelte` alone → `runtime: client`
- `+page.svelte` + `+page.server.ts` → `runtime: shared`
- `+page.server.ts` alone → `runtime: server`

**Remix nested folder route support:**
- Recursive scan of `app/routes/` subdirectories
- `users/_index.tsx` → `/users`, `users/$id.tsx` → `/users/:id`

**ORM column quality improvements:**
- Django ORM: `null=True` → `nullable: true`, `ForeignKey('User')` → type `ForeignKey→User`, `Meta.db_table` as table name
- SQLAlchemy: `nullable=True/False`, actual column type (`String`, `Integer`, …), `__tablename__` as table name
- JPA: `@Column(nullable=false/true)`, `@JoinColumn(name="col")` as FK column

**DB–Screen mapper connections:**
- SvelteKit and NestJS routes/components now linked to ORM tables in DB–Screen tab via `mapper-utils.ts`

**Config-driven parser selection:**
- All adapters now read `ctx.stack` flags (`hasPrisma`, `hasDrizzle`, `hasTypeOrm`, `hasSQLAlchemy`, `hasDjangoORM`, `hasSpringDataJpa`) to skip irrelevant parsers
- 5 new `StackInfo` flags: `hasDrizzle`, `hasTypeOrm`, `hasSQLAlchemy`, `hasDjangoORM`, `hasSpringDataJpa`

### Changed

- `ParsingLevel` labels corrected to reflect actual extraction depth:
  - Next.js App Router: `L1` → `L3` (routes + components + DB)
  - Nuxt, SvelteKit, Django: `L1` → `L2` (routes + components or DB)
  - Flask, Vue SPA, Angular: `L2` → `L1` (routes only)
  - vite-react: `L2` → `L3` (LLM-only = comprehensive)
- Backend adapter error handling: `Promise.all` `.catch(() => [])` guards on all parsers

---

## [0.6.0] — 2026-05-04

### Added

**5 new framework adapters (static analysis, no API key):**
- **FlaskAdapter** — `@app.route` + Blueprint `url_prefix` synthesis via tree-sitter. `<int:user_id>` → `:user_id`.
- **Next.js Pages Router adapter** — `pages/` directory file-based routing. `[param]` → `:param`, `[...param]` → `:param*`.
- **Vue SPA adapter** — `createRouter({ routes: [...] })` array parsed via ts-morph. Lazy `import()` paths included.
- **Remix adapter** — `app/routes/` file-based. `$id` → `:id`, `_index.tsx` → `/`.
- **Angular adapter** — `provideRouter(routes)` / `RouterModule.forRoot(routes)` parsed via ts-morph. Cross-file `Routes` variable resolution. `loadChildren` path literals included.

**DB Multi-ORM support (all TS adapters):**
- **Prisma** — `schema.prisma` model extraction via `@mrleebo/prisma-ast`. Relation fields excluded. DB tab populated for Next.js, NestJS, SvelteKit.
- **Drizzle** — `pgTable()` / `sqliteTable()` call extraction via ts-morph (object + callback form).
- **TypeORM** — `@Entity` / `@Column` decorator extraction via ts-morph. `@PrimaryGeneratedColumn` flagged as PK.

**Backend DB support (Python/Java adapters):**
- **Django ORM** — `models.Model` subclasses + `CharField` / `ForeignKey` etc. from `models.py` via tree-sitter.
- **SQLAlchemy** — `Base` subclasses + `Column()` from FastAPI projects via tree-sitter.
- **JPA** — `@Entity` + `@Column` + `@Table(name=...)` from Spring Boot projects via tree-sitter.

**Component graph expansion:**
- **Nuxt** — `.vue` SFC import graph (script block extracted via regex → ts-morph). `~/` and `@/` aliases resolved.
- **SvelteKit** — `.svelte` SFC import graph. `$lib/` aliases resolved.
- **Django** — `View` / `ViewSet` subclasses as component nodes.
- **FastAPI** — `BaseModel` subclasses as component nodes.
- **Spring Boot** — `@Service` / `@Component` / `@Repository` classes as component nodes.
- **NestJS** — already had component graph; now also produces `tableNodes` via TypeORM parser.

### Changed

- `FrameworkKind` type expanded: `flask`, `vue-spa`, `remix`, `angular` added.
- Framework count: 7 → 12 static-analysis adapters.

## [0.4.0] — 2026-05-03

### Added

- **Multi-stack adapter system** — static analysis adapters for 7 frameworks (Next.js, Nuxt, SvelteKit, NestJS, Django, FastAPI, Spring Boot). No API key needed for any of these.
- **DjangoAdapter** — parses `urls.py` with `path()` / `re_path()` calls via tree-sitter. Converts `<int:pk>` → `:pk` notation.
- **FastApiAdapter** — parses `@app.get()` / `@router.get()` decorators across all `.py` files. Converts `{user_id}` → `:user_id`.
- **SpringBootAdapter** — parses `@RestController` / `@GetMapping` / `@PostMapping` etc. across all `.java` files. Combines class-level `@RequestMapping` prefix with method paths.
- **Unified dynamic segment notation** — all route paths now use `:param` format (`:slug`, `:slug*`, `:id`) across all adapters for consistent Mermaid diagram labels.
- **tree-sitter WASM runtime** — Python and Java AST parsing via `web-tree-sitter` + bundled `tree-sitter-python.wasm` / `tree-sitter-java.wasm`. No native dependencies, pure Node.js.

### Changed

- Extension bundle includes `dist/wasm/` directory with WASM files (~1.1MB). Total vsix size: ~3.7MB.

## [0.2.0] — 2026-05-03

### Added
- Activity Bar 사이드바 패널 — Analyze, API Key 설정, LLM 토글, 분석 상태 표시
- 하단 패널 (CodeSight Analysis 탭) — 분석 로그 및 결과 요약

## [0.1.0] — 2026-05-03

Initial release.

### Features

- **Rendering Architecture tab** — route hierarchy with SSR/CSR/ISR/SSG labels
- **Screen–Component tab** — route → component dependency graph
- **DB–Screen tab** — Supabase table schema + page/server-action query relations with 4-view toggle (FK / Page queries / Server actions / All)
- **Static analysis** — works out of the box with no API key
- **LLM analysis** (BYOK) — Claude-powered deep analysis via Anthropic API
- **Persistent cache** — results cached in `.codesight/cache.json`, instant reopen
- **Re-analyze button** — force a fresh scan from the viewer header
- **Export dropdown** — save diagrams as PNG, SVG, or Markdown
- **Local Mermaid bundle** — works in air-gapped environments (no CDN required)
