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

    as_of_day = (
        as_of_day or str(snapshots[-1].get("timestamp", ""))[:10]
    ) or date.today().isoformat()
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


def _income_from_known_snapshots(
    by_day_store: dict[str, dict], through_day: str
) -> dict[str, float]:
    """Дневной доход между реальными (не stale) снимками store."""
    known = sorted(d for d in by_day_store if d <= through_day)
    income: dict[str, float] = {}
    for k in range(1, len(known)):
        d0, d1 = known[k - 1], known[k]
        t0 = float((by_day_store[d0].get("totalCumulativeUsd") or 0))
        t1 = float((by_day_store[d1].get("totalCumulativeUsd") or 0))
        if abs(t1 - t0) < 1e-6:
            continue
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


def find_stale_snapshot_runs(
    by_day_store: dict[str, dict],
    *,
    min_run: int = 2,
) -> list[tuple[str, str]]:
    """
    Периоды, где PA копировал одинаковый cumulative (нет обновления таблицы).
    Возвращает [(gap_start, gap_end), ...] — inclusive.
    """
    days = sorted(by_day_store)
    runs: list[tuple[str, str]] = []
    i = 1
    while i < len(days):
        t_prev = float(by_day_store[days[i - 1]].get("totalCumulativeUsd") or 0)
        t_cur = float(by_day_store[days[i]].get("totalCumulativeUsd") or 0)
        if abs(t_cur - t_prev) >= 0.001:
            i += 1
            continue
        gap_start = days[i]
        j = i
        while j + 1 < len(days):
            t_j = float(by_day_store[days[j]].get("totalCumulativeUsd") or 0)
            t_n = float(by_day_store[days[j + 1]].get("totalCumulativeUsd") or 0)
            if abs(t_n - t_j) >= 0.001:
                break
            j += 1
        if j - i + 1 >= min_run:
            runs.append((gap_start, days[j]))
        i = j + 1
    return runs


def _avg_recent_daily_income(
    income_by_day: dict[str, float], before_day: str, *, lookback: int = 7
) -> float:
    vals = [float(v) for d, v in income_by_day.items() if d < before_day and float(v) > 0]
    if not vals:
        return 0.0
    tail = vals[-lookback:]
    return sum(tail) / len(tail) if tail else 0.0


def _earliest_open_day(positions: list[dict]) -> str:
    days: list[str] = []
    for p in positions:
        od = _parse_opened_day(str(p.get("openedAt") or ""))
        if od:
            days.append(od)
    return min(days) if days else ""


def find_calendar_gaps_in_store(
    by_day_store: dict[str, dict],
    *,
    max_gap: int = 14,
    earliest_day: str = "2026-07-01",
) -> list[tuple[str, str]]:
    """Дни между снимками store, для которых нет записи (после prune stale)."""
    gaps: list[tuple[str, str]] = []
    days = sorted(by_day_store)
    for i in range(1, len(days)):
        try:
            d0 = date.fromisoformat(days[i - 1])
            d1 = date.fromisoformat(days[i])
        except ValueError:
            continue
        span = (d1 - d0).days
        if 1 < span <= max_gap:
            gap_start = (d0 + timedelta(days=1)).isoformat()
            gap_end = (d1 - timedelta(days=1)).isoformat()
            if gap_end >= earliest_day:
                gaps.append((max(gap_start, earliest_day), gap_end))
    return gaps


