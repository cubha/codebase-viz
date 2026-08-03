# codebase-viz

**VS Code extension that visualizes codebase architecture as interactive Mermaid diagrams.**

Routes, components, and DB relationships — extracted statically from **13 frameworks**, optionally enriched by LLM, rendered as three live diagram tabs inside VS Code.

> Marketplace: [`cubha.codebase-arch-viz`](https://marketplace.visualstudio.com/items?itemName=cubha.codebase-arch-viz) · Current release: **v1.2.60**
>
> **v1.2.60 highlights** — **FE↔BE 결합 뷰 실배선 + MyBatis ERD 관계선 복구**. 페어(FE↔BE) 분석 시 결합 다이어그램이 Tab1에 실제로 배선(matched-only 필터·Tab2/3 chunk fallback·FE+BE 테이블 합집합·BE 미인식/매칭 0건 조용한 강등 금지). MyBatis Repository→table `queries` 엣지 신설로 Tab3 ERD 관계선 부재 결함 복구(신규 프록시 엔티티 0개). GitHub star 배지 추가.
>
> 이전 버전 이력은 [CHANGELOG](CHANGELOG.md) 참조.

---

## What it does

Open a project in VS Code → click **Analyze**. Codebase Viz produces:

| Tab | Content |
|---|---|
| **Rendering Architecture** | Route hierarchy with URL-based hierarchical grouping, SSR / CSR / ISR / SSG labels, HTTP method badges |
| **Screen–Component** | Route → component import graph, runtime tags (client / shared / server) |
| **DB–Screen** | Table schema (Supabase, Prisma, Drizzle, TypeORM, Django ORM, SQLAlchemy, JPA, **Flyway DDL**) + 4-toggle view: **All** · **FK relations** (ERD with TH/TD distinction) · **Page queries** (route → table flow graph) · **Server actions** (action → table flow graph) |

Results are cached in `.codebase-viz/cache.json`. Re-analyze on demand.

### Multi-project Analysis (FE↔BE)

When multiple workspace folders are open (e.g. a Next.js frontend + Spring Boot backend), Codebase Viz supports **paired analysis**:

1. Click **Analyze** → select the main (FE) project
2. A second prompt appears — select the paired BE project (or **Skip** for single-project mode)

Codebase Viz statically extracts `fetch()` / `axios.*` call URLs from the FE codebase and matches them against BE route definitions. The **Rendering Architecture tab is replaced** with a combined diagram: matched routes appear as **dashed cross-edges**, and only the FE/BE routes that actually participate in a match are shown (unmatched routes stay visible in their own project's standalone view instead of cluttering the combined one). Screen–Component stays FE-only; DB–Screen merges FE + BE tables into one ERD.

| | Without LLM | With LLM (BYOK) |
|---|---|---|
| Literal URL match rate | ~30–50% | ~70–85% |
| Template literal (same-file const) | ✅ | ✅ |
| Dynamic segments (`${id}`) | shown as `${…}` placeholder | ✅ |
| Import-resolved constants | ✗ | ✅ |

FE calls with no matching BE route (`no-route-match`) are silently excluded from the combined diagram — they don't appear as dangling boxes. If the paired folder isn't recognized as a BE project, Codebase Viz falls back to the FE-only view with an inline notice instead of showing an empty diagram. Diagrams exceeding the node/text threshold collapse into a single notice box stating the actual count that triggered it.

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

Select a provider in the Codebase Viz sidebar under **AI Provider**:

| Provider | Model | Cost |
|---|---|---|
| **Anthropic** | `claude-sonnet-4-6` | Paid (BYOK) |
| **Google Gemini** | `gemini-2.5-flash` | **Free tier available** |
| **OpenAI** | `gpt-4o` | Paid (BYOK) |

### Getting a Free Gemini API Key

1. Go to **[aistudio.google.com](https://aistudio.google.com/app/apikey)**
2. Click **Create API key** → select or create a Google Cloud project
3. Copy the key → open VS Code → Codebase Viz sidebar → select **Google (Gemini 무료)** → click **Set API Key**

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
  → .codebase-viz/cache.json

# Pair mode (FE↔BE)
detectStack(pairRepoRoot)
  → adapter.analyze(pairRepoRoot)              # BE IRGraph
  → extractFeCalls(feComponentFiles)           # fetch/axios literal extraction
  → matchFeCallsToBeRoutes(feCalls, beRoutes)  # URL matching
  → remapCrossEdgeFromIds(edges, feGraph)      # remap to real ComponentNode ids
  → buildCombinedDiagram(feGraph, beGraph, crossEdges)
  → .codebase-viz/cache-pair-<be-name>.json
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

MIT — [github.com/cubha/codebase-viz](https://github.com/cubha/codebase-viz)
