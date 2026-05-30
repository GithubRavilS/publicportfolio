#!/usr/bin/env python3
"""Статика + прокси загрузки профиля (обход CORS в браузере)."""

from __future__ import annotations

import json
import os
import re
import shutil
import ssl
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.server import SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def resolve_node_bin() -> str:
    nvm_root = Path.home() / ".nvm" / "versions" / "node"
    if nvm_root.is_dir():
        for node_path in sorted(nvm_root.glob("*/bin/node"), reverse=True):
            if node_path.is_file():
                return str(node_path)
    return shutil.which("node") or "node"


NODE_BIN = resolve_node_bin()

DEFAULT_CHAINS = [
    "arb",
    "base",
    "op",
    "eth",
    "matic",
    "bsc",
    "hyperliquid",
    "era",
    "linea",
    "scroll",
    "blast",
    "gnosis",
]
CONFIG_PATH = ROOT / "config.json"
PARSE_SCRIPT = ROOT / "js" / "debank-parse.js"
CACHE_DIR = ROOT / ".cache" / "portfolio"
REVERT_CACHE_DIR = ROOT / ".cache" / "revert"
ONCHAIN_CACHE_DIR = ROOT / ".cache" / "onchain"
ONCHAIN_PORTFOLIO_CACHE_DIR = ROOT / ".cache" / "onchain-portfolio"
CACHE_TTL = 600
REVERT_CACHE_TTL = 900
ONCHAIN_CACHE_TTL = 300
ONCHAIN_PORTFOLIO_TTL = 300
PORT = 5500
PRIORITY_CHAINS = ["arb", "base", "hyperliquid", "op", "eth", "matic", "bsc"]
EXTRA_CHAINS = ["era", "linea", "scroll", "blast", "gnosis", "monad", "plasma", "hyperevm"]


def _api_log(msg: str) -> None:
    try:
        p = ROOT / ".cache" / "api-debug.log"
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n")
    except OSError:
        pass


def _guard_node_modules() -> None:
    """npm init с type:commonjs ломает import из js/*.js — фиксируем ESM."""
    pkg = ROOT / "package.json"
    try:
        pkg.write_text('{"type":"module","private":true}\n', encoding="utf-8")
    except OSError:
        pass


def load_scraper_key() -> str:
    if not CONFIG_PATH.exists():
        return ""
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        return str(data.get("debank_scraperapi_key") or "").strip()
    except (json.JSONDecodeError, OSError):
        return ""


def load_debank_access_key() -> str:
    for env_name in ("DEBANK_ACCESS_KEY", "DEBANK_OPENAPI_KEY"):
        v = os.environ.get(env_name, "").strip()
        if v:
            return v
    if not CONFIG_PATH.exists():
        return ""
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        return str(data.get("debank_access_key") or data.get("debank_openapi_key") or "").strip()
    except (json.JSONDecodeError, OSError):
        return ""


def load_krystal_key() -> str:
    if not CONFIG_PATH.exists():
        return ""
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        return str(data.get("krystal_cloud_api_key") or data.get("krystal_api_key") or "").strip()
    except (json.JSONDecodeError, OSError):
        return ""


def normalize_profile_text(raw: str) -> str:
    """Jina отдаёт markdown — приводим к плотному тексту как в plain scrape."""
    raw = re.sub(r"!\[[^\]]*\]\([^)]+\)", "", raw)
    lines_out: list[str] = []
    started = False
    for line in raw.splitlines():
        s = line.strip()
        if s.startswith("Markdown Content:"):
            started = True
            continue
        if not started and s.startswith(("Title:", "URL Source:", "Published Time:")):
            continue
        if not s or s.startswith("!["):
            continue
        s = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", s).strip()
        if not s:
            continue
        hm = re.match(r"^Health Rate\s*>?\s*([\d.]+)", s, re.I)
        if hm:
            lines_out.append("Health Rate")
            lines_out.append(hm.group(1))
            continue
        if re.match(r"^Health Rate\s*>\s*10", s, re.I):
            lines_out.append("Health Rate")
            lines_out.append(">10")
            continue
        lines_out.append(s)
    text = "\n".join(lines_out)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def html_to_text(html: str) -> str:
    t = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", html)
    t = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", t)
    t = re.sub(r"(?is)<br\s*/?>", "\n", t)
    t = re.sub(r"(?is)</(div|p|tr|li|h[1-6])\s*>", "\n", t)
    t = re.sub(r"<[^>]+>", " ", t)
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n\s*\n+", "\n", t)
    return t.strip()


def fetch_url(url: str, timeout: int = 45) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 PortfolioTracker/1.0",
            "Accept": "text/plain, text/html, */*",
        },
    )
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
        return resp.read().decode("utf-8", errors="replace")


