#!/usr/bin/env python3
"""QA левого графика: якоря, хвост без скачков, корреляция с β×BTC с 15.01."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "python"))

from export_static_data import (  # noqa: E402
    BTC_EQUITY_BETA,
    EQUITY_BTC_BACKWARD_FROM_DAY,
    EQUITY_CHART_START_DAY,
    EQUITY_CHART_START_USD,
    JAN_EQUITY_SHAPAN_END_DAY,
    _btc_forward_return,
    load_or_fetch_btc_by_day,
)


def load_snapshots() -> list[dict]:
    js = ROOT / "data" / "portfolio-data.js"
    raw = js.read_text(encoding="utf-8")
    data = json.loads(raw.split("=", 1)[1].strip().rstrip(";"))
    return data.get("snapshots") or []


def main() -> int:
    snaps = load_snapshots()
    if len(snaps) < 30:
        print("[FAIL] snapshots < 30")
        return 1

    days = [s["timestamp"][:10] for s in snaps]
    eq = {d: float(s["equityUsd"]) for d, s in zip(days, snaps)}
    btc = load_or_fetch_btc_by_day(days[0], days[-1])
    issues: list[str] = []

    start = eq.get(EQUITY_CHART_START_DAY, 0)
    today = days[-1]
    if abs(start - EQUITY_CHART_START_USD) > 1:
        issues.append(f"Jan1={start:.2f} expected {EQUITY_CHART_START_USD}")

    cur = json.loads((ROOT / "data" / "portfolio-data.js").read_text().split("=", 1)[1].rstrip(";"))
    live = float(cur.get("currentCapitalUsd") or 0)
    if live > 0 and abs(eq[today] - live) > 2:
        issues.append(f"today equity {eq[today]:.2f} != currentCapitalUsd {live:.2f}")

    # Хвост: нет скачка >12% за 2 дня (типичный β×BTC <10%)
    for i in range(len(days) - 2, len(days)):
        if i < 1:
            continue
        d0, d1 = days[i - 1], days[i]
        ch = abs(eq[d1] / eq[d0] - 1.0) * 100
        if ch > 12:
            issues.append(f"tail jump {d0}->{d1}: {ch:.1f}% (${eq[d0]:.0f}->${eq[d1]:.0f})")

    # С 15.01 до Jupiter live: дневной % ≈ β×BTC%
    mism = 0
    checked = 0
    jupiter_live_from = "2026-06-16"
    for i in range(1, len(days)):
        d0, d1 = days[i - 1], days[i]
        if d1 < EQUITY_BTC_BACKWARD_FROM_DAY or d1 == today or d1 >= jupiter_live_from:
            continue
        r_btc = _btc_forward_return(btc, d0, d1) * 100
        r_eq = (eq[d1] / eq[d0] - 1.0) * 100 if eq[d0] > 0 else 0
        r_exp = BTC_EQUITY_BETA * r_btc
        checked += 1
        if abs(r_eq - r_exp) > 1.5:
            mism += 1
    if checked and mism / checked > 0.15:
        issues.append(
            f"BTC β mismatch on {mism}/{checked} days after {EQUITY_BTC_BACKWARD_FROM_DAY}"
        )

    # Стык 14→15 января (допустим ручную подгонку; хвост важнее)
    if JAN_EQUITY_SHAPAN_END_DAY in eq and EQUITY_BTC_BACKWARD_FROM_DAY in eq:
        jch = abs(eq[EQUITY_BTC_BACKWARD_FROM_DAY] / eq[JAN_EQUITY_SHAPAN_END_DAY] - 1.0) * 100
        if jch > 35:
            issues.append(
                f"jan stitch {JAN_EQUITY_SHAPAN_END_DAY}->{EQUITY_BTC_BACKWARD_FROM_DAY}: {jch:.1f}%"
            )

    print(f"[INFO] Jan1={start:.2f} today={eq[today]:.2f} live={live:.2f}")
    for d in days[-5:]:
        print(f"  {d} ${eq[d]:.0f}")

    if issues:
        for x in issues:
            print(f"[FAIL] {x}")
        return 1
    print("[OK] equity chart BTC QA passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
