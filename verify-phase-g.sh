#!/usr/bin/env bash
# Phase G regression check — Flask, NextPages, Vue SPA, Remix, Angular
set -e

SBX=$(mktemp -d -t cv-sbx-phase-g-XXXX)
trap "rm -rf $SBX" EXIT

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Phase G CLI regression check ==="

for app in mini-flask-app mini-nextpages-app mini-vue-spa-app mini-remix-app mini-angular-app; do
  cp -r "fixtures/$app" "$SBX/"
  rm -rf "$SBX/$app/.codebase-viz"
  node packages/cli/dist/index.js analyze "$SBX/$app" --no-llm > /dev/null 2>&1
done

FAIL=0
check() {
  local label="$1" pattern="$2" file="$3"
  if grep -q "$pattern" "$file"; then
    echo "  PASS: $label"
  else
    echo "  FAIL: $label — pattern '$pattern' not found"
    FAIL=1
  fi
}

echo ""
echo "--- G-1: Flask ---"
check "Flask / route"       "route_app_py"           "$SBX/mini-flask-app/.codebase-viz/rendering.md"
check "Flask /health route" "health"                 "$SBX/mini-flask-app/.codebase-viz/rendering.md"
check "Flask routeFileKind=page (not empty)" "· SSR" "$SBX/mini-flask-app/.codebase-viz/rendering.md"

echo ""
echo "--- G-2: Next.js Pages Router ---"
check "Next Pages /about"   "about"                  "$SBX/mini-nextpages-app/.codebase-viz/rendering.md"
check "Next Pages / route"  "index_tsx_page"         "$SBX/mini-nextpages-app/.codebase-viz/rendering.md"
check "Next Pages dynamic"  "id"                     "$SBX/mini-nextpages-app/.codebase-viz/rendering.md"

echo ""
echo "--- G-3: Vue SPA ---"
check "Vue /about"          "about"                  "$SBX/mini-vue-spa-app/.codebase-viz/rendering.md"
check "Vue /users"          "users"                  "$SBX/mini-vue-spa-app/.codebase-viz/rendering.md"
check "Vue CSR mode"        "· CSR"                  "$SBX/mini-vue-spa-app/.codebase-viz/rendering.md"

echo ""
echo "--- G-4: Remix ---"
check "Remix / route"       "_index_tsx_page"        "$SBX/mini-remix-app/.codebase-viz/rendering.md"
check "Remix /about"        "about"                  "$SBX/mini-remix-app/.codebase-viz/rendering.md"
check "Remix dynamic"       "id"                     "$SBX/mini-remix-app/.codebase-viz/rendering.md"

echo ""
echo "--- G-5: Angular ---"
check "Angular /about"      "about"                  "$SBX/mini-angular-app/.codebase-viz/rendering.md"
check "Angular /users"      "users"                  "$SBX/mini-angular-app/.codebase-viz/rendering.md"
check "Angular CSR mode"    "· CSR"                  "$SBX/mini-angular-app/.codebase-viz/rendering.md"

echo ""
if [ $FAIL -eq 0 ]; then
  echo "=== ALL CHECKS PASSED ==="
else
  echo "=== $FAIL CHECK(S) FAILED ==="
  exit 1
fi