def _fetch_profile_once(wallet: str, chain: str | None) -> str:
    base = f"https://debank.com/profile/{wallet}"
    page_url = f"{base}?chain={chain}" if chain else base

    api_key = load_scraper_key()
    if api_key:
        target = urllib.parse.quote(page_url, safe="")
        api_url = (
            f"https://api.scraperapi.com?api_key={urllib.parse.quote(api_key)}"
            f"&url={target}&render=true&country_code=us&device_type=desktop"
        )
        html = fetch_url(api_url, timeout=90)
        text = html_to_text(html)
        if len(text) >= 500:
            return normalize_profile_text(text)

    jina_url = f"https://r.jina.ai/{page_url}"
    req = urllib.request.Request(
        jina_url,
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Accept": "text/markdown, text/plain, */*",
            "X-Return-Format": "markdown",
        },
    )
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=55, context=ctx) as resp:
        text = resp.read().decode("utf-8", errors="replace")
    text = normalize_profile_text(text)
    if len(text) < 400:
        raise ValueError("EMPTY_RESPONSE")
    return text


def fetch_profile_text(wallet: str, chain: str | None = None) -> str:
    wallet = wallet.strip()
    if not re.fullmatch(r"0x[a-fA-F0-9]{40}", wallet):
        raise ValueError("INVALID_WALLET")

    best = ""
    last_err: Exception | None = None
    for attempt in range(10):
        try:
            text = _fetch_profile_once(wallet, chain)
            if len(text) > len(best):
                best = text
            if len(text) >= 1200 and is_rich_profile(text):
                return text
            if len(text) >= 800 and "Wallet" in text and chain:
                return text
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e:
            last_err = e
        if attempt < 9:
            time.sleep(1.5 * (attempt + 1))
    if len(best) >= 400:
        return best
    raise ValueError("FETCH_FAILED") from last_err


def is_rich_profile(text: str) -> bool:
    if len(text) < 1500:
        return False
    if "Updating data" in text and "Liquidity Pool" not in text:
        return False
    return "Wallet" in text and (
        "Liquidity Pool" in text
        or "Lending" in text
        or "GMX" in text
        or "Uniswap" in text
        or "Hyperliquid" in text
    )


def fetch_main_profile_quick(wallet: str) -> str:
    best = ""
    for attempt in range(2):
        try:
            text = fetch_profile_text(wallet, None)
        except ValueError:
            time.sleep(0.8)
            continue
        if len(text) > len(best):
            best = text
        if len(text) >= 1200 and "Wallet" in text:
            return text
    return best


def fetch_main_profile(wallet: str) -> str:
    best = ""
    for attempt in range(12):
        try:
            text = fetch_profile_text(wallet, None)
        except ValueError:
            time.sleep(1.5 * (attempt + 1))
            continue
        if len(text) > len(best):
            best = text
        if is_rich_profile(text):
            return text
        time.sleep(1.0 * (attempt + 1))
    if is_rich_profile(best):
        return best
    if len(best) >= 1500 and "Wallet" in best:
        return best
    return best


def _cache_path(wallet: str) -> Path:
    return CACHE_DIR / f"{wallet.lower()}.json"


PORTFOLIO_SCHEMA = 12


def is_portfolio_rich(portfolio: dict) -> bool:
    """Jina иногда отдаёт только Wallet — не сохраняем такой refresh."""
    if not portfolio:
        return False
    groups = portfolio.get("protocolGroups") or []
    non_wallet = [g for g in groups if g.get("protocol") != "Wallet"]
    proto_usd = sum(float(g.get("protocolUsd") or 0) for g in non_wallet)
    if len(non_wallet) >= 1 and proto_usd > 30:
        return True
    if (portfolio.get("liqUsd") or 0) + (portfolio.get("lendUsd") or 0) > 30:
        return True
    return len(groups) >= 3


def load_portfolio_cache(wallet: str, *, allow_stale: bool = False) -> dict | None:
    path = _cache_path(wallet)
    if not path.exists():
        return None
    try:
        if not allow_stale and time.time() - path.stat().st_mtime > CACHE_TTL:
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        p = data.get("portfolio")
        if not p or int(p.get("schemaVersion") or 0) < PORTFOLIO_SCHEMA:
            return None
        return p
    except (json.JSONDecodeError, OSError):
        return None


def save_portfolio_cache(wallet: str, portfolio: dict) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    p = dict(portfolio)
    p["schemaVersion"] = PORTFOLIO_SCHEMA
    _cache_path(wallet).write_text(
        json.dumps({"portfolio": p, "savedAt": time.time()}, ensure_ascii=False),
        encoding="utf-8",
    )


def fetch_chain_pages(
    wallet: str, chains: list[str] | None = None, *, min_len: int = 350
) -> dict[str, str]:
    chains = chains or DEFAULT_CHAINS
    out: dict[str, str] = {}

    def one(chain: str) -> tuple[str, str]:
        best = ""
        for attempt in range(6):
            try:
                text = fetch_profile_text(wallet, chain)
            except ValueError:
                time.sleep(1.5 * (attempt + 1))
                continue
            if len(text) > len(best):
                best = text
            if len(text) >= 500 and (
                "Liquidity Pool" in text
                or "Lending" in text
                or "Yield" in text
                or ("Wallet" in text and "Token" in text and "Price" in text)
                or ("Token" in text and "Price" in text and "Amount" in text)
            ):
                return chain, text
            time.sleep(1.0 * (attempt + 1))
        if len(best) >= min_len and "Updating data" not in best:
            return chain, best
        if len(best) >= min_len:
            return chain, best
        return chain, ""

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(one, c) for c in chains]
        for fut in as_completed(futures):
            chain, text = fut.result()
            if text:
                out[chain] = text
    return out


def unfold_chain_count(main_text: str) -> int:
    m = re.search(r"Unfold\s+(\d+)\s+chains", main_text or "", re.I)
    return int(m.group(1)) if m else 0


def discover_chains_from_main(main_text: str) -> list[str]:
    """Сети из breakdown DeBank (monad, plasma, …) — догружаем страницы."""
    _guard_node_modules()
    runner = ROOT / "scripts" / "run-debank-chains.mjs"
    try:
        proc = subprocess.run(
            [NODE_BIN, str(runner)],
            input=(main_text or "").encode("utf-8"),
            capture_output=True,
            cwd=str(ROOT),
            timeout=30,
            env=os.environ.copy(),
        )
        if proc.returncode != 0:
            return []
        chains = json.loads(proc.stdout.decode("utf-8"))
        return [c["slug"] for c in chains if c.get("slug") and (c.get("usd") or 0) > 0.01]
    except (json.JSONDecodeError, OSError, subprocess.TimeoutExpired):
        return []


def fetch_full_portfolio_text(wallet: str) -> tuple[str, dict[str, str]]:
    chain_texts: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=7) as pool:
        f_main = pool.submit(fetch_main_profile, wallet)
        f_pri = {c: pool.submit(fetch_profile_text, wallet, c) for c in PRIORITY_CHAINS}
        main = f_main.result()
        for chain, fut in f_pri.items():
            try:
                text = fut.result()
                if text and len(text) >= 350:
                    chain_texts[chain] = text
            except ValueError:
                pass
        if not is_rich_profile(main):
            f_extra = {c: pool.submit(fetch_profile_text, wallet, c) for c in EXTRA_CHAINS}
            for chain, fut in f_extra.items():
                if chain in chain_texts:
                    continue
                try:
                    text = fut.result()
                    if text and len(text) >= 350:
                        chain_texts[chain] = text
                except ValueError:
                    pass
    if not main:
        main = ""
        chain_texts.update(fetch_chain_pages(wallet, PRIORITY_CHAINS + EXTRA_CHAINS))
    else:
        discovered = discover_chains_from_main(main)
        want = [c for c in discovered if c not in chain_texts and c not in ("unknown", "all")]
        base = list(dict.fromkeys(PRIORITY_CHAINS + EXTRA_CHAINS + want))
        unfolded = unfold_chain_count(main)
        if unfolded > len(discovered) + 1:
            base = list(dict.fromkeys(PRIORITY_CHAINS + EXTRA_CHAINS + discovered + want))
        extra = [c for c in base if c not in chain_texts]
        if extra:
            chain_texts.update(fetch_chain_pages(wallet, extra))
    return main, chain_texts


def parse_full_portfolio(main_text: str, chain_texts: dict[str, str], show_small: bool) -> dict:
    return parse_portfolio_text(main_text, show_small, chain_texts)


def enrich_wallet_rpc(wallet: str, portfolio: dict) -> dict:
    """ETH/USDC на arb/eth/op через RPC, если Jina отдала только одну сеть."""
    _guard_node_modules()
    runner = ROOT / "scripts" / "supplement-wallet-portfolio.mjs"
    payload = json.dumps(portfolio, ensure_ascii=False).encode("utf-8")
    try:
        proc = subprocess.run(
            [NODE_BIN, str(runner), wallet.lower()],
            input=payload,
            capture_output=True,
            cwd=str(ROOT),
            timeout=90,
            env=os.environ.copy(),
        )
    except subprocess.TimeoutExpired:
        _api_log("wallet rpc supplement timeout")
        return portfolio
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="replace")[:300]
        _api_log(f"wallet rpc supplement: {err}")
        return portfolio
    return json.loads(proc.stdout.decode("utf-8"))


def parse_portfolio_text(
    text: str, show_small: bool = False, chain_texts: dict[str, str] | None = None
) -> dict:
    _guard_node_modules()
    runner = ROOT / "scripts" / "run-debank-parse.mjs"
    env = {**os.environ, "PT_SHOW_SMALL": "1" if show_small else "0"}
    if chain_texts:
        env["PT_CHAIN_TEXTS"] = json.dumps(chain_texts, ensure_ascii=False)
    proc = subprocess.run(
        [NODE_BIN, str(runner)],
        input=text.encode("utf-8"),
        capture_output=True,
        cwd=str(ROOT),
        timeout=120,
        env=env,
    )
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="replace")[:500]
        raise ValueError(f"PARSE_FAILED:{err}")
    return json.loads(proc.stdout.decode("utf-8"))


def enrich_quick_chain_pages(
    wallet: str, main_text: str, portfolio: dict, show_small: bool
) -> dict:
    """Quick: догружаем arb/eth/op… чтобы кошелёк и LP были по сетям."""
    slugs: list[str] = []
    for c in portfolio.get("chains") or []:
        s = (c.get("slug") or "").strip().lower()
        if s and s not in ("unknown", "all"):
            slugs.append(s)
    if not slugs or not main_text:
        return portfolio
    try:
        chain_texts = fetch_chain_pages(wallet, slugs[:6], min_len=200)
    except Exception as ex:
        _api_log(f"quick chain pages: {ex!s}")
        return portfolio
    if not chain_texts:
        return portfolio
    try:
        return parse_full_portfolio(main_text, chain_texts, show_small)
    except Exception as ex:
        _api_log(f"quick re-parse: {ex!s}")
        return portfolio


def fetch_debank_portfolio_api(wallet: str, show_small: bool) -> dict:
    """DeBank Pro OpenAPI — тот же источник, что debank.com (~2–5 с)."""
    _guard_node_modules()
    key = load_debank_access_key()
    if not key:
        raise ValueError("NO_DEBANK_KEY")
    runner = ROOT / "scripts" / "run-debank-api.mjs"
    env = {
        **os.environ,
        "DEBANK_ACCESS_KEY": key,
        "PT_SHOW_SMALL": "1" if show_small else "0",
    }
    proc = subprocess.run(
        [NODE_BIN, str(runner), wallet.lower()],
        capture_output=True,
        cwd=str(ROOT),
        timeout=45,
        env=env,
    )
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="replace")[:500]
        raise ValueError(f"DEBANK_API_FAILED:{err}")
    return json.loads(proc.stdout.decode("utf-8"))


def fetch_revert_account_text(wallet: str) -> str:
    """Revert нужен markdown от Jina — text/plain убирает ссылки на пулы."""
    page = f"https://revert.finance/account/{wallet}"
    jina_url = f"https://r.jina.ai/{page}"
    req = urllib.request.Request(
        jina_url,
        headers={
            "User-Agent": "Mozilla/5.0 PortfolioTracker/1.0",
            "Accept": "text/plain, text/markdown, */*",
        },
    )
    ctx = ssl.create_default_context()
    last_err: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=90, context=ctx) as resp:
                text = resp.read().decode("utf-8", errors="replace")
            if "revert.finance/#/pool/" in text or "revert.finance/%23/pool/" in text:
                return text
            low = text.lower()
            if "pooled assets" in low and "\nrange\n" in f"\n{low}\n":
                return text
            if "open lp positions" in low and "range" in low:
                return text
            if "Markdown Content:" in text:
                return text
            last_err = ValueError("NO_POOL_LINKS")
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last_err = e
        time.sleep(1.5 * (attempt + 1))
    if last_err:
        raise ValueError("FETCH_FAILED") from last_err
    raise ValueError("FETCH_FAILED")


