#!/usr/bin/env bash
# Ежедневное дотягивание графиков до сегодня (β×BTC + APR-хвост). Без Google/DeBank.
# Запуск: GitHub Actions cron и PythonAnywhere (всегда, даже если полный export упал).
set -uo pipefail
cd "$(dirname "$0")/.."
echo "[OK] daily_chart_sync.sh $(date -u +%Y-%m-%dT%H:%M:%SZ)"

PYTHON="${PYTHON:-python3}"
if [ -x ".venv/bin/python" ]; then
  PYTHON=".venv/bin/python"
fi

"$PYTHON" scripts/enrich_portfolio_tail.py
"$PYTHON" scripts/validate_portfolio_export.py data/portfolio-data.js --soft || true

LAST=$("$PYTHON" -c "
import json
from pathlib import Path
p=json.loads(Path('data/portfolio-data.js').read_text().split('=',1)[1].strip().rstrip(';'))
print(p['snapshots'][-1]['timestamp'][:10], p.get('exportedAt',''))
")
echo "[OK] chart through ${LAST}"
