#!/usr/bin/env python3
"""Добавляет на график дни с последнего снимка в portfolio-data.js до сегодня (β×BTC)."""

from __future__ import annotations

import json
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_JS = ROOT / "data" / "portfolio-data.js"
BTC_CACHE = ROOT / "data" / "btc-daily-prices.json"
BTC_BETA = 1.3
PREFIX = "window.PORTFOLIO_DATA = "


def fetch_btc_binance(start_day: str, end_day: str) -> dict[str, float]:
    start_ms = int(datetime.fromisoformat(start_day).timestamp() * 1000)
    end_ms = int((datetime.fromisoformat(end_day) + timedelta(days=1)).timestamp() * 1000)
    url = (
        "https://api.binance.com/api/v3/klines"
        f"?symbol=BTCUSDT&interval=1d&startTime={start_ms}&endTime={end_ms}&limit=1000"
    )
    with urllib.request.urlopen(url, timeout=45) as res:
        rows = json.loads(res.read().decode())
    out: dict[str, float] = {}
    for row in rows:
        day = datetime.fromtimestamp(int(row[0]) / 1000, tz=timezone.utc).date().isoformat()
        out[day] = float(row[4])
    return out


def btc_return(btc: dict[str, float], d0: str, d1: str) -> float:
    p0 = btc.get(d0) or 0.0
    p1 = btc.get(d1) or 0.0
    if p0 <= 0 or p1 <= 0:
        return 0.0
    return (p1 / p0) - 1.0


def load_portfolio() -> dict:
    raw = DATA_JS.read_text(encoding="utf-8")
    if not raw.startswith(PREFIX):
        raise SystemExit("Unexpected portfolio-data.js format")
    return json.loads(raw[len(PREFIX) :].strip().rstrip(";"))


def save_portfolio(payload: dict) -> None:
    DATA_JS.write_text(
        PREFIX + json.dumps(payload, ensure_ascii=False, separators=(", ", ": ")) + ";\n",
        encoding="utf-8",
    )


def equity_history_from_snapshots(snapshots: list[dict]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for s in snapshots:
        d = str(s.get("timestamp", ""))[:10]
        if not d:
            continue
        out[d] = {
            "equityUsd": float(s.get("equityUsd") or 0),
            "collateralUsd": float(s.get("collateralUsd") or 0),
            "debtUsd": float(s.get("debtUsd") or 0),
            "liquidityUsd": float(s.get("liquidityUsd") or 0),
            "dailyFeeIncomeUsd": float(s.get("dailyFeeIncomeUsd") or 0),
        }
    return out


def main() -> None:
    today = datetime.now(timezone.utc).date().isoformat()
    payload = load_portfolio()
    snaps = payload.get("snapshots") or []
    if not snaps:
        raise SystemExit("No snapshots in portfolio-data.js")

    by_day = {str(s["timestamp"])[:10]: dict(s) for s in snaps}
    last_day = max(by_day)
    if last_day >= today:
        print(f"[OK] Chart already through {last_day} (today={today})")
        return

    anchor = dict(by_day[last_day])
    anchor_eq = float(anchor.get("equityUsd") or 0)
    if anchor_eq <= 0:
        raise SystemExit(f"Invalid anchor equity on {last_day}")

    btc: dict[str, float] = {}
    if BTC_CACHE.exists():
        cached = json.loads(BTC_CACHE.read_text(encoding="utf-8"))
        btc = dict(cached.get("byDay") or cached)

    fetch_start = (datetime.fromisoformat(last_day) - timedelta(days=2)).date().isoformat()
    btc.update(fetch_btc_binance(fetch_start, today))
    if BTC_CACHE.exists():
        cache_doc = json.loads(BTC_CACHE.read_text(encoding="utf-8"))
        if "byDay" in cache_doc:
            cache_doc["byDay"].update(btc)
        else:
            cache_doc = {"byDay": {**cache_doc, **btc}}
        BTC_CACHE.write_text(json.dumps(cache_doc, separators=(",", ":")), encoding="utf-8")

    d = datetime.fromisoformat(last_day).date()
    end = datetime.fromisoformat(today).date()
    days_to_add: list[str] = []
    while d < end:
        d += timedelta(days=1)
        days_to_add.append(d.isoformat())

    prev_day = last_day
    prev_eq = anchor_eq
    prev_row = dict(anchor)
    for d in days_to_add:
        r = btc_return(btc, prev_day, d)
        eq = prev_eq * (1.0 + BTC_BETA * r)
        step = eq / prev_eq if prev_eq > 0 else 1.0
        row = {
            "timestamp": f"{d}T00:00:00.000Z",
            "collateralUsd": round(float(prev_row["collateralUsd"] or 0) * step, 6),
            "debtUsd": round(float(prev_row["debtUsd"] or 0) * step, 6),
            "liquidityUsd": round(float(prev_row["liquidityUsd"] or 0) * step, 6),
            "equityUsd": round(eq, 6),
            "dailyFeeIncomeUsd": 0.0,
        }
        snaps.append(row)
        by_day[d] = row
        prev_day, prev_eq, prev_row = d, eq, row

    payload["snapshots"] = snaps
    payload["equityHistoryByDay"] = equity_history_from_snapshots(snaps)
    payload["exportedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload["currentCapitalUsd"] = round(float(snaps[-1]["equityUsd"]), 2)

    save_portfolio(payload)
    print(
        f"[OK] Extended chart {last_day} -> {today} (+{len(days_to_add)} days), "
        f"last equity={snaps[-1]['equityUsd']:.2f}"
    )


if __name__ == "__main__":
    main()