def _revert_cache_path(wallet: str) -> Path:
    return REVERT_CACHE_DIR / f"{wallet.lower()}.json"


def load_revert_cache(wallet: str, *, allow_stale: bool = False) -> list | None:
    path = _revert_cache_path(wallet)
    if not path.exists():
        return None
    try:
        if not allow_stale and time.time() - path.stat().st_mtime > REVERT_CACHE_TTL:
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        positions = data.get("positions")
        if not positions:
            return None
        return positions
    except (json.JSONDecodeError, OSError):
        return None


def save_revert_cache(wallet: str, positions: list) -> None:
    REVERT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    _revert_cache_path(wallet).write_text(
        json.dumps({"positions": positions, "savedAt": time.time()}, ensure_ascii=False),
        encoding="utf-8",
    )


def parse_revert_text(text: str) -> list:
    _guard_node_modules()
    runner = ROOT / "scripts" / "run-revert-parse.mjs"
    proc = subprocess.run(
        [NODE_BIN, str(runner)],
        input=text.encode("utf-8"),
        capture_output=True,
        cwd=str(ROOT),
        timeout=60,
        env=os.environ.copy(),
    )
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="replace")[:400]
        raise ValueError(f"REVERT_PARSE_FAILED:{err}")
    return json.loads(proc.stdout.decode("utf-8"))


def build_revert_api_payload(
    wallet: str, *, refresh: bool = False, onchain_only: bool = False
) -> dict:
    """Revert + опциональное ончейн-обогащение; при сбое Jina — stale-кэш."""
    cached = load_revert_cache(wallet)
    stale = load_revert_cache(wallet, allow_stale=True) if cached is None else cached
    positions = None if refresh else cached
    fetch_error = None
    if positions is None:
        try:
            text = fetch_revert_account_text(wallet)
            if len(text) < 200:
                positions = stale or []
                fetch_error = "SHORT_TEXT"
                _api_log(f"revert short text len={len(text)}")
            else:
                positions = parse_revert_text(text)
                if not positions:
                    positions = parse_revert_text(normalize_profile_text(text))
                _api_log(f"revert parsed n={len(positions)} text_len={len(text)}")
            if positions:
                save_revert_cache(wallet, positions)
        except Exception as ex:
            fetch_error = str(ex)[:120]
            _api_log(f"revert fetch failed: {fetch_error}")
            positions = stale or []

    onchain_count = 0
    try:
        oc = None if refresh else load_onchain_cache(wallet)
        if oc is None:
            oc = run_onchain_enrich(wallet, positions or [])
            if oc.get("onchain"):
                save_onchain_cache(wallet, oc)
        if onchain_only and oc:
            positions = oc.get("onchain") or []
        elif oc and oc.get("positions"):
            positions = oc["positions"]
            onchain_count = oc.get("count") or len(oc.get("onchain") or [])
    except Exception as ex:
        _api_log(f"onchain enrich failed: {ex!s}")

    used_stale = bool(fetch_error and stale and positions == stale)
    return {
        "ok": True,
        "positions": positions or [],
        "count": len(positions or []),
        "cached": not refresh and not fetch_error,
        "stale": used_stale,
        "warning": fetch_error if used_stale else None,
        "onchainEnriched": onchain_count,
        "source": "onchain+revert" if onchain_count else "revert",
    }


def _onchain_cache_path(wallet: str) -> Path:
    return ONCHAIN_CACHE_DIR / f"{wallet.lower()}.json"


