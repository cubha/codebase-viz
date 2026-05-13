# codebase-viz

**VS Code extension that visualizes codebase architecture as interactive Mermaid diagrams.**

Routes, components, and DB relationships — extracted statically from **13 frameworks**, optionally enriched by LLM, rendered as three live diagram tabs inside VS Code.

> Marketplace: [`cubha.codebase-arch-viz`](https://marketplace.visualstudio.com/items?itemName=cubha.codebase-arch-viz) · Current release: **v1.1.52**

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

Unmatched FE calls appear as **dangling edges** (inferred, `no-route-match`). Diagrams exceeding 1 M characters fall back to a Cytoscape-ready placeholder.

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
| Spring Boot | **L2** | `pom.xml` / `build.gradle` | Controllers (GET/POST labels) · `@Service`/`@Repository` · JPA `@Entity` (@JoinColumn/nullable) · MyBatis mapper XML + `@Mapper` interfaces |

**L1** = routes only · **L2** = routes + components + DB (ORM-conditional) · **L3** = all 3 tabs always

Frameworks not in this list (Express, Hono, Rails, Go, etc.) fall back to **L3 — LLM primary** mode when an Anthropic API key is provided.

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

---

## License

MIT — [github.com/cubha/codesight](https://github.com/cubha/codesight)
