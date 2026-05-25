"""
Снимки накопленного дохода LP (комиссии + инсентивы) — как lp-position-store.js в Portfolio Tracker.
Дневной доход = сумма приростов по позициям; APR = (доход / ликвидность) × 365 × 100.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from pathlib import Path

STORE_PATH = Path("data/lp-income-snapshots.json")


def position_store_key(p: dict) -> str:
    pid = str(p.get("positionId") or "").strip()
    if pid:
        return pid
    link = str(p.get("link") or "").strip()
    pair = str(p.get("pair") or "").strip()
    chain = str(p.get("chain") or "").strip()
    return f"{pair}|{chain}|{link}"


def position_cumulative_usd(p: dict) -> float:
    return float(p.get("feesUsd") or 0.0) + float(p.get("incentivesUsd") or 0.0)


def snapshot_from_positions(positions: list[dict]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for p in positions:
        if not p.get("isActive", True):
            continue
        key = position_store_key(p)
        if not key:
            continue
        out[key] = {
            "feesUsd": round(float(p.get("feesUsd") or 0.0), 6),
            "incentivesUsd": round(float(p.get("incentivesUsd") or 0.0), 6),
            "cumulativeUsd": round(position_cumulative_usd(p), 6),
            "valueUsd": round(float(p.get("valueUsd") or 0.0), 4),
            "openedAt": str(p.get("openedAt") or ""),
        }
    return out


def load_income_store() -> dict:
    if not STORE_PATH.exists():
        return {"v": 1, "byDay": {}}
    try:
        raw = json.loads(STORE_PATH.read_text(encoding="utf-8"))
        return {"v": 1, "byDay": dict(raw.get("byDay") or {})}
    except Exception:
        return {"v": 1, "byDay": {}}


def save_income_store(store: dict) -> None:
    STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STORE_PATH.write_text(json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8")


def _parse_opened_day(opened_at: str) -> str:
    s = (opened_at or "").strip()
    if not s:
        return ""
    for fmt in ("%d.%m.%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s[:10] if fmt == "%Y-%m-%d" else s, fmt).date().isoformat()
        except ValueError:
            continue
    return ""


def delta_income_between_snapshots(
    prev: dict[str, dict],
    cur: dict[str, dict],
    *,
    as_of_day: str,
    calendar_days: int,
) -> tuple[float, dict]:
    """
    Прирост USD за период между двумя снимками.
    Новая позиция: весь cumulative / дни с открытия (мин. 1).
    """
    total = 0.0
    details: dict[str, float] = {}
    days_span = max(calendar_days, 1)
    as_of = date.fromisoformat(as_of_day)

    for key, row in cur.items():
        cum = float(row.get("cumulativeUsd") or 0.0)
        prev_row = prev.get(key)
        if prev_row is None:
            opened = _parse_opened_day(str(row.get("openedAt") or ""))
            if opened:
                try:
                    d0 = date.fromisoformat(opened)
                    hold_days = max((as_of - d0).days, 1)
                except ValueError:
                    hold_days = days_span
            else:
                hold_days = days_span
            inc = cum / max(hold_days, 1) * min(days_span, hold_days)
            if inc > 0:
                total += inc
                details[key] = round(inc, 6)
            continue
        prev_cum = float(prev_row.get("cumulativeUsd") or 0.0)
        delta = cum - prev_cum
        if delta > 0:
            total += delta
            details[key] = round(delta, 6)
    return total, details


def fill_daily_income_on_snapshots(
    snapshots: list[dict],
    positions: list[dict],
    *,
    as_of_day: str | None = None,
) -> tuple[list[dict], dict[str, float]]:
    """
    Проставляет dailyFeeIncomeUsd по цепочке снимков в data/lp-income-snapshots.json.
    Возвращает (snapshots, incomeByDay).
    """
    if not snapshots:
        return snapshots, {}

    as_of_day = (as_of_day or str(snapshots[-1].get("timestamp", ""))[:10]) or date.today().isoformat()
    store = load_income_store()
    by_day_store: dict[str, dict] = store["byDay"]

    cur_snap = snapshot_from_positions(positions)
    by_day_store[as_of_day] = {
        "positions": cur_snap,
        "totalCumulativeUsd": round(sum(r["cumulativeUsd"] for r in cur_snap.values()), 4),
        "savedAt": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    save_income_store(store)

    dates = [str(s.get("timestamp", ""))[:10] for s in snapshots]
    income_by_day: dict[str, float] = {}

    known_days = sorted(d for d in by_day_store.keys() if d <= as_of_day)
    if not known_days:
        return snapshots, income_by_day

    # Между известными датами снимков — равномерно делим дельту cumulative
    for k in range(1, len(known_days)):
        d0, d1 = known_days[k - 1], known_days[k]
        snap0 = by_day_store[d0].get("positions") or {}
        snap1 = by_day_store[d1].get("positions") or {}
        try:
            gap_cal = (date.fromisoformat(d1) - date.fromisoformat(d0)).days
        except ValueError:
            gap_cal = 1
        if gap_cal <= 0:
            continue
        period_income, _ = delta_income_between_snapshots(
            snap0, snap1, as_of_day=d1, calendar_days=gap_cal
        )
        per_day = period_income / gap_cal if gap_cal else 0.0
        d_cur = date.fromisoformat(d0) + timedelta(days=1)
        d_end = date.fromisoformat(d1)
        while d_cur <= d_end:
            ds = d_cur.isoformat()
            income_by_day[ds] = income_by_day.get(ds, 0.0) + per_day
            d_cur += timedelta(days=1)

    out_snaps = [dict(s) for s in snapshots]
    for i, s in enumerate(out_snaps):
        d = dates[i]
        if d in income_by_day and income_by_day[d] > 0:
            s["dailyFeeIncomeUsd"] = round(income_by_day[d], 6)

    # Соседние календарные дни в snapshots: доход = разница cumulative store по ближайшим снимкам
    for i in range(1, len(out_snaps)):
        d = dates[i]
        d_prev = dates[i - 1]
        if float(out_snaps[i].get("dailyFeeIncomeUsd") or 0) > 0:
            continue
        if d in by_day_store and d_prev in by_day_store:
            inc, _ = delta_income_between_snapshots(
                by_day_store[d_prev]["positions"],
                by_day_store[d]["positions"],
                as_of_day=d,
                calendar_days=max(
                    1,
                    (date.fromisoformat(d) - date.fromisoformat(d_prev)).days,
                ),
            )
            if inc > 0:
                out_snaps[i]["dailyFeeIncomeUsd"] = round(inc, 6)
                income_by_day[d] = inc

    return out_snaps, income_by_day


def apr_from_snapshot_row(s: dict, *, max_apr: float = 120.0) -> float:
    liq = float(s.get("liquidityUsd") or 0.0)
    fee = float(s.get("dailyFeeIncomeUsd") or 0.0)
    if liq <= 0 or fee <= 0:
        return 0.0
    return min((fee / liq) * 365.0 * 100.0, max_apr)
