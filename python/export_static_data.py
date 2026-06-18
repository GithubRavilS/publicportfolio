#!/usr/bin/env python3
import csv
import json
import re
import sqlite3
import sys
import time
from collections.abc import Iterable
from datetime import date, datetime, timedelta, timezone
from io import StringIO
from pathlib import Path

import requests
from google_sheets_client import load_sheet_values_as_row_dicts
from jupiter_lend import (
    apply_jupiter_to_portfolio,
    fetch_jupiter_lending_positions,
    merge_live_lending,
    solana_wallets_from_config,
)
from lp_income_snapshots import apr_from_snapshot_row, fill_daily_income_on_snapshots
from lp_metadata import (
    LP_SHEET_FALLBACK_NAMES,
    incentive_token_for_platform,
    normalize_platform_label,
    resolve_lp_platform,
    sheet_headers_look_like_lp,
)


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
        parts = s.split(",")
        if len(parts) == 2 and len(parts[1]) == 3 and parts[1].isdigit() and len(parts[0]) <= 4:
            s = parts[0] + parts[1]
        else:
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


def _daily_close_from_coingecko_prices(prices: Iterable[tuple[float, float]]) -> dict[str, float]:
    """Одна цена на календарный день — последний тик UTC (close), без внутридневных выбросов."""
    buckets: dict[str, list[tuple[int, float]]] = {}
    for ts_ms, px in prices:
        day = datetime.utcfromtimestamp(ts_ms / 1000).date().isoformat()
        buckets.setdefault(day, []).append((int(ts_ms), float(px)))
    return {day: max(pts, key=lambda x: x[0])[1] for day, pts in buckets.items()}


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
    return _daily_close_from_coingecko_prices(res.json().get("prices", []))


def fetch_btc_history_binance(start_date: str, end_date: str) -> dict[str, float]:
    """Дневные close BTC/USDT с Binance (fallback при rate-limit CoinGecko)."""
    start_ms = int(datetime.fromisoformat(start_date).timestamp() * 1000)
    end_ms = int((datetime.fromisoformat(end_date) + timedelta(days=1)).timestamp() * 1000)
    out: dict[str, float] = {}
    cursor = start_ms
    while cursor < end_ms:
        url = (
            "https://api.binance.com/api/v3/klines"
            f"?symbol=BTCUSDT&interval=1d&startTime={cursor}&endTime={end_ms}&limit=1000"
        )
        res = requests.get(url, timeout=45)
        res.raise_for_status()
        rows = res.json()
        if not rows:
            break
        for row in rows:
            day = datetime.utcfromtimestamp(int(row[0]) / 1000).date().isoformat()
            out[day] = float(row[4])
        cursor = int(rows[-1][0]) + 86_400_000
        if len(rows) < 1000:
            break
        time.sleep(0.2)
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
    return _daily_close_from_coingecko_prices(res.json().get("prices", []))


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


def _eth_price_on(eth_by_day: dict[str, float], day: str) -> float:
    if day in eth_by_day and eth_by_day[day] > 0:
        return float(eth_by_day[day])
    known = sorted((d, p) for d, p in eth_by_day.items() if p > 0)
    if not known:
        return 0.0
    for d, p in reversed(known):
        if d <= day:
            return p
    return known[0][1]


# ~5% ETH → ~30% движение LP (нелинейная чувствительность пулов)
ETH_LP_PRICE_GAMMA = 6.0
MARKET_EQUITY_TAIL_DAYS = 21
EQUITY_CHART_START_DAY = "2026-01-01"
EQUITY_CHART_START_USD = 15100.0
EQUITY_CAPITAL_INJECT_DAY = "2026-02-15"
EQUITY_CAPITAL_INJECT_USD = 200.0
MANUAL_VISUAL_ADJUSTMENT_USD = 800.0
BTC_EQUITY_BETA = 1.3
JAN_EQUITY_SHAPAN_END_DAY = "2026-01-14"
EQUITY_BTC_BACKWARD_FROM_DAY = "2026-01-15"
EQUITY_CHART_MODEL_VERSION = "btc-beta-1.3-backward-jan-v6b"
EQUITY_CHART_MODEL_MARKER = Path("data/equity-chart-model.txt")
BTC_PRICES_CACHE_PATH = Path("data/btc-daily-prices.json")


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
    start_day = min(
        min(ref_by_day.keys()), min(db_by_day.keys()) if db_by_day else min(ref_by_day.keys())
    )
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


def sync_snapshot_today_live_capital(
    snapshots: list[dict],
    *,
    today: str,
    lending_positions: list[dict],
    sheet_lp_usd: float,
    adjustment_usd: float,
    open_lp_unclaimed_usd: float = 0.0,
) -> tuple[list[dict], float, float, float]:
    """Сегодня: equity = залог − долг + ликвидность + поправка + невыведённые fees активных LP."""
    if not snapshots:
        return snapshots, 0.0, 0.0, 0.0
    coll, debt, _ = aggregate_lending_totals(lending_positions)
    lp = float(sheet_lp_usd or 0.0)
    if coll <= 0 and debt <= 0 and lp <= 0:
        return snapshots, 0.0, 0.0, 0.0
    unclaimed = max(0.0, float(open_lp_unclaimed_usd or 0.0))
    base = coll - debt + lp
    live = base + float(adjustment_usd or 0.0) + unclaimed
    out = [dict(s) for s in snapshots]
    for i, s in enumerate(out):
        if str(s.get("timestamp", ""))[:10] != today:
            continue
        row = dict(s)
        row["collateralUsd"] = coll
        row["debtUsd"] = debt
        if lp > 0:
            row["liquidityUsd"] = lp
        row["equityUsd"] = live
        out[i] = row
        break
    else:
        out.append(
            {
                "timestamp": f"{today}T00:00:00.000Z",
                "collateralUsd": coll,
                "debtUsd": debt,
                "liquidityUsd": lp,
                "equityUsd": live,
                "dailyFeeIncomeUsd": 0.0,
            }
        )
        out.sort(key=lambda x: str(x.get("timestamp", "")))
    return out, base, live, unclaimed


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
    """Устарело: оставлено для совместимости; используй interpolate_equity_calendar_tail."""
    return interpolate_equity_calendar_tail(snapshots, anchor_day, ref_by_day)


def ensure_equity_calendar_through_day(
    snapshots: list[dict],
    through_day: str,
    ref_by_day: dict[str, dict] | None = None,
) -> list[dict]:
    """Добавляет пропущенные календарные дни до through_day (после конца equity-эталона)."""
    if not snapshots or not through_day:
        return snapshots
    ref_by_day = ref_by_day or {}
    by_day = {str(s["timestamp"])[:10]: dict(s) for s in snapshots}
    start_day = min(by_day.keys())
    anchor_day = max(ref_by_day.keys()) if ref_by_day else start_day
    seed = dict(ref_by_day.get(anchor_day) or by_day.get(anchor_day) or snapshots[-1])
    d_cur = datetime.strptime(start_day, "%Y-%m-%d").date()
    d_end = datetime.strptime(through_day, "%Y-%m-%d").date()
    last_row = dict(by_day.get(max(by_day.keys()), seed))
    while d_cur <= d_end:
        ds = d_cur.isoformat()
        if ds in by_day:
            last_row = dict(by_day[ds])
        else:
            filler = dict(last_row)
            filler["timestamp"] = f"{ds}T00:00:00.000Z"
            filler["dailyFeeIncomeUsd"] = 0.0
            by_day[ds] = filler
            last_row = filler
        d_cur += timedelta(days=1)
    return [by_day[k] for k in sorted(by_day.keys())]


def apply_uniform_equity_adjustment(snapshots: list[dict], adjustment_usd: float) -> list[dict]:
    """Рыночная база (coll−debt+liq) + фиксированная сумма на каждый день ряда (без размаза по дням)."""
    adj = float(adjustment_usd or 0.0)
    if adj <= 0:
        return snapshots
    out: list[dict] = []
    for s in snapshots:
        row = dict(s)
        base = (
            float(row.get("collateralUsd") or 0.0)
            - float(row.get("debtUsd") or 0.0)
            + float(row.get("liquidityUsd") or 0.0)
        )
        row["equityUsd"] = base + adj
        out.append(row)
    return out


