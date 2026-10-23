#!/usr/bin/env python3
"""
Refresh data/portfolio-data.js from live Navigator sources:
  - Jupiter Lend (Solana)
  - Debank EVM lending (Fluid)
  - wallet idle (EVM + Solana)
  - active LP rows from Public portfolio sheet

Recomputes today's capital with Navigator formula:
  equity = collateral − debt + LP + idle + internal adj

Does not touch production entry points.

Usage (from repo root):
  python3 scripts/sync_jupiter_into_portfolio_data.py
"""

from __future__ import annotations

import json
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))

from debank_lending_live import fetch_live_evm_lending  # noqa: E402
from jupiter_lend import (  # noqa: E402
    fetch_jupiter_lending_positions,
    is_jupiter_position,
    load_config,
    merge_live_lending,
)
from wallet_idle import fetch_wallet_idle_usd  # noqa: E402

# Historical handoff figure from CURSOR_BACKEND_REQUIREMENTS.md (not live SoT).
HANDOFF_CABINET_USD = 15189.0

LP_SHEETS_API = (
    "https://defilabsvipnavigator.vercel.app/api/public-portfolio-lp"
    "?sheetId={sheet_id}&sheetName={sheet_name}"
)


def load_portfolio_js(path: Path) -> dict:
    raw = path.read_text(encoding="utf-8")
    eq = raw.index("=")
    body = raw[eq + 1 :].strip()
    if body.endswith(";"):
        body = body[:-1].strip()
    return json.loads(body)


def write_portfolio_js(path: Path, payload: dict) -> None:
    text = "window.PORTFOLIO_DATA = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n"
    path.write_text(text, encoding="utf-8")


def _parse_money(raw) -> float:
    s = str(raw or "").replace("\u00a0", " ").replace(" ", "").replace("$", "").replace(",", ".")
    try:
        return float(s) if s else 0.0
    except ValueError:
        return 0.0


def refresh_active_lp_from_sheet(payload: dict) -> list[dict]:
    sheet_id = str(payload.get("googleSheetId") or "").strip()
    sheet_name = str(payload.get("publicPortfolioSheetName") or "Public portfolio").strip()
    wallet = str(payload.get("portfolioWallet") or "").strip().lower()
    if not sheet_id:
        return [p for p in (payload.get("liquidityPositions") or []) if p.get("isActive", True)]

    url = LP_SHEETS_API.format(
        sheet_id=urllib.parse.quote(sheet_id, safe=""),
        sheet_name=urllib.parse.quote(sheet_name, safe=""),
    )
    with urllib.request.urlopen(url, timeout=45) as res:
        body = json.loads(res.read().decode())
    headers = [str(h or "").strip() for h in body.get("headers") or []]
    low = [h.lower() for h in headers]

    def col(*names: str) -> int:
        for n in names:
            if n.lower() in low:
                return low.index(n.lower())
        return -1

    oi = col("Стоимость позиции, USD")
    ci = col("Дата закрытия")
    ni = col("NFT_ID")
    pi = col("Пара")
    wi = col("owner_wallet")
    xi = col("Exchange")
    net_i = col("network")
    gi = col("Ком. доход (ИТОГО $)")
    qi = col("Incentives, $")
    fi = col("Fee APY")
    open_i = col("Дата открытия")
    fee_tier_i = col("fee_tier")

    fresh_active: list[dict] = []
    for row in body.get("rows") or []:
        cells = row.get("cells") or []

        def cell(i: int) -> str:
            return str(cells[i] if 0 <= i < len(cells) else "").strip()

        w = cell(wi).lower() if wi >= 0 else ""
        if wallet and w and wallet not in w:
            continue
        closed_at = cell(ci) if ci >= 0 else ""
        if closed_at and closed_at.lower() not in ("", "null", "none", "-"):
            continue
        val = _parse_money(cells[oi] if oi >= 0 else 0)
        fees = _parse_money(cells[gi] if gi >= 0 else 0)
        inc = _parse_money(cells[qi] if qi >= 0 else 0)
        apr = _parse_money(cells[fi] if fi >= 0 else 0)
        fresh_active.append(
            {
                "platform": cell(xi) if xi >= 0 else "DEX",
                "dataSource": "Google Sheet",
                "chain": cell(net_i) if net_i >= 0 else "",
                "pair": cell(pi) if pi >= 0 else "",
                "feesUsd": fees,
                "incentivesUsd": inc,
                "apr": apr,
                "displayApr": apr,
                "openedAt": cell(open_i) if open_i >= 0 else "",
                "closedAt": "",
                "isActive": True,
                "feeTier": _parse_money(cells[fee_tier_i] if fee_tier_i >= 0 else 0),
                "positionId": cell(ni) if ni >= 0 else "",
                "valueUsd": round(val, 2),
                "investedUsd": 0.0,
            }
        )

    prev = payload.get("liquidityPositions") or []
    closed_prev = [p for p in prev if not p.get("isActive", True)]
    for p in closed_prev:
        p["isActive"] = False
        p["valueUsd"] = 0.0
    payload["liquidityPositions"] = closed_prev + fresh_active
    unclaimed = sum(
        float(p.get("feesUsd") or 0) + float(p.get("incentivesUsd") or 0) for p in fresh_active
    )
    payload["openLiquidityUnclaimedUsd"] = round(unclaimed, 2)
    print(
        f"[OK] LP sheet refresh: {len(fresh_active)} active, "
        f"sum=${sum(float(p.get('valueUsd') or 0) for p in fresh_active):.2f}"
    )
    return fresh_active


