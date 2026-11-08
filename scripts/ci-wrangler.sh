#!/usr/bin/env bash
# CIで wrangler を実行し、失敗したらエラー行を GitHub Actions の Annotations に出す
set -uo pipefail

log=$(mktemp)
npx wrangler "$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  message=$(grep -E 'ERROR|error' "$log" | head -5 | tr '\n' ' ')
  echo "::error title=wrangler $1 failed::${message:-exit code $status}"
fi
exit "$status"