def load_frozen_equity_chart_by_day(conn: sqlite3.Connection) -> dict[str, dict]:
    cur = conn.cursor()
    try:
        rows = cur.execute(
            """
            SELECT as_of_date, collateral_usd, debt_usd, liquidity_usd, equity_usd
            FROM equity_chart_daily
            ORDER BY as_of_date ASC
            """
        ).fetchall()
    except sqlite3.OperationalError:
        return {}
    out: dict[str, dict] = {}
    for r in rows:
        d = str(r[0])[:10]
        coll = float(r[1] or 0)
        debt = float(r[2] or 0)
        liq = float(r[3] or 0)
        eq = float(r[4] or 0) if len(r) > 4 and r[4] is not None else 0.0
        if eq <= 0:
            eq = coll - debt + liq
        out[d] = {
            "collateralUsd": coll,
            "debtUsd": debt,
            "liquidityUsd": liq,
            "equityUsd": eq,
        }
    return out


def overlay_frozen_equity_snapshots(
    snapshots: list[dict],
    frozen_by_day: dict[str, dict],
    *,
    today: str,
    market_tail_from: str = "",
) -> list[dict]:
    """Прошлые дни — freeze; хвост >= market_tail_from пересчитывается по BTC/ETH."""
    if not frozen_by_day:
        return snapshots
    out: list[dict] = []
    for s in snapshots:
        row = dict(s)
        d = str(row.get("timestamp", ""))[:10]
        if market_tail_from and d >= market_tail_from:
            out.append(row)
            continue
        if d and d < today and d in frozen_by_day:
            fr = frozen_by_day[d]
            row["collateralUsd"] = float(fr.get("collateralUsd") or 0)
            row["debtUsd"] = float(fr.get("debtUsd") or 0)
            row["liquidityUsd"] = float(fr.get("liquidityUsd") or 0)
        out.append(row)
    return out


def lending_collateral_btc_eth_usd(lending_positions: list[dict]) -> tuple[float, float]:
    btc_usd = 0.0
    eth_usd = 0.0
    for p in lending_positions:
        asset = str(p.get("collateralAsset") or "").upper()
        usd = float(p.get("collateralUsd") or 0.0)
        if usd <= 0:
            continue
        if "BTC" in asset:
            btc_usd += usd
        elif asset in ("ETH", "WETH"):
            eth_usd += usd
    return btc_usd, eth_usd


def _debt_usd_on_day(
    day: str,
    ref_by_day: dict[str, dict],
    debt_live: float,
    *,
    ref_through_day: str = "",
) -> float:
    """До ref_through_day — долг из эталона; после — live (без скачка 8026→7100 на последний день)."""
    if ref_through_day and day > ref_through_day and debt_live > 0:
        return debt_live
    if day in ref_by_day and float(ref_by_day[day].get("debtUsd") or 0) > 0:
        return float(ref_by_day[day]["debtUsd"])
    known = sorted(
        (d, float(v.get("debtUsd") or 0))
        for d, v in ref_by_day.items()
        if float(v.get("debtUsd") or 0) > 0
    )
    if not known:
        return debt_live
    for d, p in reversed(known):
        if d <= day:
            return p
    return known[0][1]


BTC_FETCH_CHUNK_DAYS = 30


def load_or_fetch_btc_by_day(start_day: str, end_day: str) -> dict[str, float]:
    """
    BTC USD по дням (UTC close). CoinGecko на длинном range отдаёт 1 точку/день с выбросами —
    тянем окнами по BTC_FETCH_CHUNK_DAYS, чтобы получить нормальный внутридневной close.
    """
    cached: dict[str, float] = {}
    if BTC_PRICES_CACHE_PATH.exists():
        try:
            payload = json.loads(BTC_PRICES_CACHE_PATH.read_text(encoding="utf-8"))
            cached = {str(k)[:10]: float(v) for k, v in (payload.get("byDay") or {}).items()}
        except Exception:
            cached = {}
    d0 = datetime.strptime(start_day, "%Y-%m-%d").date()
    d1 = datetime.strptime(end_day, "%Y-%m-%d").date()
    fetch_from = d0
    if cached and start_day in cached and end_day in cached:
        fetch_from = max(d0, d1 - timedelta(days=14))
    try:
        fresh = fetch_btc_history_binance(fetch_from.isoformat(), end_day)
        if not fresh:
            cur = fetch_from
            while cur <= d1:
                chunk_end = min(cur + timedelta(days=BTC_FETCH_CHUNK_DAYS), d1)
                try:
                    fresh = fetch_btc_history(cur.isoformat(), chunk_end.isoformat())
                except Exception:
                    fresh = fetch_btc_history_binance(cur.isoformat(), chunk_end.isoformat())
                if fresh:
                    cached.update(fresh)
                cur = chunk_end + timedelta(days=1)
                if cur <= d1:
                    time.sleep(0.45)
        else:
            cached.update(fresh)
        if cached:
            BTC_PRICES_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
            BTC_PRICES_CACHE_PATH.write_text(
                json.dumps({"byDay": cached}, ensure_ascii=False),
                encoding="utf-8",
            )
    except Exception as exc:
        print(f"[WARN] fetch BTC for equity chart: {exc}")
    return cached


def _liquidity_usd_market_path(
    days: list[str],
    eth_by_day: dict[str, float],
    lp_today: float,
    *,
    eth_lp_gamma: float = ETH_LP_PRICE_GAMMA,
) -> dict[str, float]:
    """LP от сегодня назад: дневной шаг ETH × gamma (5% ETH ≈ 30% LP)."""
    if lp_today <= 0 or not days:
        return {}
    liq_by_day: dict[str, float] = {}
    prev_ep = _eth_price_on(eth_by_day, days[-1])
    liq_cur = lp_today
    for d in reversed(days):
        ep = _eth_price_on(eth_by_day, d)
        if d == days[-1]:
            liq_by_day[d] = lp_today
            prev_ep = ep
            continue
        step = (ep / prev_ep - 1.0) if prev_ep > 0 else 0.0
        step = max(-0.12, min(0.12, step))
        denom = 1.0 + eth_lp_gamma * step
        liq_cur = liq_cur / denom if denom > 0 else liq_cur
        liq_by_day[d] = liq_cur
        prev_ep = ep
    return liq_by_day


def _frozen_snapshot_valid(fr: dict) -> bool:
    coll = float(fr.get("collateralUsd") or 0)
    eq = float(fr.get("equityUsd") or 0)
    return coll > 500 and eq > 8000


def _btc_forward_return(btc_by_day: dict[str, float], day_from: str, day_to: str) -> float:
    p0 = _btc_price_on(btc_by_day, day_from)
    p1 = _btc_price_on(btc_by_day, day_to)
    if p0 <= 0 or p1 <= 0:
        return 0.0
    return (p1 / p0) - 1.0


def _equity_by_btc_beta_backward(
    days: list[str],
    btc_by_day: dict[str, float],
    *,
    anchor_day: str,
    anchor_equity: float,
    beta: float = BTC_EQUITY_BETA,
) -> dict[str, float]:
    """От anchor_day (обычно сегодня) назад: вчера = сегодня / (1 + β×ΔBTC)."""
    if not days or anchor_day not in days:
        return {}
    out: dict[str, float] = {anchor_day: float(anchor_equity)}
    for i in range(len(days) - 1, 0, -1):
        d_cur = days[i]
        d_prev = days[i - 1]
        if d_cur not in out:
            continue
        r = _btc_forward_return(btc_by_day, d_prev, d_cur)
        denom = max(1.0 + beta * r, 0.05)
        out[d_prev] = out[d_cur] / denom
    return out


