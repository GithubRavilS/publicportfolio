"""Append-only frozen daily chart history (equity + yield). Past days never change."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

JUPITER_ERA_START = "2026-06-16"
BTC_BETA = 1.3
CORRUPT_EQUITY_FLOOR_USD = 10_000.0
CORRUPT_COLLATERAL_FLOOR_USD = 3_000.0


def _day(s: dict | str) -> str:
    if isinstance(s, dict):
        return str(s.get("timestamp", ""))[:10]
    return str(s)[:10]


def _row_with_ts(row: dict, day: str) -> dict:
    out = dict(row)
    out["timestamp"] = f"{day}T00:00:00.000Z"
    return out


def fetch_btc_by_day(
    start_day: str, end_day: str, cache_path: Path | None = None
) -> dict[str, float]:
    btc: dict[str, float] = {}
    if cache_path and cache_path.exists():
        try:
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            btc = dict(cached.get("byDay") or cached)
        except Exception:
            pass
    try:
        start_ms = int(datetime.fromisoformat(start_day).timestamp() * 1000)
        end_ms = int((datetime.fromisoformat(end_day) + timedelta(days=1)).timestamp() * 1000)
        url = (
            "https://api.binance.com/api/v3/klines"
            f"?symbol=BTCUSDT&interval=1d&startTime={start_ms}&endTime={end_ms}&limit=1000"
        )
        with urllib.request.urlopen(url, timeout=20) as res:
            rows = json.loads(res.read().decode())
        for row in rows:
            d = datetime.fromtimestamp(int(row[0]) / 1000, tz=timezone.utc).date().isoformat()
            btc[d] = float(row[4])
        if cache_path and btc:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(
                json.dumps({"byDay": btc}, separators=(",", ":")), encoding="utf-8"
            )
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError):
        pass
    return btc


def _btc_forward_return(btc: dict[str, float], d0: str, d1: str) -> float:
    p0 = btc.get(d0) or 0.0
    p1 = btc.get(d1) or 0.0
    if p0 <= 0 or p1 <= 0:
        return 0.0
    return (p1 / p0) - 1.0


def lending_net_backward_from_today(
    days: list[str],
    btc: dict[str, float],
    *,
    today: str,
    lending_net_today: float,
    beta: float = BTC_BETA,
) -> dict[str, float]:
    """Lending net (coll-debt) scaled backward with β×BTC from today's live value."""
    if not days or today not in days:
        return {}
    out: dict[str, float] = {today: float(lending_net_today)}
    for i in range(len(days) - 1, 0, -1):
        d_cur, d_prev = days[i], days[i - 1]
        if d_cur not in out:
            continue
        r = _btc_forward_return(btc, d_prev, d_cur)
        out[d_prev] = out[d_cur] / max(1.0 + beta * r, 0.05)
    return out


def lp_components_for_day(store: dict, day: str) -> tuple[float, float]:
    """Liquidity USD + cumulative unclaimed fees from LP income snapshots."""
    by = store.get("byDay") or {}
    if day in by:
        pos = by[day].get("positions") or {}
        liq = sum(float(p.get("valueUsd") or 0) for p in pos.values())
        unc = float(by[day].get("totalCumulativeUsd") or 0)
        return liq, unc
    prior = sorted(d for d in by if d <= day)
    if not prior:
        return 0.0, 0.0
    return lp_components_for_day(store, prior[-1])


def is_corrupt_jupiter_era_row(row: dict, day: str) -> bool:
    """Missing Jupiter collateral dip or other broken tail rows."""
    if day < JUPITER_ERA_START:
        return False
    eq = float(row.get("equityUsd") or 0)
    coll = float(row.get("collateralUsd") or 0)
    return eq < CORRUPT_EQUITY_FLOOR_USD or coll < CORRUPT_COLLATERAL_FLOOR_USD


def is_synthetic_linear_equity_ramp(rows: list[dict], *, min_run: int = 5) -> bool:
    """Detect fake straight-line equity (constant daily delta, frozen components)."""
    era = [s for s in rows if _day(s) >= JUPITER_ERA_START]
    if len(era) < min_run + 1:
        return False
    deltas: list[float] = []
    frozen_coll = True
    prev_coll = float(era[0].get("collateralUsd") or 0)
    for i in range(1, len(era)):
        deltas.append(float(era[i].get("equityUsd") or 0) - float(era[i - 1].get("equityUsd") or 0))
        coll = float(era[i].get("collateralUsd") or 0)
        if abs(coll - prev_coll) > 1.0:
            frozen_coll = False
        prev_coll = coll
    if not frozen_coll or len(deltas) < min_run:
        return False
    tail = deltas[-min_run:]
    if not all(d > 0 for d in tail):
        return False
    spread = max(tail) - min(tail)
    return spread < 2.0 and tail[0] > 50


