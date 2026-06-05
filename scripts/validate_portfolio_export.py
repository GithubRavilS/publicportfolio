#!/usr/bin/env python3
"""
Аудит экспорта portfolio-data.js (как audit-wallet.mjs в Portfolio Tracker).
Запуск: python scripts/validate_portfolio_export.py [path/to/portfolio-data.js]
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_JS = ROOT / "data" / "portfolio-data.js"
FLAT_APR_TOLERANCE = 0.02
TAIL_DAYS = 7
MAX_EQUITY_DROP_PCT = 18.0
FORBIDDEN_FLAT_APR = {8.27, 8.270, 2.6, 0.33}
MANUAL_VISUAL_ADJUSTMENT_USD = 800.0
MIN_CURRENT_CAPITAL_USD = 14900.0


def load_portfolio_data(path: Path) -> dict:
    raw = path.read_text(encoding="utf-8")
    m = re.search(r"window\.PORTFOLIO_DATA\s*=\s*(\{.*\})\s*;?\s*$", raw, re.S)
    if not m:
        raise ValueError(f"Cannot parse PORTFOLIO_DATA from {path}")
    return json.loads(m.group(1))


def tail_slice(items: list, n: int) -> list:
    return items[-n:] if len(items) >= n else list(items)


def run_audit(data: dict) -> dict:
    snapshots = data.get("snapshots") or []
    chart = data.get("dailyYieldSeries") or []
    income_by_day = data.get("incomeByDay") or {}
    issues: list[str] = []
    warnings: list[str] = []

    if len(snapshots) < 30:
        issues.append(f"too_few_snapshots: {len(snapshots)}")

    adj = float(data.get("manualVisualAdjustmentUsd") or 0)
    if abs(adj - MANUAL_VISUAL_ADJUSTMENT_USD) > 1.0:
        issues.append(f"bad_manual_adjustment: {adj} expected {MANUAL_VISUAL_ADJUSTMENT_USD}")

    cur = float(data.get("currentCapitalUsd") or 0)
    base = float(data.get("liveCapitalBaseUsd") or 0)
    unclaimed = float(data.get("openLiquidityUnclaimedUsd") or 0)
    expected_cur = base + adj + unclaimed
    if cur < MIN_CURRENT_CAPITAL_USD:
        issues.append(f"current_capital_too_low: {cur:.2f} (<{MIN_CURRENT_CAPITAL_USD})")
    elif abs(cur - expected_cur) > 25.0:
        issues.append(
            f"current_capital_formula: {cur:.2f} != base+adj+fees "
            f"({base:.2f}+{adj:.0f}+{unclaimed:.2f}={expected_cur:.2f})"
        )
    if snapshots:
        last = snapshots[-1]
        last_eq = float(last.get("equityUsd") or 0)
        if abs(last_eq - cur) > 25.0:
            issues.append(f"today_equity_mismatch: snap={last_eq:.2f} currentCapital={cur:.2f}")

    dates = [str(s.get("timestamp", ""))[:10] for s in snapshots]
    store_path = ROOT / "data" / "lp-income-snapshots.json"
    store_days = 0
    if store_path.exists():
        try:
            store = json.loads(store_path.read_text(encoding="utf-8"))
            store_days = len(store.get("byDay") or {})
        except Exception:
            warnings.append("lp_income_store_unreadable")
    if store_days < 2:
        warnings.append(
            f"lp_income_store_sparse: {store_days} day(s) — APR tail improves after daily exports"
        )

    tail_idx = list(range(max(0, len(snapshots) - TAIL_DAYS), len(snapshots)))

    tail_aprs = [float(chart[i]) if i < len(chart) else 0.0 for i in tail_idx]
    tail_fees = [float(snapshots[i].get("dailyFeeIncomeUsd") or 0) for i in tail_idx]
    tail_liq = [float(snapshots[i].get("liquidityUsd") or 0) for i in tail_idx]

    nonzero_aprs = [a for a in tail_aprs if a > 0.01]
    if len(nonzero_aprs) >= 3:
        spread = max(nonzero_aprs) - min(nonzero_aprs)
        if spread < FLAT_APR_TOLERANCE:
            issues.append(
                f"flat_tail_apr: last {TAIL_DAYS}d APR nearly identical "
                f"({min(nonzero_aprs):.4f}–{max(nonzero_aprs):.4f})"
            )

    for apr in tail_aprs:
        for bad in FORBIDDEN_FLAT_APR:
            if abs(apr - bad) < 0.005:
                warnings.append(f"suspicious_flat_apr: {apr:.4f} (known bad plateau)")

    if snapshots:
        last = snapshots[-1]
        last_day = dates[-1]
        last_fee = float(last.get("dailyFeeIncomeUsd") or 0)
        last_liq = float(last.get("liquidityUsd") or 0)
        cum_sheet = sum(
            float(p.get("feesUsd") or 0) + float(p.get("incentivesUsd") or 0)
            for p in (data.get("liquidityPositions") or [])
            if p.get("isActive", True)
        )
        if last_liq > 3000 and cum_sheet > 1 and last_fee <= 0:
            msg = f"zero_daily_income_on_last_day: {last_day} fee=0 liq={last_liq:.0f} cum_lp={cum_sheet:.2f}"
            if store_days >= 2:
                issues.append(msg)
            else:
                warnings.append(msg + " (нужен второй дневной снимок lp-income-snapshots)")

    for i in tail_idx:
        d = dates[i]
        fee = float(snapshots[i].get("dailyFeeIncomeUsd") or 0)
        liq = float(snapshots[i].get("liquidityUsd") or 0)
        apr = float(chart[i]) if i < len(chart) else 0.0
        if liq > 500 and fee > 0 and apr <= 0.01:
            warnings.append(f"fee_without_apr: {d} fee={fee:.4f} liq={liq:.0f}")
        if fee <= 0 and apr > 0.5:
            warnings.append(f"apr_without_fee: {d} apr={apr:.2f}% (reference backfill?)")

    if len(snapshots) >= 2:
        for j in range(len(snapshots) - TAIL_DAYS, len(snapshots)):
            if j < 1:
                continue
            e0 = float(snapshots[j - 1].get("equityUsd") or 0)
            e1 = float(snapshots[j].get("equityUsd") or 0)
            if e0 > 1000 and e1 > 0:
                drop_pct = (e0 - e1) / e0 * 100.0
                if drop_pct > MAX_EQUITY_DROP_PCT:
                    warnings.append(
                        f"equity_cliff: {dates[j - 1]}→{dates[j]} -{drop_pct:.1f}% "
                        f"({e0:.0f}→{e1:.0f})"
                    )

    ok = len(issues) == 0
    return {
        "ok": ok,
        "issues": issues,
        "warnings": warnings,
        "summary": {
            "snapshots": len(snapshots),
            "tailDays": TAIL_DAYS,
            "tailAprMin": round(min(nonzero_aprs), 4) if nonzero_aprs else 0,
            "tailAprMax": round(max(nonzero_aprs), 4) if nonzero_aprs else 0,
            "lastDailyFeeUsd": round(tail_fees[-1], 6) if tail_fees else 0,
            "lastLiquidityUsd": round(tail_liq[-1], 2) if tail_liq else 0,
            "incomeByDayKeys": len(income_by_day),
            "lpSnapshotStoreDays": store_days,
        },
    }


def main() -> int:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_JS
    if not path.exists():
        print(json.dumps({"ok": False, "issues": [f"missing_file: {path}"]}, indent=2))
        return 2
    try:
        data = load_portfolio_data(path)
    except Exception as e:
        print(json.dumps({"ok": False, "issues": [str(e)]}, indent=2))
        return 2
    result = run_audit(data)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if not result["ok"]:
        for x in result["issues"]:
            print(f"[AUDIT FAIL] {x}", file=sys.stderr)
    for w in result.get("warnings") or []:
        print(f"[AUDIT WARN] {w}", file=sys.stderr)
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
