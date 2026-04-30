#!/usr/bin/env python3
import csv
import json
import sqlite3
from io import StringIO
from pathlib import Path
from datetime import datetime, timedelta, timezone
from collections.abc import Iterable

import requests


def parse_pct(value: str) -> float:
    s = (value or "").strip().replace("%", "").replace(",", ".")
    if not s:
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def parse_float(value: str) -> float:
    s = (value or "").strip().replace(" ", "")
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


def invested_usd_from_row(r: dict[str, str]) -> float:
    for col in ["AA", "AH", "AF", "AE", "AD", "AC"]:
        v = parse_float(r.get(col, ""))
        if v > 0:
            return v
    return 0.0


def closed_position_apr(row: dict[str, str]) -> float:
    opened = parse_date(row.get("W", ""))
    closed = parse_date(row.get("X", ""))
    if not opened or not closed:
        return 0.0
    days = (closed - opened).days
    if days <= 0:
        return 0.0
    fees = parse_float(row.get("AG", ""))
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
    rows = cur.execute(
        """
        SELECT as_of_date, apr_annualized
        FROM revert_metrics_history
        ORDER BY id ASC
        """
    ).fetchall()
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
            hf = parse_float(r.get("health_factor", ""))
            market_price = (collateral_usd / collateral_amount) if collateral_amount > 0 else 0.0
            liquidation_price = (market_price / hf) if hf > 0 and hf <= 10 and market_price > 0 else 0.0
            out.append(
                {
                    "protocol": r.get("protocol", ""),
                    "collateralAsset": collateral_asset,
                    "collateralAmount": collateral_amount,
                    "collateralUsd": collateral_usd,
                    "borrowAsset": r.get("borrow_asset", ""),
                    "borrowAmount": parse_float(r.get("borrow_amount", "")),
                    "timestamp": r.get("timestamp", ""),
                    "healthFactor": hf,
                    "marketPrice": market_price,
                    "liquidationPrice": liquidation_price,
                    "link": debank_link,
                }
            )
    return out


def load_liquidity_positions_from_sheet(config: dict) -> list[dict]:
    sheet_id = config.get("google_sheet_id", "")
    rows = load_google_sheet_rows_by_name(sheet_id, config.get("public_portfolio_sheet_name", "Public Portfolio"))
    if not rows:
        rows = load_google_sheet_rows(sheet_id, str(config.get("revert_pools_gid", "")).strip())
    out = []
    for r in rows:
        token0 = (r.get("AK", "") or "").strip()
        token1 = (r.get("AL", "") or "").strip()
        if not token0 and not token1:
            continue
        is_active = not (r.get("X", "") or "").strip()
        apr = (parse_pct(r.get("S", "")) * 100) if is_active else closed_position_apr(r)
        if (not is_active) and apr <= 0:
            apr = 0.0
        # BJ в шите в «тысячных»; после /1000 получалось в 10 раз больше реального tier (3% вместо 0.3%)
        bj = parse_float(r.get("BJ", ""))
        fee_tier = (bj / 10000) if bj > 0 else 0.0
        out.append(
            {
                "platform": "Revert Finance",
                "chain": (r.get("BH", "") or "").strip(),
                "pair": f"{token0} / {token1}".strip(" /"),
                "feesUsd": parse_float(r.get("AG", "")),
                "apr": apr,
                "openedAt": (r.get("W", "") or "").strip(),
                "closedAt": (r.get("X", "") or "").strip(),
                "isActive": is_active,
                "feeTier": fee_tier,
                "link": (r.get("I", "") or "").strip(),
            }
        )
    return out


def strategy_lp_positions(config: dict) -> list[dict]:
    sheet_id = config.get("google_sheet_id", "")
    sheet_name = config.get("strategy_one_sheet_name", "Strategy 1")
    rows = load_google_sheet_rows_by_name(sheet_id, sheet_name)
    out: list[dict] = []
    for r in rows:
        token0 = (r.get("AK", "") or "").strip()
        token1 = (r.get("AL", "") or "").strip()
        if token0 or token1:
            pair = f"{token0} / {token1}".strip(" /")
            out.append(
                {
                    "instrument": "LP",
                    "platform": "Revert Finance",
                    "pair": pair or "Pool",
                    "chain": (r.get("BH", "") or "").strip(),
                    "feesUsd": parse_float(r.get("AG", "")),
                    "apr": parse_pct(r.get("S", "")) * 100 if parse_pct(r.get("S", "")) > 0 else 0.0,
                    "openedAt": (r.get("W", "") or "").strip(),
                    "closedAt": (r.get("X", "") or "").strip(),
                    "isActive": not (r.get("X", "") or "").strip(),
                    "feeTier": (parse_float(r.get("BJ", "")) / 10000.0) if parse_float(r.get("BJ", "")) > 0 else 0.0,
                    "link": (r.get("I", "") or "").strip(),
                    "valueUsd": parse_float(r.get("AH", "")) or parse_float(r.get("AA", "")),
                }
            )
    return out


