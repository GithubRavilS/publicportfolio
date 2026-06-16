"""
Jupiter Lend (Solana) — позиции через бесплатный Jupiter Portfolio API.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent

JUPITER_PORTFOLIO_API = "https://api.jup.ag/portfolio/v1/positions/{wallet}"
DEFAULT_SOLANA_WALLET = "9Q4mAN4QTxC39CRn3SmFqEaxhEJjNd7UTYoeqUZ1pf5o"
JUPITER_BACKFILL_START = "2026-06-10"
JUPITER_BACKFILL_END = "2026-06-15"
JUPITER_LIVE_FROM_DAY = "2026-06-16"
JUPITER_LTV_FOR_HF = 0.95


def load_config() -> dict:
    path = ROOT / "config.json"
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def solana_wallets_from_config(config: dict | None) -> list[str]:
    cfg = config or {}
    wallets: list[str] = []
    for key in ("solana_wallets", "jupiter_solana_wallets"):
        for w in cfg.get(key) or []:
            s = str(w or "").strip()
            if s and s not in wallets:
                wallets.append(s)
    single = str(cfg.get("solana_wallet") or cfg.get("jupiter_solana_wallet") or "").strip()
    if single and single not in wallets:
        wallets.append(single)
    if not wallets:
        wallets.append(DEFAULT_SOLANA_WALLET)
    return wallets


def _token_symbol(token_info: dict[str, Any], mint: str) -> str:
    meta = (token_info or {}).get("solana", {}).get(mint) or {}
    return str(meta.get("symbol") or mint[:8])


def fetch_portfolio_positions(wallet: str, timeout: float = 25.0) -> dict:
    url = JUPITER_PORTFOLIO_API.format(wallet=wallet)
    req = urllib.request.Request(
        url, headers={"Accept": "application/json", "User-Agent": "publicportfolio/1.0"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode())


def parse_borrowlend_element(element: dict, token_info: dict[str, Any]) -> dict | None:
    if str(element.get("type") or "").lower() != "borrowlend":
        return None
    data = element.get("data") or {}
    supplied = []
    for a in data.get("suppliedAssets") or []:
        td = a.get("data") or {}
        mint = str(td.get("address") or "")
        supplied.append(
            {
                "asset": _token_symbol(token_info, mint),
                "amount": float(td.get("amount") or 0),
                "usd": float(a.get("value") or 0),
            }
        )
    borrowed = []
    for a in data.get("borrowedAssets") or []:
        td = a.get("data") or {}
        mint = str(td.get("address") or "")
        borrowed.append(
            {
                "asset": _token_symbol(token_info, mint),
                "amount": float(td.get("amount") or 0),
                "usd": float(a.get("value") or 0),
            }
        )
    collateral_usd = float(data.get("suppliedValue") or sum(x["usd"] for x in supplied))
    borrow_usd = float(data.get("borrowedValue") or sum(x["usd"] for x in borrowed))
    if collateral_usd <= 0 and borrow_usd <= 0:
        return None
    coll_asset = supplied[0]["asset"] if supplied else ""
    coll_amount = supplied[0]["amount"] if supplied else 0.0
    bor_asset = borrowed[0]["asset"] if borrowed else ""
    bor_amount = borrowed[0]["amount"] if borrowed else 0.0
    market_price = (collateral_usd / coll_amount) if coll_amount > 0 else 0.0
    hf = (collateral_usd * JUPITER_LTV_FOR_HF / borrow_usd) if borrow_usd > 0 else 0.0
    liquidation_price = (market_price / hf) if hf > 0 and hf <= 25 and market_price > 0 else 0.0
    link = str(data.get("link") or "https://jup.ag/lend")
    return {
        "protocol": "Jupiter Lend",
        "chain": "solana",
        "collateralAsset": coll_asset,
        "collateralAmount": coll_amount,
        "collateralUsd": round(collateral_usd, 6),
        "borrowAsset": bor_asset,
        "borrowAmount": bor_amount,
        "borrowUsd": round(borrow_usd, 6),
        "supplied": supplied,
        "borrowed": borrowed,
        "netUsd": round(float(data.get("value") or (collateral_usd - borrow_usd)), 6),
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "healthFactor": round(hf, 4),
        "marketPrice": round(market_price, 6),
        "liquidationPrice": round(liquidation_price, 6),
        "link": link,
    }


def fetch_jupiter_lending_positions(config: dict | None = None) -> list[dict]:
    out: list[dict] = []
    for wallet in solana_wallets_from_config(config):
        try:
            doc = fetch_portfolio_positions(wallet)
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as e:
            print(f"[WARN] Jupiter portfolio API ({wallet[:8]}…): {e}")
            continue
        token_info = doc.get("tokenInfo") or {}
        for el in doc.get("elements") or []:
            pos = parse_borrowlend_element(el, token_info)
            if pos:
                out.append(pos)
    if out:
        coll = sum(float(p.get("collateralUsd") or 0) for p in out)
        debt = sum(float(p.get("borrowUsd") or 0) for p in out)
        print(
            f"[OK] Jupiter Lend: {len(out)} pos, coll=${coll:.2f} debt=${debt:.2f} net=${coll - debt:.2f}"
        )
    return out


def is_jupiter_position(p: dict) -> bool:
    chain = str(p.get("chain") or "").lower()
    proto = str(p.get("protocol") or "").lower()
    link = str(p.get("link") or "").lower()
    return chain == "solana" or "jupiter" in proto or "jup.ag/lend" in link


def merge_lending_with_jupiter(existing: list[dict], jupiter: list[dict]) -> list[dict]:
    kept = [p for p in (existing or []) if not is_jupiter_position(p)]
    return kept + list(jupiter or [])


def jupiter_net_usd(positions: list[dict]) -> float:
    return sum(float(p.get("netUsd") or 0) for p in positions if is_jupiter_position(p))


def apply_jupiter_chart_patch(
    snapshots: list[dict],
    *,
    backfill_net_usd: float,
    live_from_day: str = JUPITER_LIVE_FROM_DAY,
    backfill_start: str = JUPITER_BACKFILL_START,
    backfill_end: str = JUPITER_BACKFILL_END,
) -> list[dict]:
    """Jun 10–15: +фикс. net; с live_from_day: equity уже пересчитан в patch_live_capital."""
    if not snapshots or backfill_net_usd <= 0:
        return snapshots
    out = []
    for s in snapshots:
        row = dict(s)
        d = str(row.get("timestamp", ""))[:10]
        if backfill_start <= d <= backfill_end:
            row["equityUsd"] = round(float(row.get("equityUsd") or 0) + backfill_net_usd, 6)
        out.append(row)
    return out


def patch_live_capital_with_lending(
    payload: dict,
    lending_positions: list[dict],
    today: str,
) -> dict:
    """Сегодня: coll/debt из всех lending (EVM + Jupiter), equity = base + adj + fees."""
    snaps = [dict(s) for s in (payload.get("snapshots") or [])]
    if not snaps:
        return payload
    coll = debt = 0.0
    for p in lending_positions:
        coll += float(p.get("collateralUsd") or 0)
        debt += float(p.get("borrowUsd") or 0)
    adj = float(payload.get("manualVisualAdjustmentUsd") or 800.0)
    unclaimed = float(payload.get("openLiquidityUnclaimedUsd") or 0.0)
    last_liq = float(snaps[-1].get("liquidityUsd") or 0.0)
    base = coll - debt + last_liq
    live = base + adj + unclaimed
    payload["liveCapitalBaseUsd"] = round(base, 2)
    payload["currentCapitalUsd"] = round(live, 2)
    for i, s in enumerate(snaps):
        d = str(s.get("timestamp", ""))[:10]
        if d != today:
            continue
        row = dict(s)
        liq = float(row.get("liquidityUsd") or last_liq)
        row["collateralUsd"] = round(coll, 6)
        row["debtUsd"] = round(debt, 6)
        row["liquidityUsd"] = liq
        row["equityUsd"] = round(live, 6)
        snaps[i] = row
        break
    payload["snapshots"] = snaps
    return payload


def apply_jupiter_to_portfolio(payload: dict, config: dict | None = None) -> dict:
    jupiter = fetch_jupiter_lending_positions(config)
    existing = payload.get("lendingPositions") or []
    merged = merge_lending_with_jupiter(existing, jupiter)
    payload["lendingPositions"] = merged

    live_net = jupiter_net_usd(jupiter)
    if live_net <= 0:
        return payload

    backfill = float(payload.get("jupiterBackfillNetUsd") or 0)
    if backfill <= 0:
        backfill = live_net
        payload["jupiterBackfillNetUsd"] = round(backfill, 2)

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    snaps = apply_jupiter_chart_patch(
        payload.get("snapshots") or [],
        backfill_net_usd=backfill,
    )
    payload["snapshots"] = snaps
    payload = patch_live_capital_with_lending(payload, merged, today)
    payload["equityHistoryByDay"] = _equity_history_from_snapshots(payload.get("snapshots") or [])
    payload["jupiterLendSyncedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return payload


def _equity_history_from_snapshots(snapshots: list[dict]) -> dict[str, dict]:
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
