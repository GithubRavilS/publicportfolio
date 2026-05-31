#!/usr/bin/env node
/**
 * Индекс токенов DeFiLlama yields (~500+ проектов, 10k+ контрактов) для mass balanceOf scan.
 */
import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, "../data/llama-yield-index.json");
const REGISTRY_OUT = resolve(__dir, "../data/llama-adapter-registry.json");

const LLAMA_CHAIN_TO_SLUG = {
  Ethereum: "eth",
  Base: "base",
  Arbitrum: "arb",
  Optimism: "op",
  Polygon: "matic",
  BSC: "bsc",
  Binance: "bsc",
  Avalanche: "avax",
  Scroll: "scroll",
  Linea: "linea",
  Blast: "blast",
  Gnosis: "gnosis",
  xDai: "gnosis",
  Fantom: "ftm",
  Celo: "celo",
  Cronos: "cro",
  Metis: "metis",
  Mode: "mode",
  Sonic: "sonic",
  Zora: "zora",
  Mantle: "mantle",
  "zkSync Era": "era",
  Moonbeam: "movr",
  Moonriver: "movr",
};

const CATEGORY_RE = {
  lending: /lend|borrow|cdp|morpho|aave|compound|spark|venus|maple/i,
  dex: /dex|amm|swap|uni|curve|balancer|sushi|pancake|aerodrome|velodrome|orca|raydium/i,
  liquid_staking: /lido|liquid.?stak|steth|rocket|ether\.?fi|stake|lst|binance-staked/i,
  restaking: /eigen|restak|symbiotic|karak|babylon/i,
  staking: /staking|ssv|stake/i,
  yield: /yield|vault|yearn|beefy|convex|pendle/i,
};

function categorize(project, name, categoryHint) {
  const s = `${project} ${name} ${categoryHint || ""}`;
  for (const [cat, re] of Object.entries(CATEGORY_RE)) {
    if (re.test(s)) return cat;
  }
  return "other";
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

const [protocols, poolsRes] = await Promise.all([
  fetchJson("https://api.llama.fi/protocols"),
  fetchJson("https://yields.llama.fi/pools"),
]);

const projectMeta = new Map();
for (const p of protocols) {
  const slug = p.slug || p.name?.toLowerCase().replace(/\s+/g, "-");
  if (!slug) continue;
  projectMeta.set(slug, {
    name: p.name,
    category: p.category || "",
    tvlUsd: Math.round(p.tvl || 0),
  });
}

const pools = poolsRes.data || [];
const tokenMap = new Map();
const projectSet = new Set();

for (const pool of pools) {
  const slug = pool.project;
  if (!slug) continue;
  projectSet.add(slug);
  const chainSlug = LLAMA_CHAIN_TO_SLUG[pool.chain];
  if (!chainSlug) continue;
  const tvl = pool.tvlUsd || 0;
  if (tvl < 5000) continue;

  const meta = projectMeta.get(slug) || { name: slug, category: "", tvlUsd: 0 };
  const cat = categorize(slug, meta.name, meta.category);

  for (const addr of pool.underlyingTokens || []) {
    const a = String(addr).toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(a)) continue;
    const key = `${chainSlug}|${a}`;
    const prev = tokenMap.get(key);
    if (!prev || tvl > prev.poolTvlUsd) {
      tokenMap.set(key, {
        chain: chainSlug,
        address: a,
        project: slug,
        projectName: meta.name || slug,
        category: cat,
        symbol: pool.symbol || "",
        poolTvlUsd: Math.round(tvl),
      });
    }
  }
}

const tokens = [...tokenMap.values()].sort((a, b) => b.poolTvlUsd - a.poolTvlUsd);
const byChain = {};
for (const t of tokens) {
  if (!byChain[t.chain]) byChain[t.chain] = [];
  byChain[t.chain].push(t);
}
for (const ch of Object.keys(byChain)) {
  byChain[ch] = byChain[ch].slice(0, 2500);
}

const adapters = [];
for (const slug of projectSet) {
  const meta = projectMeta.get(slug) || { name: slug, category: "", tvlUsd: 0 };
  adapters.push({
    slug,
    name: meta.name || slug,
    adapter: "llama_token_scan",
    category: categorize(slug, meta.name, meta.category),
    tvlUsd: meta.tvlUsd,
    implemented: true,
  });
}
adapters.sort((a, b) => b.tvlUsd - a.tvlUsd);

const registry = {
  builtAt: new Date().toISOString(),
  adapterCount: adapters.length,
  tokenIndexCount: tokens.length,
  adapters,
};

const index = {
  builtAt: registry.builtAt,
  stats: {
    poolsScanned: pools.length,
    projects: projectSet.size,
    tokens: tokens.length,
    chains: Object.keys(byChain).length,
  },
  byChain,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(index));
writeFileSync(REGISTRY_OUT, JSON.stringify(registry));
console.log("yield-index", index.stats);
console.log("adapters", registry.adapterCount, "->", REGISTRY_OUT);
