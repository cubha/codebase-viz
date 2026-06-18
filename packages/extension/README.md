# Codebase Architecture Visualizer

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/cubha.codebase-arch-viz?label=VS%20Marketplace&color=blue)](https://marketplace.visualstudio.com/items?itemName=cubha.codebase-arch-viz)
[![Open VSX](https://img.shields.io/open-vsx/v/cubha/codebase-arch-viz?label=Open%20VSX&color=a60ee5)](https://open-vsx.org/extension/cubha/codebase-arch-viz)
[![Downloads](https://img.shields.io/visual-studio-marketplace/d/cubha.codebase-arch-viz)](https://marketplace.visualstudio.com/items?itemName=cubha.codebase-arch-viz)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](https://github.com/cubha/codesight/blob/master/LICENSE)

**Instant architecture diagrams for 13 frameworks — no API key needed.**  
Available on **VS Code**, **Cursor**, **VSCodium**, and any editor using the Open VSX registry.

CodeSight analyzes your project statically and renders three interactive diagrams inside your editor: route hierarchy with HTTP methods, component trees, and DB schema with FK relations.

---

## 🖼️ How It Looks

### Routes & Components — at a glance
Switch tabs once and see every route, every component, with SSR/CSR/ISR/SSG labels colour-coded.
Mouse wheel to zoom, click and drag to pan — explore freely.

![Routes & Components](https://github.com/cubha/codesight/raw/master/packages/extension/media/demo-tab-switch.gif)

### DB–Screen — four views, one click
Toggle between **All / FK Relations / Page Queries / Server Actions** to isolate what you need.
The right sidebar shows every column, FK, and which routes/actions query the table.

![DB Multi-View](https://github.com/cubha/codesight/raw/master/packages/extension/media/demo-db-toggle.gif)

### Sidebar Panel
Control everything from the sidebar — analyze, re-analyze, open the viewer, export diagrams, and manage your API key.

![Sidebar Panel](https://github.com/cubha/codesight/raw/master/packages/extension/media/screenshot-sidebar.png)

---

## 🌐 Supported Frameworks

| Framework | Level | Routes | Components | DB |
|---|---|---|---|---|
| **Next.js App Router** | **L3** | ✅ SSR/SSG/ISR/CSR · `.js`/`.jsx`/`.tsx` | ✅ import graph | ✅ Supabase · Prisma · Drizzle · TypeORM |
| **NestJS** | **L2** | ✅ `GET/POST` labels · template literals | ✅ Controllers · Services · Modules | ✅ TypeORM entities + FK relations |
| **Django** | **L2** | ✅ CBV/FBV · `re_path` regex | ✅ View / ViewSet classes | ✅ `models.Model` + nullable/FK/db_table |
| **FastAPI** | **L2** | ✅ `GET/POST` labels · relative imports | ✅ Pydantic schemas | ✅ SQLAlchemy + nullable/type/__tablename__ |
| **Spring Boot** | **L2** | ✅ `GET/POST` labels | ✅ `@Service` / `@Repository` | ✅ JPA `@Entity` + FK · MyBatis mapper XML |
| **Flask** | **L2** | ✅ Blueprint routes · HTTP methods | ✅ View classes | ✅ SQLAlchemy (Base / db.Model) + FK relations |
| **SvelteKit** | **L2** | ✅ `+page`/`+layout`/`+server` | ✅ `.svelte` + runtime tags | ✅ Supabase · Prisma · Drizzle · TypeORM |
| **Nuxt** | **L2** | ✅ `pages/` | ✅ `.vue` SFC import graph | ✅ Supabase · Prisma · Drizzle · TypeORM |
| **Next.js Pages Router** | **L2** | ✅ SSG/ISR/SSR detection | ✅ component graph | ✅ Supabase · Prisma · Drizzle · TypeORM |
| **Remix** | **L2** | ✅ nested folder routes · splat (`*`) | ✅ component graph | ✅ Supabase · Prisma · Drizzle · TypeORM |
| **React Router** | **L2** | ✅ `createBrowserRouter()` | ✅ import chain | ✅ Supabase · Prisma · Drizzle · TypeORM |
| **Vue SPA** | **L2** | ✅ `createRouter()` | ✅ template `renders` graph | ✅ Supabase · Prisma · Drizzle · TypeORM |
| **Angular** | **L2** | ✅ `provideRouter()` · lazy `loadComponent` | ✅ template renders + lazy edges | ✅ Supabase · Prisma · Drizzle · TypeORM |

**L3** = all 3 tabs always · **L2** = routes + components + DB (DB shown when ORM detected) · **L1** = routes only

Frameworks not in this list (Express, Hono, Rails, Go, etc.) use **LLM primary** mode when an Anthropic API key is provided.

---

## ✨ What's new in v1.2.53

### Fixed — Tab1 architecture layers restored on large projects + standardized Tab2 spacing

- **Tab1 always shows the full architecture now.** Apps with more than 5 top-level domains used to fall into a chunked path that dropped the infrastructure stack (`Browser → Router → React`) and the backend/data layer — leaving Tab1 as a bare URL tree. Tab1 is now a **domain summary** (one box per domain with a route count, e.g. `📁 partner · 24 routes`); the detailed route/screen tree stays in Tab2. The summary is small, so Tab1 no longer chunks and always keeps its framework + backend layers.
- **No more over-nested sub-domains in Tab1** (e.g. `matMgmt` inside `partner` as its own layer) — that detail belongs to Tab2.
- **Tab2 vertical connectors are tighter and uniform** — domain/file trees no longer stretch the lines between layers unevenly.

### Previous highlights

**v1.2.52** — Large-project viewer loads ~4× sooner (progressive chunk streaming) and scrolls smoother (`content-visibility`); viewer-only

**v1.2.51** — React Router bulk route omission (tsconfig path alias resolution) · Spring Boot large-domain "maximum size" sub-chunking · Tab1 many-domain readability grid

**v1.2.50** — Spring DI chain 5-level fan-out (Lombok `@RequiredArgsConstructor` · MyBatis XML mapper) · React Router template-literal paths · `src/pages` domain layering

**v1.2.49** — React Router parser fixes (pathless · dedup · array spread) · large-webview freeze fix (node-bound chunking + frame yield)

**v1.2.47** — React Router alias/barrel/lazy import route tracing · full `src` code-quality pass

**v1.2.45** — FE diagram standard v1.1 (top-level X-axis · nested Y-stack) · brand/folder unification

**v1.2.44** — React Router `.map()` pattern regression fix · Vue/Angular Tab2 standard · Data Flow promotion

**v1.2.42** — React Tab1/2/3 redesign · file-based FE adapters (6) Tab2 file-path nodes

**v1.2.40** — Backend Tab1/Tab2 package tree standard (Spring · NestJS · Django · FastAPI · Flask)

---

## ✨ Features

| Tab | What you see |
|---|---|
| **Rendering Architecture** | Route hierarchy · HTTP method badges · SSR/CSR/ISR/SSG labels |
| **Screen–Component** | Route → component renders/import graph · runtime tags (client/shared/server) |
| **DB–Screen** | Tables · columns with types/nullable/FK arrows · mapper connections to routes |

**Sidebar panel**
- Detected framework, parsing level (L2/L3), route/table count, last cached time
- **Analyze** → **Re-analyze** button
- **Open Viewer** — opens the diagram panel

**Two analysis modes**

| Mode | What you get | API key |
|---|---|---|
| **Static analysis** | Full L3 for Next.js App Router. L2 for all 12 other adapters. | Not required |
| **LLM-enhanced** (BYOK) | Fills gaps the static parser can't reach | Required |

**Quality-of-life**
- Results **cached** in `.codesight/cache.json`
- Offline-friendly — Mermaid bundled locally, no CDN
- Pure Node.js — Python/Java AST via bundled WebAssembly, no native installs

---

## 🚀 Getting Started

### Install

- **VS Code** — search **"Codebase Architecture Visualizer"** in Extensions, or install from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=cubha.codebase-arch-viz)
- **Cursor / VSCodium / code-server** — search in Extensions panel (served via [Open VSX](https://open-vsx.org/extension/cubha/codebase-arch-viz))

### Run

1. Open your project folder (`File → Open Folder`)
2. Click the **CodeSight icon** in the Activity Bar → **▶ Analyze Project**
3. Explore the three diagram tabs

Or use the Command Palette (`Ctrl+Shift+P`):
```
CodeSight: Analyze Project
```

---

## 🤖 LLM Analysis (BYOK)

CodeSight uses **Anthropic Claude** for deeper enrichment on top of static analysis. Your key is stored in VS Code's SecretStorage and never sent anywhere other than Anthropic's API.

**Setup**

1. Get an API key at [console.anthropic.com](https://console.anthropic.com)
2. Click **🔑 Set API Key** in the sidebar
3. Toggle **Enable LLM Analysis**

**Model selection** (`codesight.model`)

| Value | Description |
|---|---|
| `claude-sonnet-4-6` | Default — best balance |
| `claude-haiku-4-5-20251001` | Faster, lower cost |
| `claude-opus-4-7` | Highest quality for large codebases |

---

## ⚙️ Settings

| Setting | Default | Description |
|---|---|---|
| `codesight.enableLLM` | `false` | Enable Claude-powered analysis |
| `codesight.model` | `claude-sonnet-4-6` | Claude model to use |

---

## 🔧 Commands

| Command | Description |
|---|---|
| `CodeSight: Analyze Project` | Run analysis and open the viewer |
| `CodeSight: Set Anthropic API Key` | Store your API key securely |
| `CodeSight: Clear Anthropic API Key` | Remove the stored key |

---

## 📋 Requirements

- VS Code 1.90+ (or Cursor / VSCodium based on the same version)
- No additional runtimes — Python and Java AST via bundled WebAssembly

---

## 🔒 Privacy

- Your code is **never sent anywhere** in static-only mode
- In LLM mode, relevant source files are sent to the **Anthropic API using your own key**
- Anthropic's data handling: [anthropic.com/privacy](https://www.anthropic.com/privacy)
- Results cached locally in `.codesight/cache.json`

---

## 📦 Source

[github.com/cubha/codesight](https://github.com/cubha/codesight) — MIT License
