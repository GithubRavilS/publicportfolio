"""Live EVM lending from Debank profile (Jina markdown) — replaces stale CSV."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from typing import Any

JINA_HEADERS = {
    "Accept": "text/plain",
    "User-Agent": "publicportfolio-debank-lending/1.0",
}

USD_RE = re.compile(r"^\$([\d,]+(?:\.\d+)?)$")
HF_RE = re.compile(r"Health Rate\s*(>?\s*[\d.]+)", re.I)


def _parse_usd(line: str) -> float | None:
    m = USD_RE.match(str(line or "").strip())
    if not m:
        return None
    return float(m.group(1).replace(",", ""))


def _chain_from_nearby(lines: list[str], idx: int) -> str:
    for j in range(max(0, idx - 8), min(len(lines), idx + 3)):
        s = lines[j]
        m = re.search(r"chain/logo_url/([a-z0-9]+)/", s, re.I)
        if m:
            slug = m.group(1).lower()
            return {
                "eth": "eth",
                "op": "op",
                "arb": "arb",
                "base": "base",
                "matic": "matic",
                "bsc": "bsc",
            }.get(slug, slug)
        m2 = re.search(r"project/logo_url/([a-z0-9_]+)/", s, re.I)
        if m2:
            proj = m2.group(1).lower()
            if proj.startswith("op_"):
                return "op"
            if proj.startswith("arb_"):
                return "arb"
            if proj.startswith("base_"):
                return "base"
    return "eth"


def _token_hint(lines: list[str], start: int, end: int) -> str:
    for j in range(start, min(end, len(lines))):
        s = lines[j]
        m = re.search(r"coin/logo_url/([a-z0-9]+)/", s, re.I)
        if m:
            return m.group(1).upper()
        m2 = re.search(r"token/logo_url/0x[a-f0-9]+/([a-f0-9]+)/", s, re.I)
        if m2 and "a0b86991" in s.lower():
            return "USDC"
        if "/eth/" in s.lower() or "coin/logo_url/eth/" in s.lower():
            return "ETH"
    return ""


def parse_debank_lending_positions(markdown: str, *, wallet: str = "") -> list[dict[str, Any]]:
    """
    Блоки вида:
      Fluid
      $1,059
      Lending
      Health Rate 2.81
      Supplied … $1,574.71
      Borrowed … $515.69
    """
    lines = str(markdown or "").splitlines()
    out: list[dict[str, Any]] = []
    i = 0
    while i < len(lines):
        if lines[i].strip() != "Lending":
            i += 1
            continue
        # protocol: nearest non-empty non-$ line above
        protocol = "Unknown"
        for j in range(i - 1, max(-1, i - 12), -1):
            t = lines[j].strip()
            if not t or t.startswith("![") or t.startswith("[]") or t.startswith("#"):
                continue
            if _parse_usd(t) is not None:
                continue
            if t.lower() in ("balance", "usd value", "supplied", "borrowed"):
                continue
            protocol = t
            break

        hf = 0.0
        hf_m = HF_RE.search(lines[i + 1].strip() if i + 1 < len(lines) else "")
        if not hf_m and i + 2 < len(lines):
            hf_m = HF_RE.search(lines[i + 2].strip())
        if hf_m:
            raw = hf_m.group(1).replace(">", "").strip()
            try:
                hf = float(raw)
            except ValueError:
                hf = 25.0 if ">" in hf_m.group(0) else 0.0

        # find next Lending / project end
        end = len(lines)
        for j in range(i + 1, len(lines)):
            if lines[j].strip() == "Lending" and j > i + 3:
                end = j
                break
            if re.search(r"project/logo_url/", lines[j]) and j > i + 15:
                # next protocol card often starts with project logo after borrowed block
                pass

        supplied_usd = 0.0
        borrowed_usd = 0.0
        coll_asset = ""
        borrow_asset = ""
        mode = None
        for j in range(i + 1, end):
            t = lines[j].strip()
            if t == "Supplied":
                mode = "sup"
                continue
            if t == "Borrowed":
                mode = "bor"
                continue
            if t == "Lending":
                break
            usd = _parse_usd(t)
            if usd is None:
                continue
            if mode == "sup" and supplied_usd <= 0 and usd >= 0.5:
                supplied_usd = usd
                coll_asset = _token_hint(lines, j - 4, j) or coll_asset or "ETH"
            elif mode == "bor" and borrowed_usd <= 0 and usd >= 0.5:
                borrowed_usd = usd
                borrow_asset = _token_hint(lines, j - 4, j) or borrow_asset or "USDC"

        if supplied_usd < 5 and borrowed_usd < 5:
            i += 1
            continue

        chain = _chain_from_nearby(lines, i)
        link = f"https://debank.com/profile/{wallet}" if wallet else "https://debank.com"
        out.append(
            {
                "protocol": protocol,
                "chain": chain,
                "collateralAsset": coll_asset or "ETH",
                "collateralAmount": 0.0,
                "collateralUsd": round(supplied_usd, 2),
                "borrowAsset": borrow_asset or "USDC",
                "borrowAmount": round(borrowed_usd, 6) if borrowed_usd else 0.0,
                "borrowUsd": round(borrowed_usd, 2),
                "supplied": [
                    {
                        "asset": coll_asset or "ETH",
                        "amount": 0.0,
                        "usd": round(supplied_usd, 2),
                    }
                ],
                "borrowed": [
                    {
                        "asset": borrow_asset or "USDC",
                        "amount": round(borrowed_usd, 6),
                        "usd": round(borrowed_usd, 2),
                    }
                ]
                if borrowed_usd > 0
                else [],
                "netUsd": round(supplied_usd - borrowed_usd, 2),
                "timestamp": "",
                "healthFactor": hf,
                "marketPrice": 0.0,
                "liquidationPrice": 0.0,
                "link": link,
                "dataSource": "debank-jina",
            }
        )
        i = end if end < len(lines) else i + 1
    return out


def fetch_debank_markdown(wallet: str, timeout: float = 45.0) -> str:
    w = str(wallet or "").strip()
    if not re.match(r"^0x[a-fA-F0-9]{40}$", w):
        return ""
    url = f"https://r.jina.ai/https://debank.com/profile/{w}"
    req = urllib.request.Request(url, headers=JINA_HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, TimeoutError, OSError):
        return ""


def fetch_live_evm_lending(wallet: str) -> list[dict[str, Any]]:
    text = fetch_debank_markdown(wallet)
    if len(text) < 800:
        return []
    positions = parse_debank_lending_positions(text, wallet=wallet)
    if positions:
        coll = sum(float(p.get("collateralUsd") or 0) for p in positions)
        debt = sum(float(p.get("borrowUsd") or 0) for p in positions)
        print(f"[OK] Debank live lending: {len(positions)} pos, coll=${coll:.2f} debt=${debt:.2f}")
    return positions


if __name__ == "__main__":
    import sys

    w = sys.argv[1] if len(sys.argv) > 1 else "0x1fb07ac5643428710ee3bf5a73a4a66d0762f355"
    print(json.dumps(fetch_live_evm_lending(w), indent=2))
