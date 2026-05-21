#!/usr/bin/env bash
# PythonAnywhere: Scheduled task (hourly). Обновляет БД + пушит на GitHub → Vercel.
set -euo pipefail
cd ~/Public_portfolio
source .venv/bin/activate
export TMPDIR="${TMPDIR:-$HOME/tmp}"
mkdir -p "$TMPDIR"

TOKEN=$(tr -d '\n\r' < ~/.github_pat)
REMOTE="https://GithubRavilS:${TOKEN}@github.com/GithubRavilS/publicportfolio.git"

git_recover() {
  if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ]; then
    echo "[WARN] Прерванный rebase — git rebase --abort"
    git rebase --abort || true
  fi
  if [ -f .git/MERGE_HEAD ]; then
    echo "[WARN] Прерванный merge — git merge --abort"
    git merge --abort || true
  fi
  git checkout -f main 2>/dev/null || git checkout -B main
}

sync_code_from_github() {
  git_recover
  git fetch "$REMOTE" main
  # Код и эталоны — с GitHub; локальные «зависшие» коммиты на PA сбрасываем
  git reset --hard FETCH_HEAD
  echo "[OK] Код синхронизирован с GitHub (main)"
}

sync_code_from_github

python debank_parser_final.py
if ls debank_lending_*.csv >/dev/null 2>&1; then
  python python/import_debank_csv.py
else
  echo "[WARN] No debank_lending_*.csv, skip import_debank_csv"
fi

python python/etl_revert.py | tee /tmp/etl_last.log
if ! grep -q "liquidity_usd=[5-9]" /tmp/etl_last.log && ! grep -q "liquidity_usd=8" /tmp/etl_last.log; then
  echo "[FATAL] etl_revert: liquidity_usd ~444 — на GitHub старый etl_revert.py без фикса NBSP."
  echo "        Залей с Mac python/etl_revert.py, затем снова запусти этот скрипт."
  exit 1
fi

python python/export_static_data.py

git add \
  data/portfolio-data.js \
  data/snapshots.json \
  data/chart-yield-reference.json \
  data/equity-history-reference.json \
  data/s1-history-reference.json \
  data/s1-positions-reference.json \
  index.html \
  js/portfolio-ui.js \
  python/etl_revert.py \
  python/export_static_data.py \
  python/config.json \
  scripts/pa_hourly_update.sh

if git diff --cached --quiet; then
  echo "[OK] Nothing to commit"
else
  git commit -m "chore: auto portfolio update $(date -u +%Y-%m-%dT%H%MZ)"
  git push "$REMOTE" main
fi

echo "[OK] Done $(date -u +%Y-%m-%dT%H:%M:%SZ)"
