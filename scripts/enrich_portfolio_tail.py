#!/usr/bin/env python3
"""
Дотягивает portfolio-data.js до сегодня: equity (β×BTC), APR с YIELD_CUT_DAY,
якорь графика 2026-01-01 = 15100. Дни до YIELD_CUT_DAY в chart-yield-reference не трогаем.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "python") not in sys.path:
    sys.path.insert(0, str(ROOT / "python"))

from lp_income_snapshots import (  # noqa: E402
    apr_from_snapshot_row,
    delta_income_between_snapshots,
    load_income_store,
)

DATA_JS = ROOT / "data" / "portfolio-data.js"
BTC_CACHE = ROOT / "data/btc-daily-prices.json"
YIELD_REF_PATH = ROOT / "data/chart-yield-reference.json"
PREFIX = "window.PORTFOLIO_DATA = "
BTC_BETA = 1.3
YIELD_CUT_DAY = "2026-05-26"
CHART_START_DAY = "2026-01-01"
CHART_START_EQUITY = 15100.0
MAX_CHART_APR = 55.0


def fetch_btc_binance(start_day: str, end_day: str) -> dict[str, float]:
    start_ms = int(datetime.fromisoformat(start_day).timestamp() * 1000)
    end_ms = int((datetime.fromisoformat(end_day) + timedelta(days=1)).timestamp() * 1000)
    url = (
        "https://api.binance.com/api/v3/klines"
        f"?symbol=BTCUSDT&interval=1d&startTime={start_ms}&endTime={end_ms}&limit=1000"
    )
    with urllib.request.urlopen(url, timeout=20) as res:
        rows = json.loads(res.read().decode())
    out: dict[str, float] = {}
    for row in rows:
        day = datetime.fromtimestamp(int(row[0]) / 1000, tz=timezone.utc).date().isoformat()
        out[day] = float(row[4])
    return out


def load_btc_prices(start_day: str, end_day: str) -> dict[str, float]:
    btc: dict[str, float] = {}
    if BTC_CACHE.exists():
        try:
            cached = json.loads(BTC_CACHE.read_text(encoding="utf-8"))
            btc = dict(cached.get("byDay") or cached)
        except Exception:
            pass
    try:
        btc.update(fetch_btc_binance(start_day, end_day))
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as e:
        print(f"[WARN] BTC fetch failed ({e}) — using cache / flat carry", file=sys.stderr)
    if btc:
        try:
            cache_doc = (
                json.loads(BTC_CACHE.read_text(encoding="utf-8"))
                if BTC_CACHE.exists()
                else {"byDay": {}}
            )
            if "byDay" in cache_doc:
                cache_doc["byDay"].update(btc)
            else:
                cache_doc = {"byDay": {**cache_doc, **btc}}
            BTC_CACHE.write_text(json.dumps(cache_doc, separators=(",", ":")), encoding="utf-8")
        except Exception:
            pass
    return btc


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


def load_yield_ref() -> dict[str, float]:
    if not YIELD_REF_PATH.exists():
        return {}
    raw = json.loads(YIELD_REF_PATH.read_text(encoding="utf-8"))
    by = raw.get("byDay") or raw
    return {str(k)[:10]: float(v) for k, v in by.items()}


def save_yield_ref(by_day: dict[str, float]) -> None:
    YIELD_REF_PATH.write_text(
        json.dumps({"byDay": dict(sorted(by_day.items()))}, separators=(",", ":")),
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


def income_by_day_from_store(store: dict, through_day: str) -> dict[str, float]:
    by_day_store: dict[str, dict] = store.get("byDay") or {}
    known = sorted(d for d in by_day_store if d <= through_day)
    income: dict[str, float] = {}
    for k in range(1, len(known)):
        d0, d1 = known[k - 1], known[k]
        snap0 = by_day_store[d0].get("positions") or {}
        snap1 = by_day_store[d1].get("positions") or {}
        try:
            gap = max((date.fromisoformat(d1) - date.fromisoformat(d0)).days, 1)
        except ValueError:
            gap = 1
        period_income, _ = delta_income_between_snapshots(
            snap0, snap1, as_of_day=d1, calendar_days=gap
        )
        per_day = period_income / gap if gap else 0.0
        d_cur = date.fromisoformat(d0) + timedelta(days=1)
        d_end = date.fromisoformat(d1)
        while d_cur <= d_end:
            income[d_cur.isoformat()] = income.get(d_cur.isoformat(), 0.0) + per_day
            d_cur += timedelta(days=1)
    return income


def last_ref_apr_before(ref: dict[str, float], day: str) -> float:
    vals = [float(ref[d]) for d in sorted(ref) if d < day and float(ref[d]) > 0.5]
    if not vals:
        return 10.0
    return sum(vals[-7:]) / min(7, len(vals[-7:]))


def extend_equity_tail(snaps: list[dict], today: str) -> list[dict]:
    by_day = {str(s["timestamp"])[:10]: dict(s) for s in snaps}
    last_day = max(by_day)
    if last_day >= today:
        return snaps

    fetch_start = (datetime.fromisoformat(last_day) - timedelta(days=2)).date().isoformat()
    btc = load_btc_prices(fetch_start, today)

    anchor = dict(by_day[last_day])
    prev_day = last_day
    prev_eq = float(anchor.get("equityUsd") or 0)
    prev_row = dict(anchor)
    d = datetime.fromisoformat(last_day).date()
    end = datetime.fromisoformat(today).date()
    out = list(snaps)
    while d < end:
        d += timedelta(days=1)
        ds = d.isoformat()
        r = btc_return(btc, prev_day, ds)
        eq = prev_eq * (1.0 + BTC_BETA * r)
        step = eq / prev_eq if prev_eq > 0 else 1.0
        row = {
            "timestamp": f"{ds}T00:00:00.000Z",
            "collateralUsd": round(float(prev_row["collateralUsd"] or 0) * step, 6),
            "debtUsd": round(float(prev_row["debtUsd"] or 0) * step, 6),
            "liquidityUsd": round(float(prev_row["liquidityUsd"] or 0) * step, 6),
            "equityUsd": round(eq, 6),
            "dailyFeeIncomeUsd": 0.0,
        }
        out.append(row)
        prev_day, prev_eq, prev_row = ds, eq, row
    return out


def enrich_tail(payload: dict, today: str) -> dict:
    snaps = payload.get("snapshots") or []
    if not snaps:
        raise SystemExit("No snapshots")

    for s in snaps:
        d = str(s.get("timestamp", ""))[:10]
        if d in (CHART_START_DAY, "2026-01-02"):
            s["equityUsd"] = CHART_START_EQUITY

    snaps = extend_equity_tail(snaps, today)
    ref_old = load_yield_ref()
    income_store = load_income_store()
    income_by_day = income_by_day_from_store(income_store, today)
    carry_apr = last_ref_apr_before(ref_old, YIELD_CUT_DAY)

    chart_yield: dict[str, float] = {d: v for d, v in ref_old.items() if d < YIELD_CUT_DAY}
    ref_out = dict(ref_old)

    for s in snaps:
        d = str(s.get("timestamp", ""))[:10]
        if not d:
            continue
        if d in income_by_day and income_by_day[d] > 0:
            s["dailyFeeIncomeUsd"] = round(income_by_day[d], 6)
        if d < YIELD_CUT_DAY:
            continue
        apr = apr_from_snapshot_row(s, max_apr=MAX_CHART_APR)
        if apr <= 0.01:
            liq = float(s.get("liquidityUsd") or 0)
            if liq > 0 and carry_apr > 0:
                s["dailyFeeIncomeUsd"] = round((carry_apr / 100.0) * liq / 365.0, 6)
                apr = carry_apr
        if apr > 0.01:
            chart_yield[d] = round(apr, 6)
            ref_out[d] = round(apr, 6)
            carry_apr = apr

    daily_yield_series = [
        round(
            min(max(chart_yield.get(str(s.get("timestamp", ""))[:10], 0.0), 0.0), MAX_CHART_APR), 6
        )
        for s in snaps
    ]

    payload["snapshots"] = snaps
    payload["equityHistoryByDay"] = equity_history_from_snapshots(snaps)
    payload["chartYieldByDay"] = chart_yield
    payload["dailyYieldSeries"] = daily_yield_series
    payload["exportedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload["currentCapitalUsd"] = round(float(snaps[-1]["equityUsd"]), 2)
    payload["manualVisualAdjustmentUsd"] = float(payload.get("manualVisualAdjustmentUsd") or 800.0)

    save_yield_ref(ref_out)
    return payload


def main() -> None:
    today = datetime.now(timezone.utc).date().isoformat()
    payload = load_portfolio()
    before = len(payload.get("snapshots") or [])
    enrich_tail(payload, today)
    after = len(payload.get("snapshots") or [])
    y26 = (payload.get("chartYieldByDay") or {}).get(YIELD_CUT_DAY, 0)
    print(
        f"[OK] portfolio tail enriched: snapshots {before}->{after}, "
        f"last={payload['snapshots'][-1]['timestamp'][:10]}, "
        f"jan1={payload['snapshots'][0]['equityUsd']:.0f}, "
        f"adj={payload['manualVisualAdjustmentUsd']:.0f}, "
        f"apr[{YIELD_CUT_DAY}]={y26:.2f}%"
    )
    save_portfolio(payload)


if __name__ == "__main__":
    main()
