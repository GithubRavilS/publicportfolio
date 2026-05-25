#!/usr/bin/env python3
import csv
import json
import re
import sqlite3
import sys
from io import StringIO
from pathlib import Path
from datetime import date, datetime, timedelta, timezone
from collections.abc import Iterable

import requests

from lp_income_snapshots import apr_from_snapshot_row, fill_daily_income_on_snapshots


def parse_pct(value: str) -> float:
    s = (value or "").strip().replace("%", "").replace(",", ".")
    if not s:
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def parse_float(value: str) -> float:
    s = (value or "").strip()
    for ch in ("\u00a0", "\u202f", " "):
        s = s.replace(ch, "")
    if not s:
        return 0.0
    # locale-safe normalization:
    # "1,234.56" -> 1234.56
    # "1234,56"  -> 1234.56
    # "1.234,56" -> 1234.56
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s and "." not in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def parse_date(value: str) -> datetime | None:
    s = (value or "").strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s[:19], fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s.replace("Z", ""))
    except ValueError:
        return None


def excel_col_name(idx: int) -> str:
    n = idx + 1
    result = ""
    while n > 0:
        n, rem = divmod(n - 1, 26)
        result = chr(65 + rem) + result
    return result


def load_google_sheet_rows(sheet_id: str, gid: str) -> list[dict[str, str]]:
    if not sheet_id or not gid:
        return []
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}"
    res = requests.get(url, timeout=30)
    res.raise_for_status()
    raw_rows = list(csv.reader(StringIO(res.text)))
    if not raw_rows:
        return []
    headers = [str(x).strip() for x in raw_rows[0]]
    out: list[dict[str, str]] = []
    for row in raw_rows[1:]:
        item: dict[str, str] = {}
        for i, val in enumerate(row):
            col = excel_col_name(i)
            item[col] = val
            if i < len(headers) and headers[i]:
                item[headers[i]] = val
        out.append(item)
    return out


def load_google_sheet_rows_by_name(sheet_id: str, sheet_name: str) -> list[dict[str, str]]:
    if not sheet_id or not sheet_name:
        return []
    url = (
        f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq"
        f"?tqx=out:csv&sheet={requests.utils.quote(sheet_name)}"
    )
    res = requests.get(url, timeout=30)
    res.raise_for_status()
    raw_rows = list(csv.reader(StringIO(res.text)))
    if not raw_rows:
        return []
    headers = [str(x).strip() for x in raw_rows[0]]
    out: list[dict[str, str]] = []
    for row in raw_rows[1:]:
        item: dict[str, str] = {}
        for i, val in enumerate(row):
            col = excel_col_name(i)
            item[col] = val
            if i < len(headers) and headers[i]:
                item[headers[i]] = val
        out.append(item)
    return out


def month_key(date_iso: str) -> str:
    return date_iso[:7]


def fetch_eth_history(start_date: str, end_date: str) -> dict[str, float]:
    start_dt = datetime.fromisoformat(start_date)
    end_dt = datetime.fromisoformat(end_date)
    from_ts = int(start_dt.timestamp())
    to_ts = int(end_dt.timestamp())
    url = (
        f"https://api.coingecko.com/api/v3/coins/ethereum/market_chart/range"
        f"?vs_currency=usd&from={from_ts}&to={to_ts}"
    )
    res = requests.get(url, timeout=45)
    res.raise_for_status()
    out: dict[str, float] = {}
    for ts_ms, px in res.json().get("prices", []):
        out[datetime.utcfromtimestamp(ts_ms / 1000).date().isoformat()] = float(px)
    return out


def fetch_btc_history(start_date: str, end_date: str) -> dict[str, float]:
    start_dt = datetime.fromisoformat(start_date)
    end_dt = datetime.fromisoformat(end_date)
    from_ts = int(start_dt.timestamp())
    to_ts = int(end_dt.timestamp())
    url = (
        f"https://api.coingecko.com/api/v3/coins/bitcoin/market_chart/range"
        f"?vs_currency=usd&from={from_ts}&to={to_ts}"
    )
    res = requests.get(url, timeout=45)
    res.raise_for_status()
    out: dict[str, float] = {}
    for ts_ms, px in res.json().get("prices", []):
        out[datetime.utcfromtimestamp(ts_ms / 1000).date().isoformat()] = float(px)
    return out


def _btc_price_on(btc_by_day: dict[str, float], day: str) -> float:
    if day in btc_by_day and btc_by_day[day] > 0:
        return float(btc_by_day[day])
    known = sorted((d, p) for d, p in btc_by_day.items() if p > 0)
    if not known:
        return 0.0
    for d, p in reversed(known):
        if d <= day:
            return p
    return known[0][1]


def load_equity_reference_by_day() -> dict[str, dict]:
    by_day: dict[str, dict] = {}
    ref_path = Path("data/equity-history-reference.json")
    if ref_path.exists():
        try:
            payload = json.loads(ref_path.read_text(encoding="utf-8"))
            for d, snap in (payload.get("byDay") or {}).items():
                if snap:
                    by_day[str(d)[:10]] = dict(snap)
        except Exception:
            pass
    return by_day


def apply_snapshot_reference(snapshots: list[dict], ref_by_day: dict[str, dict]) -> list[dict]:
    """Восстанавливает капитал из эталона (до 18.05), не из битого portfolio-data.js на PA."""
    if not snapshots or not ref_by_day:
        return snapshots
    out: list[dict] = []
    for s in snapshots:
        d = str(s.get("timestamp", ""))[:10]
        row = dict(s)
        if d in ref_by_day:
            ref = ref_by_day[d]
            for k in ("equityUsd", "collateralUsd", "debtUsd", "liquidityUsd"):
                if k in ref and ref[k] is not None:
                    row[k] = float(ref[k])
        out.append(row)
    return out


def snapshots_from_equity_reference(
    ref_by_day: dict[str, dict],
    db_snapshots: list[dict],
    *,
    through_day: str | None = None,
) -> list[dict]:
    """
    Полный календарь: эталон — источник истины для каждого дня, DB/live только дополняет хвост.
    Иначе при дырах в daily_metrics (27.04 → 19.05) график «прыгает».
    """
    if not ref_by_day:
        return db_snapshots
    db_by_day = {str(s.get("timestamp", ""))[:10]: dict(s) for s in db_snapshots}
    end_day = through_day or max(
        max(ref_by_day.keys()),
        max(db_by_day.keys()) if db_by_day else max(ref_by_day.keys()),
    )
    start_day = min(min(ref_by_day.keys()), min(db_by_day.keys()) if db_by_day else min(ref_by_day.keys()))
    d_cur = datetime.strptime(start_day, "%Y-%m-%d").date()
    d_end = datetime.strptime(end_day, "%Y-%m-%d").date()
    out: list[dict] = []
    while d_cur <= d_end:
        ds = d_cur.isoformat()
        if ds in ref_by_day:
            row = dict(ref_by_day[ds])
        elif ds in db_by_day:
            row = dict(db_by_day[ds])
        else:
            d_cur += timedelta(days=1)
            continue
        row["timestamp"] = f"{ds}T00:00:00.000Z"
        row["equityUsd"] = float(row.get("equityUsd") or 0.0)
        row["collateralUsd"] = float(row.get("collateralUsd") or 0.0)
        row["debtUsd"] = float(row.get("debtUsd") or 0.0)
        row["liquidityUsd"] = float(row.get("liquidityUsd") or 0.0)
        row["dailyFeeIncomeUsd"] = float(row.get("dailyFeeIncomeUsd") or 0.0)
        out.append(row)
        d_cur += timedelta(days=1)
    return out


def equity_history_payload_from_snapshots(snapshots: list[dict]) -> dict[str, dict]:
    """equityHistoryByDay для фронта — после санитизации fee, не сырой эталон с rollup-скачками."""
    by_day: dict[str, dict] = {}
    for s in snapshots:
        d = str(s.get("timestamp", ""))[:10]
        if not d:
            continue
        by_day[d] = {
            "equityUsd": float(s.get("equityUsd") or 0.0),
            "collateralUsd": float(s.get("collateralUsd") or 0.0),
            "debtUsd": float(s.get("debtUsd") or 0.0),
            "liquidityUsd": float(s.get("liquidityUsd") or 0.0),
            "dailyFeeIncomeUsd": float(s.get("dailyFeeIncomeUsd") or 0.0),
        }
    return by_day


def forward_fill_equity_calendar_tail(
    snapshots: list[dict],
    anchor_day: str,
    ref_by_day: dict[str, dict],
) -> list[dict]:
    """Календарный хвост после anchor_day без привязки к BTC (не даёт ложных −$1000)."""
    anchor = ref_by_day.get(anchor_day)
    if not anchor or not snapshots:
        return snapshots
    by_day = {str(s["timestamp"])[:10]: dict(s) for s in snapshots}
    target_end = max(
        max(by_day.keys()),
        datetime.now(timezone.utc).strftime("%Y-%m-%d"),
    )
    if target_end <= anchor_day:
        return snapshots
    d_cur = datetime.strptime(anchor_day, "%Y-%m-%d").date()
    d_end = datetime.strptime(target_end, "%Y-%m-%d").date()
    last_row = dict(anchor)
    while d_cur <= d_end:
        ds = d_cur.isoformat()
        if ds in by_day:
            last_row = dict(by_day[ds])
        elif ds > anchor_day:
            filler = dict(last_row)
            filler["timestamp"] = f"{ds}T00:00:00.000Z"
            filler["dailyFeeIncomeUsd"] = 0.0
            by_day[ds] = filler
            last_row = filler
        d_cur += timedelta(days=1)
    return [by_day[k] for k in sorted(by_day.keys())]


def snapshots_already_rebased(snapshots: list[dict], initial_capital: float, tolerance: float = 80.0) -> bool:
    if not snapshots:
        return False
    return abs(float(snapshots[0].get("equityUsd") or 0.0) - float(initial_capital)) <= tolerance


def invested_usd_from_row(r: dict[str, str]) -> float:
    for col in ["AA", "AH", "AF", "AE", "AD", "AC"]:
        v = parse_float(r.get(col, ""))
        if v > 0:
            return v
    return 0.0


def normalize_closed_cell(raw: str) -> str:
    """Пустая строка = позиция не закрыта (по колонке даты/статуса)."""
    s = (raw or "").strip().replace("\xa0", " ")
    if not s:
        return ""
    low = s.lower()
    if low in ("null", "none", "n/a", "-", "false", "no", "0"):
        return ""
    return s


def liquidity_is_active_from_row(row: dict[str, str]) -> bool:
    oc = (row_get(row, "Open/Closed", "J") or "").strip().upper()
    if oc == "OPEN":
        return True
    if oc == "CLOSED":
        return False
    ia = (row.get("is_active") or "").strip().lower()
    if ia in ("true", "yes", "1", "да"):
        return True
    if ia in ("false", "no", "0", "нет"):
        return False
    closed_norm = normalize_closed_cell(
        row_get(row, "closed_at", "Дата закрытия норм", "X", "Дата закрытия")
    )
    return closed_norm == ""


def build_revert_link_from_row(row: dict[str, str]) -> str:
    chain = (row_get(row, "Сеть", "network", "BH") or "").strip().lower()
    platform = (row_get(row, "Платформа (DEX)", "Платформа", "exchange", "BI") or "").strip().lower()
    token_id = re.sub(r"\D", "", row_get(row, "NFT tokenId", "nft_id", "I", "BT") or "")
    if not chain or not token_id:
        return ""
    route = "uniswap-position"
    if "pancake" in platform:
        route = "pancakeswap-position"
    elif "aerodrome" in platform:
        route = "aerodrome-position"
    elif "velodrome" in platform:
        route = "velodrome-position"
    return f"https://revert.finance/#/{route}/{chain}/{token_id}"


def closed_display_from_row(row: dict[str, str], is_active: bool) -> str:
    if is_active:
        return ""
    raw = row_get(row, "Дата закрытия норм", "closed_at", "X").strip()
    if not raw:
        return ""
    return raw if normalize_closed_cell(raw) else ""


def apr_percent_from_cell(raw: str) -> float:
    """APR в процентах: из ячейки с % или из доли (<3 считаем долей от 1)."""
    s = (raw or "").strip()
    if not s:
        return 0.0
    p = parse_pct(s)
    if p <= 0:
        return 0.0
    if "%" in s or p >= 3.0:
        return min(p, 500.0)
    return min(p * 100.0, 500.0)


def fee_apy_percent_from_public_row(row: dict[str, str]) -> float:
    """Доходность с листа: только колонка Fee APY (по имени, не по букве)."""
    raw = (row.get("Fee APY") or "").strip()
    if not raw or raw in ("-", "—", "0"):
        return 0.0
    return apr_percent_from_cell(raw)


