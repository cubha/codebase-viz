# codebase-viz

**VS Code extension that visualizes codebase architecture as interactive Mermaid diagrams.**

Routes, components, and DB relationships — extracted statically from **13 frameworks**, optionally enriched by LLM, rendered as three live diagram tabs inside VS Code.

> Marketplace: [`cubha.codebase-arch-viz`](https://marketplace.visualstudio.com/items?itemName=cubha.codebase-arch-viz) · Current release: **v1.2.54**
>
> **v1.2.54 highlights** — **WINA-FE Tab1 LLM 오분석 근본 수정 — deployTarget 뒷문 차단 + 백엔드 환각 corroboration 게이트** (사용자 보고 · 회귀 0). 실 레포(react-router 516라우트 웹 SPA)가 LLM=true에서 Tab1을 `📱 Mobile · React Native · Expo` + `spring-boot` + `🐘 PostgreSQL`로 오분석. 원인: 정적 framework 가드가 있으나 인접 메타(`deployTarget`·`backends`)가 가드 밖으로 무조건 주입되어 뒷문 우회. **(Fix1)** `infra.ts` `hasExpo`에서 `|| deployTarget==='mobile'` 삭제 → react-router는 web 분류 유지, 진짜 Expo는 stack-detector 정적감지로 무손실. **(Fix2·Evidence-First)** 신규 `backend-corroborate.ts`: LLM `backendServices`는 수집물에 실제 서버 코드 증거(package.json server-dep 또는 `.controller.ts`)가 있을 때만 상세 렌더, FE-only 환각은 드롭→generic gateway fallback. 설계: 원 계획 "BE파일 OR api-call edge"를 **api-call edge 제외(Design B)**로 정정(api-call은 백엔드 존재만 증명, framework+모듈 미증명 → renderer generic gateway가 담당). v1.2.43 ST3 명세 정정. verify.sh **PASS · 817 passed/1 skip** · 회귀 0 · 스냅샷 byte-identical · 3 SubTask TDD.
>
> **v1.2.53 highlights** — **React Tab1 도메인 요약 재정의 + FE Tab2 Y축 연결선 표준화** (사용자 v1.2.52 후속 3현상 · 회귀 0). 코드레벨 분석 → `docs/analysis/v1.2.52-fe-tab1-yaxis-findings.md`. **귀속 정정**: v1.2.52(viewer 단독) 무관, 원인은 v1.2.51 C2 청킹 게이트(`branchingGroups>5`)가 Tab1 인프라 wrapper·외부분기를 폐기시킨 것. **(Phase A·1b/1a)** Tab1을 top-level 도메인 **요약 박스**(`📁 <도메인> · N routes`, `buildDomainSummaryLines`)로 재정의 → 라우트 leaf·하위 세분화는 Tab2 위임, 노드 O(도메인)라 **청킹 폐지**(R-T1.7 v1.2)·wrapper·외부분기 항상 유지·도메인>5는 inner-row 줄넘김. 실측: 7도메인 0 청크·`BROWSER/ROUTER/REACT`+`API LAYER` 유지·matMgmt 별도 레이어 소멸. **(Phase B·2)** 신규 `FE_TREE_INIT`(`rankSpacing:24·nodeSpacing:40`)로 Tab2 도메인/file-tree Y축 연결선 표준화(기본≈50 과대·불균일 해소), webview 실측 겹침 0. Tab1(nested+`~~~`)은 spacing 무시 케이스라 미적용. FE-DIAGRAM-STANDARD v1.2 amendment(§9). verify.sh **PASS · 806 passed/1 skip** · 회귀 0.
>
> **v1.2.52 highlights** — **대형 라우트 viewer perf 개선(점진 주입 + content-visibility · 회귀 0)**. 사용자 보고(1112 route viewer 버벅임·로딩 지연) backlog. **viewer.html 단독** — analyzer/IR/diagram 출력 무변경. (레버1) `.row-diagram { content-visibility:auto }` + 실측 `contain-intrinsic-height`(height축만) → off-screen 청크 paint/hit-test 스킵(스크롤/줌/팬 repaint가 청크 수에 비례하지 않음). (레버2) `renderChunked`(누적-후-일괄 innerHTML) → `renderChunkedInto` 점진 주입(청크별 즉시 append + rAF yield) → **첫 행 즉시 노출**. 측정 delta(`scripts/viewer-perf.mjs`, 22청크≈1100route): time-to-first-row **1459ms→333ms(−77%)**. 레버3(IO 가상화)은 baseline상 불필요로 보류. 부수: `playwright` 1.59.1→1.60.0 skew fix. **한계**: 첫 페인트·상호작용 jank 개선이며 초대형 입력의 총 렌더 시간 자체는 불변. Playwright **6/6** · verify.sh PASS · 회귀 0.
>
> **v1.2.51 highlights** — **React Router 라우트 통째 누락(tsconfig alias) + Spring Boot 대형 도메인 "maximum size" + Tab1 다도메인 가독성** (사용자 단일검증 3건 · 회귀 0). (A) `loadTsConfigPaths` baseUrl·`"*"`·extends/references·JSONC 해석 결함으로 240 라우트 전멸 → 전수 복원 + agency `import.meta.glob` 도메인 레이어. (B) BE chunking node/edge-budget 2차 sub-chunk(`splitTreeByBudget`)로 1.1MB 단일 도메인 → 다중 row. (C') top-level 형제>5면 route<100이어도 chunked grid(20:1 띠 해소). verify.sh **801 PASS** · 회귀 0(스냅샷 byte-identical).
>
> **v1.2.50 highlights** — **Spring Boot DI 체인 5단 fan-out(Lombok·MyBatis XML) + React Router 도메인 레이어** (사용자 단일검증 보강 2건 · 회귀 0). (A) **Spring Boot Tab2 "Controller에서 끊김" 해소** — 근본 원인은 Lombok `@RequiredArgsConstructor` 미인식(DI edge 0). **A-1** di-parser Lombok final 필드 주입 + `implements`(Service→ServiceImpl) 추적 · **A-2** 무어노테이션 `*Service`/`*Repository` interface 등록 · **A-3** 신규 `mapper-xml-parser`(`<mapper namespace=FQN>` ↔ Repository 정확 매칭 → XML 노드 + edge) · **A-4** renderer 2-hop 고정 폐기 → **재귀 N-ary 체인**(다중 Service 인라인 + ServiceImpl→다중 Repository fan-out + Repository→XML). 신규 fixture `mini-spring-lombok-mybatis-app`. (B) **React Router route 누락 + src/pages 도메인 레이어** — **B-1** template literal path(`` path: `${ORD_PROD_PLAN}/spec` ``)를 StringLiteral만 허용해 전부 drop하던 결함 해소 → `evalPathExpression`(NoSubstitutionTemplate·TemplateExpression const치환·bare Identifier, **cross-file 1-hop** const 평가) · **B-2** Tab2를 `src/pages/<Root 도메인>` 파일경로 트리로 레이어링(BE 동일사상, 도메인별 chunk 분리). URL이 폴더와 divergent(평탄 URL ↔ 깊은 도메인 폴더)해도 도메인으로 묶임. `framework==='react-router'` + `≥2 도메인 폴더` 게이트(평탄 fixture는 URL 그룹핑 fallback). 신규 fixture `mini-react-router-domain-app`. IR EdgeKind 확장 0. verify.sh **778 PASS** · 1 skipped · 회귀 0.
>
> **v1.2.49 highlights** — **React Router 파서 3결함 + 대형 프로젝트 webview 프리즈 수정** (회귀 0). 사용자 보고 2건 통합. (A) **React Router 회귀** — mobile/agency/partner sub-router 분리 표시가 회귀(v1.2.47이 `appRoutes.map()` alias만 고치고 spread 미처리). 3결함 해소: **①** pathless layout `<Route>` 가짜 `/` 노드 suppress(`/` ×4→×1) · **②** 부모 path+index 자식 동일 path `seen Set` dedup(`/login` ×2→×1) · **③** 배열 spread(`...routes`) 침묵 skip 해소 — 배열 리터럴(`...partnerRoutes`) + `Object.entries(obj).map()`(`...agencyRoutes`, 객체 키 정적 평가) 양 패턴 inline, spread entry `sourceFilePath` 추적으로 컴포넌트 resolve 정확도 유지. 신규 fixture `mini-react-router-spread-app`(14 routes 실측) + 테스트 8건. (B) **대형 프로젝트 webview 프리즈** — 1031 routes 단일 거대 mermaid가 메인 스레드 동기 dagre 레이아웃으로 freeze. **B-6** 청킹 게이트 `routeNodes>100` 단독 발동(`branchingGroups>5` AND 제거) · **B-7** `splitGroupsByNodeBound`(`CHUNK_ROUTE_BUDGET=50`) 노드-바운드 청킹(작은 브랜치 패킹 + 거대 브랜치 children 재귀 분할, nested 계층 보존) Tab1·Tab2 적용 · **B-8** webview 청크 사이 `requestAnimationFrame` 양보 + 첫 탭 렌더 지연. stress 테스트 +5건. verify.sh **750 PASS** · 1 skipped · 회귀 0.
>
> **v1.2.48 highlights** — **POLISH 잔여 6건 + M11 FW config화** (코드 품질 정리 · 기능 변경 없음). (1) **E-1**: BE Tab2 `emitChunk` 내 `buildPkgTree` 재구축 + `intersect` no-op 제거 (nodeIdByPath 키 정합성 수치 증명). (2) **R4/R6**: nextjs component-parser `NEXTJS_EXCLUDE_DIRS` 참조(`build` 누락 보완) · remix route-parser `REMIX_EXCLUDE_DIRS` 참조. (3) **R5/R7**: vue-spa route-parser + sveltekit component-parser inline recurse → `walkDir` 통합 (`VUE_SPA_EXCLUDE_DIRS`·`SVELTEKIT_EXCLUDE_DIRS` 신규 상수). (4) **M11**: `buildRenderingDiagram` 7+1 FW if-else → `FW_CONFIGS: readonly FwConfig[]` config 배열화. 7개 FW 케이스 close/innerIndent byte-identical 수치 검증 PASS. verify.sh **737 PASS** · snapshot byte-identical · 회귀 0.
>
> **v1.2.47 highlights** — **/refactoring 후속 12건** + **React Router 외부 import 라우트 추적 일반화** 통합. (1) **/refactoring 후속 사이클**: PR-A(M9 rename · M2 ts-config-loader · M4 ts-morph-utils + buildImportMap · M10 NodeId 컨벤션 docs) + PR-B(M1 walkDir 11곳 통합 + EXCLUDE 7종 · M3 vue-sfc-utils · M6 getDynamicSegmentTypeFromSegments) + PR-C(M8 **mermaid-renderer 1760→472라인 -72%**, helpers/fe/be/erd 15+ 파일 분리) + PR-D(M7 `packages/core/src/pipeline.ts` 신규 — cli analyze 87→11줄, extension runAnalysis 115→60줄, **v1.2.43/v1.2.45 CLI 잠복 회귀 자동 흡수** + M12 Context 객체). POLISH 8건. 34 modified + 11 new files, +346/-1956 net **-1610라인**. 외부 export 표면 변경 0 · snapshot byte-identical. (2) **React Router alias fix**: 사용자 보고 회귀(REPO-SHARED-B2B-WINA-APP-FE에서 `appRoutes.map()` 패턴 라우트 다수 `rendersEdge` 누락) root cause 3건 일괄 해소 — **path alias(`@/...`) 차단** + **named import rename(`as`)** 미인식 + **createBrowserRouter 분기 외부 import 추적 부재**(advisor 지적). 신규 `_shared/component-resolver.ts` 통합 resolver(direct/rename + tsconfig paths + barrel re-export 1-hop + lazy/alias-chain, depth=2 cycle 가드, `{absBase, hops, inferenceChain?}` Evidence-First 메타). route-parser 가드 7곳 일괄 `resolveModuleSpecWithPaths` 적용. `extractMapElementPropName` paramName 매칭 정정(`<React.Suspense>` outer tag 잘못 매칭 차단). 신규 fixture 3종(alias/createbrowser-alias/barrel) + 단위 테스트 +19건. (3) **검증**: verify.sh **737 PASS** · 1 skipped · 회귀 0 · obsolete snapshot 0 · 영향 어댑터 161 PASS · buildImportMap 정정 부수 회귀 0.
>
> **v1.2.46 highlights** — **전체 src 코드 품질 정리 (98 파일 review · 36건 수정 · 회귀 0)**. `/refactoring` 파이프라인으로 Critical 9건(데이터 정확성·동작 버그) + Dead code 10건 + 중복 제거 5건 + 주석 정리 10건 + 부수 정리 4건 일괄 처리. (1) **ANALYZER_VERSION 통일**: `@codebase-viz/types`로 이동 + cli/extension import 통일 → IR Provenance가 실제 버전과 일치, CLI 캐시 무효화 버그 해소. (2) **parseRoutes/parseComponents/parseFlywayMigrations analyzerVersion 필수 인자화** (nextjs/nuxt/sveltekit/flyway). (3) **nestjs EMPTY_ADAPTER_RESULT 적용** · **setApiKey race condition 수정** · **sveltekit dirCache 지역화** · **webview setReanalyzeCallback silent failure 제거**. (4) **`findTsFiles` 단일 traverse 옵션화** (drizzle/typeorm 후처리 filter 제거) · **`pathExists` 추출** (supabase/nextjs db-parser 통합) · **`getDynamicSegmentType` _shared 통합**. (5) mermaid-renderer 41건 버전 stamp 주석 일괄 제거. verify.sh **703 PASS** · BE Tab1/Tab2 snapshot 영향 0 · FE fixture 변경 0. 수정 파일 42개 · +285/-437 라인.
>
> **v1.2.45 highlights** — **FE 표준 v1.1 amendment (R-T1.2 X축 보장 범위 정정) + 익스텐션 브랜드·폴더 통일 + Tab1 leaf wrapper 평탄화 + URL intermediate segment 보존 + LLM dedup/phantom/component skip + label/로고**. (1) **표준 v1.1 amendment**: webview 실측으로 mermaid v11이 nested subgraph LR direction을 보장하지 못함이 입증되어 표준을 라이브러리 능력 범위에 맞게 재설계 — **Top-level 형제 cluster = X축 보장, nested 자식 cluster = Y축 stack 기본** (자세한 사유·폐기 시도: `docs/design/FE-DIAGRAM-STANDARD.md` §8). (2) **브랜드/폴더 통일**: 출력 폴더 `.codebase-viz/` + 기존 `.codesight/` 읽기 fallback. 로고/타이틀 'Codebase Visualizer', 메시지 'Codebase Viz'. (3) **Tab1 outer wrapper top-level X축**: `emitTopLevelSiblingChain` helper로 outer wrapper(BROWSER/ROUTER/REACT) 안 top-level group `~~~` chain emit — v1.1 표준에 부합. (4) **Tab1 leaf wrapper 평탄화**: `buildNestedSubgraphLines`에서 `children=0 + routes=1 + dynamic/group route 아닌` leaf의 wrapper subgraph 제거 후 route 노드 직접 emit + parent context stripPrefix → 중복 wrapper 제거 + 라벨 정합성. (5) **URL intermediate segment unfold**: `url-grouper.ts` single-route cluster recurse → mini-react-partner `/partner` 안 `/ordProdPlanMgmt`·`/matMgmt`·`/perfMgmt` 명시 subgraph로 표현. (6) **monorepo file_leaf 부활**: `skipComponents` 조건을 `result.componentNodes.length > 0`로 정정. (7) **LLM merger dedup + phantom edge 차단**: route URL 정체성, component 확장자 정규화 + `idRemap`. (8) **LLM converter component skip (config-based)**: React Router dirname mismatch 본질 해소. **폐기 시도 (재발 방지)**: ELK opt-in / invisible row wrapper / 부모 cluster 안 chain / 단일-plain-노드 subgraph chain. `verify.sh` 703 PASS · 회귀 0 · BE 영향 0.
>
> **v1.2.44 highlights** — **React Router `.map()` 패턴 라우트 추적 회귀 해소** + **Vue SPA · Angular Tab2 file-tree 표준 진입** + **Tab2 1-depth import child leaf** + **Tab3 라벨 'Data Flow' 격상**. (1) **F-Route-1·2·3 hotfix**: 사용자 실측 케이스(`appRoutes.map(r => <Route element={<r.component/>}/>)` + 외부 import + lowercase `component` 키)에서 라우트 0건 회귀 해소 — `resolveArrayLiteralFromIdentifier` 헬퍼(same-file → import 1-hop fallback) + lowercase `component` Identifier 4번째 분기(대문자 가드) + `<paramName.propName/>` member access → entries 동적 키 lookup. (2) **Vue SPA · Angular Tab2 표준**: `route.filePath` 컴포넌트 파일 치환 (dynamic import `() => import('./Foo.vue')` + sync `component: FooComp` Identifier) + `isFileTreeTab2Eligible` 화이트리스트 확장 + adapter rendersEdge 보완(filePath 매칭). FE 어댑터 8종 file-tree 표준 통일. (3) **Tab2 1-depth import**: page ComponentNode의 직접 import을 child file leaf로 노출(Sub-1 fan-in shared component + Sub-2 page→page import, routeFileKind='page' 가드로 layout/loading 차단). (4) **Tab3 'Data Flow' 격상**: 'DB-Screen' → 'Data Flow (Screen ↔ Data Source)' 표준 amendment. i18n 4 로케일·webview·export MD 헤더 일관 갱신. (5) **`docs/design/FE-DIAGRAM-STANDARD.md` v1.0** 단일진실 문서 신설(R-T1·R-T2·R-T3). verify.sh 699 PASS · 회귀 0 · 신규 fixture 2종(`mini-react-router-map-import-app` 사용자 케이스 1:1 + `mini-angular-standalone-app` v17+ standalone).
>
> **v1.2.43 highlights** — **config-based FE 어댑터(Vue SPA · Angular) Tab1 wrapper 표준 적용**. v1.2.42에서 file-based 6종에 도입된 `Browser → Router → Engine` 3단 wrapper를 Vue SPA(`💚 Vue · CSR Engine`)·Angular(`🅰 Angular · CSR Engine`)에 균등 적용 → **FE 어댑터 8종 Tab1 헤더 표현 통일**. 외부 REST API Gateway 분기는 `frontendRef` 정의로 자동 발동(v1.2.42 흡수). Tab2 파일경로 노드는 config-based의 `route.filePath`가 라우터 정의 파일 단일값이라 가치 부족 → v1.2.44+ 어댑터 보강 patch로 분리. **부수 정리**: `stack-detector` Expo `adapterId='expo'` 죽은 참조 제거 + `mermaid-renderer` over-defensive `fw.includes()` 분기 제거 + `hasVite`/`hasExpo` wrapper 의도 주석 보강(빌드/플랫폼 메타 표현, 별도 화면 프레임워크 아님). 회귀 0(687 PASS).
>
> **v1.2.42 highlights** — **React (react-router) Tab1/2/3 전면 재설계 + file-based FE 어댑터 6종 Tab1·Tab2 표준화**. (1) **Tab1**: React Router SPA 프레임워크 헤더(`Browser → React Router · SPA → React · CSR Engine`) + 외부 REST API Gateway 데이터 레이어 분기 신규(`apiCallEdges>0` && DB 데이터 레이어 미설정 시, library별 라벨 합성). 분기 우선순위 = LLM backends > Supabase > Prisma > Firebase > Dexie > hasExternalAPI > apiCallEdges(신규). (2) **Tab2**: file-based 어댑터 6종(Next.js App/Pages·Nuxt·SvelteKit·Remix·React Router) 일관된 라우트 → `📂 디렉터리 / 📄 파일명` 노드 패턴. **그룹 라우트 `app/(marketing)/about` · 동적 라우트 `app/blog/[slug]` 디렉터리 시각 노출**. (3) **Tab3**: 분기 표준 도입 — `react-router && tables===0`에서 신규 **FE API 호출 다이어그램** (axios/fetch/react-query, library별 색상 차등). Next.js+Supabase·Prisma 등 FE+tables>0은 현행 ER 유지(회귀 0). 신규 `IREdge.kind='api-call'` + `_shared/fe-call-extractor` 재사용. LLM enabled 정적 파서 무손상 회귀 테스트 2건 신규.
>
> **v1.2.41 hotfix** — v1.2.40 BE Tab1/Tab2 결함 3건 일괄 수정. (1) ELK mrtree가 cluster wrapper 안의 top-level pkg 노드를 floating root로 인식하여 박스 외곽으로 비어져 나오던 영역 어긋남 → BE diagram에서 mrtree pragma 미사용(dagre)으로 해소. (2) Tab1 `endpoints` subgraph 내부 route 노드가 가로배치되던 결함 → 내부 line chain(`---`)으로 강제 수직 정렬. (3) Tab2 DI 체인(Controller→Service→Repository) Y간격 과대 → `BE_RENDERING_INIT`로 rankSpacing 8 축소. Spring DI Interface 주입(`Service`→`ServiceImpl`) fallback + `@Mapper` 인식 동시 보강. FE 영향 없음. **알려진 한계**: Tab1 endpoints **subgraph 내부** Y간격은 mermaid v11 통제 불가로 다음 minor에서 별도 탐색.
>
> **v1.2.40 highlights** — **BE Tab1/Tab2 트리 다이어그램 표준화** (`docs/design/BE-DIAGRAM-STANDARD.md`): `graph TD` 트리(패키지=노드, 부모-자식=엣지) + Controller leaf 옆 endpoints subgraph + Tab2 leaf에 Controller→Service→Repository 수직 DI 체인 + top-level 패키지 단위 chunking. 대규모 BE 프로젝트에서 X축 폭발·nested subgraph 가독성 한계 해소.

---

## What it does

Open a project in VS Code → click **Analyze**. CodeSight produces:

| Tab | Content |
|---|---|
| **Rendering Architecture** | Route hierarchy with URL-based hierarchical grouping, SSR / CSR / ISR / SSG labels, HTTP method badges |
| **Screen–Component** | Route → component import graph, runtime tags (client / shared / server) |
| **DB–Screen** | Table schema (Supabase, Prisma, Drizzle, TypeORM, Django ORM, SQLAlchemy, JPA, **Flyway DDL**) + 4-toggle view: **All** · **FK relations** (ERD with TH/TD distinction) · **Page queries** (route → table flow graph) · **Server actions** (action → table flow graph) |

Results are cached in `.codesight/cache.json`. Re-analyze on demand.

### Multi-project Analysis (FE↔BE)

When multiple workspace folders are open (e.g. a Next.js frontend + Spring Boot backend), CodeSight supports **paired analysis**:

1. Click **Analyze** → select the main (FE) project
2. A second prompt appears — select the paired BE project (or **Skip** for single-project mode)

CodeSight statically extracts `fetch()` / `axios.*` call URLs from the FE codebase and matches them against BE route definitions. Matched routes appear as **dashed cross-edges** in the combined Rendering Architecture diagram.

| | Without LLM | With LLM (BYOK) |
|---|---|---|
| Literal URL match rate | ~30–50% | ~70–85% |
| Template literal (same-file const) | ✅ | ✅ |
| Dynamic segments (`${id}`) | shown as `${…}` placeholder | ✅ |
| Import-resolved constants | ✗ | ✅ |

Unmatched FE calls appear as **dangling edges** (inferred, `no-route-match`). Diagrams exceeding 1 M characters automatically split into chunks (rendered as multi-row grid in the viewer).

---

## LLM Analysis (Optional, BYOK)

Static analysis covers all 13 frameworks without any API key. LLM enrichment is additive — static results are never discarded.

| | Static only | With LLM |
|---|---|---|
| Framework detection | package.json / config files | ✅ + fallback for unknown stacks |
| Route extraction | File-system + AST | ✅ + dynamic route inference |
| FE↔BE URL matching | Literal URLs (~30–50%) | ✅ ~70–85% (resolves constants & templates) |
| Unknown frameworks | L3 LLM-primary mode | ✅ Express, Hono, Rails, Go, … |

### Supported Providers

Select a provider in the CodeSight sidebar under **AI Provider**:

| Provider | Model | Cost |
|---|---|---|
| **Anthropic** | `claude-sonnet-4-6` | Paid (BYOK) |
| **Google Gemini** | `gemini-2.5-flash` | **Free tier available** |
| **OpenAI** | `gpt-4o` | Paid (BYOK) |

### Getting a Free Gemini API Key

1. Go to **[aistudio.google.com](https://aistudio.google.com/app/apikey)**
2. Click **Create API key** → select or create a Google Cloud project
3. Copy the key → open VS Code → CodeSight sidebar → select **Google (Gemini 무료)** → click **Set API Key**

> **Free Tier limits**: 1,500 requests/day · 1M tokens/min · 1M token context window.
> Large projects (> 500 routes) may approach the daily limit. Use static-only mode for routine browsing and reserve LLM for final analysis.

---

## Supported Frameworks (static analysis, no API key)

### Frontend / Full-stack

| Framework | Parsing | Detection signal | What's extracted |
|---|---|---|---|
| Next.js App Router | **L3** | `package.json` → `next` + `app/` dir | Routes, components (`.tsx`), DB (Supabase · Prisma · Drizzle · TypeORM) |
| Next.js Pages Router | **L2** | `package.json` → `next` (no `app/` dir) | `pages/` file-based routes · component graph · DB (Supabase · Prisma · Drizzle · TypeORM) |
| Nuxt | **L2** | `package.json` → `nuxt` | Pages + `.vue` SFC import graph · DB (Supabase · Prisma · Drizzle · TypeORM) |
| SvelteKit | **L2** | `package.json` → `@sveltejs/kit` | `+page`/`+layout`/`+server` routes · SFC import graph (client/shared/server runtime) · DB (Supabase · Prisma · Drizzle · TypeORM) |
| Vue SPA | **L2** | `package.json` → `vue` (no nuxt) | `createRouter()` routes · component graph · DB (Supabase · Prisma · Drizzle · TypeORM) |
| Remix | **L2** | `package.json` → `@remix-run/react` | `app/routes/` recursive scan · component graph · DB (Supabase · Prisma · Drizzle · TypeORM) |
| React Router | **L2** | `package.json` → `react-router-dom` | `createBrowserRouter()` routes · component import chain · DB (Supabase · Prisma · Drizzle · TypeORM) |
| Angular | **L2** | `package.json` → `@angular/core` | `provideRouter()` / `RouterModule.forRoot()` routes · template-based component graph · DB (Supabase · Prisma · Drizzle · TypeORM) |

### Backend

| Framework | Parsing | Detection signal | What's extracted |
|---|---|---|---|
| NestJS | **L2** | `package.json` → `@nestjs/core` | Controllers (GET/POST labels) · services · modules · TypeORM entities + FK relations |
| Django | **L2** | `requirements.txt` → `django` or `manage.py` | URL patterns · CBV/FBV method detection (GET/POST) · Django ORM models (nullable/FK/db_table) |
| FastAPI | **L2** | `requirements.txt` → `fastapi` | Routes (GET/POST labels) · Pydantic schemas · SQLAlchemy models (nullable/type/__tablename__) |
| Flask | **L2** | `requirements.txt` → `flask` | `@app.route` + Blueprint routes · view classes · SQLAlchemy models (Base/db.Model) |
| Spring Boot | **L2** | `pom.xml` / `build.gradle` | Controllers (GET/POST labels) · `@Service`/`@Repository` · JPA `@Entity` (@JoinColumn/nullable) · MyBatis mapper XML + `@Mapper` interfaces · **DI chain** (field/constructor/setter injection → `calls` edges) |

**L1** = routes only · **L2** = routes + components + DB (ORM-conditional) · **L3** = all 3 tabs always

Frameworks not in this list (Express, Hono, Rails, Go, etc.) fall back to **L3 — LLM primary** mode when an API key is configured (any provider).

---

## DB Coverage

| ORM / DB | Adapters | What's extracted |
|---|---|---|
| Supabase | All TS adapters (Next.js App Router, Pages, Nuxt, SvelteKit, Remix, React Router, Vue SPA, Angular, NestJS) | `.from('TABLE')` method-chain · table names · FK targets |
| Prisma | All TS adapters | `schema.prisma` model extraction via `@mrleebo/prisma-ast` · column types · nullable |
| Drizzle | All TS adapters | `pgTable()` / `sqliteTable()` calls via ts-morph |
| TypeORM | NestJS, Next.js, SvelteKit, Angular, Vue SPA, Remix, Pages | `@Entity` / `@Column` · `@ManyToOne` / `@OneToOne` → FK references |
| Django ORM | Django | `models.Model` subclasses · `null=True` → nullable · `ForeignKey('Model')` → FK reference |
| SQLAlchemy | FastAPI, Flask | `Base` / `db.Model` subclasses · `Column()` · `relationship()` targets |
| JPA | Spring Boot | `@Entity` / `@Column` · `@JoinColumn` · `nullable=false` |
| MyBatis | Spring Boot | mapper XML `<resultMap>` → column names · `FROM/INTO/UPDATE` SQL → table names · `@Mapper` Java interface supplements |

---

## Analysis pipeline

```
detectStack(repoRoot)
  → AdapterRegistry.get(adapterId).analyze()   # static, no API key
  → IRGraph (RouteNode / ComponentNode / TableNode / IREdge)
  → [optional] LLM enrichment (analyzer.ts:60–90)  # BYOK, additive only
  → buildDiagrams() → 3-tab Mermaid viewer
  → .codesight/cache.json

# Pair mode (FE↔BE)
detectStack(pairRepoRoot)
  → adapter.analyze(pairRepoRoot)              # BE IRGraph
  → extractFeCalls(feComponentFiles)           # fetch/axios literal extraction
  → matchFeCallsToBeRoutes(feCalls, beRoutes)  # URL matching
  → remapCrossEdgeFromIds(edges, feGraph)      # remap to real ComponentNode ids
  → buildCombinedDiagram(feGraph, beGraph, crossEdges)
  → .codesight/cache-pair-<be-name>.json
```

All nodes carry `provenance` (file + line) and `confidence` (`verified` | `inferred`). The LLM enrichment block is additive — static results are never discarded.

---

## Monorepo structure

```
packages/
  types/      @codebase-viz/types     IR type definitions (RouteNode, ComponentNode, IRGraph, …)
  core/       @codebase-viz/core      Adapter registry + 13 framework adapters + WASM runtime
  llm/        @codebase-viz/llm       Stack detector + LLM enrichment pipeline
  renderer/   @codebase-viz/renderer  Mermaid / Markdown output (buildDiagrams)
  cli/        @codebase-viz/cli       CLI entry point (analyze command)
  extension/  codebase-arch-viz       VS Code Extension (publisher: cubha)

fixtures/
  mini-next-app/          Next.js App Router sandbox
  mini-nextpages-app/     Next.js Pages Router sandbox
  mini-nuxt-app/          Nuxt sandbox
  mini-sveltekit-app/     SvelteKit sandbox
  mini-vue-spa-app/       Vue SPA sandbox
  mini-remix-app/         Remix sandbox
  mini-react-router-app/  React Router sandbox
  mini-nest-app/          NestJS sandbox (TypeORM entity + FK relations)
  mini-django-app/        Django sandbox (CBV/FBV views + models)
  mini-fastapi-app/       FastAPI sandbox (schemas + SQLAlchemy models)
  mini-flask-app/         Flask sandbox (blueprints + SQLAlchemy)
  mini-spring-app/        Spring Boot sandbox (services + JPA entities)
  mini-angular-app/       Angular sandbox
  mini-vanilla/           Unknown framework (L3 fallback test)
```

---

## Development

**Prerequisites**: Node.js 20+, pnpm 9+

```bash
# Install dependencies
pnpm install

# Type-check all packages
pnpm typecheck

# Run all tests (626 tests)
pnpm test

# Or use the project verify script (tsc + vitest)
bash verify.sh
```

**Build the extension**

```bash
cd packages/extension
node esbuild.mjs            # bundles extension.js + copies WASM to dist/wasm/
npx vsce package --no-dependencies   # produces .vsix
```

**Run a single adapter test**

```bash
npx vitest run packages/core/src/adapters/django/
```

---

## Adding a new framework adapter

1. Create `packages/core/src/adapters/<framework>/{adapter,index}.ts` implementing `IAdapter`
2. Add a parser in `parsers/` using the appropriate strategy:
   - File-system traversal (L1) — see `nextjs/parsers/route-parser.ts`
   - ts-morph AST (L2 TypeScript) — see `nestjs/parsers/decorator-parser.ts`
   - tree-sitter WASM (L2 Python/Java) — see `django/parsers/urls-parser.ts` or `springboot/parsers/annotation-parser.ts`
3. Register in `packages/core/src/adapters/registry.ts` → `createDefaultRegistry()`
4. Export from `packages/core/src/adapters/index.ts`
5. Add `FrameworkKind` entry in `packages/types/src/stack.ts`
6. Add detection logic in `packages/llm/src/stack-detector.ts`:
   - **JS/TS frameworks**: add a branch in `frameworkFromDeps()` (checks `package.json` deps)
   - **Python/Java/other**: add a branch in the Step 2 block inside `detectStack()` (checks `requirements.txt`, `pom.xml`, `pubspec.yaml`, etc.)
   - Register in `FRAMEWORK_PROFILES` with `adapterId`, `parsingLevel`, and `llmRecommended`
7. Add fixture in `fixtures/mini-<framework>-app/`
8. Add integration test case in `packages/cli/src/stack-routing.integration.test.ts`

All nodes must include `provenance` + `confidence`. Use `astToProvenance()` from `@codebase-viz/types` for tree-sitter adapters.

---

## Key constraints

- **Node-only runtime**: no Python, Java, or shell subprocesses. Python/Java AST = tree-sitter WASM (`packages/core/wasm/`)
- **IRGraph shape is fixed**: adapters return `AdapterResult` — do not modify `RouteNode` / `ComponentNode` / `IREdge` types
- **LLM enrichment block is immutable**: `packages/extension/src/analyzer.ts:60–90` — adapter additions must not touch this block
- **Evidence-first**: every node/edge requires `provenance` + `confidence`. `inferred` requires `inferenceChain`
- **vsix size target**: ≤ 7 MB (current: ~3.8 MB)

---

## Release

Marketplace: `cubha.codebase-arch-viz` · Publisher: `cubha`

```bash
git push origin master
cd packages/extension
npx vsce publish --no-dependencies -p <PAT>
```

| Version | Contents |
|---|---|
| v0.1.0 | Initial release — Next.js + Supabase static analysis + LLM mode |
| v0.2.x | Sidebar panel, bottom panel, persistent cache, export dropdown |
| v0.4.0 | Multi-stack adapters (Nuxt, SvelteKit, NestJS, Django, FastAPI, Spring Boot) + WASM runtime |
| v0.6.0 | 5 new frameworks (Flask, Next.js Pages, Vue SPA, Remix, Angular) + DB Multi-ORM (Prisma/Drizzle/TypeORM/Django ORM/SQLAlchemy/JPA) + SFC/backend component graphs |
| v0.7.0 | HTTP method labels (NestJS/FastAPI/Spring Boot) · SvelteKit runtime detection · ORM column quality · DB–Screen mapper connections |
| v0.8.0 | React Router adapter (13th) · Tab3 DB connected for all 13 adapters · TypeORM/Django FK references · Django CBV method detection · Flask SQLAlchemy ORM parser |
| v0.8.1 | Spring Boot MyBatis support (mapper XML `<resultMap>` + `@Mapper`) · Mermaid large diagram fix · DB–Screen empty state cleanup |
| v0.8.2 | Supabase shared parser for all SPA adapters · Tab3 mapper edges for Nuxt/Vue SPA/Angular/React Router · regex false-positive fix |
| v0.9.0 | DB FK accuracy (Spring Boot `@OneToOne`, Django M2M, TypeORM nullable) · Flask/Spring HTTP method detection · tsconfig alias resolution · Angular component dedup · MyBatis inheritance |
| v1.0.0 | Next.js `.js`/`.jsx` routes · Remix splat catch-all · Vue SPA `renders` edges · Angular `loadComponent` renders · Flask FK arrows · Spring Boot column name/FK table mapping · Django `re_path` · NestJS template literals |
| v1.1.0 | **URL-based hierarchical grouping** (Tab1/Tab2) · **Flyway DDL parser** (Spring Boot + Django) · **Tab3 schema/module grouping** · **1M chunk fallback** (auto-split large diagrams) · **Multi-workspace folder selection** · **FE↔BE cross-project analysis** (fetch/axios → BE route matching, combined diagram, 2-step QuickPick) |
| v1.1.1 | **react-router JSX `<Routes>` parser** (BrowserRouter + Routes + Route 4 patterns) · **vite+react adapterId fix** · **stack-detector priority fix** · **LCP 분기점 행 그리드** (Tab1·Tab2·Tab3, GROUPS_PER_ROW=5) · **전체 컬럼 ERD** (8개 절단 제거) · **멀티행 스택 뷰어** |
| v1.1.2 | **Tab1 X폭발 수정** (flat 렌더링, 7,407→1,380px) · **Tab2 X폭발 수정** (nested comp subgraph + TAB2_GROUPS_PER_ROW=2, 32,035→1,381px) · **Tab3 chunk 폭발** (tableCount 기준 교체) · **Tab3 source 그룹화** (Pages/Actions subgraph) · **ERD th/td 색상 분리** (TH 어두운/TD 흰색·연회색) · **Tab3 전체 뷰 기본값** (ALL 토글 맨앞·기본 활성) |
| v1.1.3 | **Tab1/Tab2 줌·드래그 수정** (단일 drag 객체 + document 이벤트, 탭 전환 간섭 제거) · **fitToView 수식 수정** (SVG 자연 크기 기준) · **⌂ 리셋 → fitToView** · **Tab3 DB ERD 토글** (전체·FK관계·페이지쿼리·서버액션 4-toggle) |
| v1.1.4 | **스택 감지 개선** — Turbo/Lerna 모노레포(`apps/packages/services/` 하위 스캔) · 루트 `package.json` 없는 멀티서비스 프로젝트(`backend/frontend/` 등 직접 스캔) · 전체 최상위 디렉터리 fallback · Flutter(`pubspec.yaml`) 감지 추가 · 사이드바 스택 표시 전 프레임워크 표시명 전수 보완 |
| v1.1.5 | **i18n 4개 언어** (한국어·영어·일본어·중국어 간체) · 언어 전환 즉시 적용 · **데모 GIF** 2종 (Tab 전환·DB 토글) · 뷰어 텍스트 선택 방지 + Row-mode 휠 줌/드래그 |
| v1.1.51 | **chunked path nested grouping 수정** — 937+ routes 환경에서 `buildRouteRowDiagram` · `renderScreenSection` NestedGroup tree 보존 · 청크 경계 1 top-level branch = 1 chunk |
| v1.1.52 | **Tab1/Tab2 chunk 과다 수정** (698→9 chunks, `collectGroupRoutes` 30 routes/chunk 기준) · **Tab3 extractModule 수정** (`bin/main/sql/primary/**` → 의미 디렉토리 추출) · **row-mode floating island 수정** (`left:50%→0`) · **React Router sub-router 2-pass 파싱** (9→130 routes, `element={<SubRouter/>}` 재귀 추적) |
| v1.1.53 | **작은 프로젝트 Y축 단조 나열 수정** (adapter-wide) — `SINGLE_DIAGRAM_ROUTE_THRESHOLD = 100` 게이트 추가. 28 routes / 7 top-level folder 같은 작은 프로젝트가 `GROUPS_PER_ROW=5` / `TAB2_GROUPS_PER_ROW=2` 초과만으로 chunked → viewer row-mode Y축 stack되던 결함. 모든 어댑터(angular/fastapi/flask/next/nextpages/nuxt/react-router/remix/sveltekit/vue-spa)의 mini fixture까지 Tab2 chunked였던 adapter-wide 결함 해소. 200-route stress test 회귀 보호 유지. |
| v1.2.0 | **Multi-provider LLM** — Anthropic · Google Gemini · OpenAI BYOK 지원. Vercel AI SDK로 교체, Zod 스키마 검증 + 1회 retry. **Gemini 무료 키** 지원 (1,500 RPD · 무료): 사이드바 AI Provider 드롭다운에서 Google 선택 후 aistudio.google.com 발급 키 입력. 기존 Anthropic 키 자동 무중단 마이그레이션 (first-run 1회). i18n 4로케일 provider 키 추가. |
| v1.2.1 | **Phase 2.5 버그픽스 3종** — Anthropic/OpenAI 키 발급 링크 사이드바 추가 (provider별 동적 href) · React Router 동적 `.map()` 패턴 path prefix 인식 (`extractMapPathPrefix` 헬퍼, BinaryExpression+TemplateLiteral 지원) · 대규모 BE 프로젝트 Row-mode 초기 scale 1.0 고정 (fit-to-box 폐기). |
| v1.2.2 | **BE 어댑터 표준화 (BE-A~E)** — `IAdapter.category` 도입(FE/BE/Fullstack) + url-grouper `distinctPaths` 변경(동일 path 다중 method 평면 유지) · Spring Boot **DI 의존성 파서** (`@Autowired`·생성자·setter 3종) → Controller→Service→Repository `calls` 엣지 생성 · Tab1 BE 전용 렌더러 (File-First grouping) + Tab2 BE 전용 렌더러 (3-tier DI subgraph) + Tab3 BE Repository 노드 cross-ref. |
| v1.2.3 | **v1.2.2 후속 결함 3건 + Tab1 nested grouping** — Tab2 chunking 가드 (`buildWithChunkFallback` BE 분기) · JPA `interface Repository` Spring 컴포넌트 인식 보완 · Gemini "Not Found" 진단 강화 · Tab1 BE 패키지 nested subgraph 추가 (`buildPkgTree` + `extractPackageSegments`). |
| v1.2.31 | **LLM 빈 model fallback hotfix** — `codesight.model` 기본값 `""` → undefined 변환 + client trimmed 가드. Gemini Not Found 근본 원인 해결. |
| v1.2.40 | **BE Tab1/Tab2 트리 다이어그램 표준화** — `docs/design/BE-DIAGRAM-STANDARD.md` 단일진실 수립. `graph TD` 트리(패키지=node, 부모-자식=edge, `:::pkg` 클래스) + 헤더 annotation `📁 src/main/java/<lcp>` (R-T1.2) + leaf `📄 Controller [/api/prefix]` + endpoints subgraph (R-T1.6) · **Tab2 leaf**에 `Controller→Service→Repository` 수직 DI subgraph (R-T2.2) + DI edge 없는 Controller는 leaf만 표시 (R-T2.5 Less is More) + cross-package DI dashed edge (R-T2.4) · **top-level 패키지 단위 chunking** (R-T1.8) — wide-pkg 프로젝트 X축 폭발 방지 · **ELK mrtree per-diagram opt-in** (R-T1.9, vsix +0.49MB) — chunk 내부 leaf 자식 가로 폭발 추가 완화 · `mini-spring-wide-pkg-app`/`mini-spring-deep-pkg-app` fixture 회귀 보호. FE 회귀 0. |
| v1.2.41 | **v1.2.40 BE Tab1/Tab2 결함 3건 hotfix** — ELK mrtree cluster 어긋남(BE에서 pragma 제거, dagre로 정렬) · Tab1 endpoints 가로배치(line chain `---`로 수직 강제) · Tab2 DI 체인 Y간격 과대(`BE_RENDERING_INIT` rankSpacing 8) · Spring DI Interface→Impl fallback + `@Mapper` 인식 + `adapterCategory` 메타 전달 부수 보강. FE 영향 0. |
| v1.2.42 | **React (react-router) Tab1/2/3 전면 재설계 + file-based FE 어댑터 6종 표준화** — Tab1: React Router SPA 프레임워크 헤더 + 외부 REST API Gateway 분기(`apiCallEdges>0` && DB 미설정 시, library별 라벨). 우선순위: LLM backends > Supabase > Prisma > Firebase > Dexie > hasExternalAPI > apiCallEdges. Tab2: file-based 어댑터 6종(Next App/Pages·Nuxt·SvelteKit·Remix·ReactRouter) `📂 디렉터리 / 📄 파일명` 노드 패턴 — 그룹 `(marketing)`·동적 `[slug]` 디렉터리 시각 노출. `buildReactRouterScreenDiagram` → `buildFeFileTreeScreenDiagram` + `isFileTreeTab2Eligible(meta)` 헬퍼. Tab3: 3-way 분기(BE→현행 ER+Repository, react-router && tables===0→FE API 호출, FE+tables>0→현행 ER). 신규 `IREdge.kind='api-call'` + `ApiCallInfo` + `makeNodeId('endpoint',...)` 가상 kind + `_shared/fe-call-extractor` 재사용. LLM enabled 정적 파서 무손상 회귀 테스트 2건. config-based(`vue-spa`·`angular`)·Expo·Vite는 v1.2.43에서 별도 진행. |
| v1.2.43 | **config-based FE 어댑터(Vue SPA · Angular) Tab1 wrapper 표준 적용** — v1.2.42 file-based 6종 표준을 화면 프레임워크 2종에 균등 적용. Vue SPA `BROWSER → 🧭 Vue Router · SPA → 💚 Vue · CSR Engine` + Angular `BROWSER → 🧭 Angular Router · SPA → 🅰 Angular · CSR Engine` 3단 wrapper 신규(`InfraInfo.hasVueSpa`/`hasAngular`, `frontendRef='VUE'`/`'ANGULAR'`). 외부 REST API Gateway 분기는 `frontendRef` 정의로 자동 발동. Tab2 파일경로 노드는 config-based `route.filePath`가 라우터 정의 파일 단일값이라 가치 부족 → v1.2.44+ 어댑터 보강 patch로 분리. **부수 정리**: `stack-detector` Expo `adapterId='expo'` 죽은 참조 제거(registry 미등록) + `mermaid-renderer` over-defensive `fw.includes('vite'/'expo')` 분기 제거(`FrameworkKind` union 닫힘으로 unreachable) + `hasVite`/`hasExpo` wrapper 의도 주석 보강(빌드/플랫폼 메타 표현, 별도 화면 프레임워크 아님). 폐기 결정(부활 금지): Expo·Vite 별도 화면 프레임워크 어댑터 신설. |

---

## License

MIT — [github.com/cubha/codesight](https://github.com/cubha/codesight)
