# Changelog

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