def active_apr_from_public_row(row: dict[str, str]) -> float:
    return fee_apy_percent_from_public_row(row)


def fees_usd_public_row(row: dict[str, str]) -> float:
    for key in ("Заработано комиссий всего, USD", "Заработано комиссий итого", "fees_value", "AG"):
        v = parse_float(row_get(row, key))
        if v > 0:
            return v
    pending = parse_float(row_get(row, "Комиссии pending, USD", "R"))
    claimed = parse_float(row_get(row, "Комиссии claimed, USD", "S"))
    return pending + claimed


def incentives_usd_public_row(row: dict[str, str]) -> tuple[float, str]:
    pending = parse_float(row_get(row, "Инцентив: pending, USD"))
    claimed = parse_float(row_get(row, "Инцентив: claimed, USD"))
    total = pending + claimed
    if total <= 0:
        return 0.0, ""
    token = str(row_get(row, "Инцентив: токен")).strip()
    low = token.lower()
    if "cake" in low:
        label = "Cake"
    elif "aira" in low:
        label = "Aira"
    else:
        label = token or "Incentive"
    return total, label


def days_held_since_open(opened_at: str, as_of: date) -> float:
    opened = parse_date(opened_at)
    if not opened:
        return 1.0
    days = (as_of - opened.date()).days
    return max(float(days), 1.0)


MAX_CHART_DAILY_APR_PCT = 55.0


def max_daily_fee_usd_for_liquidity(liquidity_usd: float, *, max_apr: float = MAX_CHART_DAILY_APR_PCT) -> float:
    liq = float(liquidity_usd or 0.0)
    if liq <= 0:
        return 0.0
    return liq * (max_apr / 100.0) / 365.0


def position_apr_from_item(p: dict, as_of: date | None = None) -> float:
    """APR позиции: Fee APY из таблицы или (fees+incentives)/valueUsd/дни×365."""
    as_of = as_of or date.today()
    sheet_apr = float(p.get("apr") or 0.0)
    if sheet_apr > 0:
        return min(sheet_apr, 500.0)
    fees = float(p.get("feesUsd") or 0.0) + float(p.get("incentivesUsd") or 0.0)
    value = float(p.get("valueUsd") or 0.0)
    if value <= 0 or fees <= 0:
        return 0.0
    days = days_held_since_open(str(p.get("openedAt") or ""), as_of)
    return min((fees / value) * (365.0 / days) * 100.0, 500.0)


def reset_spike_fee_days_for_interpolation(
    out: list[dict],
    dates: list[str],
    *,
    start_day: str,
    end_day: str,
    max_apr: float = MAX_CHART_DAILY_APR_PCT,
) -> None:
    """Сбрасывает дневной fee на «потолке» APR — дальше заполнит интерполяция."""
    for i, d in enumerate(dates):
        if d < start_day or d > end_day:
            continue
        liq = float(out[i].get("liquidityUsd") or 0.0)
        fee = float(out[i].get("dailyFeeIncomeUsd") or 0.0)
        if liq <= 0 or fee <= 0:
            continue
        apr = (fee / liq) * 365.0 * 100.0
        if apr >= max_apr - 0.5:
            out[i]["dailyFeeIncomeUsd"] = 0.0


def sanitize_snapshot_daily_fees(
    out: list[dict],
    dates: list[str],
    *,
    max_apr: float = MAX_CHART_DAILY_APR_PCT,
) -> None:
    """Убирает артефакты rollup (80% плато): ограничивает дневной fee по ликвидности."""
    for i, s in enumerate(out):
        liq = float(s.get("liquidityUsd") or 0.0)
        fee = float(s.get("dailyFeeIncomeUsd") or 0.0)
        if liq <= 0 or fee <= 0:
            continue
        cap = max_daily_fee_usd_for_liquidity(liq, max_apr=max_apr)
        if fee > cap * 1.15:
            s["dailyFeeIncomeUsd"] = round(cap, 6)


def sheet_portfolio_cumulative_income_usd(config: dict) -> float:
    """Сумма комиссий + инсентивов по всем активным LP (накопительно из таблицы)."""
    total = 0.0
    for p in load_liquidity_positions_from_sheet(config):
        if not p.get("isActive"):
            continue
        total += float(p.get("feesUsd") or 0.0) + float(p.get("incentivesUsd") or 0.0)
    return total


def sheet_portfolio_daily_income_usd(config: dict, as_of: date | None = None) -> float:
    """Средний дневной доход LP: (комиссии + incentives USD) / дни в позиции."""
    as_of = as_of or date.today()
    daily_income = 0.0
    for p in load_liquidity_positions_from_sheet(config):
        if not p.get("isActive"):
            continue
        fees = float(p.get("feesUsd") or 0.0)
        inc = float(p.get("incentivesUsd") or 0.0)
        days = days_held_since_open(str(p.get("openedAt") or ""), as_of)
        daily_income += (fees + inc) / days
    return daily_income


def distribute_rollup_income_to_snapshots(
    out: list[dict],
    dates: list[str],
    rollup_by_day: dict[str, dict],
) -> dict[str, float]:
    """
    Заполняет dailyFeeIncomeUsd из revert_daily_rollup (БД на PA).
    Между двумя датами rollup делит earned (или дельту total_fee) поровну по календарю.
    """
    income_by_day: dict[str, float] = {}
    roll_dates = sorted(rollup_by_day.keys())
    if len(roll_dates) < 2:
        return income_by_day

    date_to_idx = {d: i for i, d in enumerate(dates)}

    for k in range(1, len(roll_dates)):
        d0, d1 = roll_dates[k - 1], roll_dates[k]
        r0, r1 = rollup_by_day[d0], rollup_by_day[d1]
        earned = float(r1.get("earnedUsd") or 0.0)
        if earned <= 0:
            t0 = float(r0.get("totalFeeUsd") or 0.0)
            t1 = float(r1.get("totalFeeUsd") or 0.0)
            if t1 > t0:
                earned = t1 - t0
        if earned <= 0:
            continue
        try:
            gap_days = max((date.fromisoformat(d1) - date.fromisoformat(d0)).days, 1)
        except ValueError:
            gap_days = 1
        per_day = earned / gap_days
        try:
            d_cur = date.fromisoformat(d0) + timedelta(days=1)
            d_end = date.fromisoformat(d1)
        except ValueError:
            continue
        while d_cur <= d_end:
            ds = d_cur.isoformat()
            day_fee = per_day
            if ds in date_to_idx:
                liq = float(out[date_to_idx[ds]].get("liquidityUsd") or 0.0)
                cap = max_daily_fee_usd_for_liquidity(liq)
                if cap > 0:
                    day_fee = min(day_fee, cap)
            income_by_day[ds] = income_by_day.get(ds, 0.0) + day_fee
            if ds in date_to_idx:
                i = date_to_idx[ds]
                if float(out[i].get("dailyFeeIncomeUsd") or 0) <= 0:
                    out[i]["dailyFeeIncomeUsd"] = round(day_fee, 6)
            d_cur += timedelta(days=1)

    for i, s in enumerate(out):
        d = dates[i]
        earned = float((rollup_by_day.get(d) or {}).get("earnedUsd") or 0.0)
        if earned > 0 and float(s.get("dailyFeeIncomeUsd") or 0) <= 0:
            s["dailyFeeIncomeUsd"] = earned
            income_by_day[d] = earned

    return income_by_day


def assign_daily_fee_income_to_snapshots(
    snapshots: list[dict],
    rollup_by_day: dict[str, dict],
    config: dict,
    positions: list[dict],
) -> tuple[list[dict], dict[str, float]]:
    """
    Дневной доход LP:
    1) revert_daily_rollup (БД, каждый hourly ETL);
    2) lp-income-snapshots.json (дельта по позициям);
    3) дельта cumulative из Google Sheet между прогонами.
    """
    if not snapshots:
        return snapshots, {}
    as_of = str(snapshots[-1].get("timestamp", ""))[:10]
    out = [dict(s) for s in snapshots]
    dates = [str(s.get("timestamp", ""))[:10] for s in out]
    sanitize_snapshot_daily_fees(out, dates)
    income_by_day = distribute_rollup_income_to_snapshots(out, dates, rollup_by_day)

    db_path = str(config.get("db_path", "data/portfolio.db"))
    if Path(db_path).exists():
        _conn = sqlite3.connect(db_path)
        try:
            apply_daily_metrics_fees(out, dates, load_daily_metrics_fees_by_day(_conn))
        finally:
            _conn.close()

    snap_income, income_from_store = fill_daily_income_on_snapshots(
        snapshots, positions, as_of_day=as_of or None
    )
    for i, s in enumerate(snap_income):
        fee_store = float(s.get("dailyFeeIncomeUsd") or 0.0)
        if fee_store > 0:
            out[i] = dict(s)
            income_by_day[dates[i]] = fee_store

    dates = [str(s.get("timestamp", ""))[:10] for s in out]

    for i, s in enumerate(out):
        d = dates[i]
        earned = float((rollup_by_day.get(d) or {}).get("earnedUsd") or 0.0)
        if earned > 0:
            s["dailyFeeIncomeUsd"] = earned
            income_by_day[d] = earned

    cum_now = sheet_portfolio_cumulative_income_usd(config)
    roll_dates = sorted(rollup_by_day.keys())
    last_roll_day = roll_dates[-1] if roll_dates else ""
    last_roll_cum = float(rollup_by_day[last_roll_day].get("totalFeeUsd") or 0.0) if last_roll_day else 0.0

    if last_roll_day and cum_now > last_roll_cum:
        gap_idx = [i for i, d in enumerate(dates) if d > last_roll_day]
        if gap_idx and len(gap_idx) <= 14:
            delta = cum_now - last_roll_cum
            per_day = delta / len(gap_idx)
            for i in gap_idx:
                if float(out[i].get("dailyFeeIncomeUsd") or 0) <= 0:
                    out[i]["dailyFeeIncomeUsd"] = per_day
                    income_by_day[dates[i]] = per_day

    for i in range(1, len(out)):
        if float(out[i].get("dailyFeeIncomeUsd") or 0) > 0:
            continue
        prev_cum = 0.0
        dprev = ""
        for j in range(i - 1, -1, -1):
            dprev = dates[j]
            if dprev in rollup_by_day:
                prev_cum = float(rollup_by_day[dprev].get("totalFeeUsd") or 0.0)
                break
        if prev_cum > 0 and dprev and dates[i] in rollup_by_day:
            cur_cum = float(rollup_by_day[dates[i]].get("totalFeeUsd") or 0.0)
            if cur_cum > prev_cum:
                gap = (datetime.strptime(dates[i], "%Y-%m-%d") - datetime.strptime(dprev, "%Y-%m-%d")).days
                inc = (cur_cum - prev_cum) / max(gap, 1)
                out[i]["dailyFeeIncomeUsd"] = inc
                income_by_day[dates[i]] = inc

    if out and float(out[-1].get("dailyFeeIncomeUsd") or 0) <= 0:
        try:
            as_of = datetime.strptime(dates[-1], "%Y-%m-%d").date()
        except ValueError:
            as_of = date.today()
        est = sheet_portfolio_daily_income_usd(config, as_of)
        if est > 0:
            out[-1]["dailyFeeIncomeUsd"] = est
            income_by_day[dates[-1]] = est

    sanitize_snapshot_daily_fees(out, dates)
    reset_spike_fee_days_for_interpolation(out, dates, start_day="2026-04-27", end_day="2026-04-30")
    interpolate_daily_fee_income_gaps(out, dates, anchor_day="2026-04-20")
    refine_flat_fee_plateaus(out, dates, anchor_day="2026-04-27")
    sanitize_snapshot_daily_fees(out, dates)
    interpolate_daily_fee_income_gaps(out, dates, anchor_day="2026-05-15")
    refine_flat_fee_plateaus(out, dates, anchor_day="2026-05-19")
    decouple_identical_tail_daily_fees(out, dates, config)
    for i, d in enumerate(dates):
        fee = float(out[i].get("dailyFeeIncomeUsd") or 0.0)
        if fee > 0:
            income_by_day[d] = fee

    return out, income_by_day


def decouple_identical_tail_daily_fees(
    out: list[dict],
    dates: list[str],
    config: dict,
    *,
    tail_days: int = 4,
) -> None:
    """Последние дни с одинаковым fee — пересчёт по календарной дате из Google Sheet."""
    if len(out) < 2:
        return
    start = max(0, len(out) - tail_days)
    for i in range(start, len(out)):
        try:
            as_of = date.fromisoformat(dates[i])
        except ValueError:
            continue
        est = sheet_portfolio_daily_income_usd(config, as_of)
        if est > 0:
            out[i]["dailyFeeIncomeUsd"] = round(est, 6)


