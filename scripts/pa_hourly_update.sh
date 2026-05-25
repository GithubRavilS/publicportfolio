#!/usr/bin/env bash
# PythonAnywhere: Scheduled task (hourly). Обновляет БД + пушит на GitHub → Vercel.
# PA_HOURLY_SCRIPT_VERSION=2026-05-25-market-equity-v5
set -euo pipefail
cd ~/Public_portfolio
echo "[OK] pa_hourly_update.sh version 2026-05-25-market-equity-v5"
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

CONFIG_BAK="${HOME}/.portfolio_pa_config.json.bak"
GSERVICE_BAK="${HOME}/.portfolio_pa_google_sa.json.bak"
DB_BAK="${HOME}/.portfolio_pa.db.bak"
[ -f python/config.json ] && cp python/config.json "$CONFIG_BAK"
[ -f python/google-service-account.json ] && cp python/google-service-account.json "$GSERVICE_BAK"
[ -f data/portfolio.db ] && cp data/portfolio.db "$DB_BAK"

sync_code_from_github() {
  git_recover
  git fetch "$REMOTE" main
  # Код и эталоны — с GitHub; локальные «зависшие» коммиты на PA сбрасываем
  git reset --hard FETCH_HEAD
  echo "[OK] Код синхронизирован с GitHub (main)"
}

sync_code_from_github

if [ -f "$CONFIG_BAK" ]; then
  cp "$CONFIG_BAK" python/config.json
  echo "[OK] Восстановлен python/config.json (не в GitHub)"
fi
if [ -f "$GSERVICE_BAK" ]; then
  cp "$GSERVICE_BAK" python/google-service-account.json
  echo "[OK] Восстановлен google-service-account.json"
fi
if [ -f "$DB_BAK" ]; then
  mkdir -p data
  cp "$DB_BAK" data/portfolio.db
  echo "[OK] Восстановлен data/portfolio.db"
fi

python python/init_db.py

if [ ! -f python/config.json ]; then
  echo "[FATAL] Нет python/config.json на PA."
  echo "        Создай: cp python/config.example.json python/config.json && nano python/config.json"
  echo "        Нужны: google_sheet_id, google_service_account_file, debank_wallets."
  exit 1
fi

python debank_parser_final.py || echo "[WARN] debank_parser_final.py failed (на PA часто 0 позиций — ок)"

if ls debank_lending_*.csv >/dev/null 2>&1; then
  python python/import_debank_csv.py || echo "[WARN] import_debank_csv failed"
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
python scripts/validate_portfolio_export.py data/portfolio-data.js || echo "[WARN] export audit warnings (non-fatal)"

echo "=== PUSH TO GITHUB (v3) ==="
set +e
PUSH_TS="$(date -u +%Y-%m-%dT%H%MZ)"
PUSH_MSG="chore: portfolio data update ${PUSH_TS}"

for f in data/portfolio-data.js data/lp-income-snapshots.json data/chart-yield-reference.json; do
  if [ ! -f "$f" ]; then
    echo "[FATAL] Нет файла $f — push отменён"
    set -e
    exit 1
  fi
done

cp data/portfolio-data.js "${TMPDIR}/portfolio-data.js.push"
cp data/lp-income-snapshots.json "${TMPDIR}/lp-income-snapshots.json.push"
cp data/chart-yield-reference.json "${TMPDIR}/chart-yield-reference.json.push"
git fetch "$REMOTE" main
git reset --hard FETCH_HEAD

cp "${TMPDIR}/portfolio-data.js.push" data/portfolio-data.js
cp "${TMPDIR}/lp-income-snapshots.json.push" data/lp-income-snapshots.json
cp "${TMPDIR}/chart-yield-reference.json.push" data/chart-yield-reference.json

git add data/portfolio-data.js data/lp-income-snapshots.json data/chart-yield-reference.json

if git diff --cached --quiet; then
  echo "[OK] Файлы совпадают с GitHub — push не требуется"
else
  git commit -m "$PUSH_MSG"
  if git push "$REMOTE" HEAD:main; then
    echo "[OK] Pushed to GitHub (main)"
  else
    echo "[FATAL] git push failed — проверь ~/.github_pat (права repo)"
    set -e
    exit 1
  fi
fi
set -e

if [ -f "$CONFIG_BAK" ]; then
  cp "$CONFIG_BAK" python/config.json
fi
if [ -f "$DB_BAK" ]; then
  mkdir -p data
  cp "$DB_BAK" data/portfolio.db
fi

echo "[OK] Done $(date -u +%Y-%m-%dT%H:%M:%SZ)"
