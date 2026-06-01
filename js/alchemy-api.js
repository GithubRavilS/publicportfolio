/**
 * Alchemy Portfolio API (индексированные токены + NFT), не JSON-RPC getLogs.
 * https://www.alchemy.com/docs/reference/portfolio-apis
 */
import { loadConfig } from "./onchain-rpc.js";

const PORTFOLIO_BASE = "https://api.g.alchemy.com/data/v1";

/** Portfolio API network id → наш chain slug */
export const ALCHEMY_NETWORK = {
  eth: "eth-mainnet",
  base: "base-mainnet",
  arb: "arb-mainnet",
  op: "opt-mainnet",
  optimism: "opt-mainnet",
  matic: "matic-mainnet",
  polygon: "matic-mainnet",
  bsc: "bnb-mainnet",
  bnb: "bnb-mainnet",
  avax: "avax-mainnet",
  avalanche: "avax-mainnet",
  zksync: "zksync-mainnet",
  era: "zksync-mainnet",
  linea: "linea-mainnet",
  scroll: "scroll-mainnet",
  blast: "blast-mainnet",
  gnosis: "gnosis-mainnet",
  ftm: "fantom-mainnet",
  fantom: "fantom-mainnet",
  celo: "celo-mainnet",
  zora: "zora-mainnet",
  worldchain: "worldchain-mainnet",
  mantle: "mantle-mainnet",
  metis: "metis-mainnet",
  cro: "cro-mainnet",
  sonic: "sonic-mainnet",
  mode: "mode-mainnet",
};

const NETWORK_TO_CHAIN = {
  "eth-mainnet": "eth",
  "base-mainnet": "base",
  "arb-mainnet": "arb",
  "opt-mainnet": "op",
  "matic-mainnet": "matic",
  "polygon-mainnet": "matic",
  "bnb-mainnet": "bsc",
  "avax-mainnet": "avax",
  "zksync-mainnet": "era",
  "linea-mainnet": "linea",
  "scroll-mainnet": "scroll",
  "blast-mainnet": "blast",
  "gnosis-mainnet": "gnosis",
  "fantom-mainnet": "ftm",
  "celo-mainnet": "celo",
  "zora-mainnet": "zora",
  "worldchain-mainnet": "worldchain",
  "mantle-mainnet": "mantle",
  "metis-mainnet": "metis",
  "cro-mainnet": "cro",
  "sonic-mainnet": "sonic",
  "mode-mainnet": "mode",
};

const TOKEN_NETS_PER_REQ = 5;
const NFT_NETS_PER_REQ = 15;

export function alchemyApiKey() {
  const cfg = loadConfig();
  const direct = cfg.alchemy_api_key || process.env.ALCHEMY_API_KEY || "";
  if (direct) return String(direct).trim();
  const urls = cfg.rpc_urls || {};
  for (const u of Object.values(urls)) {
    const m = String(u).match(/g\.alchemy\.com\/v2\/([^/?]+)/i);
    if (m?.[1]) return m[1];
  }
  return "";
}

export function alchemyEnabled() {
  return alchemyApiKey().length > 8;
}

/** Все chain slug, для которых есть Portfolio network id */
export function alchemyChainSlugs() {
  const seen = new Set();
  const out = [];
  for (const [slug, net] of Object.entries(ALCHEMY_NETWORK)) {
    if (seen.has(net)) continue;
    seen.add(net);
    out.push(slug);
  }
  return out;
}

/** @param {string} spec comma list or "all" */
export function resolveAlchemyChains(spec) {
  const s = String(spec || "all").trim().toLowerCase();
  if (!s || s === "all" || s === "*") return alchemyChainSlugs();
  return s
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

function chainsToNetworks(chains) {
  const nets = [];
  const seen = new Set();
  for (const c of chains) {
    const n = ALCHEMY_NETWORK[String(c).toLowerCase()];
    if (n && !seen.has(n)) {
      seen.add(n);
      nets.push(n);
    }
  }
  return nets;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function networkToChainSlug(network) {
  const n = String(network || "").toLowerCase();
  if (NETWORK_TO_CHAIN[n]) return NETWORK_TO_CHAIN[n];
  const m = n.match(/^([a-z0-9]+)-/);
  return m ? m[1] : n;
}

async function portfolioPost(path, body) {
  const key = alchemyApiKey();
  if (!key) throw new Error("ALCHEMY_API_KEY_MISSING");
  const r = await fetch(`${PORTFOLIO_BASE}/${key}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`ALCHEMY_JSON:${r.status}`);
  }
  if (!r.ok) {
    const msg =
      typeof json?.message === "string"
        ? json.message
        : typeof json?.error === "string"
          ? json.error
          : text.slice(0, 200);
    throw new Error(`ALCHEMY_HTTP_${r.status}:${msg}`);
  }
  return json;
}

async function portfolioPostSafe(path, body) {
  try {
    return await portfolioPost(path, body);
  } catch {
    return null;
  }
}

function extractTokens(json) {
  const tokens = json?.data?.tokens || json?.data?.tokenBalances || [];
  return Array.isArray(tokens) ? tokens : [];
}

function extractNfts(json) {
  const data = json?.data || {};
  const owned = data.ownedNfts || data.nfts || [];
  return Array.isArray(owned) ? owned : [];
}

/**
 * @param {string} wallet
 * @param {string[] | string} chains slugs or "all"
 */
export async function fetchAlchemyTokens(wallet, chains = "all") {
  const networks = chainsToNetworks(resolveAlchemyChains(chains));
  if (!networks.length) return [];
  const batches = chunk(networks, TOKEN_NETS_PER_REQ);
  const parts = await Promise.all(
    batches.map((nets) =>
      portfolioPostSafe("/assets/tokens/by-address", {
        addresses: [{ address: wallet.toLowerCase(), networks: nets }],
        includeNativeTokens: true,
        includeErc20Tokens: true,
        withMetadata: true,
        withPrices: true,
      }),
    ),
  );
  return parts.filter(Boolean).flatMap(extractTokens);
}

/**
 * @param {string} wallet
 * @param {string[] | string} chains
 */
export async function fetchAlchemyNfts(wallet, chains = "all") {
  const networks = chainsToNetworks(resolveAlchemyChains(chains));
  if (!networks.length) return [];
  const netBatches = chunk(networks, NFT_NETS_PER_REQ);
  const all = [];

  for (const nets of netBatches) {
    let pageKey;
    for (let page = 0; page < 12; page++) {
      const body = {
        addresses: [{ address: wallet.toLowerCase(), networks: nets }],
        withMetadata: true,
        pageSize: 100,
      };
      if (pageKey) body.pageKey = pageKey;
      const json = await portfolioPostSafe("/assets/nfts/by-address", body);
      if (!json) break;
      all.push(...extractNfts(json));
      pageKey = json?.data?.pageKey;
      if (!pageKey) break;
    }
  }
  return all;
}