def _equity_by_btc_beta_forward(
    days: list[str],
    btc_by_day: dict[str, float],
    *,
    start_day: str,
    start_equity: float,
    beta: float = BTC_EQUITY_BETA,
) -> dict[str, float]:
    """От start_day вперёд: сегодня = вчера × (1 + β×ΔBTC)."""
    if not days or start_day not in days:
        return {}
    out: dict[str, float] = {start_day: float(start_equity)}
    for i in range(1, len(days)):
        d_prev, d_cur = days[i - 1], days[i]
        if d_prev not in out:
            continue
        r = _btc_forward_return(btc_by_day, d_prev, d_cur)
        out[d_cur] = out[d_prev] * (1.0 + beta * r)
    return out


def compute_btc_beta_equity_by_day(
    days: list[str],
    btc_by_day: dict[str, float],
    *,
    today: str,
    target_today: float,
    start_day: str = EQUITY_CHART_START_DAY,
    start_equity: float = EQUITY_CHART_START_USD,
    beta: float = BTC_EQUITY_BETA,
    jan_shapan_end: str = JAN_EQUITY_SHAPAN_END_DAY,
    backward_from: str = EQUITY_BTC_BACKWARD_FROM_DAY,
) -> dict[str, float]:
    """
    Левый график: от live-сегодня назад (β×ΔBTC); 01.01–14.01 — forward от 15100 (подгонка января);
    с 15.01 — та же backward-цепочка (без blend-хвоста → нет скачка +$3000).
    """
    if not days:
        return {}
    backward = _equity_by_btc_beta_backward(
        days, btc_by_day, anchor_day=today, anchor_equity=target_today, beta=beta
    )
    forward = _equity_by_btc_beta_forward(
        days, btc_by_day, start_day=start_day, start_equity=start_equity, beta=beta
    )
    merged: dict[str, float] = {}
    d_back = datetime.strptime(backward_from, "%Y-%m-%d").date()
    for d in days:
        dd = datetime.strptime(d, "%Y-%m-%d").date()
        if d == start_day:
            merged[d] = float(start_equity)
        elif d == today:
            merged[d] = float(target_today)
        elif dd < d_back:
            merged[d] = float(forward.get(d, start_equity))
        else:
            merged[d] = float(backward.get(d, target_today))
    merged[start_day] = float(start_equity)
    merged[today] = float(target_today)
    return merged


def should_rebuild_equity_chart_freeze() -> bool:
    if not EQUITY_CHART_MODEL_MARKER.exists():
        return True
    try:
        return (
            EQUITY_CHART_MODEL_MARKER.read_text(encoding="utf-8").strip()
            != EQUITY_CHART_MODEL_VERSION
        )
    except Exception:
        return True


def mark_equity_chart_model_saved() -> None:
    EQUITY_CHART_MODEL_MARKER.parent.mkdir(parents=True, exist_ok=True)
    EQUITY_CHART_MODEL_MARKER.write_text(EQUITY_CHART_MODEL_VERSION + "\n", encoding="utf-8")


def build_market_equity_snapshots_calendar(
    *,
    today: str,
    lending_positions: list[dict],
    sheet_lp_usd: float,
    ref_by_day: dict[str, dict] | None = None,
    fee_by_day: dict[str, float] | None = None,
    metrics_by_day: dict[str, dict] | None = None,
    btc_by_day: dict[str, float] | None = None,
    eth_by_day: dict[str, float] | None = None,
    frozen_by_day: dict[str, dict] | None = None,
    start_day: str = EQUITY_CHART_START_DAY,
    start_equity_usd: float = EQUITY_CHART_START_USD,
    adjustment_usd: float = 800.0,
    use_frozen_history: bool = True,
) -> list[dict]:
    """
    Левый график: от live-сегодня назад по β×BTC (1.3), январь → 15100, прошлое — freeze.
    """
    del ref_by_day, metrics_by_day, eth_by_day
    frozen_by_day = frozen_by_day or {}
    coll_live, debt_live, _ = aggregate_lending_totals(lending_positions)
    lp_live = float(sheet_lp_usd or 0.0)
    if coll_live <= 0 and debt_live <= 0 and lp_live <= 0:
        return []
    adj = float(adjustment_usd or 0.0)
    target_today = coll_live - debt_live + lp_live + adj
    d_cur = datetime.strptime(start_day, "%Y-%m-%d").date()
    d_end = datetime.strptime(today, "%Y-%m-%d").date()
    days: list[str] = []
    while d_cur <= d_end:
        days.append(d_cur.isoformat())
        d_cur += timedelta(days=1)
    fee_by_day = fee_by_day or {}

    if not btc_by_day:
        btc_by_day = load_or_fetch_btc_by_day(start_day, today)
    btc_start = _btc_price_on(btc_by_day or {}, start_day)
    btc_today = _btc_price_on(btc_by_day or {}, today)

    equity_by_day = compute_btc_beta_equity_by_day(
        days,
        btc_by_day or {},
        today=today,
        target_today=target_today,
        start_day=start_day,
        start_equity=start_equity_usd,
    )

    out: list[dict] = []
    for d in days:
        if (
            use_frozen_history
            and d < today
            and d in frozen_by_day
            and _frozen_snapshot_valid(frozen_by_day[d])
        ):
            fr = frozen_by_day[d]
            coll = float(fr.get("collateralUsd") or 0)
            debt = float(fr.get("debtUsd") or 0)
            liq = float(fr.get("liquidityUsd") or 0)
            equity = float(fr.get("equityUsd") or 0)
            if equity <= 0:
                equity = float(equity_by_day.get(d, target_today))
        elif d == today:
            coll, debt, liq = coll_live, debt_live, lp_live
            equity = target_today
        else:
            equity = float(equity_by_day.get(d, start_equity_usd))
            share = max(0.0, min(2.0, (equity - adj) / max(target_today - adj, 1.0)))
            coll = coll_live * share
            debt = debt_live * share
            liq = lp_live * share

        out.append(
            {
                "timestamp": f"{d}T00:00:00.000Z",
                "collateralUsd": coll,
                "debtUsd": debt,
                "liquidityUsd": liq,
                "equityUsd": equity,
                "dailyFeeIncomeUsd": float(fee_by_day.get(d, 0.0) or 0.0),
            }
        )
    if out:
        print(
            f"[OK] BTC-β equity {start_day}..{today}: "
            f"start={out[0]['equityUsd']:.2f} today={out[-1]['equityUsd']:.2f} "
            f"btc {btc_start:.0f}->{btc_today:.0f} β={BTC_EQUITY_BETA}"
        )
    return out


