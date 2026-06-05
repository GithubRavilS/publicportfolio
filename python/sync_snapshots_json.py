import json
import sqlite3
from pathlib import Path

INITIAL_CAPITAL_USD = 15500.0
INITIAL_DATE = "2026-01-01"
MANUAL_VISUAL_ADJUSTMENT_USD = 800.0


def main() -> None:
    config_path = Path("python/config.json")
    if not config_path.exists():
        raise FileNotFoundError("Create python/config.json from python/config.example.json")
    config = json.loads(config_path.read_text(encoding="utf-8"))
    cfg_adj = float(config.get("manual_visual_adjustment_usd", MANUAL_VISUAL_ADJUSTMENT_USD) or 0)
    manual_adjustment_usd = (
        MANUAL_VISUAL_ADJUSTMENT_USD
        if abs(cfg_adj - MANUAL_VISUAL_ADJUSTMENT_USD) > 1.0
        else cfg_adj
    )

    db_path = config["db_path"]
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute(
        """
        SELECT as_of_date, collateral_usd, debt_usd, liquidity_usd, daily_fee_income_usd
        FROM daily_metrics
        ORDER BY as_of_date ASC
        """
    )
    rows = cur.fetchall()
    conn.close()

    snapshots = []
    has_initial = False
    for row in rows:
        if str(row["as_of_date"]) == INITIAL_DATE:
            has_initial = True
        collateral = float(row["collateral_usd"] or 0)
        debt = float(row["debt_usd"] or 0)
        liquidity = float(row["liquidity_usd"] or 0)
        equity = collateral - debt + liquidity
        snapshots.append(
            {
                "timestamp": f"{row['as_of_date']}T00:00:00.000Z",
                "collateralUsd": collateral,
                "debtUsd": debt,
                "liquidityUsd": liquidity,
                "equityUsd": equity + manual_adjustment_usd,
                "dailyFeeIncomeUsd": float(row["daily_fee_income_usd"] or 0),
            }
        )

    if not has_initial:
        snapshots.insert(
            0,
            {
                "timestamp": f"{INITIAL_DATE}T00:00:00.000Z",
                "collateralUsd": INITIAL_CAPITAL_USD,
                "debtUsd": 0.0,
                "liquidityUsd": 0.0,
                "equityUsd": INITIAL_CAPITAL_USD + manual_adjustment_usd,
                "dailyFeeIncomeUsd": 0.0,
            },
        )

    output_path = Path("data/snapshots.json")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(snapshots, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[OK] Synced {len(snapshots)} snapshots to data/snapshots.json")


if __name__ == "__main__":
    main()