def load_onchain_cache(wallet: str) -> dict | None:
    path = _onchain_cache_path(wallet)
    if not path.exists():
        return None
    try:
        if time.time() - path.stat().st_mtime > ONCHAIN_CACHE_TTL:
            return None
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def save_onchain_cache(wallet: str, data: dict) -> None:
    ONCHAIN_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    _onchain_cache_path(wallet).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def _onchain_portfolio_cache_path(wallet: str) -> Path:
    return ONCHAIN_PORTFOLIO_CACHE_DIR / f"{wallet.lower()}.json"


def load_onchain_portfolio_cache(wallet: str, *, allow_stale: bool = False) -> dict | None:
    path = _onchain_portfolio_cache_path(wallet)
    if not path.exists():
        return None
    try:
        if not allow_stale and time.time() - path.stat().st_mtime > ONCHAIN_PORTFOLIO_TTL:
            return None
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def build_hybrid_portfolio(
    wallet: str, *, refresh: bool, show_small: bool, force_onchain: bool = False
) -> dict:
    """DeBank + on-chain merge. На refresh обновляем on-chain и диапазоны LP."""
    onchain_portfolio: dict = {}
    refresh_onchain = force_onchain or (not refresh)

    if refresh_onchain:
        try:
            onchain_portfolio = run_onchain_portfolio(wallet)
            save_onchain_portfolio_cache(wallet, onchain_portfolio)
        except Exception as ex:
            _api_log(f"onchain scan partial fail: {ex!s}")
            onchain_portfolio = load_onchain_portfolio_cache(wallet, allow_stale=True) or {}
    else:
        onchain_portfolio = load_onchain_portfolio_cache(wallet, allow_stale=True) or {}

    debank_portfolio: dict = {}
    try:
        debank_portfolio = fetch_debank_portfolio(
            wallet, quick=False, refresh=refresh, show_small=show_small
        )
        save_portfolio_cache(wallet, debank_portfolio)
    except Exception as ex:
        _api_log(f"debank fetch partial fail: {ex!s}")
        debank_portfolio = load_portfolio_cache(wallet) or {}

    if not onchain_portfolio and not debank_portfolio:
        raise ValueError("FETCH_FAILED")

    portfolio = run_hybrid_merge(onchain_portfolio, debank_portfolio)
    if refresh or force_onchain:
        try:
            portfolio = enrich_portfolio_lp_ranges(wallet, portfolio)
        except Exception as ex:
            _api_log(f"lp range enrich failed: {ex!s}")
        try:
            portfolio = merge_portfolio_revert(wallet, portfolio, refresh=refresh)
        except Exception as ex:
            _api_log(f"revert merge failed: {ex!s}")
    portfolio["fromCache"] = False
    if is_portfolio_rich(portfolio):
        save_portfolio_cache(wallet, portfolio)
    else:
        _api_log(f"skip cache save: thin portfolio {wallet[:10]}")
    return portfolio


def merge_portfolio_revert(wallet: str, portfolio: dict, *, refresh: bool = False) -> dict:
    """Диапазоны/APY с Revert (в т.ч. застейканные NFT, которых нет в wallet scan)."""
    positions = load_revert_cache(wallet) if not refresh else None
    if positions is None and refresh:
        try:
            text = fetch_revert_account_text(wallet)
            if len(text) >= 200:
                positions = parse_revert_text(text)
                if not positions:
                    positions = parse_revert_text(normalize_profile_text(text))
                if positions:
                    save_revert_cache(wallet, positions)
        except Exception as ex:
            _api_log(f"revert fetch for merge: {ex!s}")
    if not positions:
        positions = load_revert_cache(wallet, allow_stale=True) or []
    if not positions:
        return portfolio
    _guard_node_modules()
    runner = ROOT / "scripts" / "merge-portfolio-revert.mjs"
    payload = json.dumps(
        {"portfolio": portfolio, "revertPositions": positions}, ensure_ascii=False
    ).encode("utf-8")
    proc = subprocess.run(
        [NODE_BIN, str(runner)],
        input=payload,
        capture_output=True,
        cwd=str(ROOT),
        timeout=60,
        env=os.environ.copy(),
    )
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="replace")[:500]
        raise ValueError(f"REVERT_MERGE_FAILED:{err}")
    return json.loads(proc.stdout.decode("utf-8"))


def enrich_portfolio_lp_ranges(wallet: str, portfolio: dict) -> dict:
    _guard_node_modules()
    runner = ROOT / "scripts" / "enrich-portfolio-ranges.mjs"
    payload = json.dumps(portfolio, ensure_ascii=False).encode("utf-8")
    proc = subprocess.run(
        [NODE_BIN, str(runner), wallet.lower()],
        input=payload,
        capture_output=True,
        cwd=str(ROOT),
        timeout=180,
        env=os.environ.copy(),
    )
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="replace")[:500]
        raise ValueError(f"LP_RANGE_ENRICH_FAILED:{err}")
    return json.loads(proc.stdout.decode("utf-8"))


def enrich_portfolio_krystal(wallet: str, portfolio: dict) -> tuple[dict, list]:
    """Krystal LP: Aerodrome, PancakeSwap и др."""
    key = load_krystal_key()
    if not key:
        return portfolio, []
    _guard_node_modules()
    runner = ROOT / "scripts" / "merge-krystal-portfolio.mjs"
    payload = json.dumps(portfolio, ensure_ascii=False).encode("utf-8")
    env = os.environ.copy()
    env["KRYSTAL_CLOUD_API_KEY"] = key
    proc = subprocess.run(
        [NODE_BIN, str(runner), wallet.lower()],
        input=payload,
        capture_output=True,
        cwd=str(ROOT),
        timeout=120,
        env=env,
    )
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="replace")[:500]
        raise ValueError(f"KRYSTAL_MERGE_FAILED:{err}")
    merged = json.loads(proc.stdout.decode("utf-8"))
    pos_runner = ROOT / "scripts" / "run-krystal-positions.mjs"
    proc2 = subprocess.run(
        [NODE_BIN, str(pos_runner), wallet.lower()],
        capture_output=True,
        cwd=str(ROOT),
        timeout=90,
        env=env,
    )
    positions = []
    if proc2.returncode == 0:
        try:
            positions = json.loads(proc2.stdout.decode("utf-8") or "[]")
        except json.JSONDecodeError:
            positions = []
    return merged, positions


def save_onchain_portfolio_cache(wallet: str, portfolio: dict) -> None:
    ONCHAIN_PORTFOLIO_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    _onchain_portfolio_cache_path(wallet).write_text(
        json.dumps(portfolio, ensure_ascii=False), encoding="utf-8"
    )


def run_onchain_portfolio(wallet: str) -> dict:
    _guard_node_modules()
    runner = ROOT / "scripts" / "run-onchain-portfolio.mjs"
    proc = subprocess.run(
        [NODE_BIN, str(runner), wallet.lower()],
        capture_output=True,
        cwd=str(ROOT),
        timeout=180,
        env=os.environ.copy(),
    )
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="replace")[:500]
        raise ValueError(f"ONCHAIN_PORTFOLIO_FAILED:{err}")
    data = json.loads(proc.stdout.decode("utf-8"))
    return data.get("portfolio") or data