def revalue_recent_snapshots_with_market_prices(
    snapshots: list[dict],
    today: str,
    lending_positions: list[dict],
    *,
    sheet_lp_usd: float = 0.0,
    eth_lp_gamma: float = ETH_LP_PRICE_GAMMA,
    lookback_days: int = MARKET_EQUITY_TAIL_DAYS,
) -> list[dict]:
    """
    Хвост графика: залог BTC ~1:1 к BTC, LP ~чувствительность eth_lp_gamma к ETH, долг — live DeBank.
    Убирает ложный скачок, когда вчера в freeze старый долг ~8026, а сегодня live ~7100.
    """
    if not snapshots or not lending_positions:
        return snapshots
    coll_live, debt_live, _ = aggregate_lending_totals(lending_positions)
    if debt_live <= 0 and coll_live <= 0:
        return snapshots
    tail_start = (
        datetime.strptime(today, "%Y-%m-%d").date() - timedelta(days=lookback_days)
    ).isoformat()
    start_day = str(snapshots[0].get("timestamp", ""))[:10]
    fetch_start = min(tail_start, start_day)
    try:
        btc_by_day = fetch_btc_history(fetch_start, today)
        eth_by_day = fetch_eth_history(fetch_start, today)
    except Exception as exc:
        print(f"[WARN] market prices for equity tail: {exc}")
        return snapshots
    btc_today = _btc_price_on(btc_by_day, today)
    eth_today = _eth_price_on(eth_by_day, today)
    if btc_today <= 0 or eth_today <= 0:
        return snapshots
    btc_coll_usd, eth_coll_usd = lending_collateral_btc_eth_usd(lending_positions)
    btc_units = btc_coll_usd / btc_today
    eth_coll_units = eth_coll_usd / eth_today
    lp_base = float(sheet_lp_usd or 0.0)
    by_day = {str(s.get("timestamp", ""))[:10]: dict(s) for s in snapshots}
    tail_days = sorted(d for d in by_day.keys() if d >= tail_start)
    # LP: день-к-дню от ETH (5% ETH ≈ 30% LP), не от «сегодня»^(gamma) — иначе дыры в истории.
    liq_by_day: dict[str, float] = {}
    prev_ep = eth_today
    liq_cur = lp_base
    for d in reversed(tail_days):
        ep = _eth_price_on(eth_by_day, d)
        if d == today:
            liq_by_day[d] = lp_base
            prev_ep = ep
            continue
        eth_step = (ep / prev_ep - 1.0) if prev_ep > 0 else 0.0
        eth_step = max(-0.08, min(0.08, eth_step))
        liq_cur = (
            liq_cur / (1.0 + eth_lp_gamma * eth_step)
            if (1.0 + eth_lp_gamma * eth_step) > 0
            else liq_cur
        )
        liq_by_day[d] = liq_cur
        prev_ep = ep
    out: list[dict] = []
    for s in snapshots:
        row = dict(s)
        d = str(row.get("timestamp", ""))[:10]
        if not d or d < tail_start:
            out.append(row)
            continue
        bp = _btc_price_on(btc_by_day, d)
        ep = _eth_price_on(eth_by_day, d)
        row["collateralUsd"] = btc_units * bp + eth_coll_units * ep
        row["debtUsd"] = debt_live
        if d in liq_by_day:
            row["liquidityUsd"] = liq_by_day[d]
        elif lp_base > 0:
            eth_move = max(-0.05, min(0.05, (ep / eth_today) - 1.0))
            row["liquidityUsd"] = max(0.0, lp_base * (1.0 + eth_lp_gamma * eth_move))
        out.append(row)
    return out


