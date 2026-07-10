#!/usr/bin/env python3
"""
Ежедневное дотягивание графиков: append-only история.
Прошлые дни заморожены; пересчитывается только сегодня (+ одноразовое заполнение пропусков).
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "python") not in sys.path:
    sys.path.insert(0, str(ROOT / "python"))

from chart_frozen_history import (  # noqa: E402
    daily_yield_series_from_map,
    equity_history_from_snapshots,
    fetch_btc_by_day,
    merge_append_only_equity_rows,
    merge_append_only_yield,
    rebuild_jupiter_era_snapshots,
)
from jupiter_lend import (  # noqa: E402
    fetch_jupiter_lending_positions,
    load_config as load_portfolio_config,
    merge_live_lending,
)
from lp_income_snapshots import (  # noqa: E402
    apr_from_snapshot_row,
    delta_income_between_snapshots,
    load_income_store,
    save_income_store,
    snapshot_from_positions,
)

DATA_JS = ROOT / "data" / "portfolio-data.js"
YIELD_REF_PATH = ROOT / "data/chart-yield-reference.json"
BTC_CACHE = ROOT / "data/btc-daily-prices.json"
PREFIX = "window.PORTFOLIO_DATA = "
YIELD_CUT_DAY = "2026-05-26"
MAX_CHART_APR = 55.0

LP_SHEETS_API = (
    "https://defilabsvipnavigator.vercel.app/api/public-portfolio-lp"
    "?sheetId={sheet_id}&sheetName={sheet_name}"
)
DEFAULT_SHEET_ID = "1yq5nbZ-fws8o9C0PCZWjlZjxUqZs60E4hfPiI7L0GD8"
DEFAULT_WALLET = "0x1fb07ac5643428710ee3bf5a73a4a66d0762f355"


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


def _parse_money(raw) -> float:
    if isinstance(raw, (int, float)) and raw == raw:
        return float(raw)
    s = str(raw or "").strip().replace("\u00a0", "").replace(" ", "")
    if not s:
        return 0.0
    if s.count(",") == 1 and s.count(".") == 0:
        s = s.replace(",", ".")
    elif s.count(",") and s.count("."):
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    try:
        return float(s)
    except ValueError:
        return 0.0


def _col_index(headers: list[str], *names: str) -> int:
    for n in names:
        if n in headers:
            return headers.index(n)
    low_names = [str(n).lower() for n in names if n]
    for i, h in enumerate(headers):
        hl = str(h or "").strip().lower()
        if hl in low_names:
            return i
    return -1


def fetch_active_lp_positions(payload: dict) -> list[dict]:
    sheet_id = str(payload.get("googleSheetId") or DEFAULT_SHEET_ID).strip()
    sheet_name = str(payload.get("publicPortfolioSheetName") or "Public portfolio").strip()
    wallet = str(payload.get("portfolioWallet") or DEFAULT_WALLET).strip().lower()
    url = LP_SHEETS_API.format(
        sheet_id=urllib.parse.quote(sheet_id, safe=""),
        sheet_name=urllib.parse.quote(sheet_name, safe=""),
    )
    with urllib.request.urlopen(url, timeout=45) as res:
        body = json.loads(res.read().decode())
    headers = [str(h or "").strip() for h in body.get("headers") or []]
    if not headers:
        return []

    def col_idx(*names: str) -> int:
        return _col_index(headers, *names)

    out: list[dict] = []
    for row in body.get("rows") or []:
        cells = row.get("cells") or []

        def cell_at(i: int) -> str:
            return str(cells[i] if 0 <= i < len(cells) else "").strip()

        wi = col_idx("owner_wallet", "H")
        if wi >= 0:
            w = cell_at(wi).lower()
            if wallet and wallet not in w:
                continue

        closed = cell_at(col_idx("Дата закрытия", "J"))
        if closed and closed.lower() not in ("", "null", "none", "-"):
            continue

        g_idx = col_idx("Ком. доход (ИТОГО $)", "G")
        q_idx = col_idx("Incentives, $", "Q")
        o_idx = col_idx("Стоимость позиции, USD", "O")
        fees = _parse_money(cells[g_idx] if g_idx >= 0 else 0)
        inc = _parse_money(cells[q_idx] if q_idx >= 0 else 0)
        val = _parse_money(cells[o_idx] if o_idx >= 0 else 0)
        nft = cell_at(col_idx("NFT_ID", "C"))
        out.append(
            {
                "platform": cell_at(col_idx("Exchange", "F")),
                "chain": cell_at(col_idx("network", "M")),
                "pair": cell_at(col_idx("Пара", "R")),
                "positionId": nft,
                "feesUsd": fees,
                "incentivesUsd": inc,
                "valueUsd": val,
                "openedAt": cell_at(col_idx("Дата открытия", "I")),
                "isActive": True,
            }
        )
    return out


def refresh_income_snapshot_from_sheet(today: str, payload: dict) -> bool:
    """Сохраняет снимок cumulative LP-дохода (комиссии + incentives) на сегодня."""
    try:
        positions = fetch_active_lp_positions(payload)
        if not positions:
            return False
        store = load_income_store()
        snap = snapshot_from_positions(positions)
        store.setdefault("byDay", {})[today] = {
            "positions": snap,
            "totalCumulativeUsd": round(sum(r["cumulativeUsd"] for r in snap.values()), 4),
            "savedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        save_income_store(store)
        print(f"[OK] LP income snapshot {today}: {len(snap)} positions", file=sys.stderr)
        return True
    except Exception as e:
        print(f"[WARN] LP income snapshot refresh skipped: {e}", file=sys.stderr)
        try:
            from export_static_data import load_liquidity_positions_from_sheet

            config = load_portfolio_config()
            positions = load_liquidity_positions_from_sheet(config)
            if not positions:
                return False
            store = load_income_store()
            snap = snapshot_from_positions(positions)
            store.setdefault("byDay", {})[today] = {
                "positions": snap,
                "totalCumulativeUsd": round(sum(r["cumulativeUsd"] for r in snap.values()), 4),
                "savedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
            save_income_store(store)
            return True
        except Exception as e2:
            print(f"[WARN] local sheet fallback failed: {e2}", file=sys.stderr)
            return False


def income_by_day_from_store(store: dict, through_day: str) -> dict[str, float]:
    from datetime import date, timedelta

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


def compute_today_snapshot(
    payload: dict,
    lending_positions: list[dict],
    lp_positions: list[dict],
    today: str,
    income_by_day: dict[str, float],
) -> dict:
    coll = sum(float(p.get("collateralUsd") or 0) for p in lending_positions)
    debt = sum(float(p.get("borrowUsd") or 0) for p in lending_positions)
    liq = sum(float(p.get("valueUsd") or 0) for p in lp_positions)
    unclaimed = sum(
        float(p.get("feesUsd") or 0) + float(p.get("incentivesUsd") or 0) for p in lp_positions
    )
    adj = float(payload.get("manualVisualAdjustmentUsd") or 800.0)
    equity = coll - debt + liq + adj + unclaimed
    fee_today = float(income_by_day.get(today) or 0)
    payload["openLiquidityUnclaimedUsd"] = round(unclaimed, 2)
    payload["liveCapitalBaseUsd"] = round(coll - debt + liq, 2)
    payload["currentCapitalUsd"] = round(equity, 2)
    return {
        "timestamp": f"{today}T00:00:00.000Z",
        "collateralUsd": round(coll, 6),
        "debtUsd": round(debt, 6),
        "liquidityUsd": round(liq, 6),
        "equityUsd": round(equity, 6),
        "dailyFeeIncomeUsd": round(fee_today, 6),
    }


def build_yield_for_day(
    day: str,
    snap: dict,
    income_by_day: dict[str, float],
) -> float:
    if day < YIELD_CUT_DAY:
        return 0.0
    row = dict(snap)
    if day in income_by_day and income_by_day[day] > 0:
        row["dailyFeeIncomeUsd"] = income_by_day[day]
    return round(apr_from_snapshot_row(row, max_apr=MAX_CHART_APR), 6)


def enrich_tail(payload: dict, today: str) -> dict:
    prev_snaps = [dict(s) for s in (payload.get("snapshots") or [])]
    if not prev_snaps:
        raise SystemExit("No snapshots")

    refresh_income_snapshot_from_sheet(today, payload)

    config = load_portfolio_config()
    jupiter = fetch_jupiter_lending_positions(config)
    stale_evm = [
        p
        for p in (payload.get("lendingPositions") or [])
        if str(p.get("chain") or "").lower() != "solana"
    ]
    lending = merge_live_lending(jupiter, stale_evm)
    payload["lendingPositions"] = lending

    lp_positions = fetch_active_lp_positions(payload)
    income_store = load_income_store()
    income_by_day = income_by_day_from_store(income_store, today)

    today_row = compute_today_snapshot(payload, lending, lp_positions, today, income_by_day)

    adj = float(payload.get("manualVisualAdjustmentUsd") or 800.0)
    btc = fetch_btc_by_day("2026-06-14", today, BTC_CACHE)

    # One-time heal: Jun 16+ broken rows (Jupiter dip / fake linear ramp) → hybrid model
    healed = rebuild_jupiter_era_snapshots(
        prev_snaps,
        income_store=income_store,
        lending_positions=lending,
        btc=btc,
        today=today,
        adjustment_usd=adj,
    )

    # Append-only: freeze all past days, only update today
    merged = merge_append_only_equity_rows(healed, [today_row], today)

    # Daily fee income on frozen days (does not change equityUsd)
    for s in merged:
        d = str(s.get("timestamp", ""))[:10]
        if d in income_by_day and income_by_day[d] > 0:
            s["dailyFeeIncomeUsd"] = round(income_by_day[d], 6)

    # Yield: append-only reference
    ref_old = load_yield_ref()
    new_yield: dict[str, float] = {}
    for s in merged:
        d = str(s.get("timestamp", ""))[:10]
        if not d or d < YIELD_CUT_DAY:
            continue
        apr = build_yield_for_day(d, s, income_by_day)
        new_yield[d] = apr

    chart_yield = merge_append_only_yield(ref_old, new_yield, today)
    # Pre-cut days from legacy ref only
    chart_yield = {d: v for d, v in chart_yield.items() if d >= YIELD_CUT_DAY or d in ref_old}
    for d, v in ref_old.items():
        if d < YIELD_CUT_DAY:
            chart_yield[d] = v

    daily_yield_series = daily_yield_series_from_map(merged, chart_yield, max_apr=MAX_CHART_APR)

    payload["snapshots"] = merged
    payload["equityHistoryByDay"] = equity_history_from_snapshots(merged)
    payload["chartYieldByDay"] = chart_yield
    payload["dailyYieldSeries"] = daily_yield_series
    payload["exportedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload["manualVisualAdjustmentUsd"] = float(payload.get("manualVisualAdjustmentUsd") or 800.0)
    payload["jupiterLendSyncedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    save_yield_ref(chart_yield)
    return payload


def main() -> None:
    today = datetime.now(timezone.utc).date().isoformat()
    payload = load_portfolio()
    before_last = (
        (payload.get("snapshots") or [])[-1]["timestamp"][:10] if payload.get("snapshots") else "?"
    )
    enrich_tail(payload, today)
    after_last = payload["snapshots"][-1]["timestamp"][:10]
    y_last = (
        list((payload.get("chartYieldByDay") or {}).items())[-1]
        if payload.get("chartYieldByDay")
        else ("", 0)
    )
    print(
        f"[OK] portfolio tail (append-only): last {before_last}->{after_last}, "
        f"capital={payload.get('currentCapitalUsd', 0):.0f}, "
        f"lending={len(payload.get('lendingPositions') or [])}, "
        f"adj={payload['manualVisualAdjustmentUsd']:.0f}, "
        f"yield[{y_last[0]}]={y_last[1]:.2f}%"
    )
    save_portfolio(payload)


if __name__ == "__main__":
    main()