def run_hybrid_merge(onchain: dict | None, debank: dict | None) -> dict:
    _guard_node_modules()
    runner = ROOT / "scripts" / "run-hybrid-merge.mjs"
    payload = json.dumps(
        {"onchain": onchain or {}, "debank": debank or {}},
        ensure_ascii=False,
    ).encode("utf-8")
    proc = subprocess.run(
        [NODE_BIN, str(runner)],
        input=payload,
        capture_output=True,
        cwd=str(ROOT),
        timeout=30,
        env=os.environ.copy(),
    )
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="replace")[:500]
        raise ValueError(f"HYBRID_MERGE_FAILED:{err}")
    data = json.loads(proc.stdout.decode("utf-8"))
    return data.get("portfolio") or data


def fetch_debank_portfolio_free(wallet: str, *, quick: bool, show_small: bool) -> dict:
    """Бесплатно: Jina markdown (main + parallel chains), без DeBank OpenAPI."""
    _guard_node_modules()
    runner = ROOT / "scripts" / "fetch-debank-free.mjs"
    env = {
        **os.environ,
        "PT_QUICK": "1" if quick else "0",
        "PT_SHOW_SMALL": "1" if show_small else "0",
        "PT_JINA_TIMEOUT_MS": "22000",
        "PT_MAX_CHAINS": "5",
        "PT_CHAIN_BATCH": "2",
    }
    try:
        proc = subprocess.run(
            [NODE_BIN, str(runner), wallet.lower()],
            capture_output=True,
            cwd=str(ROOT),
            timeout=40 if quick else 55,
            env=env,
        )
    except subprocess.TimeoutExpired as ex:
        raise ValueError("FETCH_FAILED") from ex
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="replace")[:500]
        _api_log(f"free debank: {err}")
        raise ValueError(f"FETCH_FAILED:{err}")
    portfolio = json.loads(proc.stdout.decode("utf-8"))
    portfolio["fromCache"] = False
    portfolio["source"] = "debank-free"
    return portfolio


def fetch_debank_portfolio(wallet: str, *, quick: bool, refresh: bool, show_small: bool) -> dict:
    api_key = load_debank_access_key()
    if api_key and os.environ.get("PT_USE_DEBANK_API", "").strip() in ("1", "true", "yes"):
        if not refresh:
            cached = load_portfolio_cache(wallet)
            if cached and cached.get("fromDebankApi"):
                out = dict(cached)
                out["fromCache"] = True
                out["partial"] = bool(cached.get("partial"))
                return out
        portfolio = fetch_debank_portfolio_api(wallet, show_small)
        portfolio["fromCache"] = False
        portfolio["partial"] = bool(
            portfolio.get("partial")
            or (portfolio.get("coverageGapUsd") or 0)
            > max(1, (portfolio.get("debankTotalUsd") or 0) * 0.02)
        )
        return portfolio

    if not refresh and not quick:
        cached = load_portfolio_cache(wallet)
        if cached:
            out = dict(cached)
            out["fromCache"] = True
            out["partial"] = bool(cached.get("partial"))
            return out

    try:
        portfolio = fetch_debank_portfolio_free(wallet, quick=quick, show_small=show_small)
        if quick:
            portfolio = enrich_wallet_rpc(wallet, portfolio)
        portfolio["partial"] = bool(
            quick
            or (portfolio.get("coverageGapUsd") or 0)
            > max(1, (portfolio.get("debankTotalUsd") or 0) * 0.03)
        )
        return portfolio
    except ValueError as ex:
        _api_log(f"free debank fallback to scrape: {ex!s}")

    if not refresh and not quick:
        cached = load_portfolio_cache(wallet)
        if cached:
            out = dict(cached)
            out["fromCache"] = True
            out["partial"] = False
            return out
    if quick:
        main_text = fetch_main_profile_quick(wallet)
        if not main_text:
            raise ValueError("FETCH_FAILED")
        portfolio = parse_full_portfolio(main_text, {}, show_small)
        portfolio = enrich_quick_chain_pages(wallet, main_text, portfolio, show_small)
        portfolio = enrich_wallet_rpc(wallet, portfolio)
        portfolio["partial"] = True
    else:
        main_text, chain_texts = fetch_full_portfolio_text(wallet)
        if not main_text and not chain_texts:
            raise ValueError("FETCH_FAILED")
        portfolio = parse_full_portfolio(main_text, chain_texts, show_small)
        portfolio["partial"] = bool(portfolio.get("partial"))
        if not is_portfolio_rich(portfolio):
            for retry in range(8):
                time.sleep(2.5 * (retry + 1))
                main_text, chain_texts = fetch_full_portfolio_text(wallet)
                if not main_text and not chain_texts:
                    continue
                portfolio = parse_full_portfolio(main_text, chain_texts, show_small)
                portfolio["partial"] = bool(portfolio.get("partial"))
                if is_portfolio_rich(portfolio):
                    break
            if not is_portfolio_rich(portfolio):
                for retry in range(4):
                    time.sleep(3.0 * (retry + 1))
                    try:
                        main_text = fetch_main_profile(wallet)
                    except ValueError:
                        continue
                    if main_text:
                        portfolio = parse_full_portfolio(main_text, chain_texts or {}, show_small)
                        portfolio["partial"] = bool(portfolio.get("partial"))
                        if is_portfolio_rich(portfolio):
                            break
            if not is_portfolio_rich(portfolio):
                stale = load_portfolio_cache(wallet, allow_stale=True)
                if stale and is_portfolio_rich(stale):
                    _api_log(f"debank thin parse for {wallet[:10]}, using stale cache")
                    portfolio = stale
                    portfolio["partial"] = True
                    portfolio["fromCache"] = True
        debank = float(portfolio.get("debankTotalUsd") or 0)
        gap = float(portfolio.get("coverageGapUsd") or 0)
        if debank > 0 and gap > debank * 0.12:
            all_chains = list(
                dict.fromkeys(PRIORITY_CHAINS + EXTRA_CHAINS + discover_chains_from_main(main_text))
            )
            missing = [c for c in all_chains if c not in chain_texts]
            if missing:
                chain_texts.update(fetch_chain_pages(wallet, missing, min_len=200))
                portfolio = parse_full_portfolio(main_text, chain_texts, show_small)
                portfolio["partial"] = bool(portfolio.get("partial"))
    portfolio["fromCache"] = False
    return portfolio


