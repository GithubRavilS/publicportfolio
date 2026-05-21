#!/usr/bin/env python3
"""
DeBank Lending Parser FINAL - Accurate Parsing
Корректное извлечение всех активов и сумм

На PythonAnywhere: запускать из Scheduled task (не из веб-приложения).
Chrome только в headless + флаги с https://help.pythonanywhere.com/pages/selenium
"""

import csv
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

from selenium import webdriver
from selenium.common.exceptions import InvalidSessionIdException
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.remote.webdriver import WebDriver

DEFAULT_WALLET = "0x1fb07ac5643428710ee3bf5a73a4a66d0762f355"


class ChromeSessionLost(Exception):
    """Chrome закрылся или сессия недействительна (часто на PythonAnywhere: OOM / лимиты)."""


def load_wallet() -> str:
    cfg_path = Path("python/config.json")
    if cfg_path.exists():
        try:
            cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
            wallets = cfg.get("debank_wallets") or []
            if wallets and isinstance(wallets[0], str):
                w = wallets[0].strip()
                if w:
                    return w if w.startswith("0x") else f"0x{w}"
        except (json.JSONDecodeError, OSError):
            pass
    return DEFAULT_WALLET


def load_json_config() -> dict:
    p = Path("python/config.json")
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def load_debank_proxy() -> str:
    p = os.environ.get("DEBANK_PROXY", "").strip()
    if p:
        return p
    return (load_json_config().get("debank_http_proxy") or "").strip()


def load_scraperapi_key() -> str:
    k = os.environ.get("SCRAPERAPI_API_KEY", "").strip()
    if k:
        return k
    return (load_json_config().get("debank_scraperapi_key") or "").strip()


