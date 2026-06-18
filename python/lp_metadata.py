"""Resolve LP platform/DEX from sheet labels, Revert links, and Krystal position URLs."""

from __future__ import annotations

import re

# NFT position manager contracts (lowercase) → human-readable DEX name.
LP_POSITION_MANAGERS: dict[str, str] = {
    "0x7c5f5a4bbd8fd63184577525326123b519429bdc": "Uniswap V4",
    "0x46a15b0b27311cedf172ab29e4f4766fbe7f4364": "PancakeSwap V3",
    "0x03a520b32c04bf3bbeefbde7c3d8d4fdeb6952ce": "Uniswap V3",
    "0x827922686190790b372ae4b3259e3468713b62e9": "Aerodrome Slipstream",
}

LP_SHEET_FALLBACK_NAMES: tuple[str, ...] = (
    "Public portfolio",
    "Public Portfolio",
    "Revert pools",
    "Revert Pools",
    "Pools",
    "pools",
    "LP",
    "liquidity",
)


def parse_position_manager_from_link(link: str) -> str:
    s = (link or "").strip()
    m = re.search(r"positions/\d+/(0x[a-fA-F0-9]{40})-", s, re.I)
    return m.group(1).lower() if m else ""


def normalize_platform_label(raw: str) -> str:
    s = (raw or "").strip()
    if not s:
        return ""
    low = s.lower()
    if low in ("dex", "revert finance", "google sheet", "krystal"):
        return ""
    if "pancake" in low:
        return "PancakeSwap V3"
    if "aerodrome" in low or "slipstream" in low:
        return "Aerodrome Slipstream"
    if "velodrome" in low:
        return "Velodrome"
    if "uniswap" in low and "v4" in low:
        return "Uniswap V4"
    if "uniswap" in low and "v3" in low:
        return "Uniswap V3"
    if low in ("uniswapv3", "uniswap_v3", "uni v3"):
        return "Uniswap V3"
    if low in ("uniswapv4", "uniswap_v4", "uni v4"):
        return "Uniswap V4"
    if "uni" in low:
        return "Uniswap V3"
    return s.strip()


def incentive_token_for_platform(platform: str) -> str:
    low = (platform or "").strip().lower()
    if "pancake" in low:
        return "Cake"
    if "aerodrome" in low or "aero" in low or "slipstream" in low:
        return "Aero"
    return ""


def dex_from_link_path(link: str) -> str:
    s = (link or "").lower()
    if "aerodrome" in s:
        return "Aerodrome Slipstream"
    if "pancake" in s:
        return "PancakeSwap V3"
    if "velodrome" in s:
        return "Velodrome"
    if "uniswap" in s:
        return "Uniswap V3"
    mgr = parse_position_manager_from_link(link)
    if mgr in LP_POSITION_MANAGERS:
        return LP_POSITION_MANAGERS[mgr]
    return "DEX"


def resolve_lp_platform(platform: str = "", link: str = "") -> str:
    label = normalize_platform_label(platform)
    if label:
        return label
    mgr = parse_position_manager_from_link(link)
    if mgr in LP_POSITION_MANAGERS:
        return LP_POSITION_MANAGERS[mgr]
    return dex_from_link_path(link)


def sheet_headers_look_like_lp(headers: list[str]) -> bool:
    joined = " ".join(str(h or "").strip().lower() for h in headers)
    markers = (
        "токен 0",
        "token0",
        "nft_id",
        "nft token",
        "exchange",
        "платформа",
        "platform",
        "fee tier",
        "fee_tier",
        "min price",
        "ком. доход",
        "ссылка на позицию",
    )
    return any(m in joined for m in markers)


def enrich_lp_position(item: dict) -> dict:
    if not item:
        return item
    out = dict(item)
    out["platform"] = resolve_lp_platform(
        str(out.get("platform") or ""),
        str(out.get("link") or ""),
    )
    return out


def enrich_liquidity_positions(positions: list[dict]) -> list[dict]:
    return [enrich_lp_position(p) for p in (positions or [])]