def load_daily_metrics_fees_by_day(conn: sqlite3.Connection) -> dict[str, float]:
    by_day: dict[str, float] = {}
    try:
        rows = conn.execute(
            """
            SELECT as_of_date, daily_fee_income_usd
            FROM daily_metrics
            WHERE daily_fee_income_usd > 0
            ORDER BY as_of_date ASC
            """
        ).fetchall()
        for row in rows:
            d = str(row[0] or "")[:10]
            fee = float(row[1] or 0.0)
            if d and fee > 0:
                by_day[d] = fee
    except sqlite3.OperationalError:
        pass
    return by_day


def apply_daily_metrics_fees(
    out: list[dict],
    dates: list[str],
    fees_by_day: dict[str, float],
) -> None:
    for i, d in enumerate(dates):
        fee = float(fees_by_day.get(d) or 0.0)
        if fee <= 0:
            continue
        liq = float(out[i].get("liquidityUsd") or 0.0)
        cap = max_daily_fee_usd_for_liquidity(liq)
        if cap > 0:
            fee = min(fee, cap)
        if float(out[i].get("dailyFeeIncomeUsd") or 0) <= 0:
            out[i]["dailyFeeIncomeUsd"] = round(fee, 6)


def interpolate_daily_fee_income_gaps(
    out: list[dict],
    dates: list[str],
    *,
    anchor_day: str = "2026-05-15",
) -> None:
    """Дни с fee=0 между двумя днями с известным доходом — линейная интерполяция."""
    for i, d in enumerate(dates):
        if d < anchor_day:
            continue
        if float(out[i].get("dailyFeeIncomeUsd") or 0) > 0:
            continue
        prev_i = next(
            (j for j in range(i - 1, -1, -1) if float(out[j].get("dailyFeeIncomeUsd") or 0) > 0),
            None,
        )
        next_i = next(
            (j for j in range(i + 1, len(out)) if float(out[j].get("dailyFeeIncomeUsd") or 0) > 0),
            None,
        )
        if prev_i is None or next_i is None:
            continue
        span = next_i - prev_i
        if span <= 0:
            continue
        prev_fee = float(out[prev_i]["dailyFeeIncomeUsd"])
        next_fee = float(out[next_i]["dailyFeeIncomeUsd"])
        t = (i - prev_i) / span
        fee = prev_fee + (next_fee - prev_fee) * t
        if fee > 0:
            out[i]["dailyFeeIncomeUsd"] = round(fee, 6)


def refine_flat_fee_plateaus(
    out: list[dict],
    dates: list[str],
    *,
    anchor_day: str = "2026-05-19",
) -> None:
    """Убирает одинаковый dailyFee на несколько дней подряд (артефакт gap-fill)."""
    i = 0
    while i < len(dates):
        if dates[i] < anchor_day:
            i += 1
            continue
        fee = float(out[i].get("dailyFeeIncomeUsd") or 0.0)
        if fee <= 0:
            i += 1
            continue
        j = i
        while j + 1 < len(dates):
            nfee = float(out[j + 1].get("dailyFeeIncomeUsd") or 0.0)
            if dates[j + 1] < anchor_day or abs(nfee - fee) > 1e-6:
                break
            j += 1
        if j > i:
            prev_i = next(
                (
                    x
                    for x in range(i - 1, -1, -1)
                    if float(out[x].get("dailyFeeIncomeUsd") or 0) > 0
                    and abs(float(out[x].get("dailyFeeIncomeUsd") or 0) - fee) > 1e-6
                ),
                None,
            )
            next_i = next(
                (
                    x
                    for x in range(j + 1, len(out))
                    if float(out[x].get("dailyFeeIncomeUsd") or 0) > 0
                    and abs(float(out[x].get("dailyFeeIncomeUsd") or 0) - fee) > 1e-6
                ),
                None,
            )
            if prev_i is not None and next_i is not None:
                span = next_i - prev_i
                prev_fee = float(out[prev_i]["dailyFeeIncomeUsd"])
                next_fee = float(out[next_i]["dailyFeeIncomeUsd"])
                for k in range(i, j + 1):
                    t = (k - prev_i) / span
                    out[k]["dailyFeeIncomeUsd"] = round(prev_fee + (next_fee - prev_fee) * t, 6)
        i = j + 1


def sheet_portfolio_chart_apr(
    config: dict,
    liquidity_usd: float,
    as_of: date | None = None,
    *,
    max_chart_apr: float = 80.0,
) -> float:
    as_of = as_of or date.today()
    liq = float(liquidity_usd or 0.0)
    if liq <= 0:
        liq = sum(float(p.get("valueUsd") or 0.0) for p in load_liquidity_positions_from_sheet(config) if p.get("isActive"))
    daily_income = sheet_portfolio_daily_income_usd(config, as_of)
    if liq <= 0 or daily_income <= 0:
        return 0.0
    return min((daily_income / liq) * 365.0 * 100.0, max_chart_apr)


def parse_fee_tier_cell(raw: str) -> float:
    s = (raw or "").strip()
    if not s or s in ("-", "—"):
        return 0.0
    has_pct = "%" in s
    t = s.replace("%", "").replace(" ", "")
    if "." in t and "," in t:
        if t.rfind(",") > t.rfind("."):
            t = t.replace(".", "").replace(",", ".")
        else:
            t = t.replace(",", "")
    elif "," in t and "." not in t:
        t = t.replace(",", ".")
    try:
        n = float(t)
    except ValueError:
        return 0.0
    if n <= 0:
        return 0.0
    if has_pct:
        if n >= 1000:
            return n / 1_000_000
        if n >= 1:
            return n / 100
        return n
    if n >= 50:
        return n / 10000
    if n <= 1:
        return n
    return n / 100


def fee_tier_public_row(row: dict[str, str]) -> float:
    for key in ("Fee tier (%)", "Fee tier", "fee_tier", "BJ", "V"):
        v = parse_fee_tier_cell(row.get(key, "") or "")
        if v > 0:
            return v
    return 0.0


def live_value_usd_public_row(row: dict[str, str]) -> float:
    keys = (
        "Стоимость позиции, USD",
        "К hold, USD",
        "Внесено, USD",
        "Инвестировано ВСЕГО (сейчас)",
        "underlying_value",
    )
    for k in keys:
        v = parse_float(row.get(k, ""))
        if v > 0:
            return v
    t0usd = parse_float(row.get("Сейчас токен0, USD", ""))
    t1usd = parse_float(row.get("Сейчас токен1, USD", ""))
    if t0usd + t1usd > 0:
        return t0usd + t1usd
    token0 = (row.get("token0") or row.get("AK") or "").strip().upper()
    token1 = (row.get("token1") or row.get("AL") or "").strip().upper()
    stable_symbols = {"USDC", "USDT", "DAI", "USDE", "FDUSD", "TUSD", "USD"}
    amt0 = parse_float(row.get("AU", "")) or parse_float(row.get("current_amount0", ""))
    amt1 = parse_float(row.get("AV", "")) or parse_float(row.get("current_amount1", ""))
    if token0 in stable_symbols or token1 in stable_symbols:
        return max(0.0, amt0) + max(0.0, amt1)
    return 0.0


def closed_position_apr(row: dict[str, str]) -> float:
    opened = parse_date(row_get(row, "Дата открытия норм", "W", "first_mint_ts"))
    closed_raw = row_get(row, "Дата закрытия норм", "closed_at", "X")
    closed = parse_date(closed_raw)
    if not opened or not closed:
        return 0.0
    days = (closed - opened).days
    if days <= 0:
        return 0.0
    fees = fees_usd_public_row(row)
    invested = invested_usd_from_row(row)
    if invested <= 0 or fees <= 0:
        return 0.0
    return max(0.0, (fees / invested) * (365 / days) * 100)


def mean_apr_from_revert_sheet(config: dict) -> float:
    rows = load_google_sheet_rows(config.get("google_sheet_id", ""), str(config.get("revert_pools_gid", "")).strip())
    apr_values = [parse_pct(r.get("S", "")) * 100 for r in rows if parse_pct(r.get("S", "")) > 0]
    return (sum(apr_values) / len(apr_values)) if apr_values else 43.9


def month_apr_map_from_revert_sheet(config: dict) -> dict[str, float]:
    rows = load_google_sheet_rows(config.get("google_sheet_id", ""), str(config.get("revert_pools_gid", "")).strip())
    buckets: dict[str, list[float]] = {}
    for r in rows:
        apr_active = parse_pct(r.get("S", "")) * 100
        closed = parse_date(r.get("X", ""))
        if closed:
            apr = closed_position_apr(r)
            # closed in early next month -> previous month performance
            ref = closed.replace(day=1)
            if closed.day <= 7:
                ref = (ref - timedelta(days=1)).replace(day=1)
            mk = f"{ref.year:04d}-{ref.month:02d}"
            if apr > 0:
                buckets.setdefault(mk, []).append(apr)
        else:
            opened = parse_date(r.get("W", ""))
            if opened and apr_active > 0:
                mk = f"{opened.year:04d}-{opened.month:02d}"
                buckets.setdefault(mk, []).append(apr_active)
    out: dict[str, float] = {}
    for k, arr in buckets.items():
        if arr:
            out[k] = sum(arr) / len(arr)
    return out


def rebase_equity_start_only(snapshots: list[dict], initial_capital: float, current_adjustment: float) -> list[dict]:
    if not snapshots:
        return snapshots
    shift = initial_capital - float(snapshots[0]["equityUsd"])
    n = len(snapshots)
    for i, s in enumerate(snapshots):
        spread_adj = current_adjustment * (i / max(n - 1, 1))
        s["equityUsd"] = float(s["equityUsd"]) + shift + spread_adj
    return snapshots


def build_daily_yield_series(snapshots: list[dict], fallback_apr: float, month_apr: dict[str, float]) -> list[float]:
    if not snapshots:
        return []
    dates = [s["timestamp"][:10] for s in snapshots]
    start, end = dates[0], dates[-1]
    eth = fetch_eth_history(start, end)

    target_mean: dict[str, float] = {}
    for d in dates:
        mk = month_key(d)
        if mk == "2026-01":
            target_mean[mk] = 45.0
        else:
            target_mean[mk] = 43.9
    # allow closed-position month override only when close to expected range
    for mk, apr in month_apr.items():
        if 10 <= apr <= 80 and mk in target_mean:
            target_mean[mk] = apr

    raw: list[float] = []
    for d in dates:
        mk = month_key(d)
        base = target_mean[mk]
        month_days = [x for x in dates if month_key(x) == mk]
        month_prices = [eth.get(x, 0) for x in month_days if eth.get(x, 0) > 0]
        p = eth.get(d, month_prices[-1] if month_prices else 0)
        p_avg = (sum(month_prices) / len(month_prices)) if month_prices else max(p, 1)
        ratio = p / p_avg if p_avg > 0 else 1
        apr = base * (1 + (ratio - 1) * 0.6)
        raw.append(max(0.0, apr))

    normalized = raw[:]
    for mk, target in target_mean.items():
        idxs = [i for i, d in enumerate(dates) if month_key(d) == mk]
        if not idxs:
            continue
        avg = sum(raw[i] for i in idxs) / len(idxs)
        if avg <= 0:
            for i in idxs:
                normalized[i] = target
        else:
            k = target / avg
            for i in idxs:
                normalized[i] = max(0, min(60, raw[i] * k))

    # do not hard-override latest day to avoid artificial spikes
    return normalized


def load_realized_apr_by_day(conn: sqlite3.Connection) -> dict[str, float]:
    out: dict[str, float] = {}
    cur = conn.cursor()
    try:
        rows = cur.execute(
            """
            SELECT as_of_date, apr_annualized
            FROM revert_metrics_history
            ORDER BY id ASC
            """
        ).fetchall()
    except sqlite3.OperationalError:
        return {}
    for row in rows:
        d = str(row[0] or "").strip()
        if not d:
            continue
        apr = float(row[1] or 0.0)
        if apr < 0:
            apr = 0.0
        if apr > 2000:
            apr = 2000.0
        # Keep the best positive factual APR for the date.
        # This avoids a transient zero run overriding a valid non-zero run.
        if apr > 0:
            out[d] = max(out.get(d, 0.0), apr)
    return out


def merge_realized_apr(
    snapshots: list[dict], synthetic: list[float], realized_by_day: dict[str, float]
) -> list[float]:
    if not snapshots:
        return []
    out = synthetic[:]
    last_known = 0.0
    for i, s in enumerate(snapshots):
        d = str(s.get("timestamp", ""))[:10]
        if d in realized_by_day:
            out[i] = float(realized_by_day[d])
            last_known = out[i]
        elif last_known > 0:
            # Keep continuity between days when no fresh run happened
            out[i] = last_known
    return out


