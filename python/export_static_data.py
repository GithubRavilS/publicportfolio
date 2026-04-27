#!/usr/bin/env python3
import csv
import json
import sqlite3
from io import StringIO
from pathlib import Path
from datetime import datetime, timedelta

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
    rows = load_google_sheet_rows(config.get("google_sheet_id", ""), str(config.get("revert_pools_gid", "")).strip())
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
        fee_tier = parse_float(r.get("BJ", "")) / 1000 if parse_float(r.get("BJ", "")) > 0 else 0.0
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
    conn.close()

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
    daily_yield_series = build_daily_yield_series(snapshots, fallback_apr, month_apr)

    tx_path = Path("data/transactions.json")
    transactions = json.loads(tx_path.read_text(encoding="utf-8")) if tx_path.exists() else []
    liquidity_positions = load_liquidity_positions_from_sheet(config)
    lending_positions = load_latest_debank_lending_csv(config)

    payload = {
        "initialCapitalUsd": initial_capital,
        "prices": {"BTC": 95000, "ETH": 1800},
        "snapshots": snapshots,
        "dailyYieldSeries": daily_yield_series,
        "fallbackApr": fallback_apr,
        "monthAprMap": month_apr,
        "liquidityPositions": liquidity_positions,
        "lendingPositions": lending_positions,
        "transactions": transactions,
    }

    out = Path("data/portfolio-data.js")
    out.write_text("window.PORTFOLIO_DATA = " + json.dumps(payload, ensure_ascii=False) + ";", encoding="utf-8")
    print(f"[OK] Exported static data to {out}")


if __name__ == "__main__":
    main()
