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
CHART_BRIDGE_ANCHOR_DAY = "2026-06-09"
CHART_BRIDGE_START = "2026-06-10"
CHART_BRIDGE_END = "2026-06-15"
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


def jupiter_has_btc_collateral(jupiter: list[dict]) -> bool:
    for p in jupiter:
        coll = str(p.get("collateralAsset") or "").upper()
        if coll in ("CBBTC", "WBTC", "BTC") and float(p.get("collateralUsd") or 0) > 500:
            return True
    return False


def filter_phantom_evm_lending(evm: list[dict], jupiter: list[dict]) -> list[dict]:
    """Убираем закрытые/переехавшие EVM-позиции (cbBTC Base → Jupiter Solana)."""
    migrated_btc = jupiter_has_btc_collateral(jupiter)
    out: list[dict] = []
    for p in evm or []:
        if is_jupiter_position(p):
            continue
        coll = str(p.get("collateralAsset") or "").upper()
        chain = str(p.get("chain") or "").lower()
        proto = str(p.get("protocol") or "").lower()
        coll_usd = float(p.get("collateralUsd") or 0)
        bor_usd = float(p.get("borrowUsd") or 0)
        if coll_usd < 5 and bor_usd < 5:
            continue
        if migrated_btc and coll == "CBBTC" and chain == "base":
            print(f"[OK] drop phantom lending: {proto} {chain} {coll} (migrated to Jupiter)")
            continue
        out.append(p)
    return out


def merge_live_lending(jupiter: list[dict], evm: list[dict]) -> list[dict]:
    return list(jupiter or []) + filter_phantom_evm_lending(evm or [], jupiter or [])


def legacy_backfill_strip_amount(snapshots: list[dict], payload: dict) -> float:
    explicit = float(payload.get("jupiterBackfillNetUsd") or 0)
    if explicit > 0:
        return explicit
    by_day = {str(s.get("timestamp", ""))[:10]: s for s in snapshots}
    eq9 = float((by_day.get(CHART_BRIDGE_ANCHOR_DAY) or {}).get("equityUsd") or 0)
    eq10 = float((by_day.get(CHART_BRIDGE_START) or {}).get("equityUsd") or 0)
    if eq9 > 0 and eq10 - eq9 > 1500:
        return eq10 - eq9
    return 0.0


def apply_main_chart_bridge(
    snapshots: list[dict],
    *,
    anchor_day: str = CHART_BRIDGE_ANCHOR_DAY,
    bridge_start: str = CHART_BRIDGE_START,
    bridge_end: str = CHART_BRIDGE_END,
    backfill_to_strip: float = 0.0,
) -> list[dict]:
    """
    Главный график: 10–15 июня выровнять по 9-му (без скачка).
    Сначала снимаем старый Jupiter backfill, потом сдвигаем мост к anchor.
    """
    if not snapshots:
        return snapshots
    by_day = {str(s.get("timestamp", ""))[:10]: dict(s) for s in snapshots}
    if anchor_day not in by_day or bridge_start not in by_day:
        return snapshots

    if backfill_to_strip > 0:
        for d in sorted(by_day):
            if bridge_start <= d <= bridge_end:
                by_day[d]["equityUsd"] = round(
                    float(by_day[d].get("equityUsd") or 0) - backfill_to_strip, 6
                )

    anchor_eq = float(by_day[anchor_day].get("equityUsd") or 0)
    shift = anchor_eq - float(by_day[bridge_start].get("equityUsd") or 0)
    if abs(shift) > 0.01:
        for d in sorted(by_day):
            if bridge_start <= d <= bridge_end:
                by_day[d]["equityUsd"] = round(float(by_day[d].get("equityUsd") or 0) + shift, 6)
        print(
            f"[OK] main chart bridge {bridge_start}..{bridge_end}: "
            f"shift={shift:+.2f} anchor={anchor_day}={anchor_eq:.2f}"
        )

    # If day-15 already contains some wrong backfill, constant shift can still
    # leave an unnatural spike. We smooth only the last day in bridge range.
    if bridge_end in by_day:
        try:
            days = [d for d in sorted(by_day.keys()) if bridge_start <= d <= bridge_end]
            if len(days) >= 4:
                eqs = [float(by_day[d].get("equityUsd") or 0) for d in days]
                deltas = [eqs[i] - eqs[i - 1] for i in range(1, len(eqs))]
                last_delta = deltas[-1]
                typical_delta = sum(deltas[:-1]) / max(1, len(deltas[:-1]))
                if typical_delta > 0 and last_delta > typical_delta * 2.0:
                    by_day[bridge_end]["equityUsd"] = round(eqs[-2] + typical_delta, 6)
                    print(
                        f"[OK] main chart day spike heal: {bridge_end} "
                        f"delta {last_delta:+.2f} -> {typical_delta:+.2f}"
                    )
        except Exception:
            pass
    return [by_day[k] for k in sorted(by_day.keys())]


def patch_live_capital_with_lending(
    payload: dict,
    lending_positions: list[dict],
    today: str,
) -> dict:
    """Сегодня: coll/debt из актуального lending, equity = base + adj + fees."""
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


def apply_jupiter_to_portfolio(
    payload: dict,
    config: dict | None = None,
    *,
    evm_lending: list[dict] | None = None,
) -> dict:
    config = config or load_config()
    jupiter = fetch_jupiter_lending_positions(config)

    stale_evm = evm_lending
    if stale_evm is None:
        stale_evm = [
            p for p in (payload.get("lendingPositions") or []) if not is_jupiter_position(p)
        ]

    merged = merge_live_lending(jupiter, stale_evm)
    payload["lendingPositions"] = merged

    strip = legacy_backfill_strip_amount(payload.get("snapshots") or [], payload)
    snaps = apply_main_chart_bridge(
        payload.get("snapshots") or [],
        backfill_to_strip=strip,
    )
    payload["snapshots"] = snaps
    payload.pop("jupiterBackfillNetUsd", None)
    payload.pop("jupiterBackfillAppliedDays", None)

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    payload = patch_live_capital_with_lending(payload, merged, today)

    # equityHistoryByDay — только для главного графика; APR не трогаем
    hist = payload.get("equityHistoryByDay") or {}
    if isinstance(hist, dict):
        for s in snaps:
            d = str(s.get("timestamp", ""))[:10]
            if not d or d < CHART_BRIDGE_START:
                continue
            hist[d] = {
                "equityUsd": float(s.get("equityUsd") or 0),
                "collateralUsd": float(s.get("collateralUsd") or 0),
                "debtUsd": float(s.get("debtUsd") or 0),
                "liquidityUsd": float(s.get("liquidityUsd") or 0),
                "dailyFeeIncomeUsd": float(s.get("dailyFeeIncomeUsd") or 0),
            }
        payload["equityHistoryByDay"] = hist

    payload["jupiterLendSyncedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return payload
