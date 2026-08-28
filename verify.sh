#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# ── 실행 모드 (게이트 계층화 — ~/.claude/skills/_shared/impl-handoff.md §3-1) ──
VERIFY_MODE="full"
case "${1:-}" in
  --ts-only)  VERIFY_MODE="ts-only" ;;
  --no-build) VERIFY_MODE="no-build" ;;
  --full|"")  VERIFY_MODE="full" ;;
  *) echo "⚠️  알 수 없는 플래그 '$1' — full 로 실행합니다" ;;
esac

echo "=== [1/4] TypeScript build ==="
pnpm run typecheck
echo "✅ tsc --build PASS"

if [ "$VERIFY_MODE" = "ts-only" ]; then
  echo ""
  echo "=== ts-only 모드: 타입체크만 수행하고 종료 ==="
  exit 0
fi

echo ""
echo "=== [2/4] oxlint (correctness) ==="
if command -v pnpm >/dev/null 2>&1 && pnpm exec oxlint --version >/dev/null 2>&1; then
  pnpm exec oxlint --config .oxlintrc.json
  echo "✅ oxlint PASS (correctness=deny — 위반 시 exit 1로 게이트 실패, set -e가 스크립트 중단)"
else
  echo "ℹ️  oxlint 미설치 — 건너뜀"
fi

echo ""
echo "=== [3/4] 단위 테스트 ==="
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
echo "=== [4/4] contributes ID 매칭 (package.json ↔ src) ==="
node scripts/check-contributes-ids.mjs

# NOTE: 이 프로젝트는 [1/4] typecheck 이 곧 `tsc --build` 라 별도 번들러 스텝이 없다.
#       따라서 --no-build 는 full 과 동일하게 동작한다 (스킵할 빌드 스텝이 없음).
#       실질 절감이 있는 계층은 --ts-only 뿐이다.
echo ""
echo "✅ verify.sh ALL PASS (mode=$VERIFY_MODE)"