def build_hybrid_equity_row(
    day: str,
    *,
    lending_net: float,
    lp_liq: float,
    unclaimed: float,
    adjustment_usd: float,
    live_coll: float,
    live_debt: float,
) -> dict:
    """Component equity: lending_net + LP liquidity + manual adj + unclaimed fees."""
    equity = lending_net + lp_liq + adjustment_usd + unclaimed
    debt = live_debt
    coll = max(lending_net + debt, live_coll * 0.5)
    return {
        "timestamp": f"{day}T00:00:00.000Z",
        "collateralUsd": round(coll, 6),
        "debtUsd": round(debt, 6),
        "liquidityUsd": round(lp_liq, 6),
        "equityUsd": round(equity, 6),
        "dailyFeeIncomeUsd": 0.0,
    }


def rebuild_jupiter_era_snapshots(
    snapshots: list[dict],
    *,
    income_store: dict,
    lending_positions: list[dict],
    btc: dict[str, float],
    today: str,
    adjustment_usd: float = 800.0,
) -> list[dict]:
    """
    Rebuild Jun 16 .. yesterday from live lending + β×BTC + real LP snapshot liquidity.
    Skips if era already looks healthy (frozen append-only).
    """
    by_day = {_day(s): dict(s) for s in snapshots if _day(s)}
    era_days = sorted(d for d in by_day if JUPITER_ERA_START <= d < today)
    if not era_days:
        return snapshots

    era_rows = [by_day[d] for d in era_days]
    corrupt = any(is_corrupt_jupiter_era_row(by_day[d], d) for d in era_days)
    linear = is_synthetic_linear_equity_ramp(era_rows)
    if not corrupt and not linear:
        return snapshots

    live_coll = sum(float(p.get("collateralUsd") or 0) for p in lending_positions)
    live_debt = sum(float(p.get("borrowUsd") or 0) for p in lending_positions)
    live_net = live_coll - live_debt

    cal_start = JUPITER_ERA_START
    cal_end = today
    d_cur = date.fromisoformat(cal_start)
    d_end = date.fromisoformat(cal_end)
    cal_days: list[str] = []
    while d_cur <= d_end:
        cal_days.append(d_cur.isoformat())
        d_cur += timedelta(days=1)

    net_by_day = lending_net_backward_from_today(
        cal_days, btc, today=today, lending_net_today=live_net
    )

    for d in era_days:
        lp_liq, unc = lp_components_for_day(income_store, d)
        by_day[d] = build_hybrid_equity_row(
            d,
            lending_net=float(net_by_day.get(d, live_net)),
            lp_liq=lp_liq,
            unclaimed=unc,
            adjustment_usd=adjustment_usd,
            live_coll=live_coll,
            live_debt=live_debt,
        )

    return [_row_with_ts(by_day[d], d) for d in sorted(by_day) if d in by_day]


def merge_append_only_equity_rows(
    prev_rows: list[dict],
    new_rows: list[dict],
    today: str,
) -> list[dict]:
    """Keep all past days from prev_rows; only add missing days or update today."""
    prev_by_day = {_day(s): dict(s) for s in prev_rows if _day(s)}
    new_by_day = {_day(s): dict(s) for s in new_rows if _day(s)}
    if not prev_by_day:
        return sorted(new_by_day.values(), key=_day)

    out_by_day = dict(prev_by_day)
    for d in sorted(new_by_day):
        if d > today:
            continue
        if d not in out_by_day:
            out_by_day[d] = new_by_day[d]
        elif d == today:
            out_by_day[d] = new_by_day[d]

    return [_row_with_ts(out_by_day[d], d) for d in sorted(out_by_day) if d <= today]


def merge_append_only_yield(
    prev: dict[str, float],
    new: dict[str, float],
    today: str,
    *,
    backfill_days: set[str] | None = None,
) -> dict[str, float]:
    """Past yield frozen; append missing, refresh today, overwrite stale-gap backfill days."""
    out = {str(k)[:10]: float(v) for k, v in prev.items()}
    backfill = backfill_days or set()
    for d, v in new.items():
        ds = str(d)[:10]
        if ds > today:
            continue
        if ds not in out or ds == today or ds in backfill:
            out[ds] = float(v)
    return dict(sorted(out.items()))


def equity_history_from_snapshots(snapshots: list[dict]) -> dict[str, dict[str, float]]:
    out: dict[str, dict[str, float]] = {}
    for s in snapshots:
        d = _day(s)
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


def daily_yield_series_from_map(
    snapshots: list[dict],
    yield_by_day: dict[str, float],
    *,
    max_apr: float = 55.0,
) -> list[float]:
    out: list[float] = []
    for s in snapshots:
        d = _day(s)
        v = min(max(float(yield_by_day.get(d, 0) or 0), 0.0), max_apr)
        out.append(round(v, 6))
    return out
