"""
Yield / Deposit positions for Public Portfolio (same sources as DeFi Navigator).

Primary: Pendle PT/YT/LP valuation via Pendle dashboard API.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any


def _http_json(url: str, timeout: float = 30.0) -> Any:
    req = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "publicportfolio/1.0"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode())


def fetch_pendle_yield_positions(wallet: str) -> list[dict]:
    wallet = str(wallet or "").strip()
    if not wallet:
        return []
    url = f"https://api-v2.pendle.finance/core/v1/dashboard/positions/database/{wallet}"
    try:
        raw = _http_json(url)
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as e:
        print(f"[WARN] Pendle positions ({wallet[:8]}…): {e}")
        return []

    market_name_by_id: dict[str, str] = {}
    chain_ids = [int(c.get("chainId", 0) or 0) for c in raw.get("positions") or []]
    for chain_id in set(chain_ids):
        if chain_id <= 0:
            continue
        try:
            meta = _http_json(
                f"https://api-v2.pendle.finance/core/v1/markets/all?chainId={chain_id}"
            )
            for m in meta.get("markets") or []:
                addr = str(m.get("address", "")).lower()
                if not addr:
                    continue
                market_name_by_id[f"{chain_id}-{addr}"] = str(m.get("name", "") or "").strip()
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError, TypeError):
            pass

    out: list[dict] = []
    for chain in raw.get("positions") or []:
        chain_id = int(chain.get("chainId", 0) or 0)
        for pos in chain.get("openPositions") or []:
            pt = float((pos.get("pt") or {}).get("valuation") or 0.0)
            yt = float((pos.get("yt") or {}).get("valuation") or 0.0)
            lp = float((pos.get("lp") or {}).get("valuation") or 0.0)
            value = pt + yt + lp
            if value <= 0:
                continue
            market_id = str(pos.get("marketId", "") or "")
            pair = market_name_by_id.get(market_id.lower(), market_id)
            out.append(
                {
                    "type": "yield",
                    "protocol": "Pendle",
                    "platform": "Pendle",
                    "chain": str(chain_id),
                    "marketId": market_id,
                    "pair": pair or "Pendle",
                    "asset": pair or "PT",
                    "ptUsd": round(pt, 6),
                    "ytUsd": round(yt, 6),
                    "lpUsd": round(lp, 6),
                    "valueUsd": round(value, 6),
                    "isActive": True,
                    "link": "https://app.pendle.finance/trade/markets",
                    "dataSource": "pendle-dashboard-api",
                }
            )
    if out:
        total = sum(float(p.get("valueUsd") or 0) for p in out)
        print(f"[OK] Pendle yield: {len(out)} pos, ${total:.2f}")
    return out


def fetch_yield_positions(*, evm_wallet: str) -> list[dict]:
    """Aggregate yield/deposit principals for the public portfolio wallet set."""
    return fetch_pendle_yield_positions(evm_wallet)


def yield_principal_usd(positions: list[dict] | None) -> float:
    return round(
        sum(float(p.get("valueUsd") or 0) for p in (positions or []) if p.get("isActive", True)),
        6,
    )