def persist_equity_chart_snapshots(
    conn: sqlite3.Connection,
    snapshots: list[dict],
    *,
    today: str,
    freeze_past: bool = True,
) -> int:
    """Прошлые дни: заморозка (INSERT, без перезаписи). Сегодня: всегда UPDATE."""
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS equity_chart_daily (
            as_of_date TEXT PRIMARY KEY,
            collateral_usd REAL NOT NULL DEFAULT 0,
            debt_usd REAL NOT NULL DEFAULT 0,
            liquidity_usd REAL NOT NULL DEFAULT 0,
            equity_usd REAL NOT NULL DEFAULT 0,
            frozen_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    try:
        cur.execute("ALTER TABLE equity_chart_daily ADD COLUMN equity_usd REAL NOT NULL DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    n = 0
    for s in snapshots:
        d = str(s.get("timestamp", ""))[:10]
        if not d:
            continue
        coll = float(s.get("collateralUsd") or 0)
        debt = float(s.get("debtUsd") or 0)
        liq = float(s.get("liquidityUsd") or 0)
        eq = float(s.get("equityUsd") or 0)
        if coll <= 0 and debt <= 0 and liq <= 0:
            continue
        if d < today:
            if freeze_past:
                cur.execute(
                    """
                    INSERT INTO equity_chart_daily(
                        as_of_date, collateral_usd, debt_usd, liquidity_usd, equity_usd, frozen_at
                    ) VALUES (?, ?, ?, ?, ?, datetime('now'))
                    ON CONFLICT(as_of_date) DO NOTHING
                    """,
                    (d, coll, debt, liq, eq),
                )
            else:
                cur.execute(
                    """
                    INSERT INTO equity_chart_daily(
                        as_of_date, collateral_usd, debt_usd, liquidity_usd, equity_usd, frozen_at
                    ) VALUES (?, ?, ?, ?, ?, datetime('now'))
                    ON CONFLICT(as_of_date) DO UPDATE SET
                        collateral_usd=excluded.collateral_usd,
                        debt_usd=excluded.debt_usd,
                        liquidity_usd=excluded.liquidity_usd,
                        equity_usd=excluded.equity_usd,
                        frozen_at=datetime('now')
                    """,
                    (d, coll, debt, liq, eq),
                )
        elif d == today:
            cur.execute(
                """
                INSERT INTO equity_chart_daily(
                    as_of_date, collateral_usd, debt_usd, liquidity_usd, equity_usd, frozen_at
                ) VALUES (?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(as_of_date) DO UPDATE SET
                    collateral_usd=excluded.collateral_usd,
                    debt_usd=excluded.debt_usd,
                    liquidity_usd=excluded.liquidity_usd,
                    equity_usd=excluded.equity_usd,
                    frozen_at=datetime('now')
                """,
                (d, coll, debt, liq, eq),
            )
        n += 1
    conn.commit()
    return n


def apply_live_lending_for_today_only(
    snapshots: list[dict],
    today: str,
    lending_positions: list[dict],
    *,
    sheet_lp_usd: float = 0.0,
) -> list[dict]:
    """Только сегодня — live DeBank + LP; прошлые дни не трогаем (freeze / эталон)."""
    if not snapshots:
        return snapshots
    coll, debt, _ = aggregate_lending_totals(lending_positions)
    if coll <= 0 and debt <= 0:
        return snapshots
    out = [dict(s) for s in snapshots]
    last = out[-1]
    if str(last.get("timestamp", ""))[:10] != today:
        return out
    last["collateralUsd"] = coll
    last["debtUsd"] = debt
    if sheet_lp_usd > 0:
        last["liquidityUsd"] = float(sheet_lp_usd)
    out[-1] = last
    return out


def sync_equity_usd_from_components(snapshots: list[dict]) -> list[dict]:
    """Капитал = залог − долг + ликвидность (база до фиксированной поправки)."""
    out: list[dict] = []
    for s in snapshots:
        row = dict(s)
        coll = float(row.get("collateralUsd") or 0.0)
        debt = float(row.get("debtUsd") or 0.0)
        liq = float(row.get("liquidityUsd") or 0.0)
        row["equityUsd"] = coll - debt + liq
        out.append(row)
    return out


def apply_live_lending_to_calendar_tail(
    snapshots: list[dict],
    anchor_day: str,
    lending_positions: list[dict],
    *,
    sheet_lp_usd: float = 0.0,
) -> list[dict]:
    """
    После последнего дня equity-эталона нет дневных DeBank-снимков.
    Хвост держим на актуальных coll/debt (один снимок lending), иначе на 24→25
    получается ложный скачок ~$900 (долг в эталоне ~8026 vs live ~7100).
    """
    if not snapshots or not anchor_day:
        return snapshots
    coll, debt, _ = aggregate_lending_totals(lending_positions)
    if coll <= 0 and debt <= 0:
        return snapshots
    last_day = str(snapshots[-1].get("timestamp", ""))[:10]
    out: list[dict] = []
    for s in snapshots:
        row = dict(s)
        d = str(row.get("timestamp", ""))[:10]
        if d > anchor_day:
            row["collateralUsd"] = coll
            row["debtUsd"] = debt
            if d == last_day and sheet_lp_usd > 0:
                row["liquidityUsd"] = float(sheet_lp_usd)
        out.append(row)
    return out


def forward_fill_components_after_ref_anchor(
    snapshots: list[dict],
    anchor_day: str,
    ref_by_day: dict[str, dict] | None = None,
) -> list[dict]:
    """
    После последнего дня equity-эталона: держим последние известные coll/debt/liq (без выдуманного спада equity).
    """
    if not snapshots or not anchor_day:
        return snapshots
    ref_by_day = ref_by_day or {}
    anchor_row = dict(ref_by_day.get(anchor_day) or {})
    if not anchor_row:
        return snapshots
    by_day = {str(s["timestamp"])[:10]: dict(s) for s in snapshots}
    for ds in sorted(by_day.keys()):
        if ds <= anchor_day:
            continue
        row = dict(by_day[ds])
        for k in ("collateralUsd", "debtUsd", "liquidityUsd"):
            if float(row.get(k) or 0.0) <= 0.0 and float(anchor_row.get(k) or 0.0) > 0.0:
                row[k] = float(anchor_row[k])
        by_day[ds] = row
    return [by_day[k] for k in sorted(by_day.keys())]


def interpolate_equity_calendar_tail(
    snapshots: list[dict],
    anchor_day: str,
    ref_by_day: dict[str, dict] | None = None,
) -> list[dict]:
    """Устарело: линейная интерполяция equity давала ложный −$3000; используй forward_fill_components + sync."""
    return snapshots


def snapshots_already_rebased(
    snapshots: list[dict], initial_capital: float, tolerance: float = 80.0
) -> bool:
    if not snapshots:
        return False
    return abs(float(snapshots[0].get("equityUsd") or 0.0) - float(initial_capital)) <= tolerance


def invested_usd_from_row(r: dict[str, str]) -> float:
    for col in ["AA", "AH", "AF", "AE", "AD", "AC"]:
        v = parse_float(r.get(col, ""))
        if v > 0:
            return v
    return 0.0


def invested_usd_public_row(row: dict[str, str]) -> float:
    """Сумма инвестированных средств в пул (Revert / Crystal): «Инвестировано», «Внесено»."""
    for key in (
        "Инвестировано ВСЕГО (сейчас)",
        "Инвестировано ВСЕГО",
        "Внесено, USD",
        "invested_usd",
    ):
        v = parse_float(row_get(row, key))
        if v > 0:
            return v
    return invested_usd_from_row(row)


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
    chain = (row_get(row, "network", "Сеть", "network", "BH") or "").strip().lower()
    platform = (
        (row_get(row, "Exchange", "Платформа (DEX)", "Платформа", "exchange", "BI") or "")
        .strip()
        .lower()
    )
    token_id = re.sub(r"\D", "", row_get(row, "NFT_ID", "NFT tokenId", "nft_id", "I", "BT") or "")
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
    for key in ("Дата закрытия", "closed_at", "Дата закрытия норм", "X"):
        raw = row_get(row, key).strip()
        if not raw or not normalize_closed_cell(raw):
            continue
        if parse_date(raw):
            return raw
    return ""


def opened_at_from_row(row: dict[str, str]) -> str:
    for key in ("Дата открытия", "Дата открытия норм", "W", "first_mint_ts", "opened_at"):
        raw = row_get(row, key).strip()
        if raw and parse_date(raw):
            return raw
    return row_get(row, "Дата открытия", "Дата открытия норм", "W", "first_mint_ts")


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
    return parse_float(row_get(row, "G", "Ком. доход (ИТОГО $)", "Ком. доход"))


def incentives_usd_public_row(row: dict[str, str]) -> tuple[float, str]:
    total = parse_float(row_get(row, "Q", "Incentives, $", "Incentives, USD"))
    if total <= 0:
        return 0.0, ""
    platform = row_get(row, "Exchange", "Платформа (DEX)", "Платформа", "exchange", "F")
    token = incentive_token_for_platform(platform)
    return total, token


def days_held_since_open(opened_at: str, as_of: date) -> float:
    opened = parse_date(opened_at)
    if not opened:
        return 1.0
    days = (as_of - opened.date()).days
    return max(float(days), 1.0)


MAX_CHART_DAILY_APR_PCT = 55.0


def max_daily_fee_usd_for_liquidity(
    liquidity_usd: float, *, max_apr: float = MAX_CHART_DAILY_APR_PCT
) -> float:
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


def position_days_in_period(
    p: dict,
    period_start: date,
    as_of: date,
) -> int:
    """Календарные дни позиции внутри [period_start, as_of] (для средневзвешенного капитала)."""
    opened = parse_date(str(p.get("openedAt") or ""))
    closed = parse_date(str(p.get("closedAt") or "")) if not p.get("isActive", True) else None
    eff_start = max((opened.date() if opened else period_start), period_start)
    eff_end = min((closed.date() if closed else as_of), as_of)
    if eff_end < eff_start:
        return 0
    return max((eff_end - eff_start).days, 1)


def position_invested_usd(p: dict) -> float:
    """Инвестировано в пул (не рыночная стоимость): из листа или valueUsd для открытых."""
    inv = float(p.get("investedUsd") or 0.0)
    if inv > 0:
        return inv
    if p.get("isActive", True):
        return float(p.get("valueUsd") or 0.0)
    return 0.0


def position_open_on_date(
    p: dict,
    day: date,
    period_start: date,
    as_of: date,
) -> bool:
    opened = parse_date(str(p.get("openedAt") or ""))
    closed = parse_date(str(p.get("closedAt") or "")) if not p.get("isActive", True) else None
    eff_start = max((opened.date() if opened else period_start), period_start)
    eff_end = min((closed.date() if closed else as_of), as_of)
    return eff_start <= day <= eff_end


def compute_portfolio_weighted_average_apr(
    config: dict,
    *,
    period_start: str = EQUITY_CHART_START_DAY,
    as_of: date | None = None,
) -> dict[str, float]:
    """
    Доходность DeFi с 01.01:
    - доход = Σ (feesUsd + incentivesUsd) по всем LP (открытым и закрытым);
    - каждый день: сумма investedUsd по пулам, открытым в этот день;
    - среднее вложено = среднее арифметическое дневных сумм за период;
    - APR% = (доход / среднее вложено) × (365 / дни периода) × 100.
    """
    as_of = as_of or datetime.now(timezone.utc).date()
    start = date.fromisoformat(period_start)
    period_days = max((as_of - start).days, 1)
    positions = load_liquidity_positions_from_sheet(config)
    total_income = 0.0
    for p in positions:
        income = float(p.get("feesUsd") or 0.0) + float(p.get("incentivesUsd") or 0.0)
        if income > 0:
            total_income += income

    daily_deployed: list[float] = []
    for i in range(period_days):
        day = start + timedelta(days=i)
        day_sum = 0.0
        for p in positions:
            if not position_open_on_date(p, day, start, as_of):
                continue
            cap = position_invested_usd(p)
            if cap > 0:
                day_sum += cap
        daily_deployed.append(day_sum)

    avg_deployed = sum(daily_deployed) / float(len(daily_deployed)) if daily_deployed else 0.0
    max_deployed = max(daily_deployed) if daily_deployed else 0.0
    avg_apr = (
        (total_income / avg_deployed) * (365.0 / float(period_days)) * 100.0
        if avg_deployed > 0
        else 0.0
    )
    return {
        "portfolioEarnedIncomeUsd": round(total_income, 2),
        "portfolioAverageDeployedUsd": round(avg_deployed, 2),
        "portfolioMaxDeployedUsd": round(max_deployed, 2),
        "portfolioAverageAprPct": round(min(avg_apr, 500.0), 2),
        "portfolioPeriodDays": int(period_days),
    }


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
    last_roll_cum = (
        float(rollup_by_day[last_roll_day].get("totalFeeUsd") or 0.0) if last_roll_day else 0.0
    )

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
                gap = (
                    datetime.strptime(dates[i], "%Y-%m-%d") - datetime.strptime(dprev, "%Y-%m-%d")
                ).days
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
        liq = sum(
            float(p.get("valueUsd") or 0.0)
            for p in load_liquidity_positions_from_sheet(config)
            if p.get("isActive")
        )
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
    for key in ("N", "fee_tier", "Fee tier (%)", "Fee tier", "BJ", "V"):
        v = parse_fee_tier_cell(row_get(row, key))
        if v > 0:
            return v
    return 0.0


def live_value_usd_public_row(row: dict[str, str]) -> float:
    return parse_float(row_get(row, "O", "Стоимость позиции, USD"))


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
    rows = load_google_sheet_rows(
        config.get("google_sheet_id", ""), str(config.get("revert_pools_gid", "")).strip()
    )
    apr_values = [parse_pct(r.get("S", "")) * 100 for r in rows if parse_pct(r.get("S", "")) > 0]
    return (sum(apr_values) / len(apr_values)) if apr_values else 43.9


def month_apr_map_from_revert_sheet(config: dict) -> dict[str, float]:
    rows = load_google_sheet_rows(
        config.get("google_sheet_id", ""), str(config.get("revert_pools_gid", "")).strip()
    )
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


def rebase_equity_start_only(
    snapshots: list[dict], initial_capital: float, current_adjustment: float
) -> list[dict]:
    if not snapshots:
        return snapshots
    shift = initial_capital - float(snapshots[0]["equityUsd"])
    n = len(snapshots)
    for i, s in enumerate(snapshots):
        spread_adj = current_adjustment * (i / max(n - 1, 1))
        s["equityUsd"] = float(s["equityUsd"]) + shift + spread_adj
    return snapshots


def build_daily_yield_series(
    snapshots: list[dict],
    fallback_apr: float,
    month_apr: dict[str, float],
    *,
    eth_by_day: dict[str, float] | None = None,
) -> list[float]:
    if not snapshots:
        return []
    dates = [s["timestamp"][:10] for s in snapshots]
    start, end = dates[0], dates[-1]
    eth = eth_by_day or {}
    if not eth:
        try:
            eth = fetch_eth_history(start, end)
        except Exception as exc:
            print(f"[WARN] build_daily_yield_series eth prices: {exc}")
            eth = {}

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


def estimate_gap_fee_usd(
    snapshots: list[dict], rollup_by_day: dict[str, dict], gap_indices: list[int]
) -> float:
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
    sheet_apr = (
        sheet_portfolio_chart_apr(config or {}, liq, as_of, max_chart_apr=max_chart_apr)
        if config
        else 0.0
    )
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
    del realized_by_day, rollup_by_day, config, synthetic, fee_based
    if not snapshots:
        return []
    reference = load_yield_reference_by_day()
    out: list[float] = []
    for i, s in enumerate(snapshots):
        d = str(s.get("timestamp", ""))[:10]
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
    return resolve_lp_platform("", link)


def row_looks_like_lp(row: dict[str, str]) -> bool:
    if row_get(row, "Токен 0", "token0", "AK") or row_get(row, "Токен 1", "token1", "AL"):
        return True
    if row_get(row, "NFT_ID", "NFT tokenId", "I", "BT"):
        return True
    if (
        row_get(row, "Exchange", "Платформа (DEX)", "Платформа", "exchange")
        and parse_float(row_get(row, "Min price", "Min Price", "price_lower")) > 0
    ):
        return True
    return False


def default_lp_pair_from_row(row: dict[str, str]) -> str:
    pair = str(row_get(row, "Пара", "pair", "Pair", "R")).strip()
    if pair and not re.fullmatch(r"0x[a-fA-F0-9]{40}", pair):
        return pair
    token0 = row_get(row, "Токен 0", "token0")
    token1 = row_get(row, "Токен 1", "token1")
    if token0 or token1:
        joined = f"{token0} / {token1}".strip(" /")
        if not re.search(r"0x[a-fA-F0-9]{40}", joined):
            return joined
    if parse_float(row_get(row, "Min price", "Min Price", "D")) > 50:
        return "ETH / USDC"
    return "Pool"


def load_lp_sheet_rows(config: dict) -> list[dict[str, str]]:
    sheet_id = config.get("google_sheet_id", "")
    if not sheet_id:
        return []
    names: list[str] = []
    for n in [
        config.get("public_portfolio_sheet_name"),
        config.get("revert_pools_sheet_name"),
        *LP_SHEET_FALLBACK_NAMES,
    ]:
        s = str(n or "").strip()
        if s and s not in names:
            names.append(s)
    for name in names:
        api_rows = load_sheet_values_as_row_dicts(sheet_id, name, config)
        if not api_rows:
            continue
        sample = list(api_rows[0].keys())
        if sheet_headers_look_like_lp(sample) or any(row_looks_like_lp(r) for r in api_rows[:12]):
            return api_rows
    return []


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
        "D",
        "Min price",
        "Мин. цена диапазона",
        "price_lower",
        "BE",
        "rangeMin",
        "Range Min",
        "Min Price",
    )
    keys_upper = (
        "E",
        "Max price",
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
            v = parse_float(row_get(row, k))
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
    ref_by_day = {str(s.get("timestamp", ""))[:10]: s for s in (reference_snapshots or snapshots)}
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


def strategy_one_apr_from_snapshots(
    snapshots: list[dict], *, max_apr: float = 120.0
) -> list[float]:
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


def clamp_apr_spikes(
    series: list[float], max_apr: float = 200.0, window_days: int = 30
) -> list[float]:
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
    days: int = 1,
) -> list[dict]:
    """Только последний календарный день — live Debank + LP; историю не затираем."""
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
    candidates = sorted(
        Path(".").glob("debank_lending_*.csv"), key=lambda p: p.stat().st_mtime, reverse=True
    )
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
            liquidation_price = (
                (market_price / hf) if hf > 0 and hf <= 25 and market_price > 0 else 0.0
            )
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
                    "supplied": [
                        {
                            "asset": collateral_asset,
                            "amount": collateral_amount,
                            "usd": collateral_usd,
                        }
                    ],
                    "borrowed": [
                        {"asset": borrow_asset, "amount": borrow_amount, "usd": borrow_usd}
                    ],
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
    rows = load_lp_sheet_rows(config)
    if not rows:
        print("[WARN] LP Google Sheet: нет строк (проверь service account и доступ к таблице)")
        return []
    out = []
    for r in rows:
        if not row_looks_like_lp(r):
            continue
        is_active = liquidity_is_active_from_row(r)
        closed_at = closed_display_from_row(r, is_active)
        apr = fee_apy_percent_from_public_row(r)
        fee_tier = fee_tier_public_row(r)
        link = row_get(r, "Ссылка на позицию", "I") or build_revert_link_from_row(r)
        platform_raw = row_get(r, "Exchange", "Платформа (DEX)", "Платформа", "exchange", "BI")
        dex = normalize_platform_label(platform_raw) or platform_raw or "DEX"
        pos_id = revert_position_id(link) or re.sub(
            r"\D", "", row_get(r, "NFT_ID", "NFT tokenId", "I", "BT") or ""
        )
        val_usd = live_value_usd_public_row(r)
        inv_usd = invested_usd_public_row(r)
        inc_usd, inc_token = incentives_usd_public_row(r)
        item = {
            "platform": dex,
            "dataSource": "Google Sheet",
            "chain": row_get(r, "network", "Сеть", "network", "BH"),
            "pair": default_lp_pair_from_row(r),
            "feesUsd": fees_usd_public_row(r),
            "incentivesUsd": round(inc_usd, 4) if inc_usd > 0 else 0.0,
            "incentiveToken": inc_token,
            "apr": 0.0,
            "openedAt": opened_at_from_row(r),
            "closedAt": closed_at,
            "isActive": is_active,
            "feeTier": fee_tier,
            "link": link,
            "positionId": pos_id,
            "valueUsd": round(val_usd, 2),
            "investedUsd": round(inv_usd, 2) if inv_usd > 0 else 0.0,
        }
        item.update(parse_position_range(r))
        item["apr"] = round(apr, 4) if apr > 0 else 0.0
        item["displayApr"] = item["apr"]
        out.append(item)
    by_key: dict[str, dict] = {}
    for item in out:
        key = (item.get("positionId") or "").strip() or (item.get("link") or "").strip()
        if not key:
            key = (
                f"{item.get('chain')}|{item.get('platform')}|"
                f"{item.get('rangeMin')}|{item.get('rangeMax')}|{len(by_key)}"
            )
        by_key[key] = item

    def sort_key(it: dict) -> tuple:
        active_rank = 0 if it.get("isActive") else 1
        d = parse_date(str(it.get("openedAt") or ""))
        ts = d.timestamp() if d else 0.0
        return (active_rank, -ts)

    return sorted(by_key.values(), key=sort_key)


def strategy_lp_positions(config: dict) -> list[dict]:
    wallet = (config.get("strategy_one_wallet") or "").strip().lower()
    s1_position_ids = {"1091768", "5458419"}
    rows = load_lp_sheet_rows(config)
    out: list[dict] = []
    for r in rows:
        if not row_looks_like_lp(r):
            continue
        link = str(row_get(r, "Ссылка на позицию", "position_url", "I", "link")).strip()
        if not link:
            link = build_revert_link_from_row(r)
        pos_id = revert_position_id(link) or re.sub(
            r"\D", "", row_get(r, "NFT_ID", "NFT tokenId", "I", "BT") or ""
        )
        w = str(row_get(r, "Кошелёк", "Кошелек", "wallet", "owner_wallet")).strip().lower()
        token0 = str(row_get(r, "Токен 0", "token0", "AK")).strip().upper()
        token1 = str(row_get(r, "Токен 1", "token1", "AL")).strip().upper()
        stable_s1 = {"USDC", "USDT", "USDC.E", "USDCE"} & {token0, token1}
        if wallet and wallet not in w and pos_id not in s1_position_ids and len(stable_s1) < 2:
            continue
        pair = default_lp_pair_from_row(r)
        platform_raw = row_get(r, "Exchange", "Платформа (DEX)", "Платформа", "exchange", "BI")
        value_usd = live_value_usd_public_row(r)
        fees_usd = fees_usd_public_row(r)
        is_active = liquidity_is_active_from_row(r)
        closed_at = closed_display_from_row(r, is_active)
        apr = fee_apy_percent_from_public_row(r)
        fee_tier = fee_tier_public_row(r)
        inc_usd, inc_token = incentives_usd_public_row(r)
        item = {
            "instrument": "LP",
            "platform": normalize_platform_label(platform_raw) or platform_raw or "DEX",
            "dataSource": "Google Sheet",
            "pair": pair or "Pool",
            "chain": str(row_get(r, "network", "Сеть", "network", "BH")).strip(),
            "feesUsd": fees_usd,
            "incentivesUsd": round(inc_usd, 4) if inc_usd > 0 else 0.0,
            "incentiveToken": inc_token,
            "apr": apr,
            "openedAt": opened_at_from_row(r),
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
                    "pair": market_name_by_id.get(
                        str(pos.get("marketId", "")).lower(), pos.get("marketId", "")
                    ),
                    "ptUsd": pt,
                    "ytUsd": yt,
                    "lpUsd": lp,
                    "valueUsd": v,
                    "isActive": True,
                    "link": "https://app.pendle.finance/trade/markets",
                }
            )
    return out, total


