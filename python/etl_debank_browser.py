import json
import re
import sqlite3
import time
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any

import requests
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options


def load_config() -> dict[str, Any]:
    config_path = Path("python/config.json")
    if not config_path.exists():
        raise FileNotFoundError("Create python/config.json from python/config.example.json")
    return json.loads(config_path.read_text(encoding="utf-8"))


def normalize_symbol(symbol: str) -> str:
    s = symbol.strip().upper()
    if "BTC" in s:
        return "BTC"
    if "ETH" in s:
        return "ETH"
    return s


def fetch_prices() -> dict[str, float]:
    url = (
        "https://api.coingecko.com/api/v3/simple/price"
        "?ids=bitcoin,ethereum,tether,usd-coin&vs_currencies=usd"
    )
    res = requests.get(url, timeout=30)
    res.raise_for_status()
    data = res.json()
    return {
        "BTC": float(data["bitcoin"]["usd"]),
        "ETH": float(data["ethereum"]["usd"]),
        "USDT": float(data["tether"]["usd"]),
        "USDC": float(data["usd-coin"]["usd"]),
    }


def parse_lending_positions(body_text: str) -> list[dict[str, Any]]:
    lines = body_text.split("\n")
    positions: list[dict[str, Any]] = []
    i = 0

    while i < len(lines):
        line = lines[i].strip()
        if line == "Lending":
            protocol = "Unknown"
            supplied: list[dict[str, str]] = []
            borrowed: list[dict[str, str]] = []

            j = i - 1
            while j >= max(0, i - 15):
                check_line = lines[j].strip()
                if check_line and "$" not in check_line and re.search(r"[A-Za-z]", check_line):
                    protocol = check_line
                    break
                j -= 1

            i += 1
            mode = None
            while i < len(lines):
                line = lines[i].strip()
                if line == "Supplied":
                    mode = "supplied"
                    i += 1
                    continue
                if line == "Borrowed":
                    mode = "borrowed"
                    i += 1
                    continue
                if line in ["Rewards", "Liquidity Pool", "Pool"]:
                    break
                if line in ["Balance", "USD Value", "Wallet", ""]:
                    i += 1
                    continue

                if mode and re.match(r"^[A-Za-z0-9]+$", line):
                    asset_name = line
                    amount_str = None
                    usd_value_str = None

                    if i + 1 < len(lines):
                        next_line = lines[i + 1].strip()
                        match = re.search(r"([\d,]+\.?[\d]*)\s+" + re.escape(asset_name), next_line)
                        if match:
                            amount_str = match.group(1).replace(",", "")
                            i += 1

                    if i + 1 < len(lines):
                        k = i + 1
                        while k < min(i + 5, len(lines)):
                            check_line = lines[k].strip()
                            if check_line.startswith("$"):
                                match = re.search(r"\$([\d,]+\.?[\d]*)", check_line)
                                if match:
                                    usd_value_str = match.group(1).replace(",", "")
                                    i = k
                                break
                            if re.match(r"^[A-Z0-9]+$", check_line):
                                break
                            k += 1

                    if amount_str and usd_value_str:
                        item = {"asset": asset_name, "amount": amount_str, "usd": usd_value_str}
                        if mode == "supplied":
                            supplied.append(item)
                        else:
                            borrowed.append(item)

                i += 1

            if supplied or borrowed:
                positions.append({"protocol": protocol, "supplied": supplied, "borrowed": borrowed})
        i += 1

    return positions


def scrape_wallet_debank(wallet: str) -> list[dict[str, Any]]:
    options = Options()
    options.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    driver = webdriver.Chrome(options=options)
    try:
        driver.get(f"https://debank.com/profile/{wallet}")
        time.sleep(15)
        body_text = driver.find_element(By.TAG_NAME, "body").text
    finally:
        driver.quit()

    positions = parse_lending_positions(body_text)
    if not positions:
        raise RuntimeError(f"No lending positions parsed for wallet {wallet}")
    return positions


def ingest_debank_browser(config: dict[str, Any]) -> None:
    db_path = config["db_path"]
    wallets = config.get("debank_wallets", [])
    if not wallets:
        wallets = ["0x1fb07ac5643428710ee3bf5a73a4a66d0762f355"]

    if not Path(db_path).exists():
        raise FileNotFoundError(f"DB not found: {db_path}. Run python python/init_db.py first.")

    as_of_date = date.today().isoformat()
    prices = fetch_prices()

    total_collateral = defaultdict(float)
    total_debt = defaultdict(float)

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    try:
        cur.execute("DELETE FROM debank_tokens WHERE as_of_date = ?", (as_of_date,))

        for wallet in wallets:
            positions = scrape_wallet_debank(wallet)
            for pos in positions:
                for item in pos["supplied"]:
                    symbol = normalize_symbol(item["asset"])
                    amount = float(item["amount"])
                    total_collateral[symbol] += amount
                    cur.execute(
                        """
                        INSERT INTO debank_tokens(as_of_date, wallet, side, symbol, amount)
                        VALUES (?, ?, 'collateral', ?, ?)
                        """,
                        (as_of_date, wallet, symbol, amount),
                    )
                for item in pos["borrowed"]:
                    symbol = normalize_symbol(item["asset"])
                    amount = float(item["amount"])
                    total_debt[symbol] += amount
                    cur.execute(
                        """
                        INSERT INTO debank_tokens(as_of_date, wallet, side, symbol, amount)
                        VALUES (?, ?, 'debt', ?, ?)
                        """,
                        (as_of_date, wallet, symbol, amount),
                    )

        collateral_usd = sum(amount * prices.get(symbol, 0.0) for symbol, amount in total_collateral.items())
        debt_usd = sum(amount * prices.get(symbol, 0.0) for symbol, amount in total_debt.items())

        cur.execute(
            """
            INSERT INTO daily_metrics(as_of_date, collateral_usd, debt_usd, source_debank, updated_at)
            VALUES (?, ?, ?, 'debank_selenium_parser', datetime('now'))
            ON CONFLICT(as_of_date) DO UPDATE SET
                collateral_usd=excluded.collateral_usd,
                debt_usd=excluded.debt_usd,
                source_debank='debank_selenium_parser',
                updated_at=datetime('now')
            """,
            (as_of_date, collateral_usd, debt_usd),
        )

        cur.execute(
            """
            INSERT INTO ingestion_runs(as_of_date, pipeline, status, message)
            VALUES (?, 'debank_browser', 'success', ?)
            """,
            (as_of_date, f"wallets={len(wallets)} collateral_usd={collateral_usd:.2f} debt_usd={debt_usd:.2f}"),
        )
        conn.commit()
        print(f"[OK] DeBank Selenium ingest: collateral_usd={collateral_usd:.2f}, debt_usd={debt_usd:.2f}")
    except Exception as exc:
        cur.execute(
            """
            INSERT INTO ingestion_runs(as_of_date, pipeline, status, message)
            VALUES (?, 'debank_browser', 'error', ?)
            """,
            (as_of_date, str(exc)),
        )
        conn.commit()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    cfg = load_config()
    ingest_debank_browser(cfg)
