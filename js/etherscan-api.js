/**
 * Etherscan API v2 — FREE tier: balance, tokentx, tokenbalance.
 * Лимиты: 3 req/s, 100_000 calls/day (см. .cache/etherscan-usage.json).
 * addresstokenbalance — только Pro; не используем на Free.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadConfig } from "./onchain-rpc.js";
import { CHAIN_IDS, NATIVE_SYMBOL } from "./onchain-registry.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "..");
const USAGE_PATH = resolve(ROOT, ".cache/etherscan-usage.json");
const BASE = "https://api.etherscan.io/v2/api";

/** Бесплатный multichain (~90%): проверено action=tokentx/balance. */
export const ETHERSCAN_FREE_CHAINS = new Set([
  "eth",
  "arb",
  "matic",
  "linea",
  "blast",
  "gnosis",
  "mantle",
  "celo",
  "sonic",
]);

const CORE_ERC20 = {
  eth: [
    { address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbol: "USDC", decimals: 6 },
    { address: "0xdac17f958d2ee523a2206206994597c13d831ec7", symbol: "USDT", decimals: 6 },
    { address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", symbol: "WETH", decimals: 18 },
    { address: "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0", symbol: "WSTETH", decimals: 18 },
  ],
  arb: [
    { address: "0xaf88d065e77c8cc2239328c0dfb60a416255c15", symbol: "USDC", decimals: 6 },
    { address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1", symbol: "WETH", decimals: 18 },
  ],
  matic: [
    { address: "0x3c499c542cef5e3811e119ce41d8db6e58e488b", symbol: "USDC", decimals: 6 },
    { address: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270", symbol: "WMATIC", decimals: 18 },
  ],
};

const MIN_INTERVAL_MS = 340; // ~3 req/s
const DAILY_LIMIT = 100_000;

let lastCallAt = 0;
let queue = Promise.resolve();

function apiKey() {
  const cfg = loadConfig();
  return (
    cfg.etherscan_api_key ||
    cfg.etherscan_keys?.default ||
    process.env.ETHERSCAN_API_KEY ||
    ""
  );
}

function loadUsage() {
  const today = new Date().toISOString().slice(0, 10);
  if (!existsSync(USAGE_PATH)) return { date: today, count: 0 };
  try {
    const u = JSON.parse(readFileSync(USAGE_PATH, "utf8"));
    if (u.date !== today) return { date: today, count: 0 };
    return u;
  } catch {
    return { date: today, count: 0 };
  }
}

function bumpUsage() {
  const u = loadUsage();
  u.count += 1;
  mkdirSync(dirname(USAGE_PATH), { recursive: true });
  writeFileSync(USAGE_PATH, JSON.stringify(u));
  return u.count;
}

function schedule(fn) {
  queue = queue.then(async () => {
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastCallAt));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const used = loadUsage().count;
    if (used >= DAILY_LIMIT) throw new Error("ETHERSCAN_DAILY_LIMIT");
    lastCallAt = Date.now();
    bumpUsage();
    return fn();
  });
  return queue;
}

async function apiGet(params) {
  return schedule(async () => {
    const key = apiKey();
    if (!key) throw new Error("ETHERSCAN_NO_KEY");
    const url = new URL(BASE);
    for (const [k, v] of Object.entries(params)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
    url.searchParams.set("apikey", key);
    const r = await fetch(url.toString());
    const j = await r.json();
    if (j.status !== "1" && j.message !== "OK") {
      const msg = typeof j.result === "string" ? j.result : j.message || "ETHERSCAN_ERR";
      throw new Error(msg.slice(0, 120));
    }
    return j.result;
  });
}

export function etherscanEnabled() {
  return Boolean(apiKey());
}

export function chainSupported(chain) {
  return ETHERSCAN_FREE_CHAINS.has(chain) && Boolean(CHAIN_IDS[chain]);
}

export async function fetchNativeBalance(chain, wallet) {
  const chainId = CHAIN_IDS[chain];
  if (!chainId) return 0n;
  const wei = await apiGet({
    chainid: chainId,
    module: "account",
    action: "balance",
    address: wallet,
    tag: "latest",
  });
  return BigInt(wei || 0);
}

async function fetchTokentxPage(chain, wallet, page) {
  const chainId = CHAIN_IDS[chain];
  const result = await apiGet({
    chainid: chainId,
    module: "account",
    action: "tokentx",
    address: wallet,
    page,
    offset: 100,
    sort: "desc",
  });
  return Array.isArray(result) ? result : [];
}

/** Уникальные контракты из истории переводов + core stables. */
export async function discoverTokenContracts(chain, wallet, { maxPages = 2, maxTokens = 40 } = {}) {
  const pages = process.env.PT_QUICK === "1" ? 1 : maxPages;
  const cap = process.env.PT_QUICK === "1" ? Math.min(maxTokens, 18) : maxTokens;
  const seen = new Map();
  for (const t of CORE_ERC20[chain] || []) {
    seen.set(t.address.toLowerCase(), t);
  }
  for (let page = 1; page <= pages; page++) {
    let rows;
    try {
      rows = await fetchTokentxPage(chain, wallet, page);
    } catch {
      break;
    }
    if (!rows.length) break;
    for (const row of rows) {
      const addr = String(row.contractAddress || "").toLowerCase();
      if (!/^0x[a-f0-9]{40}$/.test(addr)) continue;
      if (!seen.has(addr)) {
        seen.set(addr, {
          address: addr,
          symbol: String(row.tokenSymbol || "").toUpperCase() || "?",
          decimals: Number(row.tokenDecimal || 18),
        });
      }
      if (seen.size >= cap) break;
    }
    if (rows.length < 100) break;
  }
  return [...seen.values()];
}

export async function fetchErc20Balance(chain, wallet, contractAddress) {
  const chainId = CHAIN_IDS[chain];
  const raw = await apiGet({
    chainid: chainId,
    module: "account",
    action: "tokenbalance",
    contractaddress: contractAddress,
    address: wallet,
    tag: "latest",
  });
  return BigInt(raw || 0);
}

/**
 * Все ERC-20 на сети через Free API.
 * @returns {Promise<{address:string,symbol:string,amount:number,chain:string}[]>}
 */
export async function fetchWalletTokensEtherscan(chain, wallet) {
  if (!chainSupported(chain) || !etherscanEnabled()) return [];

  const w = wallet.toLowerCase();
  const out = [];
  const nativeSym = NATIVE_SYMBOL[chain] || "ETH";

  try {
    const wei = await fetchNativeBalance(chain, w);
    const amount = Number(wei) / 1e18;
    if (amount > 1e-12) {
      out.push({ symbol: nativeSym, amount, chain, address: "native", source: "etherscan" });
    }
  } catch {
    /* */
  }

  let contracts = [];
  try {
    contracts = await discoverTokenContracts(chain, w);
  } catch {
    return out;
  }

  for (const c of contracts) {
    try {
      const raw = await fetchErc20Balance(chain, w, c.address);
      if (raw === 0n) continue;
      const amount = Number(raw) / 10 ** (c.decimals || 18);
      if (amount < 1e-12 || amount > 1e12) continue;
      out.push({
        address: c.address,
        symbol: c.symbol,
        amount,
        chain,
        source: "etherscan",
      });
    } catch {
      /* skip token */
    }
  }
  return out;
}

export function getEtherscanUsageStats() {
  const u = loadUsage();
  return { date: u.date, count: u.count, limit: DAILY_LIMIT, remaining: DAILY_LIMIT - u.count };
}