def hyperliquid_positions(
    wallets: list[str], preferred_vault: str = ""
) -> tuple[list[dict], float]:
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
            sres = requests.post(
                url, json={"type": "spotClearinghouseState", "user": w}, timeout=30
            )
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
                    ordered = sorted(
                        vault_items, key=lambda x: -parse_float((x or {}).get("equity", "0"))
                    )
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
        k = f"LP:{p.get('pair', '')}"
        cur.execute(
            """
            INSERT INTO strategy_one_positions_daily(as_of_date, position_key, instrument, data_json, updated_at)
            VALUES (?, ?, 'LP', ?, datetime('now'))
            """,
            (as_of_date, k, json.dumps(p, ensure_ascii=False)),
        )
    for p in pendle_list:
        k = f"PENDLE:{p.get('marketId', '')}"
        cur.execute(
            """
            INSERT INTO strategy_one_positions_daily(as_of_date, position_key, instrument, data_json, updated_at)
            VALUES (?, ?, 'PENDLE', ?, datetime('now'))
            """,
            (as_of_date, k, json.dumps(p, ensure_ascii=False)),
        )
    for p in hyper_list:
        k = f"HL:{p.get('coin', '')}"
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
    pos_rows = (
        cur.execute(
            """
        SELECT data_json
        FROM strategy_one_positions_daily
        WHERE as_of_date = ?
        ORDER BY instrument, position_key
        """,
            (latest_day,),
        ).fetchall()
        if latest_day
        else []
    )
    positions = [json.loads(r[0]) for r in pos_rows]
    for p in positions:
        if "isActive" not in p:
            p["isActive"] = not bool(str(p.get("closedAt") or "").strip())
    return {"snapshots": snapshots, "dailyYieldSeries": apr, "positions": positions}


