#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "=== [1/2] TypeScript build ==="
pnpm run typecheck
echo "✅ tsc --build PASS"

echo ""
echo "=== [2/2] 단위 테스트 ==="
UNIT_TEST_FILES=$(find . -type d -name node_modules -prune -o \
    -type f \( -name '*.test.ts' -o -name '*.test.tsx' \
               -o -name '*.test.js' -o -name '*.test.jsx' \
               -o -name '*.spec.ts' -o -name '*.spec.tsx' \) -print 2>/dev/null \
  | grep -vE '(^|/)(e2e|tests/e2e)/|\.e2e\.' | head -1 || true)
UNIT_RUNNER=""
grep -qE '"vitest"' package.json 2>/dev/null && UNIT_RUNNER="vitest" || true
grep -qE '"jest"'   package.json 2>/dev/null && UNIT_RUNNER="jest"   || true
if [ -z "$UNIT_TEST_FILES" ]; then
  echo "ℹ️  단위 테스트 없음 — 건너뜀 (E2E는 별도 레이어에서 검증)"
elif [ -z "$UNIT_RUNNER" ]; then
  echo "❌ 단위 테스트 파일이 존재하나 러너(vitest/jest) 미설치 — verify에서 실행 불가"
  exit 1
elif ! grep -qE '"test"[[:space:]]*:' package.json 2>/dev/null; then
  echo "❌ 단위 테스트 파일이 존재하나 package.json에 \"test\" 스크립트 없음"
  exit 1
else
  TEST_EXIT=0
  pnpm test > /tmp/verify-unittest-cbviz.log 2>&1 || TEST_EXIT=$?
  if [ "$TEST_EXIT" -ne 0 ]; then
    echo "❌ 단위 테스트 실패 ($UNIT_RUNNER)"; tail -30 /tmp/verify-unittest-cbviz.log
    exit 1
  else
    echo "✅ 단위 테스트 통과 ($UNIT_RUNNER)"
  fi
fi

echo ""
echo "✅ verify.sh ALL PASS"