def run_onchain_enrich(wallet: str, positions: list | None = None) -> dict:
    """Скан NFT + slot0 через JSON-RPC; обогащает positions точными диапазонами."""
    _guard_node_modules()
    runner = ROOT / "scripts" / "run-lp-onchain.mjs"
    payload = json.dumps({"positions": positions or []}, ensure_ascii=False).encode("utf-8")
    proc = subprocess.run(
        [NODE_BIN, str(runner), wallet.lower()],
        input=payload,
        capture_output=True,
        cwd=str(ROOT),
        timeout=120,
        env=os.environ.copy(),
    )
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="replace")[:500]
        raise ValueError(f"ONCHAIN_FAILED:{err}")
    return json.loads(proc.stdout.decode("utf-8"))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        if self.path.startswith("/api/"):
            self.send_header("X-Portfolio-Tracker", "1")
        if self.path.endswith((".js", ".html", ".css")):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/"):
            super().log_message(fmt, *args)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/health":
            body = b'{"ok":true,"app":"portfolio-tracker"}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/api/profile":
            self.handle_profile(parsed)
            return
        if parsed.path == "/api/portfolio":
            self.handle_portfolio(parsed)
            return
        if parsed.path == "/api/history":
            self.handle_history(parsed)
            return
        if parsed.path == "/api/revert":
            self.handle_revert(parsed)
            return
        if parsed.path == "/api/onchain/lp":
            self.handle_onchain_lp(parsed)
            return
        if parsed.path == "/api/enrich-ranges":
            self.handle_enrich_ranges(parsed)
            return
        if parsed.path == "/api/enrich-krystal":
            self.handle_enrich_krystal(parsed)
            return
        super().do_GET()

    def handle_profile(self, parsed):
        qs = urllib.parse.parse_qs(parsed.query)
        wallet = (qs.get("wallet") or [""])[0].strip()
        chain = (qs.get("chain") or [""])[0].strip() or None
        try:
            text = fetch_profile_text(wallet, chain)
            body = json.dumps({"ok": True, "text": text}, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
        except ValueError as e:
            code = str(e)
            status = 400 if code == "INVALID_WALLET" else 502
            body = json.dumps({"ok": False, "error": code}, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)
        except Exception:
            body = json.dumps({"ok": False, "error": "FETCH_FAILED"}, ensure_ascii=False).encode(
                "utf-8"
            )
            self.send_response(502)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)

    def handle_portfolio(self, parsed):
        qs = urllib.parse.parse_qs(parsed.query)
        wallet = (qs.get("wallet") or [""])[0].strip()
        show_small = (qs.get("dust") or ["0"])[0].lower() in ("1", "true", "yes")
        quick = (qs.get("quick") or ["0"])[0].lower() in ("1", "true", "yes")
        refresh = (qs.get("refresh") or ["0"])[0].lower() in ("1", "true", "yes")
        source = (qs.get("source") or ["debank"])[0].lower()
        use_hybrid = source in ("hybrid", "onchain", "rpc", "chain", "")
        use_onchain_only = source in ("onchain", "rpc", "chain")
        try:
            if use_hybrid and not quick:
                if not refresh:
                    cached = load_portfolio_cache(wallet)
                    if cached and cached.get("source") in ("hybrid", "onchain+debank"):
                        cached = dict(cached)
                        cached["fromCache"] = True
                        body = json.dumps(
                            {
                                "ok": True,
                                "portfolio": cached,
                                "cached": True,
                                "source": cached.get("source") or "hybrid",
                            },
                            ensure_ascii=False,
                        ).encode("utf-8")
                        self.send_response(200)
                        self.send_header("Content-Type", "application/json; charset=utf-8")
                        self.send_header("Cache-Control", "no-store")
                        self.end_headers()
                        self.wfile.write(body)
                        return

                force_onchain = (qs.get("refreshOnchain") or ["0"])[0].lower() in (
                    "1",
                    "true",
                    "yes",
                )
                portfolio = build_hybrid_portfolio(
                    wallet,
                    refresh=refresh,
                    show_small=show_small,
                    force_onchain=force_onchain,
                )

                body = json.dumps(
                    {
                        "ok": True,
                        "portfolio": portfolio,
                        "cached": False,
                        "source": "hybrid",
                    },
                    ensure_ascii=False,
                ).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
                return

            if use_onchain_only and not quick:
                if not refresh:
                    cached = load_onchain_portfolio_cache(wallet)
                    if cached:
                        body = json.dumps(
                            {
                                "ok": True,
                                "portfolio": cached,
                                "cached": True,
                                "source": "onchain",
                            },
                            ensure_ascii=False,
                        ).encode("utf-8")
                        self.send_response(200)
                        self.send_header("Content-Type", "application/json; charset=utf-8")
                        self.send_header("Cache-Control", "no-store")
                        self.end_headers()
                        self.wfile.write(body)
                        return
                try:
                    portfolio = run_onchain_portfolio(wallet)
                    save_onchain_portfolio_cache(wallet, portfolio)
                    body = json.dumps(
                        {
                            "ok": True,
                            "portfolio": portfolio,
                            "cached": False,
                            "source": "onchain",
                        },
                        ensure_ascii=False,
                    ).encode("utf-8")
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    self.wfile.write(body)
                    return
                except Exception as ex:
                    _api_log(f"onchain portfolio failed: {ex!s}")
                    body = json.dumps(
                        {"ok": False, "error": "ONCHAIN_PORTFOLIO_FAILED"},
                        ensure_ascii=False,
                    ).encode("utf-8")
                    self.send_response(502)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(body)
                    return

            if source == "debank":
                portfolio = fetch_debank_portfolio(
                    wallet, quick=quick, refresh=refresh, show_small=show_small
                )
                if not portfolio.get("fromCache"):
                    save_portfolio_cache(wallet, portfolio)
                src = (
                    "debank-api"
                    if portfolio.get("fromDebankApi")
                    else "debank-free"
                    if portfolio.get("fromFreeFetch") or portfolio.get("source") == "debank-free"
                    else "debank"
                )
                body = json.dumps(
                    {
                        "ok": True,
                        "portfolio": portfolio,
                        "cached": bool(portfolio.get("fromCache")),
                        "source": src,
                    },
                    ensure_ascii=False,
                ).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
                return

        except ValueError as e:
            code = str(e).split(":")[0]
            status = 400 if code == "INVALID_WALLET" else 502
            body = json.dumps({"ok": False, "error": code}, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)
        except Exception:
            body = json.dumps({"ok": False, "error": "FETCH_FAILED"}, ensure_ascii=False).encode(
                "utf-8"
            )
            self.send_response(502)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)

    def handle_enrich_ranges(self, parsed):
        qs = urllib.parse.parse_qs(parsed.query)
        wallet = (qs.get("wallet") or [""])[0].strip()
        if not re.fullmatch(r"0x[a-fA-F0-9]{40}", wallet):
            body = json.dumps({"ok": False, "error": "INVALID_WALLET"}, ensure_ascii=False).encode(
                "utf-8"
            )
            self.send_response(400)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)
            return
        try:
            portfolio = load_portfolio_cache(wallet, allow_stale=True)
            if not portfolio:
                main_text = fetch_main_profile_quick(wallet)
                if not main_text:
                    raise ValueError("FETCH_FAILED")
                portfolio = parse_full_portfolio(main_text, {}, False)
                portfolio = enrich_quick_chain_pages(wallet, main_text, portfolio, False)
            portfolio = enrich_portfolio_lp_ranges(wallet, portfolio)
            body = json.dumps({"ok": True, "portfolio": portfolio}, ensure_ascii=False).encode(
                "utf-8"
            )
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
        except ValueError as e:
            code = str(e).split(":")[0]
            body = json.dumps({"ok": False, "error": code}, ensure_ascii=False).encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)
        except Exception:
            body = json.dumps(
                {"ok": False, "error": "LP_RANGE_ENRICH_FAILED"}, ensure_ascii=False
            ).encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)

    def handle_enrich_krystal(self, parsed):
        qs = urllib.parse.parse_qs(parsed.query)
        wallet = (qs.get("wallet") or [""])[0].strip()
        if not re.fullmatch(r"0x[a-fA-F0-9]{40}", wallet):
            body = json.dumps({"ok": False, "error": "INVALID_WALLET"}, ensure_ascii=False).encode(
                "utf-8"
            )
            self.send_response(400)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)
            return
        try:
            portfolio = load_portfolio_cache(wallet, allow_stale=True)
            if not portfolio:
                main_text = fetch_main_profile_quick(wallet)
                if not main_text:
                    raise ValueError("FETCH_FAILED")
                portfolio = parse_full_portfolio(main_text, {}, False)
            merged, positions = enrich_portfolio_krystal(wallet, portfolio)
            body = json.dumps(
                {"ok": True, "portfolio": merged, "positions": positions, "count": len(positions)},
                ensure_ascii=False,
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
        except ValueError as e:
            code = str(e).split(":")[0]
            body = json.dumps({"ok": False, "error": code}, ensure_ascii=False).encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)
        except Exception:
            body = json.dumps(
                {"ok": False, "error": "KRYSTAL_ENRICH_FAILED"}, ensure_ascii=False
            ).encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)

    def handle_history(self, parsed):
        qs = urllib.parse.parse_qs(parsed.query)
        wallet = (qs.get("wallet") or [""])[0].strip()
        if not re.fullmatch(r"0x[a-fA-F0-9]{40}", wallet):
            body = json.dumps({"ok": False, "error": "INVALID_WALLET"}, ensure_ascii=False).encode(
                "utf-8"
            )
            self.send_response(400)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)
            return
        try:
            series = load_history_cache(wallet)
            if not series:
                portfolio = load_portfolio_cache(wallet)
                if not portfolio:
                    main_text = fetch_main_profile_quick(wallet)
                    if not main_text:
                        raise ValueError("NO_PORTFOLIO")
                    portfolio = parse_full_portfolio(main_text, {}, False)
                series = build_portfolio_history(portfolio)
                if not series:
                    series = flat_history_fallback(portfolio)
                if series:
                    save_history_cache(wallet, series)
            body = json.dumps(
                {"ok": True, "series": series or [], "note": "anchored_to_total_v2"},
                ensure_ascii=False,
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
        except Exception:
            body = json.dumps({"ok": False, "error": "HISTORY_FAILED"}, ensure_ascii=False).encode(
                "utf-8"
            )
            self.send_response(502)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)

    def handle_revert(self, parsed):
        qs = urllib.parse.parse_qs(parsed.query)
        wallet = (qs.get("wallet") or [""])[0].strip()
        refresh = (qs.get("refresh") or ["0"])[0].lower() in ("1", "true", "yes")
        if not re.fullmatch(r"0x[a-fA-F0-9]{40}", wallet):
            body = json.dumps({"ok": False, "error": "INVALID_WALLET"}, ensure_ascii=False).encode(
                "utf-8"
            )
            self.send_response(400)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)
            return
        try:
            onchain_only = (qs.get("onchainOnly") or ["0"])[0].lower() in (
                "1",
                "true",
                "yes",
            )
            payload = build_revert_api_payload(wallet, refresh=refresh, onchain_only=onchain_only)
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
        except Exception as ex:
            _api_log(f"revert handler: {ex!s}")
            stale = load_revert_cache(wallet, allow_stale=True) or []
            if stale:
                body = json.dumps(
                    {
                        "ok": True,
                        "positions": stale,
                        "count": len(stale),
                        "cached": True,
                        "stale": True,
                        "warning": "REVERT_FETCH_FAILED",
                        "onchainEnriched": 0,
                        "source": "revert",
                    },
                    ensure_ascii=False,
                ).encode("utf-8")
                self.send_response(200)
            else:
                body = json.dumps(
                    {"ok": False, "error": "REVERT_FAILED"}, ensure_ascii=False
                ).encode("utf-8")
                self.send_response(502)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)

    def handle_onchain_lp(self, parsed):
        qs = urllib.parse.parse_qs(parsed.query)
        wallet = (qs.get("wallet") or [""])[0].strip()
        refresh = (qs.get("refresh") or ["0"])[0].lower() in ("1", "true", "yes")
        enrich = (qs.get("enrich") or ["0"])[0].lower() in ("1", "true", "yes")
        if not re.fullmatch(r"0x[a-fA-F0-9]{40}", wallet):
            body = json.dumps({"ok": False, "error": "INVALID_WALLET"}, ensure_ascii=False).encode(
                "utf-8"
            )
            self.send_response(400)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)
            return
        try:
            oc = None if refresh else load_onchain_cache(wallet)
            if oc is None:
                rev = load_revert_cache(wallet) if enrich else []
                oc = run_onchain_enrich(wallet, rev or [])
                if oc.get("onchain"):
                    save_onchain_cache(wallet, oc)
            body = json.dumps(
                {
                    "ok": True,
                    "wallet": wallet.lower(),
                    "onchain": oc.get("onchain") or [],
                    "positions": oc.get("positions") if enrich else oc.get("onchain"),
                    "count": oc.get("count") or len(oc.get("onchain") or []),
                    "cached": not refresh,
                    "source": "onchain-rpc",
                },
                ensure_ascii=False,
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
        except Exception as ex:
            _api_log(f"onchain lp failed: {ex!s}")
            body = json.dumps(
                {"ok": False, "error": "ONCHAIN_FAILED", "onchain": []},
                ensure_ascii=False,
            ).encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)


