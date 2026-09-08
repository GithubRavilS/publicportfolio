"""Idle wallet USD: Debank (Jina) for EVM + native SOL for Solana."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from typing import Any

JINA_HEADERS = {
    "Accept": "text/plain",
    "User-Agent": "publicportfolio-wallet-idle/1.0",
}


def parse_debank_wallet_idle_usd(markdown: str) -> float:
    """Wallet block: line `Wallet` then `$141` before `Token`."""
    lines = str(markdown or "").splitlines()
    best = 0.0
    for i, line in enumerate(lines):
        if line.strip() != "Wallet":
            continue
        found = None
        for j in range(i + 1, min(i + 10, len(lines))):
            t = lines[j].strip()
            if not t:
                continue
            if t in ("Token", "Lending", "Liquidity Pool"):
                break
            m = re.match(r"^\$([\d,]+(?:\.\d+)?)$", t)
            if m:
                found = float(m.group(1).replace(",", ""))
                break
        if found is not None and found > best:
            best = found
    return best


def fetch_debank_wallet_idle_usd(wallet: str, timeout: float = 45.0) -> float:
    w = str(wallet or "").strip()
    if not re.match(r"^0x[a-fA-F0-9]{40}$", w):
        return 0.0
    url = f"https://r.jina.ai/https://debank.com/profile/{w}"
    req = urllib.request.Request(url, headers=JINA_HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            text = resp.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, TimeoutError, OSError):
        return 0.0
    if len(text) < 800:
        return 0.0
    return parse_debank_wallet_idle_usd(text)


def fetch_solana_idle_usd(wallet: str, timeout: float = 20.0) -> float:
    w = str(wallet or "").strip()
    if not w or w.startswith("0x"):
        return 0.0
    try:
        bal_req = urllib.request.Request(
            "https://api.mainnet-beta.solana.com",
            data=json.dumps(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "getBalance",
                    "params": [w],
                }
            ).encode(),
            headers={"content-type": "application/json"},
        )
        with urllib.request.urlopen(bal_req, timeout=timeout) as resp:
            bal = json.loads(resp.read().decode())
        lamports = float(((bal.get("result") or {}).get("value")) or 0)
        sol = lamports / 1e9
        if sol <= 0:
            return 0.0
        px_req = urllib.request.Request(
            "https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT"
        )
        with urllib.request.urlopen(px_req, timeout=timeout) as resp:
            px = float(json.loads(resp.read().decode()).get("price") or 0)
        return sol * px if px > 0 else 0.0
    except (
        urllib.error.URLError,
        TimeoutError,
        OSError,
        ValueError,
        TypeError,
        json.JSONDecodeError,
    ):
        return 0.0


def fetch_wallet_idle_usd(
    *,
    evm_wallet: str = "",
    solana_wallet: str = "",
) -> dict[str, Any]:
    evm = fetch_debank_wallet_idle_usd(evm_wallet) if evm_wallet else 0.0
    sol = fetch_solana_idle_usd(solana_wallet) if solana_wallet else 0.0
    total = round(max(0.0, evm) + max(0.0, sol), 2)
    return {
        "walletIdleUsd": total,
        "evmUsd": round(max(0.0, evm), 2),
        "solanaUsd": round(max(0.0, sol), 2),
    }
