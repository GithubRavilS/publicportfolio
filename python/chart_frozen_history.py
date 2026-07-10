"""Append-only frozen daily chart history (equity + yield). Past days never change."""

from __future__ import annotations

from datetime import date, timedelta


def _day(s: dict | str) -> str:
    if isinstance(s, dict):
        return str(s.get("timestamp", ""))[:10]
    return str(s)[:10]


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


def fill_equity_gap_with_interpolation(
    rows: list[dict],
    today: str,
    today_row: dict,
) -> list[dict]:
    """
    If calendar days are missing between last recorded day and today,
    insert one-time linear interpolation (not flat plateau + cliff).
    """
    by_day = {_day(s): dict(s) for s in rows if _day(s)}
    if not by_day:
        by_day[today] = dict(today_row)
        return [_row_with_ts(by_day[today], today)]

    last_day = max(d for d in by_day if d < today) if any(d < today for d in by_day) else None
    if not last_day:
        by_day[today] = dict(today_row)
        return [_row_with_ts(by_day[d], d) for d in sorted(by_day)]

    try:
        d0 = date.fromisoformat(last_day)
        d1 = date.fromisoformat(today)
    except ValueError:
        by_day[today] = dict(today_row)
        return [_row_with_ts(by_day[d], d) for d in sorted(by_day)]

    gap = (d1 - d0).days
    if gap <= 1:
        by_day[today] = dict(today_row)
        return [_row_with_ts(by_day[d], d) for d in sorted(by_day)]

    start_eq = float(by_day[last_day].get("equityUsd") or 0)
    end_eq = float(today_row.get("equityUsd") or 0)
    start_coll = float(by_day[last_day].get("collateralUsd") or 0)
    end_coll = float(today_row.get("collateralUsd") or 0)
    start_debt = float(by_day[last_day].get("debtUsd") or 0)
    end_debt = float(today_row.get("debtUsd") or 0)
    start_liq = float(by_day[last_day].get("liquidityUsd") or 0)
    end_liq = float(today_row.get("liquidityUsd") or 0)

    for i in range(1, gap):
        ds = (d0 + timedelta(days=i)).isoformat()
        if ds in by_day:
            continue
        t = i / gap
        by_day[ds] = {
            "timestamp": f"{ds}T00:00:00.000Z",
            "equityUsd": round(start_eq + (end_eq - start_eq) * t, 6),
            "collateralUsd": round(start_coll + (end_coll - start_coll) * t, 6),
            "debtUsd": round(start_debt + (end_debt - start_debt) * t, 6),
            "liquidityUsd": round(start_liq + (end_liq - start_liq) * t, 6),
            "dailyFeeIncomeUsd": 0.0,
        }

    by_day[today] = dict(today_row)
    return [_row_with_ts(by_day[d], d) for d in sorted(by_day) if d <= today]


def merge_append_only_yield(
    prev: dict[str, float],
    new: dict[str, float],
    today: str,
) -> dict[str, float]:
    """Past yield days are frozen; only append missing days or refresh today."""
    out = {str(k)[:10]: float(v) for k, v in prev.items()}
    for d, v in new.items():
        ds = str(d)[:10]
        if ds > today:
            continue
        if ds not in out or ds == today:
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


def _row_with_ts(row: dict, day: str) -> dict:
    out = dict(row)
    out["timestamp"] = f"{day}T00:00:00.000Z"
    return out


def repair_flat_equity_plateau(rows: list[dict], today: str, *, min_run: int = 4) -> list[dict]:
    """
    One-time heal: flat equity plateau (stale PA copy) followed by a large jump.
    Smooth interpolation across the plateau up to the jump day.
    """
    if len(rows) < min_run + 2:
        return rows
    by_day = {_day(s): dict(s) for s in rows if _day(s)}
    days = sorted(by_day)
    if today not in days:
        return rows

    i = 0
    changed = False
    while i < len(days):
        j = i
        eq0 = float(by_day[days[i]].get("equityUsd") or 0)
        while j + 1 < len(days) and float(by_day[days[j + 1]].get("equityUsd") or 0) == eq0:
            j += 1
        run_len = j - i + 1
        if run_len >= min_run and j + 1 < len(days):
            next_eq = float(by_day[days[j + 1]].get("equityUsd") or 0)
            if abs(next_eq - eq0) > max(500, eq0 * 0.03):
                anchor_day = days[i - 1] if i > 0 else days[i]
                end_day = days[j + 1]
                start_eq = float(by_day[anchor_day].get("equityUsd") or 0)
                end_eq = next_eq
                try:
                    d0 = date.fromisoformat(anchor_day)
                    d1 = date.fromisoformat(end_day)
                except ValueError:
                    i = j + 1
                    continue
                total = (d1 - d0).days
                if total > 1:
                    for step in range(1, total):
                        ds = (d0 + timedelta(days=step)).isoformat()
                        if ds not in by_day:
                            continue
                        t = step / total
                        row = dict(by_day[ds])
                        row["equityUsd"] = round(start_eq + (end_eq - start_eq) * t, 6)
                        by_day[ds] = row
                        changed = True
                i = j + 2
                continue
        i = j + 1

    if not changed:
        return rows
    return [_row_with_ts(by_day[d], d) for d in sorted(by_day)]


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
