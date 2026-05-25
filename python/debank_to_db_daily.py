#!/usr/bin/env python3
"""
Single-run DeBank pipeline:
1) Parse DeBank lending page (selenium parser)
2) Import generated CSV into SQLite DB
3) Sync snapshots JSON for website
"""

import subprocess
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent


def run_step(cmd: list[str], title: str) -> None:
    print(f"\n=== {title} ===")
    print(" ".join(cmd))
    result = subprocess.run(cmd, cwd=ROOT_DIR)
    if result.returncode != 0:
        raise RuntimeError(f"Step failed: {title} (exit code {result.returncode})")
    print(f"[OK] {title}")


def main() -> None:
    python_bin = sys.executable

    run_step([python_bin, "debank_parser_final.py"], "Parse DeBank into CSV")
    run_step([python_bin, "python/import_debank_csv.py"], "Import DeBank CSV into database")
    run_step([python_bin, "python/sync_snapshots_json.py"], "Sync snapshots for web dashboard")

    print("\n[DONE] DeBank data updated in DB and website snapshots.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[ERROR] {exc}")
        sys.exit(1)