def portfolio_base_usd_from_snapshot(s: dict) -> float:
    """База для APR: залог − долг + ликвидность (без визуальной поправки)."""
    coll = float(s.get("collateralUsd") or 0.0)
    debt = float(s.get("debtUsd") or 0.0)
    liq = float(s.get("liquidityUsd") or 0.0)
    base = coll - debt + liq
    if base > 0:
        return base
    return max(float(s.get("equityUsd") or 0.0), liq, 1.0)


def build_fee_based_daily_yield(snapshots: list[dict], *, max_apr: float = 80.0) -> list[float]:
    """APR (годовых) = (дневной доход USD / ликвидность LP) × 365 × 100."""
    return [apr_from_snapshot_row(s, max_apr=max_apr) for s in snapshots]


def merge_apr_for_chart(
    snapshots: list[dict],
    fee_based: list[float],
    realized_by_day: dict[str, float],
    *,
    max_chart_apr: float = 80.0,
) -> list[float]:
    """Legacy merge — prefer build_chart_daily_yield_series()."""
    return build_chart_daily_yield_series(
        snapshots,
        fee_based,
        [],
        realized_by_day,
        {},
        max_chart_apr=max_chart_apr,
    )


def load_yield_reference_by_day() -> dict[str, float]:
    """Эталонная дневная доходность (до 18.05 и ранее), чтобы не терять историю графика."""
    by_day: dict[str, float] = {}
    ref_path = Path("data/chart-yield-reference.json")
    if ref_path.exists():
        try:
            payload = json.loads(ref_path.read_text(encoding="utf-8"))
            for d, v in (payload.get("byDay") or {}).items():
                fv = float(v or 0.0)
                if fv > 0:
                    by_day[str(d)[:10]] = fv
        except Exception:
            pass
    return by_day


def fill_calendar_gaps_in_snapshots(snapshots: list[dict], *, max_gap_days: int = 45) -> list[dict]:
    """Вставляет пропущенные календарные дни (копия предыдущего дня)."""
    if len(snapshots) < 2:
        return snapshots
    out: list[dict] = []
    for i, s in enumerate(snapshots):
        out.append(dict(s))
        if i + 1 >= len(snapshots):
            break
        d0 = datetime.strptime(str(s["timestamp"])[:10], "%Y-%m-%d").date()
        d1 = datetime.strptime(str(snapshots[i + 1]["timestamp"])[:10], "%Y-%m-%d").date()
        gap = (d1 - d0).days
        if 1 < gap <= max_gap_days + 1:
            for g in range(1, gap):
                mid = (d0 + timedelta(days=g)).isoformat()
                filler = dict(s)
                filler["timestamp"] = f"{mid}T00:00:00.000Z"
                filler["dailyFeeIncomeUsd"] = 0.0
                out.append(filler)
    out.sort(key=lambda x: str(x.get("timestamp", "")))
    return out


def merge_snapshots_from_js_file(current: list[dict], js_path: Path) -> list[dict]:
    """Заполняет дыры в календаре (например 28.04–20.05) из предыдущего export."""
    if not js_path.exists() or not current:
        return current
    try:
        raw = js_path.read_text(encoding="utf-8")
        m = re.search(r"window\.PORTFOLIO_DATA\s*=\s*(\{.*\})\s*;?\s*$", raw, re.S)
        if not m:
            return current
        old = json.loads(m.group(1))
        old_snaps = old.get("snapshots") or []
        if not old_snaps:
            return current
        by_day = {s["timestamp"][:10]: dict(s) for s in old_snaps}
        for s in current:
            by_day[s["timestamp"][:10]] = dict(s)
        merged = [by_day[k] for k in sorted(by_day.keys())]
        return merged if len(merged) > len(current) else current
    except Exception:
        return current


def estimate_gap_fee_usd(snapshots: list[dict], rollup_by_day: dict[str, dict], gap_indices: list[int]) -> float:
    total = 0.0
    for i in gap_indices:
        d = str(snapshots[i].get("timestamp", ""))[:10]
        roll = rollup_by_day.get(d, {})
        total += float(roll.get("earnedUsd") or snapshots[i].get("dailyFeeIncomeUsd") or 0.0)
    if total > 0:
        return total
    fees: list[float] = []
    start = gap_indices[0] - 1
    for j in range(start, -1, -1):
        f = float(snapshots[j].get("dailyFeeIncomeUsd") or 0.0)
        if f > 0:
            fees.append(f)
        if len(fees) >= 7:
            break
    if fees:
        return (sum(fees) / len(fees)) * len(gap_indices)
    return 0.0


def fill_trailing_yield_gap(
    snapshots: list[dict],
    series: list[float],
    rollup_by_day: dict[str, dict],
    config: dict | None = None,
    *,
    max_gap_days: int = 3,
    max_chart_apr: float = 80.0,
) -> list[float]:
    """19–21.05: APR из таблицы (комиссии + incentives / объём / дни в позиции)."""
    if not snapshots or not series:
        return series
    out = list(series)
    n = len(out)
    tail: list[int] = []
    for i in range(n - 1, -1, -1):
        d = str(snapshots[i].get("timestamp", ""))[:10]
        fee_apr = 0.0
        liq = float(snapshots[i].get("liquidityUsd") or 0.0)
        fee = float(snapshots[i].get("dailyFeeIncomeUsd") or 0.0)
        if liq > 0 and fee > 0:
            fee_apr = (fee / liq) * 365.0 * 100.0
        if out[i] <= 0.5 or (fee_apr <= 0.5 and d >= "2026-05-19"):
            tail.insert(0, i)
            if len(tail) >= max_gap_days:
                break
        elif tail:
            break
    if not tail:
        return out
    last_day = str(snapshots[-1].get("timestamp", ""))[:10]
    try:
        as_of = datetime.strptime(last_day, "%Y-%m-%d").date()
    except ValueError:
        as_of = date.today()
    liq = float(snapshots[-1].get("liquidityUsd") or 0.0)
    sheet_apr = sheet_portfolio_chart_apr(config or {}, liq, as_of, max_chart_apr=max_chart_apr) if config else 0.0
    if sheet_apr > 0.5:
        for i in tail:
            out[i] = sheet_apr
        return out
    total_fee = estimate_gap_fee_usd(snapshots, rollup_by_day, tail)
    per_day = total_fee / len(tail) if tail else 0.0
    flat_apr = 0.0
    for i in tail:
        liq_i = float(snapshots[i].get("liquidityUsd") or 0.0)
        if liq_i > 0 and per_day > 0:
            flat_apr = min((per_day / liq_i) * 365.0 * 100.0, max_chart_apr)
            break
    if flat_apr <= 0:
        for j in range(tail[0] - 1, -1, -1):
            if out[j] > 0.5:
                flat_apr = out[j]
                break
    if flat_apr <= 0:
        flat_apr = 8.0
    for i in tail:
        out[i] = flat_apr
    return out


def build_chart_daily_yield_series(
    snapshots: list[dict],
    fee_based: list[float],
    synthetic: list[float],
    realized_by_day: dict[str, float],
    rollup_by_day: dict[str, dict],
    config: dict | None = None,
    *,
    max_chart_apr: float = MAX_CHART_DAILY_APR_PCT,
) -> list[float]:
    """
    Правый график: дневной прирост дохода (fees+incentives) → APR годовых.
    История без fee — chart-yield-reference, но не плато 80% (игнор ref > max_chart_apr).
    """
    del realized_by_day, rollup_by_day, config, synthetic
    if not snapshots:
        return []
    reference = load_yield_reference_by_day()
    out: list[float] = []
    for i, s in enumerate(snapshots):
        d = str(s.get("timestamp", ""))[:10]
        fee_apr = float(fee_based[i] if i < len(fee_based) else 0.0)
        if fee_apr > 0.01:
            out.append(max(0.0, min(fee_apr, max_chart_apr)))
            continue
        ref_apr = float(reference.get(d, 0.0))
        if 0.5 < ref_apr < max_chart_apr - 0.5:
            out.append(ref_apr)
        else:
            out.append(0.0)
    # Дни с 0 между известными APR (27–30.04 и т.п.) — линейная интерполяция
    for i in range(len(out)):
        if out[i] > 0.01:
            continue
        prev_i = next((j for j in range(i - 1, -1, -1) if out[j] > 0.01), None)
        next_i = next((j for j in range(i + 1, len(out)) if out[j] > 0.01), None)
        if prev_i is None or next_i is None:
            continue
        span = next_i - prev_i
        if span <= 0:
            continue
        t = (i - prev_i) / span
        out[i] = max(0.0, min(out[prev_i] + (out[next_i] - out[prev_i]) * t, max_chart_apr))
    return out


def load_apr_rollup_by_day(conn: sqlite3.Connection) -> dict[str, dict]:
    cur = conn.cursor()
    try:
        rows = cur.execute(
            """
            SELECT as_of_date, liquidity_usd, total_fee_usd, earned_vs_prev_day_usd,
                   elapsed_hours, apr_annualized
            FROM revert_daily_rollup
            ORDER BY as_of_date ASC
            """
        ).fetchall()
    except sqlite3.OperationalError:
        return {}
    out: dict[str, dict] = {}
    for row in rows:
        d = str(row[0] or "").strip()
        if not d:
            continue
        out[d] = {
            "liquidityUsd": float(row[1] or 0.0),
            "totalFeeUsd": float(row[2] or 0.0),
            "earnedUsd": float(row[3] or 0.0),
            "elapsedHours": float(row[4] or 0.0),
            "rollupApr": float(row[5] or 0.0),
        }
    return out


def build_apr_audit(
    snapshots: list[dict],
    chart_series: list[float],
    fee_based: list[float],
    realized_by_day: dict[str, float],
    rollup_by_day: dict[str, dict],
) -> list[dict]:
    audit: list[dict] = []
    for i, s in enumerate(snapshots):
        d = str(s.get("timestamp", ""))[:10]
        liq = float(s.get("liquidityUsd") or 0.0)
        fee = float(s.get("dailyFeeIncomeUsd") or 0.0)
        roll = rollup_by_day.get(d, {})
        fee_apr = float(fee_based[i] if i < len(fee_based) else 0.0)
        chart_apr = float(chart_series[i] if i < len(chart_series) else 0.0)
        real_apr = float(realized_by_day.get(d, 0.0))
        spike = real_apr > 0 and fee_apr > 0 and real_apr > max(fee_apr * 3.5, 60.0)
        audit.append(
            {
                "date": d,
                "chartApr": round(chart_apr, 4),
                "feeBasedApr": round(fee_apr, 4),
                "rollupApr": round(float(roll.get("rollupApr", real_apr) or 0.0), 4),
                "earnedUsd": round(float(roll.get("earnedUsd", fee) or 0.0), 6),
                "elapsedHours": round(float(roll.get("elapsedHours", 24.0) or 24.0), 2),
                "liquidityUsd": round(liq, 2),
                "dailyFeeIncomeUsd": round(fee, 6),
                "spikeRejected": spike,
            }
        )
    return audit


def revert_position_id(link: str) -> str:
    s = (link or "").strip()
    if not s:
        return ""
    m = re.search(r"/(\d+)(?:\?.*)?$", s)
    return m.group(1) if m else ""


def row_get(row: dict[str, str], *keys: str) -> str:
    for k in keys:
        v = (row.get(k) or "").strip()
        if v:
            return v
    return ""


def dex_from_revert_link(link: str) -> str:
    s = (link or "").lower()
    if "aerodrome" in s:
        return "Aerodrome V3"
    if "pancake" in s:
        return "PancakeSwap V3"
    if "velodrome" in s:
        return "Velodrome"
    if "uniswap" in s:
        return "Uniswap V3"
    return "DEX"


RANGE_FLIP_THRESHOLD = 0.5


def flip_pool_price(value: float | None) -> float | None:
    if value is None or value <= 0:
        return None
    if value < RANGE_FLIP_THRESHOLD:
        return 1.0 / value
    return value


def normalize_lp_range(
    lower: float | None,
    upper: float | None,
    current: float | None = None,
) -> dict[str, float]:
    a = flip_pool_price(lower)
    b = flip_pool_price(upper)
    c = flip_pool_price(current) if current is not None else None
    if a is None or b is None:
        return {}
    rmin, rmax = min(a, b), max(a, b)
    if c is None:
        c = (rmin + rmax) / 2.0
    return {"rangeMin": rmin, "rangeMax": rmax, "rangeCurrent": c}


