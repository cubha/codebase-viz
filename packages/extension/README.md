# Codebase Architecture Visualizer

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/cubha.codebase-arch-viz?label=VS%20Marketplace&color=blue)](https://marketplace.visualstudio.com/items?itemName=cubha.codebase-arch-viz)
[![Open VSX](https://img.shields.io/open-vsx/v/cubha/codebase-arch-viz?label=Open%20VSX&color=a60ee5)](https://open-vsx.org/extension/cubha/codebase-arch-viz)
[![Downloads](https://img.shields.io/visual-studio-marketplace/d/cubha.codebase-arch-viz)](https://marketplace.visualstudio.com/items?itemName=cubha.codebase-arch-viz)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](https://github.com/cubha/codebase-viz/blob/master/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/cubha/codebase-viz?style=social)](https://github.com/cubha/codebase-viz)

**Instant architecture diagrams for 13 frameworks — no API key needed.**  
Available on **VS Code**, **Cursor**, **VSCodium**, and any editor using the Open VSX registry.

Codebase Viz analyzes your project statically and renders three interactive diagrams inside your editor: route hierarchy with HTTP methods, component trees, and DB schema with FK relations.

---

## 🖼️ How It Looks

### Routes & Components — at a glance
Switch tabs once and see every route, every component, with SSR/CSR/ISR/SSG labels colour-coded.
Mouse wheel to zoom, click and drag to pan — explore freely.

![Routes & Components](https://github.com/cubha/codebase-viz/raw/master/packages/extension/media/demo-tab-switch.gif)

### DB–Screen — four views, one click
Toggle between **All / FK Relations / Page Queries / Server Actions** to isolate what you need.
The right sidebar shows every column, FK, and which routes/actions query the table.

![DB Multi-View](https://github.com/cubha/codebase-viz/raw/master/packages/extension/media/demo-db-toggle.gif)

### Sidebar Panel
Control everything from the sidebar — analyze, re-analyze, open the viewer, export diagrams, and manage your API key.

![Sidebar Panel](https://github.com/cubha/codebase-viz/raw/master/packages/extension/media/screenshot-sidebar.png)

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

## ✨ What's new in v1.2.63

### The Data Flow tab, actually working for React Router

- **Fixed: Data Flow tab showed "(No data)" for every React Router project.** It never rendered correctly in the extension since it was introduced — the viewer always parsed it as a database diagram, and an API-call diagram isn't one. Now it renders properly, including on MD/SVG export.
- **Endpoint boxes are now clickable.** Clicking an API call (`GET /api/...`) jumps to the actual fetch/axios call site. When multiple components call the same endpoint, the click target and the on-screen label now always point to the same, most-certain call.
- **Search now works on the Data Flow tab** for React Router projects.
- Fixed a performance issue where deeply-nested Java package structures (common in large Spring Boot codebases) could make analysis noticeably slower than it should be.

### v1.2.62 — Click-to-source and search, actually working

- Node clicks now jump to the source for every clickable node (was broken since v1.2.61), search no longer lights up unrelated nodes, and matched nodes get a visible highlight.

### v1.2.61 — Click, hover, search introduced

- Clickable nodes, hover tooltips showing file:line + confidence badge (verified/manual/inferred), and a search bar on the diagram tabs.

### v1.2.60 — FE↔BE combined view wired up + MyBatis ERD fix

- **Paired (FE↔BE) analysis now renders the real combined diagram**, showing only the routes that actually participate in a match, with the DB–Screen tab merging tables from both projects.
- **MyBatis-based repositories now show their table relationships in the ERD** — previously appeared as disconnected entities.
- No more silent fallbacks: unrecognized backend or no matches now shows a clear inline notice.

> Known issue: on React Router projects, the endpoint boxes on the DB–Screen tab aren't clickable yet (route boxes are).

> Full version history lives in the [CHANGELOG](CHANGELOG.md).

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
- Results **cached** in `.codebase-viz/cache.json`
- Offline-friendly — Mermaid bundled locally, no CDN
- Pure Node.js — Python/Java AST via bundled WebAssembly, no native installs

---

## 🚀 Getting Started

### Install

- **VS Code** — search **"Codebase Architecture Visualizer"** in Extensions, or install from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=cubha.codebase-arch-viz)
- **Cursor / VSCodium / code-server** — search in Extensions panel (served via [Open VSX](https://open-vsx.org/extension/cubha/codebase-arch-viz))

### Run

1. Open your project folder (`File → Open Folder`)
2. Click the **Codebase Viz icon** in the Activity Bar → **▶ Analyze Project**
3. Explore the three diagram tabs

Or use the Command Palette (`Ctrl+Shift+P`):
```
Codebase Viz: Analyze Project
```

---

## 🤖 LLM Analysis (BYOK)

Codebase Viz uses **Anthropic Claude** for deeper enrichment on top of static analysis. Your key is stored in VS Code's SecretStorage and never sent anywhere other than Anthropic's API.

**Setup**

1. Get an API key at [console.anthropic.com](https://console.anthropic.com)
2. Click **🔑 Set API Key** in the sidebar
3. Toggle **Enable LLM Analysis**

**Model selection** (`codebaseViz.model`)

| Value | Description |
|---|---|
| `claude-sonnet-4-6` | Default — best balance |
| `claude-haiku-4-5-20251001` | Faster, lower cost |
| `claude-opus-4-7` | Highest quality for large codebases |

---

## ⚙️ Settings

| Setting | Default | Description |
|---|---|---|
| `codebaseViz.enableLLM` | `false` | Enable Claude-powered analysis |
| `codebaseViz.model` | `claude-sonnet-4-6` | Claude model to use |

---

## 🔧 Commands

| Command | Description |
|---|---|
| `Codebase Viz: Analyze Project` | Run analysis and open the viewer |
| `Codebase Viz: Set Anthropic API Key` | Store your API key securely |
| `Codebase Viz: Clear Anthropic API Key` | Remove the stored key |

---

## 📋 Requirements

- VS Code 1.90+ (or Cursor / VSCodium based on the same version)
- No additional runtimes — Python and Java AST via bundled WebAssembly

---

## 🔒 Privacy

- Your code is **never sent anywhere** in static-only mode
- In LLM mode, relevant source files are sent to the **Anthropic API using your own key**
- Anthropic's data handling: [anthropic.com/privacy](https://www.anthropic.com/privacy)
- Results cached locally in `.codebase-viz/cache.json`

---

## 📦 Source

[github.com/cubha/codebase-viz](https://github.com/cubha/codebase-viz) — MIT License
