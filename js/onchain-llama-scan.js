/**
 * Mass-scan: balanceOf по индексу DeFiLlama yields (500+ протоколов).
 */
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { multicallBalances } from "./onchain-multicall.js";
import { rpcForChain } from "./onchain-rpc.js";
import { fetchPricesUsd, usdValue } from "./onchain-prices.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = resolve(__dir, "../data/llama-yield-index.json");

const SEL_DECIMALS = "0x313ce567";
const SEL_SYMBOL = "0x95d89b41";
const decCache = new Map();
const symCache = new Map();

let indexCache = null;

export function loadYieldIndex() {
  if (indexCache) return indexCache;
  if (!existsSync(INDEX_PATH)) return null;
  try {
    indexCache = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
    return indexCache;
  } catch {
    return null;
  }
}

async function tokenDecimals(rpc, addr) {
  const k = `${rpc}|${addr}`;
  if (decCache.has(k)) return decCache.get(k);
  let d = 18;
  try {
    d = parseInt(await rpc.ethCall(addr, SEL_DECIMALS), 16) || 18;
  } catch {
    /* */
  }
  decCache.set(k, d);
  return d;
}

async function tokenSymbol(rpc, addr, fallback) {
  const k = `${rpc}|${addr}`;
  if (symCache.has(k)) return symCache.get(k);
  let sym = fallback || addr.slice(2, 8).toUpperCase();
  try {
    const symHex = await rpc.ethCall(addr, SEL_SYMBOL);
    if (symHex?.length > 130) {
      const len = parseInt(symHex.slice(66, 130), 16);
      sym = Buffer.from(symHex.slice(130, 130 + len * 2), "hex")
        .toString("utf8")
        .replace(/\0/g, "")
        .toUpperCase();
    }
  } catch {
    /* */
  }
  symCache.set(k, sym);
  return sym;
}

function projectDisplayName(slug, name) {
  if (name && name !== slug) return name;
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function isLiquidityCategory(cat, sym) {
  if (cat === "dex" || cat === "yield") return true;
  return /LP|UNI-V|CURVE|BAL|AMM|\/|-/i.test(sym || "");
}

/**
 * @param {string} wallet
 * @param {string[]} chains
 */
function maxTokensPerChain() {
  if (process.env.PT_FAST === "1") return 350;
  const n = Number(process.env.PT_LLAMA_MAX_PER_CHAIN || 1200);
  return Number.isFinite(n) && n > 0 ? n : 1200;
}

export async function scanLlamaYieldTokens(wallet, chains) {
  if (process.env.PT_LLAMA_WALLET === "0") {
    return { walletTokens: [], liquidity: [], lending: [], projectsHit: [] };
  }
  const index = loadYieldIndex();
  if (!index?.byChain) return { walletTokens: [], liquidity: [], lending: [], projectsHit: [] };

  const cap = maxTokensPerChain();
  const w = wallet.toLowerCase();
  const walletTokens = [];
  const liquidity = [];
  const lending = [];
  const projectsHit = new Set();
  const symbols = new Set();

  for (const chain of chains) {
    const entries = (index.byChain[chain] || []).slice(0, cap);
    if (!entries.length) continue;

    const addresses = entries.map((e) => e.address);
    const balances = await multicallBalances(chain, w, addresses, 60);
    if (!balances.size) continue;

    const rpc = rpcForChain(chain);
    const entryByAddr = new Map(entries.map((e) => [e.address, e]));

    for (const [addr, raw] of balances) {
      const meta = entryByAddr.get(addr);
      if (!meta) continue;
      const dec = await tokenDecimals(rpc, addr);
      const amount = Number(raw) / 10 ** dec;
      if (amount < 1e-12 || amount > 1e15) continue;

      const sym = await tokenSymbol(rpc, addr, meta.symbol?.split("-")[0] || "");
      symbols.add(sym);
      projectsHit.add(meta.project);

      const row = {
        symbol: sym,
        amount: amount.toFixed(amount < 1 ? 6 : 4),
        chain,
        address: addr,
        project: meta.project,
        projectName: projectDisplayName(meta.project, meta.projectName),
        category: meta.category,
        onchain: true,
        source: "llama-token-scan",
      };

      if (isLiquidityCategory(meta.category, meta.symbol)) {
        liquidity.push({
          protocol: row.projectName,
          chain,
          positionUsd: 0,
          pair: meta.symbol || sym,
          poolId: `${meta.project} · ${sym}`,
          onchain: true,
          source: "llama-token-scan",
          _amt: amount,
          _sym: sym,
        });
      } else if (meta.category === "lending") {
        lending.push({
          protocol: row.projectName,
          chain,
          netUsd: 0,
          supplied: [{ asset: sym, amount: row.amount, usd: 0 }],
          borrowed: [],
          onchain: true,
          source: "llama-token-scan",
          _amt: amount,
          _sym: sym,
        });
      } else {
        walletTokens.push({ ...row, price: "—", usd: 0, _amt: amount, _sym: sym });
      }
    }
  }

  const prices = await fetchPricesUsd([...symbols]);
  for (const t of walletTokens) {
    t.usd = usdValue(t._amt, t._sym, prices);
    t.price = prices[t._sym] != null ? `$${prices[t._sym]}` : "—";
    delete t._amt;
    delete t._sym;
  }
  for (const p of liquidity) {
    p.positionUsd = usdValue(p._amt, p._sym, prices);
    delete p._amt;
    delete p._sym;
  }
  for (const p of lending) {
    const u = usdValue(p._amt, p._sym, prices);
    p.netUsd = Math.round(u * 100) / 100;
    if (p.supplied[0]) p.supplied[0].usd = p.netUsd;
    delete p._amt;
    delete p._sym;
  }

  return {
    walletTokens: walletTokens.filter((t) => (t.usd || 0) > 0.01),
    liquidity: liquidity.filter((p) => (p.positionUsd || 0) > 0.01),
    lending: lending.filter((p) => (p.netUsd || 0) > 0.01),
    projectsHit: [...projectsHit],
  };
}