def parse_position_range(row: dict[str, str]) -> dict[str, float | None]:
    """Диапазон цены из Revert-таблицы: price_lower/upper + рыночная цена."""
    keys_lower = (
        "Мин. цена диапазона",
        "price_lower",
        "BE",
        "rangeMin",
        "Range Min",
        "Min Price",
    )
    keys_upper = (
        "Макс. цена диапазона",
        "price_upper",
        "BD",
        "rangeMax",
        "Range Max",
        "Max Price",
    )
    keys_cur = (
        "Цена пула",
        "Текущая цена",
        "Asset market price",
        "BW",
        "rangeCurrent",
        "Range Current",
        "Current Price",
    )

    def pick(keys: tuple[str, ...]) -> float | None:
        for k in keys:
            v = parse_float(row.get(k, ""))
            if v > 0:
                return v
        return None

    lower = pick(keys_lower)
    upper = pick(keys_upper)
    cur = pick(keys_cur)
    if lower is None or upper is None:
        return {}
    return normalize_lp_range(lower, upper, cur)


def _s1_leg_sum(s: dict) -> float:
    return (
        float(s.get("lpUsd") or 0.0)
        + float(s.get("pendleUsd") or 0.0)
        + float(s.get("hyperliquidUsd") or 0.0)
    )


def flatten_strategy_one_equity_dips(
    snapshots: list[dict],
    initial: float,
    *,
    min_ratio: float = 0.85,
) -> list[dict]:
    """Убирает ложные провалы (29.04 → $20 при ногах ~$30)."""
    if not snapshots:
        return snapshots
    floor = float(initial) * min_ratio
    out = [dict(s) for s in snapshots]
    for i, row in enumerate(out):
        eq = float(row.get("equityUsd") or 0.0)
        if eq >= floor:
            continue
        legs = _s1_leg_sum(row)
        if legs >= floor:
            row["equityUsd"] = legs
            continue
        prev = float(out[i - 1].get("equityUsd") or 0.0) if i > 0 else 0.0
        nxt = float(out[i + 1].get("equityUsd") or 0.0) if i + 1 < len(out) else 0.0
        candidates = [v for v in (prev, nxt) if v >= floor]
        if candidates:
            row["equityUsd"] = sum(candidates) / len(candidates)
    return out


def sanitize_strategy_one_snapshots(
    snapshots: list[dict],
    live_total: float,
    initial: float,
    *,
    lp_usd: float = 0.0,
    pendle_usd: float = 0.0,
    hyper_usd: float = 0.0,
) -> list[dict]:
    """Убираем искусственный скачок на 30$; хвост — стабильный live (~29.92)."""
    if not snapshots:
        return snapshots
    live = float(live_total or 0.0)
    if live <= 0:
        return snapshots
    out = flatten_strategy_one_equity_dips(snapshots, initial)
    for i, s in enumerate(out):
        eq = float(s.get("equityUsd") or 0.0)
        prev = float(out[i - 1].get("equityUsd") or 0.0) if i > 0 else eq
        if abs(eq - initial) < 0.06 and abs(prev - initial) > 0.4:
            out[i] = {**out[i], "equityUsd": prev}
    stable_from = "2026-05-18"
    if live >= initial * 0.85:
        legs = {
            "lpUsd": float(lp_usd or 0.0),
            "pendleUsd": float(pendle_usd or 0.0),
            "hyperliquidUsd": float(hyper_usd or 0.0),
        }
        for i, s in enumerate(out):
            if str(s.get("timestamp", ""))[:10] >= stable_from:
                out[i] = {**out[i], "equityUsd": live, **legs}
        out[-1] = {**out[-1], "equityUsd": live, **legs}
    return out


def load_s1_snapshots_reference() -> list[dict]:
    ref_path = Path("data/s1-history-reference.json")
    if not ref_path.exists():
        return []
    try:
        payload = json.loads(ref_path.read_text(encoding="utf-8"))
        snaps = payload.get("snapshots") or []
        return [dict(s) for s in snaps if s.get("timestamp")]
    except Exception:
        return []


def merge_strategy_one_positions(
    live_positions: list[dict],
    fallback_positions: list[dict],
) -> list[dict]:
    """Не теряем LP при сбое Google Sheet — подмешиваем эталон по positionId/link."""
    by_key: dict[str, dict] = {}
    for p in fallback_positions:
        key = str(p.get("positionId") or revert_position_id(p.get("link", "")) or p.get("pair", ""))
        if key:
            by_key[key] = dict(p)
    out: list[dict] = []
    seen: set[str] = set()
    for p in live_positions:
        key = str(p.get("positionId") or revert_position_id(p.get("link", "")) or p.get("pair", ""))
        seen.add(key)
        if key in by_key and p.get("instrument") == "LP":
            ref = by_key[key]
            merged = {**ref, **p}
            if float(p.get("apr") or 0) <= 0 and float(ref.get("apr") or 0) > 0:
                merged["apr"] = ref["apr"]
            if float(p.get("valueUsd") or 0) <= 0 and float(ref.get("valueUsd") or 0) > 0:
                merged["valueUsd"] = ref["valueUsd"]
            out.append(merged)
        else:
            out.append(p)
    for key, p in by_key.items():
        if key not in seen and p.get("isActive"):
            out.append(p)
    return out


def _strategy_one_days_between(start_day: str, end_day: str) -> int:
    try:
        d0 = datetime.strptime(start_day[:10], "%Y-%m-%d").date()
        d1 = datetime.strptime(end_day[:10], "%Y-%m-%d").date()
        return max(1, (d1 - d0).days)
    except ValueError:
        return 1


def strategy_one_display_apr_from_position(
    p: dict,
    *,
    as_of_day: str,
    portfolio_start_day: str,
) -> float:
    """Та же логика, что на карточках в index.html (Fee APY / рост от $10)."""
    instrument = str(p.get("instrument") or "")
    if instrument == "LP":
        return float(p.get("apr") or 0.0)
    base_usd = 10.0
    value_usd = float(p.get("valueUsd") or 0.0)
    if value_usd <= 0:
        return 0.0
    opened = str(p.get("openedAt") or "").strip()
    start_day = portfolio_start_day
    if opened and re.match(r"\d{2}\.\d{2}\.\d{4}", opened):
        dd, mm, yyyy = opened.split(".")
        start_day = f"{yyyy}-{mm}-{dd}"
    days = _strategy_one_days_between(start_day, as_of_day)
    return ((value_usd - base_usd) / base_usd / days) * 365.0 * 100.0


def strategy_one_arithmetic_mean_apr(
    positions: list[dict],
    *,
    as_of_day: str,
    portfolio_start_day: str,
) -> float:
    """Среднее арифметическое доходности активных позиций (3 шт. ≈ 2.5%, не 0.33%)."""
    aprs: list[float] = []
    for p in positions:
        if p.get("isActive") is False:
            continue
        apr = strategy_one_display_apr_from_position(
            p, as_of_day=as_of_day, portfolio_start_day=portfolio_start_day
        )
        if apr > 0:
            aprs.append(apr)
    if not aprs:
        return 0.0
    return sum(aprs) / len(aprs)


def strategy_one_attach_display_apr(
    positions: list[dict],
    *,
    as_of_day: str,
    portfolio_start_day: str,
) -> list[dict]:
    out: list[dict] = []
    for p in positions:
        row = dict(p)
        row["displayApr"] = round(
            strategy_one_display_apr_from_position(
                row, as_of_day=as_of_day, portfolio_start_day=portfolio_start_day
            ),
            4,
        )
        out.append(row)
    return out


def patch_strategy_one_stuck_yield_tail(
    series: list[float],
    mean_apr: float,
    *,
    patch_tail_days: int = 5,
    stuck_near: float = 0.33,
    stuck_eps: float = 0.06,
    max_apr: float = 25.0,
) -> list[float]:
    """Меняем только «залипшие» ~0.33% и хвост из patch_tail_days дней, историю не трогаем."""
    if not series:
        return series
    mean_v = max(0.0, min(float(mean_apr), max_apr))
    out = [float(v or 0.0) for v in series]
    n = len(out)
    tail_start = max(1, n - patch_tail_days)
    for i in range(1, n):
        v = out[i]
        stuck = abs(v - stuck_near) <= stuck_eps
        tail_low = i >= tail_start and 0 <= v < 0.55 and mean_v > 1.0
        if stuck or tail_low:
            out[i] = mean_v
    return out


def strategy_one_chart_yield_series(
    snapshots: list[dict],
    positions: list[dict],
    *,
    base_series: list[float] | None = None,
    reference_snapshots: list[dict] | None = None,
    patch_tail_days: int = 5,
    max_apr: float = 25.0,
    portfolio_start_day: str = "",
) -> list[float]:
    """Правый график S1: история из equity-эталона; хвост ~0.33% → среднее по 3 позициям."""
    if not snapshots:
        return []
    n = len(snapshots)
    ref_by_day = {
        str(s.get("timestamp", ""))[:10]: s
        for s in (reference_snapshots or snapshots)
    }
    # До 14 мая — волатильная история из эталона; с 14 мая — уже выровненные snapshots.
    tail_from = "2026-05-14"
    aligned: list[dict] = []
    for s in snapshots:
        day = str(s.get("timestamp", ""))[:10]
        if day >= tail_from:
            aligned.append(s)
        else:
            aligned.append(ref_by_day.get(day, s))
    out = strategy_one_apr_from_snapshots(aligned, max_apr=max_apr)
    if base_series and len(base_series) == n:
        for i in range(1, n):
            b = float(base_series[i] or 0.0)
            if b > 0.5 and abs(b - 0.33) > 0.06:
                out[i] = min(b, max_apr)
    as_of = str(snapshots[-1].get("timestamp", ""))[:10]
    start_day = portfolio_start_day or str(snapshots[0].get("timestamp", ""))[:10]
    mean_apr = strategy_one_arithmetic_mean_apr(
        positions, as_of_day=as_of, portfolio_start_day=start_day
    )
    return patch_strategy_one_stuck_yield_tail(
        out,
        mean_apr,
        patch_tail_days=patch_tail_days,
        max_apr=max_apr,
    )


def strategy_one_apr_from_snapshots(snapshots: list[dict], *, max_apr: float = 120.0) -> list[float]:
    apr: list[float] = []
    for i, s in enumerate(snapshots):
        if i == 0:
            apr.append(0.0)
            continue
        prev_eq = max(float(snapshots[i - 1].get("equityUsd") or 0.0), 1e-9)
        cur_eq = float(s.get("equityUsd") or 0.0)
        daily_return = (cur_eq - prev_eq) / prev_eq
        v = daily_return * 365.0 * 100.0
        apr.append(max(0.0, min(v, max_apr)))
    return apr


def clamp_apr_spikes(series: list[float], max_apr: float = 200.0, window_days: int = 30) -> list[float]:
    """
    Если APR выбивается выше max_apr, заменяем на среднее за последние window_days.
    Это убирает визуальные "палки" и сохраняет гладкий информативный график.
    """
    if not series:
        return []
    out: list[float] = []
    for i, raw in enumerate(series):
        v = float(raw or 0.0)
        if v > max_apr:
            start = max(0, i - window_days)
            hist = [x for x in out[start:i] if x > 0 and x <= max_apr]
            if hist:
                v = sum(hist) / len(hist)
            else:
                # fallback baseline when no reliable history yet
                v = 45.0
        out.append(max(0.0, v))
    return out


def estimate_lending_health_factor(collateral_usd: float, borrow_usd: float) -> float:
    """Грубая оценка HF, если DeBank отдал «>10» или ошибочное 10."""
    if borrow_usd <= 0 or collateral_usd <= 0:
        return 0.0
    return (collateral_usd / borrow_usd) * 0.93


def sanitize_lending_health_factor(
    hf: float,
    *,
    collateral_usd: float,
    borrow_usd: float,
) -> float:
    if borrow_usd <= 0:
        return 0.0
    est = estimate_lending_health_factor(collateral_usd, borrow_usd)
    if hf <= 0:
        return round(est, 2) if est > 0 else 0.0
    # «>10» часто парсится как 10; для реального долга это неверно.
    if hf >= 9.5 and borrow_usd >= 50 and 1.05 <= est <= 5.0:
        return round(est, 2)
    if hf > 25:
        return round(min(hf, 25.0), 2)
    return round(hf, 2)


def lending_chain_for_position(
    protocol: str,
    *,
    chain_raw: str = "",
    collateral_asset: str = "",
    borrow_asset: str = "",
) -> str:
    slug = (chain_raw or "").strip().lower()
    if slug in ("op", "optimism", "10"):
        return "op"
    if slug in ("base",):
        return "base"
    if slug in ("arb", "arbitrum", "42161"):
        return "arb"
    if slug in ("eth", "ethereum", "1"):
        return "eth"
    if slug in ("matic", "polygon", "137"):
        return "matic"
    if slug in ("bsc", "56"):
        return "bsc"
    if slug:
        return slug

    p = (protocol or "").lower()
    coll = (collateral_asset or "").upper()
    if "fluid" in p:
        return "eth"
    if "compound" in p:
        if "CBBTC" in coll:
            return "base"
        if "WBTC" in coll:
            return "op"
        return "base"
    if "aave" in p:
        return "eth"
    return "eth"


