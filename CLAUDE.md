# codebase-viz — Project Rules

## Project Overview

CLI tool that analyzes Next.js 15 App Router + Supabase (ORM-less) codebases
and produces 3-axis visualizations (.md + .mmd output).

**Absolute Principles:**
1. **Less is More** — emit only high-confidence, meaningful edges. Noise is worse than silence.
2. **Evidence-First** — every node/edge MUST carry `provenance` + `confidence`. `inferred` requires `inferenceChain`.

## Tech Stack

- **Runtime**: Node.js 20+ (ESM only — `"type": "module"` in all packages)
- **Language**: TypeScript 5.5, strict mode, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`
- **Module system**: `module: NodeNext`, `moduleResolution: NodeNext` — all local imports MUST use `.js` extension
- **Monorepo**: pnpm workspace, TypeScript project references
- **Test**: Vitest (ESM mode)
- **AST analysis**: ts-morph (for S4 component parser)

## Package Structure

```
packages/
  types/     @codebase-viz/types   — IR type definitions (S2 ✅)
  core/      @codebase-viz/core    — parsers (S3/S4/S5) + mapper (S6)
  renderer/  @codebase-viz/renderer — Mermaid/Markdown output (S7)
  cli/       @codebase-viz/cli     — CLI entry point (S8)
fixtures/
  mini-next-app/                   — sandbox test fixture (S0)
```

## Core IR Types (packages/types/src/ir.ts)

All parsers MUST use these types — do NOT redefine:

```typescript
import { createRouteNode, createComponentNode, createTableNode, createEdge, createIRGraph,
         makeNodeId, makeEdgeId, type IRGraph, type Provenance } from '@codebase-viz/types'
```

Key factories:
- `createRouteNode({ id, path, filePath, routeFileKind, dynamicSegmentType, isGroupRoute, renderingMode, provenance, confidence, ...})` 
- `createComponentNode({ id, name, filePath, runtime, provenance, confidence, ... })`
- `createTableNode({ id, name, columns, provenance, confidence, ... })`
- `createEdge({ id, from, to, kind, provenance, confidence, ... })`
- `makeNodeId(kind, repoRelativePath, symbol)` → NodeId

## Coding Rules

1. All imports: use `.js` extension (e.g., `import { x } from './utils.js'`)
2. No UUID — NodeId must be deterministic via `makeNodeId()`
3. `confidence: 'inferred'` requires `inferenceChain: string[]`
4. `confidence: 'verified'` = statically provable; `'inferred'` = pattern-based heuristic
5. Parser functions export a single async function: `parse(repoRoot: string): Promise<IRGraph>`
6. No comments unless WHY is non-obvious

## Verification

```bash
bash verify.sh   # tsc --build + vitest run
```

Wave 2 DONE criteria: `fixtures/mini-next-app` 대상 각 파서 단위 테스트 PASS