def refresh_income_store_and_backfill_gap(
    store: dict,
    live_positions: list[dict],
    *,
    through_day: str,
) -> tuple[dict[str, float], set[str]]:
    """
    1) Обновляет снимок на through_day из live sheet.
    2) Удаляет stale-копии (одинаковый cumulative).
    3) Равномерно распределяет доход за пропущенную неделю по дням графика.
    Возвращает (income_by_day, backfill_days для перезаписи APR).
    """
    by_day: dict[str, dict] = store.setdefault("byDay", {})
    live_snap = snapshot_from_positions(live_positions)
    live_total = round(sum(r["cumulativeUsd"] for r in live_snap.values()), 4)
    by_day[through_day] = {
        "positions": live_snap,
        "totalCumulativeUsd": live_total,
        "savedAt": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    stale_runs = find_stale_snapshot_runs(by_day)
    stale_runs.extend(find_calendar_gaps_in_store(by_day))
    # dedupe overlapping runs
    merged_runs: list[tuple[str, str]] = []
    for gap_start, gap_end in sorted(stale_runs):
        if merged_runs and gap_start <= merged_runs[-1][1]:
            prev_s, prev_e = merged_runs[-1]
            merged_runs[-1] = (prev_s, max(prev_e, gap_end))
        else:
            merged_runs.append((gap_start, gap_end))
    stale_runs = merged_runs

    backfill_days: set[str] = set()
    for gap_start, gap_end in stale_runs:
        for d in list(by_day):
            if gap_start <= d <= gap_end and d != through_day:
                backfill_days.add(d)
                by_day.pop(d, None)

    income = _income_from_known_snapshots(by_day, through_day)

    for gap_start, gap_end in stale_runs:
        sorted_days = sorted(by_day)
        anchor_day = max((d for d in sorted_days if d < gap_start), default="")

        if not anchor_day:
            continue

        try:
            d0 = date.fromisoformat(gap_start)
            d1 = date.fromisoformat(gap_end)
        except ValueError:
            continue
        gap_days_list: list[str] = []
        d_cur = d0
        while d_cur <= d1:
            gap_days_list.append(d_cur.isoformat())
            d_cur += timedelta(days=1)

        pool_change = _earliest_open_day(live_positions)
        pre_gap_avg = _avg_recent_daily_income(income, gap_start, lookback=7)
        if pre_gap_avg <= 0:
            pre_gap_avg = 5.0

        new_pool_cum = sum(
            position_cumulative_usd(p) for p in live_positions if p.get("isActive", True)
        )
        post_days: list[str] = []
        pre_days: list[str] = []
        for d in gap_days_list:
            if pool_change and d >= pool_change:
                post_days.append(d)
            else:
                pre_days.append(d)

        if post_days:
            try:
                open_d = date.fromisoformat(pool_change)
                post_span = max((date.fromisoformat(through_day) - open_d).days + 1, 1)
            except ValueError:
                post_span = max(len(post_days), 1)
            post_daily = new_pool_cum / post_span
        else:
            post_daily = 0.0

        for d in pre_days:
            income[d] = round(pre_gap_avg, 6)
            backfill_days.add(d)
        for d in post_days:
            income[d] = round(max(post_daily, pre_gap_avg * 0.5), 6)
            backfill_days.add(d)

        if through_day not in income or income.get(through_day, 0) <= 0:
            if post_daily > 0:
                income[through_day] = round(post_daily, 6)
            else:
                income[through_day] = round(pre_gap_avg, 6)
            backfill_days.add(through_day)

        if (
            gap_start <= through_day <= gap_end
            and through_day not in post_days
            and through_day not in pre_days
        ):
            if post_daily > 0 and pool_change and through_day >= pool_change:
                income[through_day] = round(post_daily, 6)
            elif pre_gap_avg > 0:
                income[through_day] = round(pre_gap_avg, 6)
            backfill_days.add(through_day)

        print(
            f"[OK] income gap backfill {gap_start}..{gap_end}: "
            f"pre={len(pre_days)}d×${pre_gap_avg:.2f}, "
            f"post={len(post_days)}d×${post_daily:.2f}, "
            f"pool_change={pool_change or 'n/a'}"
        )

    pool_change = _earliest_open_day(live_positions)
    new_pool_cum = sum(
        position_cumulative_usd(p) for p in live_positions if p.get("isActive", True)
    )
    if pool_change and through_day >= pool_change and new_pool_cum > 0:
        try:
            post_span = max(
                (date.fromisoformat(through_day) - date.fromisoformat(pool_change)).days + 1,
                1,
            )
        except ValueError:
            post_span = 1
        income[through_day] = round(new_pool_cum / post_span, 6)
        backfill_days.add(through_day)

    save_income_store(store)
    return income, backfill_days


def income_by_day_from_store(store: dict, through_day: str) -> dict[str, float]:
    """Публичная обёртка для enrich/export."""
    return _income_from_known_snapshots(store.get("byDay") or {}, through_day)


def apr_from_snapshot_row(s: dict, *, max_apr: float = 120.0) -> float:
    liq = float(s.get("liquidityUsd") or 0.0)
    fee = float(s.get("dailyFeeIncomeUsd") or 0.0)
    if liq <= 0 or fee <= 0:
        return 0.0
    return min((fee / liq) * 365.0 * 100.0, max_apr)
