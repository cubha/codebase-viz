#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "=== [1/2] TypeScript build ==="
pnpm run typecheck
echo "✅ tsc --build PASS"

echo ""
echo "=== [2/2] Vitest ==="
pnpm run test
echo "✅ vitest PASS"

echo ""
echo "✅ verify.sh ALL PASS"
