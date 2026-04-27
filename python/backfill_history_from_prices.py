#!/usr/bin/env python3
"""
Backfill daily metrics from 2026-01-01 using current token amounts
and historical BTC/ETH prices.

Logic:
- Token amounts are taken from latest available day in DB
- BTC/ETH are revalued for each historical day
- Stablecoins USDC/USDT are valued as 1 USD
- Other assets fallback to latest known implied USD price
- Backfill writes dates up to yesterday
- Current day remains real data from daily ETL
"""

import json
import sqlite3
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import requests

START_DATE = date(2026, 1, 1)


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


def fetch_price_history() -> dict[str, dict[str, float]]:
    today = date.today()
    from_ts = int(datetime(START_DATE.year, START_DATE.month, START_DATE.day).timestamp())
    to_ts = int(datetime(today.year, today.month, today.day).timestamp())

    def one_asset(asset_id: str) -> dict[str, float]:
        url = (
            f"https://api.coingecko.com/api/v3/coins/{asset_id}/market_chart/range"
            f"?vs_currency=usd&from={from_ts}&to={to_ts}"
        )
        res = requests.get(url, timeout=45)
        res.raise_for_status()
        data = res.json()
        out: dict[str, float] = {}
        for ts_ms, px in data.get("prices", []):
            dt = datetime.utcfromtimestamp(ts_ms / 1000).date().isoformat()
            out[dt] = float(px)
        return out

    btc = one_asset("bitcoin")
    eth = one_asset("ethereum")
    return {"BTC": btc, "ETH": eth}


def get_latest_token_state(conn: sqlite3.Connection) -> tuple[str, list[tuple[str, str, float]], dict[str, float]]:
    cur = conn.cursor()

    latest_day = cur.execute("SELECT MAX(as_of_date) FROM daily_metrics").fetchone()[0]
    if not latest_day:
        raise RuntimeError("No data in daily_metrics. Run normal ETL first.")

    token_rows = cur.execute(
        """
        SELECT side, symbol, amount
        FROM debank_tokens
        WHERE as_of_date = ?
        """,
        (latest_day,),
    ).fetchall()

    liquidity_rows = cur.execute(
        """
        SELECT symbol, SUM(amount) AS amount, SUM(usd_value) AS usd_value
        FROM revert_positions
        WHERE as_of_date = ?
        GROUP BY symbol
        """,
        (latest_day,),
    ).fetchall()

    implied_prices: dict[str, float] = {}
    for symbol, amount, usd_value in liquidity_rows:
        sym = normalize_symbol(symbol)
        amt = float(amount or 0)
        usd = float(usd_value or 0)
        if amt > 0 and usd > 0:
            implied_prices[sym] = usd / amt

    combined: list[tuple[str, str, float]] = []
    for side, symbol, amount in token_rows:
        combined.append((side, normalize_symbol(symbol), float(amount or 0)))
    for symbol, amount, _usd in liquidity_rows:
        combined.append(("liquidity", normalize_symbol(symbol), float(amount or 0)))

    return str(latest_day), combined, implied_prices


def price_for(symbol: str, day: str, histories: dict[str, dict[str, float]], implied: dict[str, float]) -> float:
    sym = normalize_symbol(symbol)
    if sym in ("USDC", "USDT"):
        return 1.0
    if sym in ("BTC", "ETH"):
        series = histories[sym]
        if day in series:
            return series[day]
        # fallback to nearest previous date price
        day_obj = datetime.fromisoformat(day).date()
        for i in range(1, 15):
            prev = (day_obj - timedelta(days=i)).isoformat()
            if prev in series:
                return series[prev]
        # fallback to nearest next date price
        for i in range(1, 15):
            nxt = (day_obj + timedelta(days=i)).isoformat()
            if nxt in series:
                return series[nxt]
        return 0.0
    return implied.get(sym, 0.0)


def main() -> None:
    cfg = load_config()
    db_path = cfg["db_path"]
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    try:
        latest_day, token_state, implied_prices = get_latest_token_state(conn)
        histories = fetch_price_history()

        today = date.today()
        end_day = today - timedelta(days=1)
        if end_day < START_DATE:
            print("[SKIP] No historical range to backfill yet.")
            return

        day = START_DATE
        inserted = 0
        while day <= end_day:
            d = day.isoformat()
            collateral_usd = 0.0
            debt_usd = 0.0
            liquidity_usd = 0.0

            for side, symbol, amount in token_state:
                px = price_for(symbol, d, histories, implied_prices)
                usd = amount * px
                if side == "collateral":
                    collateral_usd += usd
                elif side == "debt":
                    debt_usd += usd
                elif side == "liquidity":
                    liquidity_usd += usd

            equity_usd = collateral_usd - debt_usd + liquidity_usd

            cur.execute(
                """
                INSERT INTO daily_metrics(
                  as_of_date, collateral_usd, debt_usd, liquidity_usd, equity_usd,
                  daily_fee_income_usd, source_revert, source_debank, updated_at
                ) VALUES (?, ?, ?, ?, ?, 0, 'backfill_prices', 'backfill_prices', datetime('now'))
                ON CONFLICT(as_of_date) DO UPDATE SET
                  collateral_usd=excluded.collateral_usd,
                  debt_usd=excluded.debt_usd,
                  liquidity_usd=excluded.liquidity_usd,
                  equity_usd=excluded.equity_usd,
                  source_revert='backfill_prices',
                  source_debank='backfill_prices',
                  updated_at=datetime('now')
                """,
                (d, collateral_usd, debt_usd, liquidity_usd, equity_usd),
            )
            inserted += 1
            day += timedelta(days=1)

        cur.execute(
            """
            INSERT INTO ingestion_runs(as_of_date, pipeline, status, message)
            VALUES (?, 'history_backfill', 'success', ?)
            """,
            (date.today().isoformat(), f"backfilled_days={inserted}; latest_source_day={latest_day}"),
        )

        conn.commit()
        print(f"[OK] Backfilled {inserted} days from {START_DATE.isoformat()} to {end_day.isoformat()}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