def pendle_positions(wallet: str) -> tuple[list[dict], float]:
    if not wallet:
        return [], 0.0
    url = f"https://api-v2.pendle.finance/core/v1/dashboard/positions/database/{wallet}"
    res = requests.get(url, timeout=30)
    res.raise_for_status()
    raw = res.json()
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
                    "ptUsd": pt,
                    "ytUsd": yt,
                    "lpUsd": lp,
                    "valueUsd": v,
                    "link": "https://app.pendle.finance/trade/markets",
                }
            )
    return out, total


def hyperliquid_positions(wallet: str) -> tuple[list[dict], float]:
    if not wallet:
        return [], 0.0
    url = "https://api.hyperliquid.xyz/info"
    res = requests.post(url, json={"type": "clearinghouseState", "user": wallet}, timeout=30)
    res.raise_for_status()
    raw = res.json()
    total = parse_float((raw.get("marginSummary") or {}).get("accountValue", "0"))
    out: list[dict] = []
    for p in raw.get("assetPositions", []):
        item = p.get("position") or {}
        out.append(
            {
                "instrument": "Hyperliquid",
                "platform": "Hyperliquid",
                "coin": item.get("coin", ""),
                "szi": parse_float(item.get("szi", "0")),
                "entryPx": parse_float(item.get("entryPx", "0")),
                "positionValue": parse_float(item.get("positionValue", "0")),
                "unrealizedPnl": parse_float(item.get("unrealizedPnl", "0")),
                "valueUsd": parse_float(item.get("positionValue", "0")),
                "link": "https://app.hyperliquid.xyz/",
            }
        )
    return out, total


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
    apr: list[float] = []
    for i, s in enumerate(snapshots):
        if i == 0:
            apr.append(0.0)
            continue
        delta_fee = max(0.0, fee_series[i] - fee_series[i - 1])
        equity = max(float(s["equityUsd"] or 0.0), 1.0)
        apr.append((delta_fee / equity) * 365.0 * 100.0)
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
    return {"snapshots": snapshots, "dailyYieldSeries": apr, "positions": positions}


def main() -> None:
    config = json.loads(Path("python/config.json").read_text(encoding="utf-8"))
    db_path = config["db_path"]
    initial_capital = 16300.0
    current_adjustment = float(config.get("manual_visual_adjustment_usd", 0) or 0)

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

    snapshots = rebase_equity_start_only(snapshots, initial_capital, current_adjustment)
    fallback_apr = mean_apr_from_revert_sheet(config)
    month_apr = month_apr_map_from_revert_sheet(config)
    synthetic_daily_yield = build_daily_yield_series(snapshots, fallback_apr, month_apr)
    realized_by_day = load_realized_apr_by_day(conn)
    merged_yield = merge_realized_apr(snapshots, synthetic_daily_yield, realized_by_day)
    daily_yield_series = clamp_apr_spikes(merged_yield, max_apr=200.0, window_days=30)

    tx_path = Path("data/transactions.json")
    transactions = json.loads(tx_path.read_text(encoding="utf-8")) if tx_path.exists() else []
    liquidity_positions = load_liquidity_positions_from_sheet(config)
    lending_positions = load_latest_debank_lending_csv(config)

    wallet = ((config.get("debank_wallets") or [""]) + [""])[0]
    s_lp = strategy_lp_positions(config)
    s_lp_usd = sum(max(0.0, float(p.get("valueUsd") or 0.0)) for p in s_lp)
    try:
        s_pendle, s_pendle_usd = pendle_positions(wallet)
    except Exception:
        s_pendle, s_pendle_usd = [], 0.0
    try:
        s_hyper, s_hyper_usd = hyperliquid_positions(wallet)
    except Exception:
        s_hyper, s_hyper_usd = [], 0.0
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    upsert_strategy_one(conn, today, s_lp, s_pendle, s_hyper, s_lp_usd, s_pendle_usd, s_hyper_usd)
    strategy_one = load_strategy_one(conn)
    conn.close()

    exported_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload = {
        "exportedAt": exported_at,
        "initialCapitalUsd": initial_capital,
        "prices": {"BTC": 95000, "ETH": 1800},
        "snapshots": snapshots,
        "dailyYieldSeries": daily_yield_series,
        "fallbackApr": fallback_apr,
        "monthAprMap": month_apr,
        "realizedAprByDay": realized_by_day,
        "liquidityPositions": liquidity_positions,
        "lendingPositions": lending_positions,
        "transactions": transactions,
        "strategyOne": strategy_one,
    }

    out = Path("data/portfolio-data.js")
    out.write_text("window.PORTFOLIO_DATA = " + json.dumps(payload, ensure_ascii=False) + ";", encoding="utf-8")
    print(f"[OK] Exported static data to {out} (exportedAt={exported_at})")


if __name__ == "__main__":
    main()
