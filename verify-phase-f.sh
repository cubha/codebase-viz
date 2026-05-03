#!/usr/bin/env bash
# Phase F regression check — DB Multi-ORM, SFC component, backend component/ORM
set -e

SBX=$(mktemp -d -t cv-sbx-phase-f-XXXX)
trap "rm -rf $SBX" EXIT

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Phase F CLI regression check ==="

for app in mini-next-app mini-nuxt-app mini-sveltekit-app mini-nest-app mini-django-app mini-fastapi-app mini-spring-app; do
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
    echo "  FAIL: $label — pattern '$pattern' not found in $(basename $file)"
    FAIL=1
  fi
}

echo ""
echo "--- F-1: DB Multi-ORM ---"
# Prisma: User and Post tables from schema.prisma
check "F-1 Prisma User table"  "User"       "$SBX/mini-next-app/.codebase-viz/db-screen.md"
check "F-1 Prisma Post table"  "Post"       "$SBX/mini-next-app/.codebase-viz/db-screen.md"

# TypeORM: users table from user.entity.ts in mini-nest-app
check "F-1 TypeORM users table" "users"     "$SBX/mini-nest-app/.codebase-viz/db-screen.md"

echo ""
echo "--- F-2: SFC component (via screen-component.md routes) ---"
# Nuxt: has routes in rendering.md (component parser doesn't break routing)
check "F-2 Nuxt routes intact"   "/about"   "$SBX/mini-nuxt-app/.codebase-viz/rendering.md"
check "F-2 Svelte routes intact" "/ · SSR"  "$SBX/mini-sveltekit-app/.codebase-viz/rendering.md"

echo ""
echo "--- F-3: Backend component (views/services) ---"
# Django: UserListView in rendering.md or screen-component.md
check "F-3 Django routes intact" "/api/users" "$SBX/mini-django-app/.codebase-viz/rendering.md"
check "F-3 FastAPI routes intact" "/api/users" "$SBX/mini-fastapi-app/.codebase-viz/rendering.md"
check "F-3 Spring routes intact"  "api/users"  "$SBX/mini-spring-app/.codebase-viz/rendering.md"

echo ""
echo "--- F-4: Backend ORM ---"
check "F-4 Django User model"     "User"     "$SBX/mini-django-app/.codebase-viz/db-screen.md"
check "F-4 Django Post model"     "Post"     "$SBX/mini-django-app/.codebase-viz/db-screen.md"
check "F-4 FastAPI User model"    "User"     "$SBX/mini-fastapi-app/.codebase-viz/db-screen.md"
check "F-4 FastAPI Post model"    "Post"     "$SBX/mini-fastapi-app/.codebase-viz/db-screen.md"
check "F-4 Spring users entity"   "users"    "$SBX/mini-spring-app/.codebase-viz/db-screen.md"

echo ""
if [ $FAIL -eq 0 ]; then
  echo "=== ALL CHECKS PASSED ==="
else
  echo "=== $FAIL CHECK(S) FAILED ==="
  exit 1
fi
