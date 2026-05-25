import sqlite3
from pathlib import Path


def init_db(db_path: str) -> None:
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS market_prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            as_of_date TEXT NOT NULL,
            symbol TEXT NOT NULL,
            price_usd REAL NOT NULL,
            source TEXT NOT NULL DEFAULT 'coingecko',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(as_of_date, symbol, source)
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS revert_positions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            as_of_date TEXT NOT NULL,
            position_id TEXT NOT NULL,
            symbol TEXT NOT NULL,
            amount REAL NOT NULL,
            usd_value REAL NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS daily_metrics (
            as_of_date TEXT PRIMARY KEY,
            collateral_usd REAL NOT NULL DEFAULT 0,
            debt_usd REAL NOT NULL DEFAULT 0,
            liquidity_usd REAL NOT NULL DEFAULT 0,
            equity_usd REAL NOT NULL DEFAULT 0,
            daily_fee_income_usd REAL NOT NULL DEFAULT 0,
            source_revert TEXT NOT NULL DEFAULT 'excel',
            source_debank TEXT NOT NULL DEFAULT 'pending',
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS debank_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            as_of_date TEXT NOT NULL,
            wallet TEXT NOT NULL,
            side TEXT NOT NULL CHECK(side IN ('collateral', 'debt')),
            symbol TEXT NOT NULL,
            amount REAL NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS equity_chart_daily (
            as_of_date TEXT PRIMARY KEY,
            collateral_usd REAL NOT NULL DEFAULT 0,
            debt_usd REAL NOT NULL DEFAULT 0,
            liquidity_usd REAL NOT NULL DEFAULT 0,
            frozen_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS ingestion_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            as_of_date TEXT NOT NULL,
            pipeline TEXT NOT NULL,
            status TEXT NOT NULL,
            message TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )

    conn.commit()
    conn.close()


if __name__ == "__main__":
    init_db("data/portfolio.db")
    print("DB initialized: data/portfolio.db")