def dedupe_lending_positions(positions: list[dict]) -> list[dict]:
    """Один долг Fluid/USDC не должен давать две карточки (ETH + WETH dust)."""
    out: list[dict] = []
    for p in positions:
        protocol = str(p.get("protocol") or "").strip().lower()
        borrow_usd = float(p.get("borrowUsd") or 0.0)
        if borrow_usd <= 0:
            sup = float(p.get("collateralUsd") or 0.0)
            if sup < 5:
                continue
            out.append(p)
            continue
        merged = False
        for i, ex in enumerate(out):
            ex_proto = str(ex.get("protocol") or "").strip().lower()
            ex_borrow = float(ex.get("borrowUsd") or 0.0)
            if protocol != ex_proto:
                continue
            if abs(borrow_usd - ex_borrow) > max(2.0, 0.02 * max(borrow_usd, ex_borrow, 1.0)):
                continue
            ex_coll = float(ex.get("collateralUsd") or 0.0)
            cur_coll = float(p.get("collateralUsd") or 0.0)
            if cur_coll > ex_coll:
                out[i] = p
            merged = True
            break
        if not merged:
            out.append(p)
    return out


def aggregate_lending_totals(positions: list[dict]) -> tuple[float, float, float]:
    coll = debt = 0.0
    for p in dedupe_lending_positions(positions):
        coll += float(p.get("collateralUsd") or 0.0)
        debt += float(p.get("borrowUsd") or 0.0)
    return coll, debt, coll - debt


def patch_latest_snapshot_from_sources(
    snapshots: list[dict],
    lending_positions: list[dict],
    sheet_lp_usd: float,
) -> list[dict]:
    return patch_recent_snapshots_from_sources(snapshots, lending_positions, sheet_lp_usd, days=1)


def patch_recent_snapshots_from_sources(
    snapshots: list[dict],
    lending_positions: list[dict],
    sheet_lp_usd: float,
    *,
    config: dict | None = None,
    days: int = 3,
) -> list[dict]:
    """Последние N дней — одинаковые live Debank + LP (без «обрыва» на 21.05)."""
    if not snapshots or days <= 0:
        return snapshots
    coll, debt, _ = aggregate_lending_totals(lending_positions)
    n = len(snapshots)
    for i in range(max(0, n - days), n):
        s = dict(snapshots[i])
        if coll > 0:
            s["collateralUsd"] = coll
        if debt > 0:
            s["debtUsd"] = debt
        if sheet_lp_usd > 0:
            s["liquidityUsd"] = float(sheet_lp_usd)
        s["equityUsd"] = (
            float(s.get("collateralUsd") or 0.0)
            - float(s.get("debtUsd") or 0.0)
            + float(s.get("liquidityUsd") or 0.0)
        )
        snapshots[i] = s
    return snapshots


def merge_strategy_one_snapshots_from_js_file(current: list[dict], js_path: Path) -> list[dict]:
    if not js_path.exists() or not current:
        return current
    try:
        raw = js_path.read_text(encoding="utf-8")
        m = re.search(r"window\.PORTFOLIO_DATA\s*=\s*(\{.*\})\s*;?\s*$", raw, re.S)
        if not m:
            return current
        old = json.loads(m.group(1))
        old_snaps = (old.get("strategyOne") or {}).get("snapshots") or []
        if len(old_snaps) <= len(current):
            return current
        by_day = {s["timestamp"][:10]: s for s in current}
        for s in old_snaps:
            by_day[s["timestamp"][:10]] = s
        merged = [by_day[k] for k in sorted(by_day.keys())]
        return merged if len(merged) > len(current) else current
    except Exception:
        return current


def load_latest_debank_lending_csv(config: dict) -> list[dict]:
    candidates = sorted(Path(".").glob("debank_lending_*.csv"), key=lambda p: p.stat().st_mtime, reverse=True)
    out = []
    wallet = (config.get("debank_wallets", [""]) or [""])[0]
    debank_link = f"https://debank.com/profile/{wallet}" if wallet else "https://debank.com"
    if not candidates:
        return out
    with candidates[0].open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for r in reader:
            collateral_asset = r.get("collateral_asset", "")
            collateral_usd = parse_float(r.get("collateral_usd", ""))
            collateral_amount = parse_float(r.get("collateral_amount", ""))
            borrow_asset = r.get("borrow_asset", "")
            borrow_amount = parse_float(r.get("borrow_amount", ""))
            borrow_usd = parse_float(r.get("borrow_usd", ""))
            hf_raw = parse_float(r.get("health_factor", ""))
            market_price = (collateral_usd / collateral_amount) if collateral_amount > 0 else 0.0
            if borrow_usd <= 0 and borrow_amount > 0 and market_price > 0:
                borrow_usd = borrow_amount * market_price
            hf = sanitize_lending_health_factor(
                hf_raw,
                collateral_usd=collateral_usd,
                borrow_usd=borrow_usd,
            )
            liquidation_price = (market_price / hf) if hf > 0 and hf <= 25 and market_price > 0 else 0.0
            chain_raw = lending_chain_for_position(
                r.get("protocol", ""),
                chain_raw=(r.get("chain") or r.get("chain_id") or "").strip(),
                collateral_asset=collateral_asset,
                borrow_asset=borrow_asset,
            )
            out.append(
                {
                    "protocol": r.get("protocol", ""),
                    "chain": chain_raw,
                    "collateralAsset": collateral_asset,
                    "collateralAmount": collateral_amount,
                    "collateralUsd": collateral_usd,
                    "borrowAsset": borrow_asset,
                    "borrowAmount": borrow_amount,
                    "borrowUsd": borrow_usd,
                    "supplied": [{"asset": collateral_asset, "amount": collateral_amount, "usd": collateral_usd}],
                    "borrowed": [{"asset": borrow_asset, "amount": borrow_amount, "usd": borrow_usd}],
                    "netUsd": collateral_usd - borrow_usd,
                    "timestamp": r.get("timestamp", ""),
                    "healthFactor": hf,
                    "marketPrice": market_price,
                    "liquidationPrice": liquidation_price,
                    "link": debank_link,
                }
            )
    return dedupe_lending_positions(out)


def load_liquidity_positions_from_sheet(config: dict) -> list[dict]:
    sheet_id = config.get("google_sheet_id", "")
    rows = load_google_sheet_rows_by_name(sheet_id, config.get("public_portfolio_sheet_name", "Public portfolio"))
    if not rows:
        rows = load_google_sheet_rows(sheet_id, str(config.get("revert_pools_gid", "")).strip())
    out = []
    for r in rows:
        token0 = row_get(r, "Токен 0", "token0", "AK")
        token1 = row_get(r, "Токен 1", "token1", "AL")
        if not token0 and not token1:
            continue
        is_active = liquidity_is_active_from_row(r)
        closed_at = closed_display_from_row(r, is_active)
        apr = fee_apy_percent_from_public_row(r)
        fee_tier = fee_tier_public_row(r)
        link = row_get(r, "Ссылка на позицию", "I") or build_revert_link_from_row(r)
        platform_raw = row_get(r, "Платформа (DEX)", "Платформа", "exchange", "BI")
        dex = dex_from_revert_link(link) if link else (platform_raw or "DEX")
        pos_id = revert_position_id(link) or re.sub(r"\D", "", row_get(r, "NFT tokenId", "I", "BT") or "")
        val_usd = live_value_usd_public_row(r)
        inc_usd, inc_token = incentives_usd_public_row(r)
        item = {
            "platform": dex,
            "dataSource": "Revert Finance",
            "chain": row_get(r, "Сеть", "network", "BH"),
            "pair": f"{token0} / {token1}".strip(" /"),
            "feesUsd": fees_usd_public_row(r),
            "incentivesUsd": round(inc_usd, 4) if inc_usd > 0 else 0.0,
            "incentiveToken": inc_token,
            "apr": 0.0,
            "openedAt": row_get(r, "Дата открытия", "Дата открытия норм", "W", "first_mint_ts"),
            "closedAt": closed_at,
            "isActive": is_active,
            "feeTier": fee_tier,
            "link": link,
            "positionId": pos_id,
            "valueUsd": round(val_usd, 2),
        }
        item.update(parse_position_range(r))
        calc_apr = position_apr_from_item(item)
        item["apr"] = round(calc_apr, 4) if calc_apr > 0 else round(apr, 4) if apr > 0 else 0.0
        item["displayApr"] = item["apr"]
        out.append(item)
    by_key: dict[str, dict] = {}
    for item in out:
        key = (item.get("positionId") or "").strip() or (item.get("link") or "").strip()
        if not key:
            key = f"{item.get('chain')}|{item.get('pair')}|{len(by_key)}"
        by_key[key] = item

    def sort_key(it: dict) -> tuple:
        active_rank = 0 if it.get("isActive") else 1
        d = parse_date(str(it.get("openedAt") or ""))
        ts = d.timestamp() if d else 0.0
        return (active_rank, -ts)

    return sorted(by_key.values(), key=sort_key)


def strategy_lp_positions(config: dict) -> list[dict]:
    sheet_id = config.get("google_sheet_id", "")
    sheet_name = config.get("public_portfolio_sheet_name", "Public portfolio")
    wallet = (config.get("strategy_one_wallet") or "").strip().lower()
    s1_position_ids = {"1091768", "5458419"}
    rows = load_google_sheet_rows_by_name(sheet_id, sheet_name)
    out: list[dict] = []
    for r in rows:
        link = str(row_get(r, "Ссылка на позицию", "position_url", "I", "link")).strip()
        if not link:
            link = build_revert_link_from_row(r)
        pos_id = revert_position_id(link) or re.sub(r"\D", "", row_get(r, "NFT tokenId", "I", "BT") or "")
        w = str(row_get(r, "Кошелёк", "Кошелек", "wallet", "owner_wallet")).strip().lower()
        token0 = str(row_get(r, "Токен 0", "token0", "AK")).strip().upper()
        token1 = str(row_get(r, "Токен 1", "token1", "AL")).strip().upper()
        stable_s1 = {"USDC", "USDT", "USDC.E", "USDCE"} & {token0, token1}
        if wallet and wallet not in w and pos_id not in s1_position_ids and len(stable_s1) < 2:
            continue
        if not token0 and not token1:
            continue
        pair = f"{token0} / {token1}".strip(" /")
        value_usd = live_value_usd_public_row(r)
        fees_usd = fees_usd_public_row(r)
        is_active = liquidity_is_active_from_row(r)
        closed_at = closed_display_from_row(r, is_active)
        apr = fee_apy_percent_from_public_row(r)
        fee_tier = fee_tier_public_row(r)
        inc_usd, inc_token = incentives_usd_public_row(r)
        item = {
            "instrument": "LP",
            "platform": dex_from_revert_link(link),
            "dataSource": "Revert Finance",
            "pair": pair or "Pool",
            "chain": str(row_get(r, "Сеть", "network", "BH")).strip(),
            "feesUsd": fees_usd,
            "incentivesUsd": round(inc_usd, 4) if inc_usd > 0 else 0.0,
            "incentiveToken": inc_token,
            "apr": apr,
            "openedAt": row_get(r, "Дата открытия", "Дата открытия норм", "W", "first_mint_ts"),
            "closedAt": closed_at,
            "isActive": is_active,
            "feeTier": fee_tier,
            "link": link,
            "positionId": revert_position_id(link),
            "valueUsd": value_usd if is_active else 0.0,
        }
        item.update(parse_position_range(r))
        out.append(item)
    return out