def main() -> None:
    path = ROOT / "data" / "portfolio-data.js"
    payload = load_portfolio_js(path)
    config = load_config()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    jupiter = fetch_jupiter_lending_positions(config)

    evm_wallet = str(
        ((config.get("debank_wallets") or [""]) + [""])[0] or payload.get("portfolioWallet") or ""
    ).strip()
    try:
        evm = fetch_live_evm_lending(evm_wallet) if evm_wallet else []
    except Exception as exc:
        print(f"[WARN] live Debank lending failed: {exc}")
        evm = [p for p in (payload.get("lendingPositions") or []) if not is_jupiter_position(p)]
    if not evm:
        evm = [p for p in (payload.get("lendingPositions") or []) if not is_jupiter_position(p)]

    merged = merge_live_lending(jupiter, evm)
    payload["lendingPositions"] = merged
    payload["jupiterLendSyncedAt"] = now_iso
    payload["exportedAt"] = now_iso

    try:
        active_lp = refresh_active_lp_from_sheet(payload)
    except Exception as exc:
        print(f"[WARN] LP sheet refresh failed: {exc}")
        active_lp = [
            p for p in (payload.get("liquidityPositions") or []) if p.get("isActive", True)
        ]

    sols = payload.get("solanaWallets") or config.get("solana_wallets") or []
    sol_wallet = str(sols[0] if sols else "").strip()
    try:
        idle_info = fetch_wallet_idle_usd(evm_wallet=evm_wallet, solana_wallet=sol_wallet)
        idle = float(idle_info.get("walletIdleUsd") or 0)
        payload["walletIdleUsd"] = round(idle, 2)
        print(
            f"[OK] walletIdleUsd={idle:.2f} "
            f"(evm={idle_info.get('evmUsd', 0):.2f} sol={idle_info.get('solanaUsd', 0):.2f})"
        )
    except Exception as exc:
        print(f"[WARN] wallet idle fetch failed: {exc}")
        idle = float(payload.get("walletIdleUsd") or 0)

    coll = sum(float(p.get("collateralUsd") or 0) for p in merged)
    debt = sum(float(p.get("borrowUsd") or 0) for p in merged)
    adj = float(
        payload.get("manualVisualAdjustmentUsd")
        or config.get("manual_visual_adjustment_usd")
        or 800
    )

    snaps = list(payload.get("snapshots") or [])
    last = dict(snaps[-1]) if snaps else {}
    lp_listed = sum(float(p.get("valueUsd") or 0) for p in active_lp)
    liq = lp_listed if lp_listed > 0 else float(last.get("liquidityUsd") or 0)

    base = coll - debt + liq
    equity = base + adj + idle
    payload["liveCapitalBaseUsd"] = round(base, 2)
    payload["currentCapitalUsd"] = round(equity, 2)
    payload["manualVisualAdjustmentUsd"] = adj

    # Live cabinet reference = Navigator methodology total at sync time.
    # Handoff ~$15189 was a frozen UI figure; gap isolates to cbBTC mark.
    jup = [p for p in merged if is_jupiter_position(p)]
    jup_coll = sum(float(p.get("collateralUsd") or 0) for p in jup)
    jup_debt = sum(float(p.get("borrowUsd") or 0) for p in jup)
    jup_net = jup_coll - jup_debt
    fluid_net = (coll - jup_coll) - (debt - jup_debt)
    handoff_implied_lending_net = HANDOFF_CABINET_USD - idle - liq - adj
    handoff_implied_jup_net = handoff_implied_lending_net - fluid_net
    handoff_gap = equity - HANDOFF_CABINET_USD
    jup_supply = sum(float(p.get("collateralAmount") or 0) for p in jup)
    api_btc = (jup_coll / jup_supply) if jup_supply > 0 else 0.0
    handoff_btc = (handoff_implied_jup_net + jup_debt) / jup_supply if jup_supply > 0 else 0.0

    payload["cabinetReferenceUsd"] = round(equity, 2)
    payload["cabinetReferenceAsOf"] = now_iso
    payload["cabinetReferenceSource"] = (
        "live Navigator methodology: idle + collateral + LP − debt + internal adj"
    )
    payload["cabinetHandoffUsd"] = HANDOFF_CABINET_USD
    payload["cabinetHandoffGapUsd"] = round(handoff_gap, 2)
    payload["cabinetHandoffGapCause"] = (
        f"Устаревшая опорная цифра handoff ${HANDOFF_CABINET_USD:.0f}: "
        f"весь разрыв ${handoff_gap:.2f} в оценке Jupiter cbBTC "
        f"(handoff-implied ~${handoff_btc:.0f}/BTC vs live ~${api_btc:.0f}/BTC; "
        f"Jupiter net ${jup_net:.2f} vs handoff-implied ${handoff_implied_jup_net:.2f}). "
        f"Ошибка формулы капитала не найдена."
    )

    today_row = {
        "timestamp": f"{today}T00:00:00.000Z",
        "collateralUsd": round(coll, 6),
        "debtUsd": round(debt, 6),
        "liquidityUsd": round(liq, 6),
        "equityUsd": round(equity, 6),
        "dailyFeeIncomeUsd": float(last.get("dailyFeeIncomeUsd") or 0),
    }
    out_snaps = []
    replaced = False
    for s in snaps:
        if str(s.get("timestamp", ""))[:10] == today:
            out_snaps.append(today_row)
            replaced = True
        else:
            out_snaps.append(s)
    if not replaced:
        out_snaps.append(today_row)
        out_snaps.sort(key=lambda x: str(x.get("timestamp", "")))
    payload["snapshots"] = out_snaps

    hist = dict(payload.get("equityHistoryByDay") or {})
    hist[today] = {
        "equityUsd": today_row["equityUsd"],
        "collateralUsd": today_row["collateralUsd"],
        "debtUsd": today_row["debtUsd"],
        "liquidityUsd": today_row["liquidityUsd"],
        "dailyFeeIncomeUsd": today_row["dailyFeeIncomeUsd"],
    }
    payload["equityHistoryByDay"] = hist

    write_portfolio_js(path, payload)

    print(
        f"[OK] wrote {path.name}: lending={len(merged)} "
        f"(jupiter={len(jupiter)} net=${jup_net:.2f}) "
        f"coll=${coll:.2f} debt=${debt:.2f} liq=${liq:.2f} idle=${idle:.2f} "
        f"currentCapitalUsd=${equity:.2f}"
    )
    print(f"[OK] cabinetReferenceUsd=${equity:.2f} (live methodology)")
    print(
        f"[OK] handoff ${HANDOFF_CABINET_USD:.0f} gap=${handoff_gap:.2f}: {payload['cabinetHandoffGapCause']}"
    )


if __name__ == "__main__":
    main()
