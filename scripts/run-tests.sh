#!/usr/bin/env bash
# Runs every tests/*.test.ts file with tsx and fails if any of them fails.
# Used by the CI pipeline (.github/workflows/deploy.yml). Run locally with: bash scripts/run-tests.sh
set -uo pipefail
cd "$(dirname "$0")/.."

pass=0
fail=0
failed=()

for f in tests/*.test.ts; do
  if out=$(timeout 180 npx tsx "$f" 2>&1); then
    pass=$((pass + 1))
    echo "PASS  $f"
  else
    fail=$((fail + 1))
    failed+=("$f")
    echo "FAIL  $f"
    echo "$out" | tail -25
  fi
done

echo
echo "Tests: $pass passed, $fail failed"
if [ "$fail" -gt 0 ]; then
  printf 'Failed files:\n'
  printf '  %s\n' "${failed[@]}"
  exit 1
fi