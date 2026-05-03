#!/usr/bin/env bash
# Phase E regression check — run after tsc --build
set -e

SBX=$(mktemp -d -t cv-sbx-phase-e-XXXX)
trap "rm -rf $SBX" EXIT

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Phase E CLI regression check ==="

for app in mini-spring-app mini-django-app mini-fastapi-app mini-nuxt-app mini-next-app; do
  cp -r "fixtures/$app" "$SBX/"
  rm -rf "$SBX/$app/.codebase-viz"
  node packages/cli/dist/index.js analyze "$SBX/$app" --no-llm > /dev/null 2>&1
done

FAIL=0
check() { local label="$1" pattern="$2" file="$3"
  grep -q "$pattern" "$file" || { echo "FAIL $label"; FAIL=1; }
}

# E-4: Spring @GetMapping({"a","b"}) → two RouteNodes
check "E-4 Spring featured" "api/posts/featured" "$SBX/mini-spring-app/.codebase-viz/rendering.md"
check "E-4 Spring pinned"   "api/posts/pinned"   "$SBX/mini-spring-app/.codebase-viz/rendering.md"

# E-2: Django include() prefix
check "E-2 Django /api/users" "api/users" "$SBX/mini-django-app/.codebase-viz/rendering.md"

# E-3: FastAPI include_router prefix + direct route
check "E-3 FastAPI /api/users" "api/users" "$SBX/mini-fastapi-app/.codebase-viz/rendering.md"
check "E-3 FastAPI /health"    "health"    "$SBX/mini-fastapi-app/.codebase-viz/rendering.md"

# E-1: Nuxt CSR
check "E-1 Nuxt CSR" "CSR" "$SBX/mini-nuxt-app/.codebase-viz/rendering.md"

# E-5: Next.js @/ alias → componentEdges >= 1
EDGE_COUNT=$(cd "$SCRIPT_DIR/packages/cli" && SBX_NEXT="$SBX/mini-next-app" node --input-type=module << 'EOF'
const { createDefaultRegistry } = await import('@codebase-viz/core')
const { detectStack } = await import('@codebase-viz/llm')
const repoRoot = process.env.SBX_NEXT
const stack = await detectStack(repoRoot)
const adapter = createDefaultRegistry().get(stack.adapterId)
const result = await adapter.analyze({ repoRoot, stack, analyzerVersion: 'test' })
process.stdout.write(String(result.componentEdges.length))
EOF
)
[ "$EDGE_COUNT" -ge 1 ] || { echo "FAIL E-5 Next.js @/ alias: componentEdges=$EDGE_COUNT"; FAIL=1; }

if [ "$FAIL" -eq 0 ]; then
  echo "✅ verify-phase-e.sh ALL PASS"
else
  echo "❌ verify-phase-e.sh FAILED"
  exit 1
fi