def html_to_plain_text(html: str) -> str:
    if not html:
        return ""
    t = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", html)
    t = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", t)
    t = re.sub(r"(?is)<noscript[^>]*>.*?</noscript>", " ", t)
    t = re.sub(r"<br\s*/?>", "\n", t, flags=re.I)
    t = re.sub(r"</(div|p|tr|li|h[1-6])\s*>", "\n", t, flags=re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n\s*\n+", "\n", t)
    return t.strip()


def try_fetch_via_jina(wallet: str) -> str | None:
    """Обход без браузера: иногда работает с публичными URL (бесплатно)."""
    if os.environ.get("DEBANK_TRY_JINA", "1" if sys.platform.startswith("linux") else "0") == "0":
        return None
    try:
        import requests
    except ImportError:
        return None
    url = f"https://r.jina.ai/https://debank.com/profile/{wallet}"
    try:
        print("🌐 Пробуем Jina Reader (без Chrome)...")
        r = requests.get(
            url,
            timeout=120,
            headers={
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
                "X-Return-Format": "text",
            },
        )
        r.raise_for_status()
        text = (r.text or "").strip()
        if len(text) < 1200:
            print(f"   Jina: мало текста ({len(text)} симв.)")
            return None
        if "lending" not in text.lower():
            print("   Jina: нет слова Lending")
            return None
        return text
    except Exception as e:
        print(f"   Jina: {e}")
        return None


def try_fetch_via_scraperapi(wallet: str, api_key: str) -> str | None:
    """ScraperAPI + render=true — типичный обход антибота для SPA (платно, с PA работает)."""
    try:
        import requests
    except ImportError:
        return None
    target = quote(f"https://debank.com/profile/{wallet}", safe="")
    api_url = (
        f"http://api.scraperapi.com?api_key={api_key}&url={target}"
        f"&render=true&country_code=us&device_type=desktop"
    )
    try:
        print("🌐 Пробуем ScraperAPI (render=true)...")
        r = requests.get(api_url, timeout=180)
        r.raise_for_status()
        text = html_to_plain_text(r.text)
        if len(text) < 1200:
            print(f"   ScraperAPI: мало текста после очистки HTML ({len(text)} симв.)")
            return None
        if "lending" not in text.lower():
            print("   ScraperAPI: нет слова Lending в тексте")
            return None
        return text
    except Exception as e:
        print(f"   ScraperAPI: {e}")
        return None


def try_fetch_without_browser(wallet: str) -> str | None:
    key = load_scraperapi_key()
    if key:
        t = try_fetch_via_scraperapi(wallet, key)
        if t:
            return t
    return try_fetch_via_jina(wallet)


def chrome_user_data_dir() -> str:
    """
    На PythonAnywhere дефолтный профиль Chrome часто падает с:
    cannot create temp dir for user data dir
    Пишем профиль в $TMPDIR или ~/tmp (должно быть writable и с квотой).
    """
    override = os.environ.get("CHROME_USER_DATA_DIR", "").strip()
    if override:
        p = Path(override)
        p.mkdir(parents=True, exist_ok=True)
        return str(p.resolve())
    base = Path(os.environ.get("TMPDIR") or (Path.home() / "tmp"))
    base.mkdir(parents=True, exist_ok=True)
    profile = base / "chrome-debank-profile"
    profile.mkdir(parents=True, exist_ok=True)
    return str(profile.resolve())


def build_chrome_options() -> Options:
    opts = Options()
    proxy = load_debank_proxy()
    if proxy:
        if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", proxy):
            proxy = "http://" + proxy
        opts.add_argument(f"--proxy-server={proxy}")
        shown = proxy.split("@")[-1] if "@" in proxy else proxy
        print(f"🌐 Chrome через прокси: {shown}")
    # Linux (в т.ч. PythonAnywhere) — headless по доке PA
    if sys.platform.startswith("linux") or os.environ.get("DEBANK_FORCE_HEADLESS") == "1":
        opts.add_argument(f"--user-data-dir={chrome_user_data_dir()}")
        opts.add_argument("--no-sandbox")
        opts.add_argument("--headless=new")
        opts.add_argument("--disable-gpu")
        opts.add_argument("--disable-dev-shm-usage")
        opts.add_argument("--window-size=1920,1080")
        opts.add_argument("--disable-extensions")
        opts.add_argument("--disable-background-networking")
        opts.add_argument("--disable-sync")
        opts.add_argument("--mute-audio")
        opts.add_argument("--no-first-run")
        opts.add_argument(
            "user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        )
    else:
        opts.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
    return opts


def extract_visible_text(driver: WebDriver) -> str:
    """Selenium .text в headless часто беднее, чем innerText в браузере."""
    chunks: list[str] = []
    try:
        chunks.append(driver.find_element(By.TAG_NAME, "body").text)
    except Exception:
        pass
    try:
        t = driver.execute_script(
            "return (document.body && document.body.innerText) ? document.body.innerText : '';"
        )
        if isinstance(t, str) and t.strip():
            chunks.append(t)
    except Exception:
        pass
    try:
        t = driver.execute_script(
            "return (document.documentElement && document.documentElement.innerText) "
            "? document.documentElement.innerText : '';"
        )
        if isinstance(t, str) and t.strip():
            chunks.append(t)
    except Exception:
        pass
    best = ""
    for c in chunks:
        if not c:
            continue
        low = c.lower()
        if "lending" in low and len(c) > len(best):
            best = c
    if best:
        return best
    return max(chunks, key=len) if chunks else ""


def body_looks_ready(text: str) -> bool:
    if not text or len(text) < 400:
        return False
    low = text.lower()
    if "just a moment" in low or "checking your browser" in low:
        return False
    if "lending" in low and "$" in text:
        return True
    if text.count("$") >= 5 and len(text) > 1200:
        return True
    return False


def session_alive(driver: WebDriver) -> bool:
    try:
        driver.execute_script("return 1")
        return True
    except Exception:
        return False


def wait_profile_body(driver: WebDriver, timeout: int) -> str:
    """Поллинг раз в 2s — на PythonAnywhere WebDriverWait часто убивает сессию к концу таймаута."""
    deadline = time.time() + timeout
    last_text = ""
    while time.time() < deadline:
        if not session_alive(driver):
            raise ChromeSessionLost("chrome session dead during wait")
        try:
            last_text = extract_visible_text(driver)
            if body_looks_ready(last_text):
                return last_text
        except InvalidSessionIdException:
            raise
        except Exception:
            pass
        time.sleep(2)
    if not session_alive(driver):
        raise ChromeSessionLost("chrome session dead after wait")
    if last_text:
        return last_text
    return extract_visible_text(driver)


def scroll_profile(driver: WebDriver) -> None:
    try:
        for _ in range(3):
            if not session_alive(driver):
                return
            driver.execute_script("window.scrollBy(0, 650);")
            time.sleep(1.0)
        driver.execute_script("window.scrollTo(0, 0);")
        time.sleep(1.0)
        for _ in range(3):
            if not session_alive(driver):
                return
            driver.execute_script("window.scrollBy(0, 550);")
            time.sleep(0.8)
    except InvalidSessionIdException:
        raise
    except Exception as e:
        print(f"⚠️ scroll: {e}")


def debug_dir_save_fail_html(driver: WebDriver) -> Path | None:
    """Сохраняем HTML, чтобы увидеть капчу/пустую оболочку/другой DOM на PythonAnywhere."""
    try:
        d = Path("data/source")
        d.mkdir(parents=True, exist_ok=True)
        p = d / f"debank_fail_page_{datetime.now().strftime('%Y%m%d_%H%M%S')}.html"
        src = driver.page_source or ""
        p.write_text(src[:200000], encoding="utf-8")
        return p
    except Exception:
        return None


CHAIN_LINE_ALIASES: dict[str, str] = {
    "op": "op",
    "optimism": "op",
    "base": "base",
    "ethereum": "eth",
    "eth": "eth",
    "arbitrum": "arb",
    "arb": "arb",
    "polygon": "matic",
    "matic": "matic",
    "bsc": "bsc",
    "bnb chain": "bsc",
    "hyperliquid": "hyperliquid",
    "hype": "hyperliquid",
}


def chain_slug_from_line(line: str) -> str:
    key = (line or "").strip().lower()
    if key in CHAIN_LINE_ALIASES:
        return CHAIN_LINE_ALIASES[key]
    return ""


def parse_health_factor_lines(line: str, next_line: str = "") -> str | None:
    """DeBank: «>10» = очень здоровый займ, не число 10."""
    for raw in (line, next_line):
        s = (raw or "").strip()
        if not s:
            continue
        low = s.lower().replace(" ", "")
        if ">" in s and "10" in low:
            return None
        if low in {">10", "≥10", ">=10"}:
            return None
        m = re.search(r"(\d+[.,]?\d*)", s)
        if m:
            return m.group(1).replace(",", ".")
    return None


def detect_chain_before_lending(lines: list[str], lending_index: int) -> str:
    for j in range(lending_index - 1, max(-1, lending_index - 24), -1):
        slug = chain_slug_from_line(lines[j].strip())
        if slug:
            return slug
    return ""


def run_parse_and_save(lines: list[str], wallet: str) -> int:
    debug_dir = Path("data/source")
    debug_dir.mkdir(parents=True, exist_ok=True)
    raw_dump = debug_dir / f"debank_raw_dump_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
    raw_dump.write_text("\n".join(lines), encoding="utf-8")
    print(f"🧪 Raw dump saved: {raw_dump}")

    print("\n🔍 Parsing lending positions...")

    positions = []
    i = 0

    while i < len(lines):
        line = lines[i].strip()

        if line.lower() == "lending":
            protocol = "Unknown"
            health_factor = None
            chain = detect_chain_before_lending(lines, i)
            supplied = []
            borrowed = []

            j = i - 1
            while j >= max(0, i - 15):
                check_line = lines[j].strip()
                if check_line and "$" not in check_line and re.search(r"[A-Za-z]", check_line):
                    protocol = check_line
                    break
                j -= 1

            i += 1
            mode = None
            block_lines = []

            while i < len(lines):
                line = lines[i].strip()
                block_lines.append(line)
                low = line.lower()
                if ("health" in low and ("factor" in low or "rate" in low)) or low in [
                    "hf",
                    "health factor",
                    "health rate",
                ]:
                    next_hf = lines[i + 1].strip() if i + 1 < len(lines) else ""
                    parsed_hf = parse_health_factor_lines(line, next_hf)
                    if parsed_hf:
                        health_factor = parsed_hf
                    elif not health_factor:
                        for k in range(1, 6):
                            if i + k >= len(lines):
                                break
                            cand = lines[i + k].strip()
                            parsed_hf = parse_health_factor_lines(cand)
                            if parsed_hf:
                                health_factor = parsed_hf
                                break

                if line == "Supplied":
                    mode = "supplied"
                    i += 1
                    continue
                if line == "Borrowed":
                    mode = "borrowed"
                    i += 1
                    continue

                if line in ["Rewards", "Liquidity Pool", "Pool", "Uniswap", "Compound", "Aave", "Fluid", "Wallet", ""]:
                    if line in ["Rewards", "Liquidity Pool", "Pool"]:
                        break
                    i += 1
                    continue

                if line in ["Balance", "USD Value"]:
                    i += 1
                    continue

                if mode and re.match(r"^[A-Za-z]+$", line):
                    asset_name = line
                    amount_str = None
                    usd_value_str = None

                    if i + 1 < len(lines):
                        next_line = lines[i + 1].strip()
                        match = re.search(r"([\d,]+\.?[\d]*)\s+" + asset_name, next_line)
                        if match:
                            amount_str = match.group(1).replace(",", "")
                            i += 1

                    if i + 1 < len(lines):
                        j2 = i + 1
                        while j2 < min(i + 5, len(lines)):
                            check_line = lines[j2].strip()
                            if check_line.startswith("$"):
                                match = re.search(r"\$([\d,]+\.?[\d]*)", check_line)
                                if match:
                                    usd_value_str = match.group(1).replace(",", "")
                                    i = j2
                                break
                            if re.match(r"^[A-Z]+$", check_line):
                                break
                            j2 += 1

                    if amount_str and usd_value_str:
                        if mode == "supplied":
                            supplied.append(
                                {"asset": asset_name, "amount": amount_str, "usd": usd_value_str}
                            )
                        else:
                            borrowed.append(
                                {"asset": asset_name, "amount": amount_str, "usd": usd_value_str}
                            )

                i += 1

            if not health_factor:
                block_text = "\n".join(block_lines)
                if not re.search(r">\s*10|≥\s*10|>=\s*10", block_text, flags=re.IGNORECASE):
                    hf_patterns = [
                        r"Health\s*Factor[^\d>]*([\d]+[.,]?[\d]*)",
                        r"Health\s*Rate[^\d>]*([\d]+[.,]?[\d]*)",
                        r"\bHF\b[^\d>]*([\d]+[.,]?[\d]*)",
                    ]
                    for p in hf_patterns:
                        m = re.search(p, block_text, flags=re.IGNORECASE)
                        if m:
                            health_factor = m.group(1).replace(",", ".")
                            break

            block_debug = debug_dir / (
                f"debank_lending_block_{len(positions) + 1}_{datetime.now().strftime('%H%M%S')}.txt"
            )
            block_payload = [
                f"PROTOCOL: {protocol}",
                f"CHAIN: {chain or 'n/a'}",
                f"HEALTH_FACTOR_PARSED: {health_factor}",
                "-" * 60,
                *block_lines,
            ]
            block_debug.write_text("\n".join(block_payload), encoding="utf-8")

            if supplied or borrowed:
                positions.append(
                    {
                        "protocol": protocol,
                        "chain": chain,
                        "supplied": supplied,
                        "borrowed": borrowed,
                        "health_factor": health_factor,
                    }
                )

        i += 1

    print(f"\n✅ Found {len(positions)} lending positions\n")

    print("=" * 70)
    for idx, pos in enumerate(positions, 1):
        print(f"\n{idx}. {pos['protocol']}")
        print(f"   🩺 Health Factor: {pos.get('health_factor') or 'N/A'}")

        if pos["supplied"]:
            total_collateral = sum(float(item["usd"]) for item in pos["supplied"])
            print(f"   📦 Collateral (${total_collateral:,.2f}):")
            for item in pos["supplied"]:
                print(f"      {item['asset']:8} {item['amount']:>15} (${item['usd']:>12})")

        if pos["borrowed"]:
            total_borrow = sum(float(item["usd"]) for item in pos["borrowed"])
            print(f"   💳 Borrowed (${total_borrow:,.2f}):")
            for item in pos["borrowed"]:
                print(f"      {item['asset']:8} {item['amount']:>15} (${item['usd']:>12})")

    print("\n" + "=" * 70)
    print("💾 Saving to CSV...\n")

    rows = []
    for pos in positions:
        if pos["supplied"] and pos["borrowed"]:
            for sup in pos["supplied"]:
                for bor in pos["borrowed"]:
                    rows.append(
                        {
                            "protocol": pos["protocol"],
                            "chain": pos.get("chain") or "",
                            "health_factor": pos.get("health_factor") or "",
                            "collateral_asset": sup["asset"],
                            "collateral_amount": sup["amount"],
                            "collateral_usd": sup["usd"],
                            "borrow_asset": bor["asset"],
                            "borrow_amount": bor["amount"],
                            "borrow_usd": bor["usd"],
                            "timestamp": datetime.now().isoformat(),
                        }
                    )
        elif pos["supplied"]:
            for sup in pos["supplied"]:
                rows.append(
                    {
                        "protocol": pos["protocol"],
                        "chain": pos.get("chain") or "",
                        "health_factor": pos.get("health_factor") or "",
                        "collateral_asset": sup["asset"],
                        "collateral_amount": sup["amount"],
                        "collateral_usd": sup["usd"],
                        "borrow_asset": "",
                        "borrow_amount": "",
                        "borrow_usd": "",
                        "timestamp": datetime.now().isoformat(),
                    }
                )
        elif pos["borrowed"]:
            for bor in pos["borrowed"]:
                rows.append(
                    {
                        "protocol": pos["protocol"],
                        "chain": pos.get("chain") or "",
                        "health_factor": pos.get("health_factor") or "",
                        "collateral_asset": "",
                        "collateral_amount": "",
                        "collateral_usd": "",
                        "borrow_asset": bor["asset"],
                        "borrow_amount": bor["amount"],
                        "borrow_usd": bor["usd"],
                        "timestamp": datetime.now().isoformat(),
                    }
                )

    if rows:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        csv_file = f"debank_lending_{wallet[:8]}_{ts}.csv"

        with open(csv_file, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=rows[0].keys())
            writer.writeheader()
            writer.writerows(rows)

        print(f"✅ Saved: {csv_file}")
        print(f"📊 Records: {len(rows)}")

        print("\n" + "=" * 70)
        print("Preview (first 5 rows):")
        print("=" * 70)
        for row in rows[:5]:
            print(
                f"  {row['protocol']:15} | Coll: {row['collateral_asset']:6} "
                f"${row['collateral_usd']:>10} | Borrow: {row['borrow_asset']:6} ${row['borrow_usd']:>10}"
            )
        print("\n✅ Done!")
        return len(rows)

    print("❌ No data to save")
    hint = debug_dir / "debank_parse_zero_positions_hint.txt"
    preview = "\n".join(lines[:120])
    hint.write_text(
        "Парсер не нашёл блоки Lending. Первые строки текста (для отладки):\n\n" + preview,
        encoding="utf-8",
    )
    print(f"📝 Подсказка для отладки: {hint}")
    print("\n✅ Done!")
    return 0


def main() -> None:
    wallet = load_wallet()
    remote = try_fetch_without_browser(wallet)
    if remote:
        print(f"📄 Текст без Selenium: {len(remote)} символов")
        n = run_parse_and_save(remote.split("\n"), wallet)
        if n > 0:
            return
        print("⚠️ Удалённый текст не распарсился в позиции — пробуем Chrome...")

    wait_sec = int(os.environ.get("DEBANK_PAGE_WAIT_SEC", "120"))
    max_attempts = int(os.environ.get("DEBANK_CHROME_RETRIES", "3"))
    last_err: BaseException | None = None
    if sys.platform.startswith("linux") and not load_debank_proxy() and not load_scraperapi_key():
        print(
            "ℹ️  На PythonAnywhere без резидентского IP DeBank часто пустой.\n"
            "   Варианты: 1) ключ debank_scraperapi_key в python/config.json (ScraperAPI.com),\n"
            "   2) резидентский прокси debank_http_proxy или export DEBANK_PROXY=http://user:pass@host:port"
        )
    for attempt in range(1, max_attempts + 1):
        driver: WebDriver | None = None
        try:
            print(f"🔧 Chrome (попытка {attempt}/{max_attempts})...")
            driver = webdriver.Chrome(options=build_chrome_options())
            driver.set_page_load_timeout(min(wait_sec + 30, 180))
            print(f"📱 Loading... profile {wallet[:10]}...")
            driver.get(f"https://debank.com/profile/{wallet}")
            print(f"⏳ Ожидание контента (до {wait_sec}s, поллинг)...")
            body_text = wait_profile_body(driver, wait_sec)
            if not body_looks_ready(body_text):
                print("⚠️ Контент слабый/таймаут; парсим что есть")
            time.sleep(2)
            scroll_profile(driver)
            if not session_alive(driver):
                raise ChromeSessionLost("session dead before read body")
            body_text = extract_visible_text(driver)
            print(f"📄 Извлечённый текст: {len(body_text)} символов")
            lines = body_text.split("\n")
            n = run_parse_and_save(lines, wallet)
            if n == 0 and session_alive(driver):
                html_snip = debug_dir_save_fail_html(driver)
                if html_snip:
                    print(f"📝 Фрагмент HTML при 0 позиций: {html_snip}")
            return
        except (InvalidSessionIdException, ChromeSessionLost) as e:
            last_err = e
            print(f"⚠️ Сессия Chrome потеряна (краш / лимиты PA): {e}")
        except Exception as e:
            last_err = e
            print(f"⚠️ Ошибка: {e}")
        finally:
            if driver is not None:
                try:
                    driver.quit()
                except Exception:
                    pass
        time.sleep(8)
    if last_err:
        raise last_err


if __name__ == "__main__":
    main()
