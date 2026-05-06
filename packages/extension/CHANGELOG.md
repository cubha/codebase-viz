# Changelog

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
