#!/usr/bin/env bash
# Локально: ETL → export → автопроверка (как run-all-wallets в Portfolio Tracker).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PY="${PYTHON:-python3}"
if [ -d .venv ]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi

echo "[1/3] etl_revert"
$PY python/etl_revert.py

echo "[2/3] export_static_data"
$PY python/export_static_data.py

echo "[3/3] validate_portfolio_export"
$PY scripts/validate_portfolio_export.py data/portfolio-data.js