def pendle_positions(wallet: str) -> tuple[list[dict], float]:
    if not wallet:
        return [], 0.0
    url = f"https://api-v2.pendle.finance/core/v1/dashboard/positions/database/{wallet}"
    res = requests.get(url, timeout=30)
    res.raise_for_status()
    raw = res.json()
    market_name_by_id: dict[str, str] = {}
    chain_ids = [int(c.get("chainId", 0) or 0) for c in raw.get("positions", [])]
    for chain_id in set(chain_ids):
        if chain_id <= 0:
            continue
        try:
            meta = requests.get(
                f"https://api-v2.pendle.finance/core/v1/markets/all?chainId={chain_id}",
                timeout=30,
            )
            meta.raise_for_status()
            for m in meta.json().get("markets", []):
                addr = str(m.get("address", "")).lower()
                if not addr:
                    continue
                mid = f"{chain_id}-{addr}"
                market_name_by_id[mid] = str(m.get("name", "") or "").strip()
        except Exception:
            # keep graceful fallback to marketId
            pass
    out: list[dict] = []
    total = 0.0
    for chain in raw.get("positions", []):
        chain_id = int(chain.get("chainId", 0) or 0)
        for pos in chain.get("openPositions", []):
            pt = float((pos.get("pt") or {}).get("valuation") or 0.0)
            yt = float((pos.get("yt") or {}).get("valuation") or 0.0)
            lp = float((pos.get("lp") or {}).get("valuation") or 0.0)
            v = pt + yt + lp
            total += v
            out.append(
                {
                    "instrument": "Pendle",
                    "platform": "Pendle",
                    "chain": str(chain_id),
                    "marketId": pos.get("marketId", ""),
                    "pair": market_name_by_id.get(str(pos.get("marketId", "")).lower(), pos.get("marketId", "")),
                    "ptUsd": pt,
                    "ytUsd": yt,
                    "lpUsd": lp,
                    "valueUsd": v,
                    "isActive": True,
                    "link": "https://app.pendle.finance/trade/markets",
                }
            )
    return out, total


def hyperliquid_positions(wallets: list[str], preferred_vault: str = "") -> tuple[list[dict], float]:
    url = "https://api.hyperliquid.xyz/info"
    stable = {"USDC", "USDT", "USDE", "USDH", "USDT0"}
    preferred_vault_lc = str(preferred_vault or "").strip().lower()
    best_positions: list[dict] = []
    best_total = 0.0
    for wallet in wallets:
        w = (wallet or "").strip()
        if not w:
            continue
        out: list[dict] = []
        total = 0.0
        # Perps account state
        res = requests.post(url, json={"type": "clearinghouseState", "user": w}, timeout=30)
        res.raise_for_status()
        raw = res.json()
        total += parse_float((raw.get("marginSummary") or {}).get("accountValue", "0"))
        for p in raw.get("assetPositions", []):
            item = p.get("position") or {}
            out.append(
                {
                    "instrument": "Hyperliquid",
                    "platform": "Hyperliquid",
                    "pair": item.get("coin", "") or "-",
                    "coin": item.get("coin", ""),
                    "szi": parse_float(item.get("szi", "0")),
                    "entryPx": parse_float(item.get("entryPx", "0")),
                    "positionValue": parse_float(item.get("positionValue", "0")),
                    "unrealizedPnl": parse_float(item.get("unrealizedPnl", "0")),
                    "valueUsd": parse_float(item.get("positionValue", "0")),
                    "link": "https://app.hyperliquid.xyz/",
                }
            )
        # Spot balances (can be non-zero while perps are zero)
        try:
            sres = requests.post(url, json={"type": "spotClearinghouseState", "user": w}, timeout=30)
            sres.raise_for_status()
            sraw = sres.json()
            for b in sraw.get("balances", []):
                coin = str(b.get("coin", "") or "")
                amt = parse_float(b.get("total", "0"))
                if amt <= 0:
                    continue
                px = 1.0 if coin.upper() in stable else 0.0
                v = amt * px
                total += v
                out.append(
                    {
                        "instrument": "Hyperliquid",
                        "platform": "Hyperliquid",
                        "pair": coin,
                        "coin": coin,
                        "valueUsd": v,
                        "link": "https://app.hyperliquid.xyz/",
                    }
                )
        except Exception:
            pass

        # Vault equities (HLP and other vault strategies).
        # Important: these positions are not visible in clearinghouse/spot states.
        try:
            vres = requests.post(url, json={"type": "userVaultEquities", "user": w}, timeout=30)
            vres.raise_for_status()
            vraw = vres.json()
            if isinstance(vraw, list):
                vault_items = [x for x in vraw if parse_float((x or {}).get("equity", "0")) > 0]
                if preferred_vault_lc:
                    ordered = sorted(
                        vault_items,
                        key=lambda x: (
                            str((x or {}).get("vaultAddress", "")).lower() != preferred_vault_lc,
                            -parse_float((x or {}).get("equity", "0")),
                        ),
                    )
                else:
                    ordered = sorted(vault_items, key=lambda x: -parse_float((x or {}).get("equity", "0")))
                for v in ordered:
                    vault_addr = str((v or {}).get("vaultAddress", "") or "")
                    equity_usd = parse_float((v or {}).get("equity", "0"))
                    if equity_usd <= 0:
                        continue
                    total += equity_usd
                    out.append(
                        {
                            "instrument": "Hyperliquid",
                            "platform": "Hyperliquid",
                            "pair": "Vault equity",
                            "coin": vault_addr or "-",
                            "vaultAddress": vault_addr,
                    "valueUsd": equity_usd,
                    "isActive": True,
                    "link": "https://app.hyperliquid.xyz/",
                }
                    )
        except Exception:
            pass
        if total > best_total or (total == best_total and len(out) > len(best_positions)):
            best_total = total
            best_positions = out
    return best_positions, best_total


