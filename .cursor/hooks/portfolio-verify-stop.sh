#!/usr/bin/env bash
# После nano-staged: bundle + ruff, если менялись js/ или server.
set -euo pipefail

INPUT=$(cat)
STATUS=$(echo "$INPUT" | jq -r '.status // "completed"')
LOOP_COUNT=$(echo "$INPUT" | jq -r '.loop_count // 0')

if [ "$STATUS" = "aborted" ] || [ "$STATUS" = "error" ]; then
  echo '{}'
  exit 0
fi

if [ "${LOOP_COUNT:-0}" -ge 2 ] 2>/dev/null; then
  echo '{}'
  exit 0
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

git rev-parse --git-dir >/dev/null 2>&1 || { echo '{}'; exit 0; }

CHANGED=$(git diff --name-only HEAD 2>/dev/null; git diff --name-only --cached 2>/dev/null) || true
if ! echo "$CHANGED" | grep -qE '^(js/|css/|server\.py|wsgi\.py|scripts/)'; then
  echo '{}'
  exit 0
fi

set +e
OUT=$(PT_SKIP_NETWORK=1 node scripts/verify.mjs 2>&1)
CODE=$?
set -e

if [ "$CODE" -ne 0 ]; then
  jq -n --arg msg "Portfolio verify failed (bundle/ruff/lint). Run: npm run verify

${OUT}" '{followup_message: $msg}'
  exit 0
fi

echo '{}'