HISTORY_CACHE_DIR = ROOT / ".cache" / "history"
COINGECKO_IDS: dict[str, str] = {
    "ETH": "ethereum",
    "WETH": "ethereum",
    "STETH": "ethereum",
    "WSTETH": "ethereum",
    "USDC": "usd-coin",
    "USDT": "tether",
    "DAI": "dai",
    "WBTC": "wrapped-bitcoin",
    "BTC": "bitcoin",
    "BNB": "binancecoin",
    "POL": "matic-network",
    "MATIC": "matic-network",
    "CAKE": "pancakeswap-token",
    "ARB": "arbitrum",
    "OP": "optimism",
    "LINK": "chainlink",
    "UNI": "uniswap",
    "AAVE": "aave",
    "GMX": "gmx",
    "PENDLE": "pendle",
}

SYMBOL_ALIASES: dict[str, str] = {
    "WETH": "ETH",
    "STETH": "ETH",
    "WSTETH": "ETH",
    "CBBTC": "BTC",
    "USDBC": "USDC",
    "USDCE": "USDC",
}

HISTORY_CACHE_VERSION = 2


def _parse_amount(raw: str) -> float:
    s = re.sub(r"[^\d.eE+-]", "", str(raw or "").replace(",", ""))
    try:
        return float(s) if s else 0.0
    except ValueError:
        return 0.0


def _normalize_symbol(sym: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]", "", str(sym or "")).upper()
    return SYMBOL_ALIASES.get(s, s)