def ensure_strategy_one_tables(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS strategy_one_daily_metrics (
            as_of_date TEXT PRIMARY KEY,
            total_usd REAL NOT NULL DEFAULT 0,
            lp_usd REAL NOT NULL DEFAULT 0,
            pendle_usd REAL NOT NULL DEFAULT 0,
            hyperliquid_usd REAL NOT NULL DEFAULT 0,
            total_fee_usd REAL NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS strategy_one_positions_daily (
            as_of_date TEXT NOT NULL,
            position_key TEXT NOT NULL,
            instrument TEXT NOT NULL,
            data_json TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (as_of_date, position_key)
        )
        """
    )


def upsert_strategy_one(
    conn: sqlite3.Connection,
    as_of_date: str,
    lp_positions: list[dict],
    pendle_list: list[dict],
    hyper_list: list[dict],
    lp_usd: float,
    pendle_usd: float,
    hyper_usd: float,
) -> None:
    ensure_strategy_one_tables(conn)
    total_fee = sum(max(0.0, float(p.get("feesUsd") or 0.0)) for p in lp_positions)
    total = lp_usd + pendle_usd + hyper_usd
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO strategy_one_daily_metrics(
            as_of_date, total_usd, lp_usd, pendle_usd, hyperliquid_usd, total_fee_usd, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(as_of_date) DO UPDATE SET
            total_usd=excluded.total_usd,
            lp_usd=excluded.lp_usd,
            pendle_usd=excluded.pendle_usd,
            hyperliquid_usd=excluded.hyperliquid_usd,
            total_fee_usd=excluded.total_fee_usd,
            updated_at=datetime('now')
        """,
        (as_of_date, total, lp_usd, pendle_usd, hyper_usd, total_fee),
    )
    cur.execute("DELETE FROM strategy_one_positions_daily WHERE as_of_date = ?", (as_of_date,))
    for p in lp_positions:
        k = f"LP:{p.get('pair','')}"
        cur.execute(
            """
            INSERT INTO strategy_one_positions_daily(as_of_date, position_key, instrument, data_json, updated_at)
            VALUES (?, ?, 'LP', ?, datetime('now'))
            """,
            (as_of_date, k, json.dumps(p, ensure_ascii=False)),
        )
    for p in pendle_list:
        k = f"PENDLE:{p.get('marketId','')}"
        cur.execute(
            """
            INSERT INTO strategy_one_positions_daily(as_of_date, position_key, instrument, data_json, updated_at)
            VALUES (?, ?, 'PENDLE', ?, datetime('now'))
            """,
            (as_of_date, k, json.dumps(p, ensure_ascii=False)),
        )
    for p in hyper_list:
        k = f"HL:{p.get('coin','')}"
        cur.execute(
            """
            INSERT INTO strategy_one_positions_daily(as_of_date, position_key, instrument, data_json, updated_at)
            VALUES (?, ?, 'HYPERLIQUID', ?, datetime('now'))
            """,
            (as_of_date, k, json.dumps(p, ensure_ascii=False)),
        )
    conn.commit()


def load_strategy_one(conn: sqlite3.Connection) -> dict:
    cur = conn.cursor()
    rows = cur.execute(
        """
        SELECT as_of_date, total_usd, lp_usd, pendle_usd, hyperliquid_usd, total_fee_usd
        FROM strategy_one_daily_metrics
        ORDER BY as_of_date ASC
        """
    ).fetchall()
    snapshots: list[dict] = []
    fee_series: list[float] = []
    for r in rows:
        snapshots.append(
            {
                "timestamp": f"{r[0]}T00:00:00.000Z",
                "equityUsd": float(r[1] or 0),
                "lpUsd": float(r[2] or 0),
                "pendleUsd": float(r[3] or 0),
                "hyperliquidUsd": float(r[4] or 0),
            }
        )
        fee_series.append(float(r[5] or 0))
    try:
        _cfg_s1 = json.loads(Path("python/config.json").read_text(encoding="utf-8"))
        s1_init = float(_cfg_s1.get("strategy_one_initial_usd", 30) or 30)
    except Exception:
        s1_init = 30.0
    per_leg = s1_init / 3.0
    # Baseline day before first DB row: full initial capital (chart starts at $30, then real days).
    if not snapshots:
        today = datetime.now(timezone.utc).date()
        yday = (today - timedelta(days=1)).isoformat()
        snapshots = [
            {
                "timestamp": f"{yday}T00:00:00.000Z",
                "equityUsd": s1_init,
                "lpUsd": per_leg,
                "pendleUsd": per_leg,
                "hyperliquidUsd": per_leg,
            },
            {
                "timestamp": f"{today.isoformat()}T00:00:00.000Z",
                "equityUsd": s1_init,
                "lpUsd": per_leg,
                "pendleUsd": per_leg,
                "hyperliquidUsd": per_leg,
            },
        ]
        fee_series = [0.0, 0.0]
    else:
        first_ts = snapshots[0]["timestamp"][:10]
        first_d = datetime.fromisoformat(first_ts).date()
        baseline_d = (first_d - timedelta(days=1)).isoformat()
        snapshots.insert(
            0,
            {
                "timestamp": f"{baseline_d}T00:00:00.000Z",
                "equityUsd": s1_init,
                "lpUsd": per_leg,
                "pendleUsd": per_leg,
                "hyperliquidUsd": per_leg,
            },
        )
        fee_series.insert(0, 0.0)

    apr: list[float] = []
    for i, s in enumerate(snapshots):
        if i == 0:
            apr.append(0.0)
            continue
        prev_equity = max(float(snapshots[i - 1]["equityUsd"] or 0.0), 1.0)
        cur_equity = float(s["equityUsd"] or 0.0)
        daily_return = (cur_equity - prev_equity) / prev_equity
        apr.append(daily_return * 365.0 * 100.0)
    latest_day = snapshots[-1]["timestamp"][:10] if snapshots else ""
    pos_rows = cur.execute(
        """
        SELECT data_json
        FROM strategy_one_positions_daily
        WHERE as_of_date = ?
        ORDER BY instrument, position_key
        """,
        (latest_day,),
    ).fetchall() if latest_day else []
    positions = [json.loads(r[0]) for r in pos_rows]
    for p in positions:
        if "isActive" not in p:
            p["isActive"] = not bool(str(p.get("closedAt") or "").strip())
    return {"snapshots": snapshots, "dailyYieldSeries": apr, "positions": positions}


def main() -> None:
    config = json.loads(Path("python/config.json").read_text(encoding="utf-8"))
    db_path = config["db_path"]
    initial_capital = 16300.0
    current_adjustment = float(config.get("manual_visual_adjustment_usd", 0) or 0)

    script_dir = Path(__file__).resolve().parent
    if str(script_dir) not in sys.path:
        sys.path.insert(0, str(script_dir))
    from init_db import init_db

    init_db(db_path)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    rows = cur.execute(
        """
        SELECT as_of_date, collateral_usd, debt_usd, liquidity_usd, daily_fee_income_usd
        FROM daily_metrics
        ORDER BY as_of_date ASC
        """
    ).fetchall()
    snapshots = []
    for row in rows:
        collateral = float(row["collateral_usd"] or 0)
        debt = float(row["debt_usd"] or 0)
        liquidity = float(row["liquidity_usd"] or 0)
        snapshots.append(
            {
                "timestamp": f"{row['as_of_date']}T00:00:00.000Z",
                "collateralUsd": collateral,
                "debtUsd": debt,
                "liquidityUsd": liquidity,
                "equityUsd": collateral - debt + liquidity,
                "dailyFeeIncomeUsd": float(row["daily_fee_income_usd"] or 0),
            }
        )

    lending_positions = dedupe_lending_positions(load_latest_debank_lending_csv(config))
    sheet_lp_usd = sum(
        max(0.0, float(p.get("valueUsd") or 0.0))
        for p in load_liquidity_positions_from_sheet(config)
        if p.get("isActive", True)
    )
    equity_ref = load_equity_reference_by_day()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if equity_ref:
        snapshots = snapshots_from_equity_reference(equity_ref, snapshots, through_day=today)
    else:
        snapshots = apply_snapshot_reference(snapshots, equity_ref)
    anchor_day = max(equity_ref.keys()) if equity_ref else ""
    if anchor_day:
        snapshots = forward_fill_equity_calendar_tail(snapshots, anchor_day, equity_ref)
    snapshots = fill_calendar_gaps_in_snapshots(snapshots, max_gap_days=45)
    snapshots = patch_recent_snapshots_from_sources(
        snapshots, lending_positions, sheet_lp_usd, config=config, days=12
    )
    if sheet_lp_usd < 3000:
        print(
            f"[WARN] sheet_lp_usd={sheet_lp_usd:.2f} — похоже на битый парсинг таблицы "
            "(NBSP). Обнови python/etl_revert.py на PA и перезапусти etl."
        )
    if snapshots and sheet_lp_usd > 0:
        last = dict(snapshots[-1])
        coll, debt, _ = aggregate_lending_totals(lending_positions)
        if coll > 0:
            last["collateralUsd"] = coll
        if debt > 0:
            last["debtUsd"] = debt
        last["liquidityUsd"] = float(sheet_lp_usd)
        last["equityUsd"] = float(last["collateralUsd"]) - float(last["debtUsd"]) + float(
            last["liquidityUsd"]
        )
        snapshots[-1] = last

    if not snapshots_already_rebased(snapshots, initial_capital):
        snapshots = rebase_equity_start_only(snapshots, initial_capital, current_adjustment)
    liquidity_positions_pre = load_liquidity_positions_from_sheet(config)
    fallback_apr = mean_apr_from_revert_sheet(config)
    month_apr = month_apr_map_from_revert_sheet(config)
    synthetic_daily_yield = build_daily_yield_series(snapshots, fallback_apr, month_apr)
    realized_by_day = load_realized_apr_by_day(conn)
    rollup_by_day = load_apr_rollup_by_day(conn)
    snapshots, income_by_day = assign_daily_fee_income_to_snapshots(
        snapshots, rollup_by_day, config, liquidity_positions_pre
    )
    fee_based_yield = build_fee_based_daily_yield(snapshots)
    daily_yield_series = build_chart_daily_yield_series(
        snapshots,
        fee_based_yield,
        synthetic_daily_yield,
        realized_by_day,
        rollup_by_day,
        config,
        max_chart_apr=MAX_CHART_DAILY_APR_PCT,
    )
    apr_audit = build_apr_audit(snapshots, daily_yield_series, fee_based_yield, realized_by_day, rollup_by_day)

    tx_path = Path("data/transactions.json")
    transactions = json.loads(tx_path.read_text(encoding="utf-8")) if tx_path.exists() else []
    liquidity_positions = liquidity_positions_pre or load_liquidity_positions_from_sheet(config)
    if not lending_positions:
        lending_positions = load_latest_debank_lending_csv(config)

    wallet = (
        (config.get("strategy_one_wallet") or "").strip()
        or (config.get("strategy_wallet") or "").strip()
        or ((config.get("debank_wallets") or [""]) + [""])[0]
    )
    s_lp = strategy_lp_positions(config)
    s_lp_active = [p for p in s_lp if p.get("isActive", True)]
    s_lp_usd = sum(max(0.0, float(p.get("valueUsd") or 0.0)) for p in s_lp_active)
    try:
        s_pendle, s_pendle_usd = pendle_positions(wallet)
    except Exception:
        s_pendle, s_pendle_usd = [], 0.0
    hyper_wallets: list[str] = []
    for x in [
        config.get("hyperliquid_wallet"),
        config.get("strategy_one_wallet"),
        config.get("strategy_wallet"),
        *((config.get("hyperliquid_wallets") or [])),
        *((config.get("debank_wallets") or [])),
    ]:
        s = str(x or "").strip()
        if s and s not in hyper_wallets:
            hyper_wallets.append(s)
    try:
        s_hyper, s_hyper_usd = hyperliquid_positions(
            hyper_wallets,
            preferred_vault=(config.get("hyperliquid_preferred_vault") or config.get("hyperliquid_vault") or ""),
        )
    except Exception:
        s_hyper, s_hyper_usd = [], 0.0
    if not s_pendle:
        s_pendle = [
            {
                "instrument": "Pendle",
                "platform": "Pendle",
                "chain": "-",
                "marketId": "-",
                "valueUsd": s_pendle_usd,
                "link": "https://app.pendle.finance/trade/markets",
            }
        ]
    if not s_hyper:
        s_hyper = [
            {
                "instrument": "Hyperliquid",
                "platform": "Hyperliquid",
                "coin": "-",
                "valueUsd": s_hyper_usd,
                "link": "https://app.hyperliquid.xyz/",
            }
        ]
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    upsert_strategy_one(conn, today, s_lp_active, s_pendle, s_hyper, s_lp_usd, s_pendle_usd, s_hyper_usd)
    strategy_one = load_strategy_one(conn)
    s1_init = float(config.get("strategy_one_initial_usd", 30) or 30)
    s1_live = s_lp_usd + s_pendle_usd + s_hyper_usd
    s1_ref_snaps = flatten_strategy_one_equity_dips(
        load_s1_snapshots_reference(), s1_init
    )
    s1_snaps = flatten_strategy_one_equity_dips(
        strategy_one.get("snapshots") or [], s1_init
    )
    if len(s1_ref_snaps) > len(s1_snaps):
        s1_snaps = s1_ref_snaps
    else:
        s1_snaps = flatten_strategy_one_equity_dips(s1_snaps, s1_init)
    s1_fallback_pos = []
    ref_path = Path("data/s1-positions-reference.json")
    if ref_path.exists():
        try:
            s1_fallback_pos = json.loads(ref_path.read_text(encoding="utf-8")).get("positions") or []
        except Exception:
            pass
    s1_positions = merge_strategy_one_positions(s_lp + s_pendle + s_hyper, s1_fallback_pos)
    s1_live_components = sum(
        max(0.0, float(p.get("valueUsd") or 0.0))
        for p in s1_positions
        if p.get("isActive", True)
    )
    s1_live = s1_live_components if s1_live_components >= s1_init * 0.85 else (s_lp_usd + s_pendle_usd + s_hyper_usd)
    if s1_live < s1_init * 0.85:
        for p in s1_fallback_pos:
            if p.get("isActive", True):
                s1_live = max(s1_live, s1_init * 0.997)
                break
    s_lp_usd_eff = s_lp_usd if s_lp_usd > 0 else sum(
        float(p.get("valueUsd") or 0.0) for p in s1_positions if p.get("instrument") == "LP" and p.get("isActive")
    )
    strategy_one["snapshots"] = sanitize_strategy_one_snapshots(
        s1_snaps,
        s1_live,
        s1_init,
        lp_usd=s_lp_usd_eff,
        pendle_usd=s_pendle_usd,
        hyper_usd=s_hyper_usd,
    )
    s1_start_day = (
        str(strategy_one["snapshots"][0].get("timestamp", ""))[:10] if strategy_one.get("snapshots") else today
    )
    s1_positions = strategy_one_attach_display_apr(
        s1_positions, as_of_day=today, portfolio_start_day=s1_start_day
    )
    s1_mean_apr = strategy_one_arithmetic_mean_apr(
        s1_positions, as_of_day=today, portfolio_start_day=s1_start_day
    )
    s1_ref_for_yield = load_s1_snapshots_reference() or s1_ref_snaps
    strategy_one["dailyYieldSeries"] = strategy_one_chart_yield_series(
        strategy_one["snapshots"],
        s1_positions,
        base_series=strategy_one.get("dailyYieldSeries") or [],
        reference_snapshots=s1_ref_for_yield,
        patch_tail_days=5,
        max_apr=25.0,
        portfolio_start_day=s1_start_day,
    )
    strategy_one["meanDisplayApr"] = round(s1_mean_apr, 4)
    strategy_one["positions"] = s1_positions
    conn.close()

    chart_yield_by_day = load_yield_reference_by_day()
    for i, s in enumerate(snapshots):
        d = str(s.get("timestamp", ""))[:10]
        if i < len(daily_yield_series) and daily_yield_series[i] > 0.01:
            apr_v = float(daily_yield_series[i])
            if apr_v < MAX_CHART_DAILY_APR_PCT - 0.5:
                chart_yield_by_day[d] = apr_v
    for d, apr_v in list(chart_yield_by_day.items()):
        if float(apr_v or 0) >= MAX_CHART_DAILY_APR_PCT - 0.5:
            del chart_yield_by_day[d]
    ref_path = Path("data/chart-yield-reference.json")
    if chart_yield_by_day:
        ref_path.write_text(
            json.dumps({"byDay": chart_yield_by_day}, ensure_ascii=False),
            encoding="utf-8",
        )

    gaps = 0
    if len(snapshots) >= 2:
        for j in range(1, len(snapshots)):
            d0 = datetime.strptime(str(snapshots[j - 1]["timestamp"])[:10], "%Y-%m-%d").date()
            d1 = datetime.strptime(str(snapshots[j]["timestamp"])[:10], "%Y-%m-%d").date()
            if (d1 - d0).days > 1:
                gaps += 1
    if gaps:
        print(
            f"[WARN] В snapshots {gaps} календарных дыр. "
            "Залей data/equity-history-reference.json на PA и в GitHub."
        )
    if len(chart_yield_by_day) < 100:
        print("[WARN] chartYieldByDay пустой — залей data/chart-yield-reference.json на PA.")
    if len(equity_ref) < 100:
        print("[WARN] equity_ref пустой — залей data/equity-history-reference.json на PA.")
    else:
        print(f"[OK] chartYieldByDay={len(chart_yield_by_day)} equityHistoryByDay={len(equity_ref)} snapshots={len(snapshots)}")

    exported_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload = {
        "exportedAt": exported_at,
        "googleSheetId": config.get("google_sheet_id", ""),
        "publicPortfolioSheetName": config.get("public_portfolio_sheet_name", "Public portfolio"),
        "portfolioWallet": ((config.get("debank_wallets") or [""]) + [""])[0],
        "debankWallets": config.get("debank_wallets") or [],
        "initialCapitalUsd": initial_capital,
        "manualVisualAdjustmentUsd": current_adjustment,
        "prices": {"BTC": 95000, "ETH": 1800},
        "snapshots": snapshots,
        "dailyYieldSeries": daily_yield_series,
        "chartYieldByDay": chart_yield_by_day,
        "equityHistoryByDay": equity_history_payload_from_snapshots(snapshots),
        "fallbackApr": fallback_apr,
        "monthAprMap": month_apr,
        "realizedAprByDay": realized_by_day,
        "aprAudit": apr_audit,
        "incomeByDay": {k: round(float(v), 6) for k, v in sorted(income_by_day.items())},
        "liquidityPositions": liquidity_positions,
        "lendingPositions": lending_positions,
        "transactions": transactions,
        "strategyOne": strategy_one,
        "strategyOneInitialUsd": float(config.get("strategy_one_initial_usd", 30) or 30),
    }

    out = Path("data/portfolio-data.js")
    out.write_text("window.PORTFOLIO_DATA = " + json.dumps(payload, ensure_ascii=False) + ";", encoding="utf-8")
    print(f"[OK] Exported static data to {out} (exportedAt={exported_at})")

    validate_script = Path(__file__).resolve().parent.parent / "scripts" / "validate_portfolio_export.py"
    if validate_script.exists():
        import subprocess

        proc = subprocess.run(
            [sys.executable, str(validate_script), str(out)],
            cwd=str(Path(__file__).resolve().parent.parent),
            capture_output=True,
            text=True,
        )
        if proc.stdout.strip():
            print(proc.stdout.strip())
        if proc.returncode != 0:
            if proc.stderr.strip():
                print(proc.stderr.strip(), file=sys.stderr)
            print("[WARN] validate_portfolio_export.py reported issues (export kept)", file=sys.stderr)

    if len(snapshots) < 130:
        raise SystemExit(
            "[FATAL] Мало дней в snapshots — залей data/equity-history-reference.json и обнови export_static_data.py"
        )
    last_snap = snapshots[-1]
    if float(last_snap.get("liquidityUsd") or 0) < 3000:
        raise SystemExit(
            f"[FATAL] liquidityUsd={last_snap.get('liquidityUsd')} на последний день. "
            "Сначала: python python/etl_revert.py (нужен фикс NBSP в etl_revert.py)."
        )
    if not chart_yield_by_day or len(chart_yield_by_day) < 100:
        raise SystemExit("[FATAL] chartYieldByDay пустой — залей data/chart-yield-reference.json")


if __name__ == "__main__":
    main()
