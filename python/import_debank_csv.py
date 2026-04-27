import csv
import glob
import json
import sqlite3
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any


def load_config() -> dict[str, Any]:
    config_path = Path("python/config.json")
    if not config_path.exists():
        raise FileNotFoundError("Create python/config.json from python/config.example.json")
    return json.loads(config_path.read_text(encoding="utf-8"))


def normalize_symbol(symbol: str) -> str:
    s = (symbol or "").strip().upper()
    if "BTC" in s:
        return "BTC"
    if "ETH" in s:
        return "ETH"
    return s


def pick_latest_csv() -> str:
    candidates = glob.glob("debank_lending_*.csv")
    if not candidates:
        raise FileNotFoundError("No debank_lending_*.csv found in project root. Run debank_parser_final.py first.")
    candidates.sort(key=lambda p: Path(p).stat().st_mtime, reverse=True)
    return candidates[0]


def main() -> None:
    cfg = load_config()
    db_path = cfg["db_path"]
    wallets = cfg.get("debank_wallets", [])
    wallet = wallets[0] if wallets else "unknown"
    as_of_date = date.today().isoformat()

    csv_path = pick_latest_csv()

    collateral_tokens: dict[str, float] = defaultdict(float)
    debt_tokens: dict[str, float] = defaultdict(float)
    collateral_usd = 0.0
    debt_usd = 0.0

    with open(csv_path, newline="", encoding="utf-8") as f:
      reader = csv.DictReader(f)
      for row in reader:
          coll_asset = normalize_symbol(row.get("collateral_asset", ""))
          coll_amount = row.get("collateral_amount", "").strip()
          coll_usd = row.get("collateral_usd", "").strip()
          bor_asset = normalize_symbol(row.get("borrow_asset", ""))
          bor_amount = row.get("borrow_amount", "").strip()
          bor_usd = row.get("borrow_usd", "").strip()

          if coll_asset and coll_amount:
              try:
                  collateral_tokens[coll_asset] += float(coll_amount)
              except ValueError:
                  pass
          if coll_usd:
              try:
                  collateral_usd += float(coll_usd)
              except ValueError:
                  pass

          if bor_asset and bor_amount:
              try:
                  debt_tokens[bor_asset] += float(bor_amount)
              except ValueError:
                  pass
          if bor_usd:
              try:
                  debt_usd += float(bor_usd)
              except ValueError:
                  pass

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    try:
      cur.execute("DELETE FROM debank_tokens WHERE as_of_date = ?", (as_of_date,))

      for symbol, amount in collateral_tokens.items():
          cur.execute(
              """
              INSERT INTO debank_tokens(as_of_date, wallet, side, symbol, amount)
              VALUES (?, ?, 'collateral', ?, ?)
              """,
              (as_of_date, wallet, symbol, amount),
          )

      for symbol, amount in debt_tokens.items():
          cur.execute(
              """
              INSERT INTO debank_tokens(as_of_date, wallet, side, symbol, amount)
              VALUES (?, ?, 'debt', ?, ?)
              """,
              (as_of_date, wallet, symbol, amount),
          )

      cur.execute(
          """
          INSERT INTO daily_metrics(as_of_date, collateral_usd, debt_usd, source_debank, updated_at)
          VALUES (?, ?, ?, 'debank_csv_import', datetime('now'))
          ON CONFLICT(as_of_date) DO UPDATE SET
            collateral_usd=excluded.collateral_usd,
            debt_usd=excluded.debt_usd,
            source_debank='debank_csv_import',
            updated_at=datetime('now')
          """,
          (as_of_date, collateral_usd, debt_usd),
      )

      cur.execute(
          """
          INSERT INTO ingestion_runs(as_of_date, pipeline, status, message)
          VALUES (?, 'debank_csv_import', 'success', ?)
          """,
          (as_of_date, f"file={csv_path}; collateral_usd={collateral_usd:.2f}; debt_usd={debt_usd:.2f}"),
      )
      conn.commit()
    finally:
      conn.close()

    print(f"[OK] Imported {csv_path}")
    print(f"[OK] collateral_usd={collateral_usd:.2f}, debt_usd={debt_usd:.2f}")


if __name__ == "__main__":
    main()