def _coin_id(sym: str) -> str | None:
    return COINGECKO_IDS.get(_normalize_symbol(sym))


def _portfolio_total_usd(portfolio: dict) -> float:
    t = float(portfolio.get("totalUsd") or 0)
    if t > 0.01:
        return t
    w = sum(float(x.get("usd") or 0) for x in portfolio.get("walletTokens") or [])
    liq = sum(float(x.get("positionUsd") or 0) for x in portfolio.get("liquidity") or [])
    lend = sum(float(x.get("netUsd") or 0) for x in portfolio.get("lending") or [])
    for g in portfolio.get("protocolGroups") or []:
        liq += sum(float(x.get("positionUsd") or 0) for x in g.get("liquidity") or [])
        lend += sum(float(x.get("netUsd") or 0) for x in g.get("lending") or [])
    return w + liq + lend


def _iter_lending_positions(portfolio: dict):
    seen: set[str] = set()
    for p in portfolio.get("lending") or []:
        key = f"{p.get('protocol')}|{p.get('chain')}"
        if key in seen:
            continue
        seen.add(key)
        yield p
    for g in portfolio.get("protocolGroups") or []:
        for p in g.get("lending") or []:
            key = f"{g.get('protocol')}|{p.get('chain')}|{p.get('netUsd')}"
            if key in seen:
                continue
            seen.add(key)
            yield p


def _iter_liquidity_positions(portfolio: dict):
    seen: set[str] = set()
    for p in portfolio.get("liquidity") or []:
        key = str(p.get("poolId") or p.get("pair") or id(p))
        if key in seen:
            continue
        seen.add(key)
        yield p
    for g in portfolio.get("protocolGroups") or []:
        for p in g.get("liquidity") or []:
            key = str(p.get("poolId") or p.get("pair") or id(p))
            if key in seen:
                continue
            seen.add(key)
            yield p


def _holdings_from_portfolio(portfolio: dict) -> list[dict]:
    """Ноги портфеля: кошелёк + LP + лендинг (объёмы на сегодня × исторические цены)."""
    raw_legs: list[dict] = []

    for t in portfolio.get("walletTokens") or []:
        sym = _normalize_symbol(t.get("symbol", ""))
        amt = _parse_amount(t.get("amount", "0"))
        if sym and amt > 0 and _coin_id(sym):
            raw_legs.append({"symbol": sym, "amount": amt})

    for pool in _iter_liquidity_positions(portfolio):
        for leg in pool.get("inPool") or []:
            sym = _normalize_symbol(leg.get("symbol", ""))
            amt = _parse_amount(leg.get("amount", "0"))
            if sym and amt > 0 and _coin_id(sym):
                raw_legs.append({"symbol": sym, "amount": amt})

    for pos in _iter_lending_positions(portfolio):
        for s in pos.get("supplied") or []:
            sym = _normalize_symbol(s.get("asset") or s.get("symbol", ""))
            amt = _parse_amount(s.get("amount", "0"))
            if sym and amt > 0 and _coin_id(sym):
                raw_legs.append({"symbol": sym, "amount": amt})
        for b in pos.get("borrowed") or []:
            sym = _normalize_symbol(b.get("asset") or b.get("symbol", ""))
            amt = _parse_amount(b.get("amount", "0"))
            if sym and amt > 0 and _coin_id(sym):
                raw_legs.append({"symbol": sym, "amount": -amt})

    merged: dict[str, dict] = {}
    for leg in raw_legs:
        sym = leg["symbol"]
        cid = _coin_id(sym)
        if not cid:
            continue
        if sym not in merged:
            merged[sym] = {"symbol": sym, "amount": 0.0, "coin_id": cid}
        merged[sym]["amount"] += leg["amount"]

    return sorted(merged.values(), key=lambda x: abs(x["amount"]), reverse=True)[:14]


def _fetch_coingecko_prices(coin_id: str, days: int = 365) -> list[float]:
    url = (
        f"https://api.coingecko.com/api/v3/coins/{coin_id}/market_chart"
        f"?vs_currency=usd&days={days}&interval=daily"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "PortfolioTracker/1.0"})
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return [float(p[1]) for p in data.get("prices", [])]


def flat_history_fallback(portfolio: dict, days: int = 30) -> list[dict]:
    """Плоская линия, если CoinGecko недоступен (PA whitelist / rate limit)."""
    import datetime as dt

    target = round(_portfolio_total_usd(portfolio), 2)
    if target <= 0:
        return []
    out: list[dict] = []
    end = dt.date.today()
    for i in range(days, -1, -1):
        day = (end - dt.timedelta(days=i)).isoformat()
        out.append({"d": day, "v": target})
    return out


def build_portfolio_history(portfolio: dict) -> list[dict]:
    """
    История 365д: сумма (объёмы позиций сегодня × цена CoinGecko в каждый день),
    затем масштабирование так, чтобы последний день = totalUsd портфеля.
    """
    import datetime as dt

    target = round(_portfolio_total_usd(portfolio), 2)
    if target <= 0:
        return []

    holdings = _holdings_from_portfolio(portfolio)
    if not holdings:
        return []

    price_map: dict[str, list[float]] = {}
    for h in holdings:
        cid = h["coin_id"]
        if cid in price_map:
            continue
        try:
            price_map[cid] = _fetch_coingecko_prices(cid, 365)
            time.sleep(0.2)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError, OSError):
            continue
    if not price_map:
        return []

    n = min(len(v) for v in price_map.values())
    if n < 2:
        return []

    start = dt.date.today() - dt.timedelta(days=n - 1)
    raw: list[float] = []
    for i in range(n):
        total = 0.0
        for h in holdings:
            prices = price_map.get(h["coin_id"])
            if not prices or i >= len(prices):
                continue
            total += h["amount"] * prices[i]
        raw.append(max(total, 0.0))

    anchor_raw = raw[-1] if raw[-1] > 0 else 1.0
    scale = target / anchor_raw

    out: list[dict] = []
    for i in range(n):
        v = raw[i] * scale
        if i == n - 1:
            v = target
        day = (start + dt.timedelta(days=i)).isoformat()
        out.append({"d": day, "v": round(v, 2)})
    return out


def load_history_cache(wallet: str) -> list[dict] | None:
    path = HISTORY_CACHE_DIR / f"{wallet.lower()}.json"
    if not path.exists():
        return None
    try:
        if time.time() - path.stat().st_mtime > 21600:
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("v") != HISTORY_CACHE_VERSION:
            return None
        return data.get("series")
    except (json.JSONDecodeError, OSError):
        return None


def save_history_cache(wallet: str, series: list[dict]) -> None:
    HISTORY_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = HISTORY_CACHE_DIR / f"{wallet.lower()}.json"
    path.write_text(
        json.dumps({"v": HISTORY_CACHE_VERSION, "series": series}, ensure_ascii=False),
        encoding="utf-8",
    )


def main():
    import socketserver

    _guard_node_modules()

    class ReuseTCPServer(socketserver.TCPServer):
        allow_reuse_address = True

    with ReuseTCPServer(("", PORT), Handler) as httpd:
        print(f"Portfolio Tracker → http://127.0.0.1:{PORT}/index.html")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
