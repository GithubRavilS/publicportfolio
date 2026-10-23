#!/usr/bin/env python3
"""Pull DeFi Navigator personal-cabinet cache into Public Portfolio.

Prefer live PA read-only endpoint; else export from a local/PC_DB_PATH copy
of portfolio-check.db via portfolio-check export module.

Examples:
  python3 scripts/pull_navigator_cabinet_snapshot.py
  NAVIGATOR_SNAPSHOT_URL=https://cry-maden008.pythonanywhere.com/portfolio-check/api/public/navigator-snapshot \\
    python3 scripts/pull_navigator_cabinet_snapshot.py
  PC_DB_PATH=../portfolio-check/data/_pa_live_pull.db \\
    python3 scripts/pull_navigator_cabinet_snapshot.py --from-db
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "data" / "navigator-cabinet-snapshot.json"
DEFAULT_URL = os.environ.get(
    "NAVIGATOR_SNAPSHOT_URL",
    "https://cry-maden008.pythonanywhere.com/portfolio-check/api/public/navigator-snapshot",
)
PORTFOLIO_CHECK = Path(
    os.environ.get(
        "PORTFOLIO_CHECK_ROOT",
        str(ROOT.parent / "portfolio-check"),
    )
)


def pull_url(url: str) -> dict:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def export_from_db(db_path: Path | None) -> dict:
    if str(PORTFOLIO_CHECK) not in sys.path:
        sys.path.insert(0, str(PORTFOLIO_CHECK))
    if db_path:
        os.environ["PC_DB_PATH"] = str(db_path.resolve())
    from backend.client_os import connect
    from backend.public_navigator_export import build_public_navigator_snapshot

    conn = connect()
    try:
        return build_public_navigator_snapshot(conn)
    finally:
        conn.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--output", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--from-db", action="store_true", help="Skip URL; use portfolio-check DB")
    ap.add_argument("--db", type=Path, default=None)
    args = ap.parse_args()

    payload = None
    source = None
    if not args.from_db:
        try:
            payload = pull_url(args.url)
            source = args.url
        except Exception as exc:
            print(f"[warn] URL pull failed: {exc}", file=sys.stderr)

    if payload is None or not payload.get("ok"):
        db = args.db
        if db is None:
            cand = PORTFOLIO_CHECK / "data" / "_pa_live_pull.db"
            if cand.is_file():
                db = cand
        payload = export_from_db(db)
        source = f"db:{db or os.environ.get('PC_DB_PATH') or 'PC_DB_PATH'}"

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    totals = payload.get("totals") or {}
    print(
        json.dumps(
            {
                "ok": payload.get("ok"),
                "source": source,
                "output": str(args.output),
                "snapshotId": payload.get("snapshotId"),
                "updatedAt": payload.get("updatedAt"),
                "balanceUsd": totals.get("totalUsd"),
                "publicNetWorthHint": round(float(totals.get("totalUsd") or 0) + 800, 2),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0 if payload.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