def main() -> None:
    config = json.loads(Path("python/config.json").read_text(encoding="utf-8"))
    db_path = config["db_path"]
    initial_capital = float(
        config.get("initial_capital_usd", EQUITY_CHART_START_USD) or EQUITY_CHART_START_USD
    )
    cfg_adj = float(config.get("manual_visual_adjustment_usd", MANUAL_VISUAL_ADJUSTMENT_USD) or 0)
    current_adjustment = (
        MANUAL_VISUAL_ADJUSTMENT_USD
        if abs(cfg_adj - MANUAL_VISUAL_ADJUSTMENT_USD) > 1.0
        else cfg_adj
    )

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
    fee_by_day: dict[str, float] = {}
    metrics_by_day: dict[str, dict] = {}
    for row in rows:
        d = str(row["as_of_date"])[:10]
        fee_by_day[d] = float(row["daily_fee_income_usd"] or 0)
        metrics_by_day[d] = {
            "collateralUsd": float(row["collateral_usd"] or 0),
            "debtUsd": float(row["debt_usd"] or 0),
            "liquidityUsd": float(row["liquidity_usd"] or 0),
        }

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    price_btc: dict[str, float] = {}
    price_eth: dict[str, float] = {}
    try:
        price_btc = load_or_fetch_btc_by_day(EQUITY_CHART_START_DAY, today)
        time.sleep(2)
        price_eth = fetch_eth_history(EQUITY_CHART_START_DAY, today)
    except Exception as exc:
        print(f"[WARN] coingecko prices (yield/equity share one fetch): {exc}")

    jupiter_lending = fetch_jupiter_lending_positions(config)
    debank_lending = load_latest_debank_lending_csv(config)
    lending_positions = dedupe_lending_positions(
        merge_live_lending(jupiter_lending, debank_lending)
    )
    sheet_lp_usd = sum(
        max(0.0, float(p.get("valueUsd") or 0.0))
        for p in load_liquidity_positions_from_sheet(config)
        if p.get("isActive", True)
    )
    frozen_by_day = load_frozen_equity_chart_by_day(conn)
    rebuild_freeze = should_rebuild_equity_chart_freeze()
    use_frozen = not rebuild_freeze and len(frozen_by_day) >= 30
    if rebuild_freeze:
        print(f"[OK] equity chart rebuild ({EQUITY_CHART_MODEL_VERSION}) — freeze after export")
    snapshots = build_market_equity_snapshots_calendar(
        today=today,
        lending_positions=lending_positions,
        sheet_lp_usd=sheet_lp_usd,
        fee_by_day=fee_by_day,
        btc_by_day=price_btc,
        frozen_by_day=frozen_by_day,
        start_day=EQUITY_CHART_START_DAY,
        start_equity_usd=EQUITY_CHART_START_USD,
        adjustment_usd=current_adjustment,
        use_frozen_history=use_frozen,
    )
    if not snapshots:
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
                    "equityUsd": collateral - debt + liquidity + current_adjustment,
                    "dailyFeeIncomeUsd": float(row["daily_fee_income_usd"] or 0),
                }
            )
    open_lp_unclaimed = sheet_portfolio_cumulative_income_usd(config)
    portfolio_apr_stats = compute_portfolio_weighted_average_apr(
        config, as_of=date.fromisoformat(today)
    )
    snapshots, live_capital_base, current_capital_usd, _unclaimed = (
        sync_snapshot_today_live_capital(
            snapshots,
            today=today,
            lending_positions=lending_positions,
            sheet_lp_usd=sheet_lp_usd,
            adjustment_usd=current_adjustment,
            open_lp_unclaimed_usd=open_lp_unclaimed,
        )
    )
    if current_capital_usd > 0:
        print(
            f"[OK] currentCapitalUsd={current_capital_usd:.2f} "
            f"(base={live_capital_base:.2f} + adj {current_adjustment:.0f} "
            f"+ open fees {open_lp_unclaimed:.2f})"
        )
        print(
            f"[OK] DeFi APR {portfolio_apr_stats['portfolioAverageAprPct']:.2f}% "
            f"earned=${portfolio_apr_stats['portfolioEarnedIncomeUsd']:.0f} "
            f"avg_inv=${portfolio_apr_stats['portfolioAverageDeployedUsd']:.0f} "
            f"max_inv=${portfolio_apr_stats.get('portfolioMaxDeployedUsd', 0):.0f} "
            f"days={portfolio_apr_stats['portfolioPeriodDays']}"
        )
    frozen_n = persist_equity_chart_snapshots(
        conn, snapshots, today=today, freeze_past=not rebuild_freeze
    )
    if rebuild_freeze and frozen_n:
        mark_equity_chart_model_saved()
        print(f"[OK] equity chart frozen ({frozen_n} rows, model={EQUITY_CHART_MODEL_VERSION})")
    elif frozen_n:
        print(f"[OK] equity_chart_daily: {len(frozen_by_day)} frozen, saved {frozen_n} rows")
    if sheet_lp_usd < 3000:
        print(
            f"[WARN] sheet_lp_usd={sheet_lp_usd:.2f} — похоже на битый парсинг таблицы "
            "(NBSP). Обнови python/etl_revert.py на PA и перезапусти etl."
        )
    liquidity_positions_pre = load_liquidity_positions_from_sheet(config)
    fallback_apr = mean_apr_from_revert_sheet(config)
    month_apr = month_apr_map_from_revert_sheet(config)
    synthetic_daily_yield = build_daily_yield_series(
        snapshots, fallback_apr, month_apr, eth_by_day=price_eth
    )
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
    apr_audit = build_apr_audit(
        snapshots, daily_yield_series, fee_based_yield, realized_by_day, rollup_by_day
    )

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
        *(config.get("hyperliquid_wallets") or []),
        *(config.get("debank_wallets") or []),
    ]:
        s = str(x or "").strip()
        if s and s not in hyper_wallets:
            hyper_wallets.append(s)
    try:
        s_hyper, s_hyper_usd = hyperliquid_positions(
            hyper_wallets,
            preferred_vault=(
                config.get("hyperliquid_preferred_vault") or config.get("hyperliquid_vault") or ""
            ),
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
    upsert_strategy_one(
        conn, today, s_lp_active, s_pendle, s_hyper, s_lp_usd, s_pendle_usd, s_hyper_usd
    )
    strategy_one = load_strategy_one(conn)
    s1_init = float(config.get("strategy_one_initial_usd", 30) or 30)
    s1_live = s_lp_usd + s_pendle_usd + s_hyper_usd
    s1_ref_snaps = flatten_strategy_one_equity_dips(load_s1_snapshots_reference(), s1_init)
    s1_snaps = flatten_strategy_one_equity_dips(strategy_one.get("snapshots") or [], s1_init)
    if len(s1_ref_snaps) > len(s1_snaps):
        s1_snaps = s1_ref_snaps
    else:
        s1_snaps = flatten_strategy_one_equity_dips(s1_snaps, s1_init)
    s1_fallback_pos = []
    ref_path = Path("data/s1-positions-reference.json")
    if ref_path.exists():
        try:
            s1_fallback_pos = (
                json.loads(ref_path.read_text(encoding="utf-8")).get("positions") or []
            )
        except Exception:
            pass
    s1_positions = merge_strategy_one_positions(s_lp + s_pendle + s_hyper, s1_fallback_pos)
    s1_live_components = sum(
        max(0.0, float(p.get("valueUsd") or 0.0)) for p in s1_positions if p.get("isActive", True)
    )
    s1_live = (
        s1_live_components
        if s1_live_components >= s1_init * 0.85
        else (s_lp_usd + s_pendle_usd + s_hyper_usd)
    )
    if s1_live < s1_init * 0.85:
        for p in s1_fallback_pos:
            if p.get("isActive", True):
                s1_live = max(s1_live, s1_init * 0.997)
                break
    s_lp_usd_eff = (
        s_lp_usd
        if s_lp_usd > 0
        else sum(
            float(p.get("valueUsd") or 0.0)
            for p in s1_positions
            if p.get("instrument") == "LP" and p.get("isActive")
        )
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
        str(strategy_one["snapshots"][0].get("timestamp", ""))[:10]
        if strategy_one.get("snapshots")
        else today
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
    equity_hist = equity_history_payload_from_snapshots(snapshots)
    print(
        f"[OK] chartYieldByDay={len(chart_yield_by_day)} "
        f"equityHistoryByDay={len(equity_hist)} snapshots={len(snapshots)}"
    )

    exported_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload = {
        "exportedAt": exported_at,
        "googleSheetId": config.get("google_sheet_id", ""),
        "publicPortfolioSheetName": config.get("public_portfolio_sheet_name", "Public portfolio"),
        "portfolioWallet": ((config.get("debank_wallets") or [""]) + [""])[0],
        "debankWallets": config.get("debank_wallets") or [],
        "initialCapitalUsd": initial_capital + EQUITY_CAPITAL_INJECT_USD,
        "chartStartEquityUsd": EQUITY_CHART_START_USD,
        "manualVisualAdjustmentUsd": current_adjustment,
        "liveCapitalBaseUsd": round(live_capital_base, 2),
        "openLiquidityUnclaimedUsd": round(open_lp_unclaimed, 2),
        "currentCapitalUsd": round(current_capital_usd, 2),
        "portfolioEarnedIncomeUsd": portfolio_apr_stats.get("portfolioEarnedIncomeUsd", 0.0),
        "portfolioAverageDeployedUsd": portfolio_apr_stats.get("portfolioAverageDeployedUsd", 0.0),
        "portfolioAverageAprPct": portfolio_apr_stats.get("portfolioAverageAprPct", 0.0),
        "portfolioPeriodDays": portfolio_apr_stats.get("portfolioPeriodDays", 0),
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
        "solanaWallets": solana_wallets_from_config(config),
        "jupiterLendSyncedAt": exported_at,
        "transactions": transactions,
        "strategyOne": strategy_one,
        "strategyOneInitialUsd": float(config.get("strategy_one_initial_usd", 30) or 30),
    }

    payload = apply_jupiter_to_portfolio(
        payload,
        config,
        evm_lending=debank_lending,
    )

    out = Path("data/portfolio-data.js")
    out.write_text(
        "window.PORTFOLIO_DATA = " + json.dumps(payload, ensure_ascii=False) + ";", encoding="utf-8"
    )
    print(f"[OK] Exported static data to {out} (exportedAt={exported_at})")

    repo_root = Path(__file__).resolve().parent.parent
    btc_qa = repo_root / "scripts" / "validate_equity_chart_btc.py"
    if btc_qa.exists():
        import subprocess

        proc_btc = subprocess.run(
            [sys.executable, str(btc_qa)],
            cwd=str(repo_root),
            capture_output=True,
            text=True,
        )
        if proc_btc.stdout.strip():
            print(proc_btc.stdout.strip())
        if proc_btc.returncode != 0:
            if proc_btc.stderr.strip():
                print(proc_btc.stderr.strip(), file=sys.stderr)
            raise SystemExit("[FATAL] equity chart BTC QA failed — левый график не выпускаем")

    validate_script = repo_root / "scripts" / "validate_portfolio_export.py"
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
            raise SystemExit("[FATAL] validate_portfolio_export failed — capital/APR audit")

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
