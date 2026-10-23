"""
Jupiter Lend (Solana) — позиции через бесплатный Jupiter Portfolio API.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent

JUPITER_PORTFOLIO_API = "https://api.jup.ag/portfolio/v1/positions/{wallet}"
JUPITER_LEND_BORROW_POSITIONS_API = "https://api.jup.ag/lend/v1/borrow/positions?users={wallet}"
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


def _http_json(url: str, timeout: float = 25.0) -> Any:
    headers = {
        "Accept": "application/json",
        "User-Agent": "publicportfolio/1.0",
    }
    api_key = str(os.environ.get("JUPITER_API_KEY") or os.environ.get("JUP_API_KEY") or "").strip()
    if api_key:
        headers["x-api-key"] = api_key
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode())


def fetch_portfolio_positions(wallet: str, timeout: float = 25.0) -> dict:
    url = JUPITER_PORTFOLIO_API.format(wallet=wallet)
    doc = _http_json(url, timeout=timeout)
    if not isinstance(doc, dict):
        raise TypeError("Jupiter portfolio API expected object")
    return doc


def parse_lend_borrow_api_position(row: dict) -> dict | None:
    """Parse Jupiter Lend Borrow API row (lend/v1/borrow/positions)."""
    if not isinstance(row, dict):
        return None
    vault = row.get("vault") or {}
    supply_tok = vault.get("supplyToken") or {}
    borrow_tok = vault.get("borrowToken") or {}
    s_dec = int(supply_tok.get("decimals") or 0)
    b_dec = int(borrow_tok.get("decimals") or 0)
    s_price = float(supply_tok.get("price") or 0)
    b_price = float(borrow_tok.get("price") or 0)
    supply_raw = int(float(row.get("supply") or 0))
    borrow_raw = int(float(row.get("borrow") or 0))
    # dustBorrow is residual interest dust in token base units — not the main debt.
    if s_dec < 0 or b_dec < 0:
        return None
    supply_amt = supply_raw / (10**s_dec) if s_dec else float(supply_raw)
    borrow_amt = borrow_raw / (10**b_dec) if b_dec else float(borrow_raw)
    collateral_usd = supply_amt * s_price
    borrow_usd = borrow_amt * b_price
    if collateral_usd <= 0 and borrow_usd <= 0:
        return None
    coll_asset = str(supply_tok.get("uiSymbol") or supply_tok.get("symbol") or "COLL")
    bor_asset = str(borrow_tok.get("uiSymbol") or borrow_tok.get("symbol") or "DEBT")
    lt = float(vault.get("liquidationThreshold") or 0) / 1000.0
    if lt <= 0:
        lt = JUPITER_LTV_FOR_HF
    hf = (collateral_usd * lt / borrow_usd) if borrow_usd > 0 else 0.0
    market_price = s_price if supply_amt > 0 else 0.0
    liquidation_price = (market_price / hf) if hf > 0 and hf <= 25 and market_price > 0 else 0.0
    pos_id = row.get("id")
    vault_id = row.get("vaultId") or vault.get("id")
    link = (
        f"https://jup.ag/lend/borrow/{vault_id}" if vault_id is not None else "https://jup.ag/lend"
    )
    return {
        "protocol": "Jupiter Lend",
        "chain": "solana",
        "collateralAsset": coll_asset,
        "collateralAmount": round(supply_amt, 8),
        "collateralUsd": round(collateral_usd, 6),
        "borrowAsset": bor_asset,
        "borrowAmount": round(borrow_amt, 6),
        "borrowUsd": round(borrow_usd, 6),
        "supplied": [{"asset": coll_asset, "amount": supply_amt, "usd": collateral_usd}],
        "borrowed": [{"asset": bor_asset, "amount": borrow_amt, "usd": borrow_usd}],
        "netUsd": round(collateral_usd - borrow_usd, 6),
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "healthFactor": round(hf, 4),
        "marketPrice": round(market_price, 6),
        "liquidationPrice": round(liquidation_price, 6),
        "link": link,
        "dataSource": "jupiter-lend-borrow-api",
        "positionId": str(pos_id) if pos_id is not None else "",
        "borrowAprPct": round(float(vault.get("borrowRate") or 0) / 100.0, 4)
        if vault.get("borrowRate") is not None
        else None,
    }


def fetch_jupiter_lend_borrow_positions(wallet: str, timeout: float = 25.0) -> list[dict]:
    url = JUPITER_LEND_BORROW_POSITIONS_API.format(wallet=wallet)
    doc = _http_json(url, timeout=timeout)
    rows = doc if isinstance(doc, list) else (doc.get("data") or doc.get("positions") or [])
    out: list[dict] = []
    for row in rows or []:
        pos = parse_lend_borrow_api_position(row)
        if pos:
            out.append(pos)
    return out


def fetch_jupiter_lending_positions(config: dict | None = None) -> list[dict]:
    """
    Live Jupiter Lend positions for configured Solana wallets.

    Prefer Portfolio API borrowlend elements; if that endpoint is down (503) or
    returns nothing, fall back to Lend Borrow Positions API which does not
    require the portfolio fetcher mesh.
    """
    out: list[dict] = []
    for wallet in solana_wallets_from_config(config):
        wallet_pos: list[dict] = []
        try:
            doc = fetch_portfolio_positions(wallet)
            token_info = doc.get("tokenInfo") or {}
            for el in doc.get("elements") or []:
                pos = parse_borrowlend_element(el, token_info)
                if pos:
                    pos.setdefault("dataSource", "jupiter-portfolio-api")
                    wallet_pos.append(pos)
        except (
            urllib.error.URLError,
            TimeoutError,
            OSError,
            json.JSONDecodeError,
            ValueError,
        ) as e:
            print(f"[WARN] Jupiter portfolio API ({wallet[:8]}…): {e}")

        if not wallet_pos:
            try:
                wallet_pos = fetch_jupiter_lend_borrow_positions(wallet)
                if wallet_pos:
                    print(
                        f"[OK] Jupiter Lend Borrow API fallback ({wallet[:8]}…): "
                        f"{len(wallet_pos)} pos"
                    )
            except (
                urllib.error.URLError,
                TimeoutError,
                OSError,
                json.JSONDecodeError,
                ValueError,
                TypeError,
            ) as e:
                print(f"[WARN] Jupiter lend borrow API ({wallet[:8]}…): {e}")

        out.extend(wallet_pos)

    if out:
        coll = sum(float(p.get("collateralUsd") or 0) for p in out)
        debt = sum(float(p.get("borrowUsd") or 0) for p in out)
        print(
            f"[OK] Jupiter Lend: {len(out)} pos, coll=${coll:.2f} debt=${debt:.2f} net=${coll - debt:.2f}"
        )
    else:
        print("[WARN] Jupiter Lend: no positions returned for configured Solana wallets")
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
    """Сегодня: coll/debt из актуального lending, equity = base + adj + idle (Navigator)."""
    snaps = [dict(s) for s in (payload.get("snapshots") or [])]
    if not snaps:
        return payload
    coll = debt = 0.0
    for p in lending_positions:
        coll += float(p.get("collateralUsd") or 0)
        debt += float(p.get("borrowUsd") or 0)
    adj = float(payload.get("manualVisualAdjustmentUsd") or 800.0)
    idle = float(payload.get("walletIdleUsd") or 0.0)
    last_liq = float(snaps[-1].get("liquidityUsd") or 0.0)
    base = coll - debt + last_liq
    live = base + adj + idle
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
    apply_chart_bridge: bool = True,
    equity_history_mode: str = "all",
) -> dict:
    """
    equity_history_mode:
      - "all" — перезаписать equityHistoryByDay с CHART_BRIDGE_START (полный export)
      - "today" — только сегодня (ежедневный append-only sync)
      - "none" — не трогать equityHistoryByDay
    """
    config = config or load_config()
    jupiter = fetch_jupiter_lending_positions(config)

    stale_evm = evm_lending
    if stale_evm is None:
        stale_evm = [
            p for p in (payload.get("lendingPositions") or []) if not is_jupiter_position(p)
        ]

    merged = merge_live_lending(jupiter, stale_evm)
    payload["lendingPositions"] = merged

    snaps = list(payload.get("snapshots") or [])
    if apply_chart_bridge:
        strip = legacy_backfill_strip_amount(snaps, payload)
        snaps = apply_main_chart_bridge(
            snaps,
            backfill_to_strip=strip,
        )
        payload.pop("jupiterBackfillNetUsd", None)
        payload.pop("jupiterBackfillAppliedDays", None)
    payload["snapshots"] = snaps

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    payload = patch_live_capital_with_lending(payload, merged, today)

    hist = payload.get("equityHistoryByDay") or {}
    if isinstance(hist, dict) and equity_history_mode != "none":
        for s in snaps:
            d = str(s.get("timestamp", ""))[:10]
            if not d:
                continue
            if equity_history_mode == "today" and d != today:
                continue
            if equity_history_mode == "all" and d < CHART_BRIDGE_START:
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
