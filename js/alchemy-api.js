/**
 * Alchemy Portfolio API (индексированные токены + NFT), не JSON-RPC getLogs.
 * https://www.alchemy.com/docs/reference/portfolio-apis
 */
import { loadConfig } from "./onchain-rpc.js";

const PORTFOLIO_BASE = "https://api.g.alchemy.com/data/v1";

/** @type {Record<string, string>} */
export const ALCHEMY_NETWORK = {
  eth: "eth-mainnet",
  base: "base-mainnet",
  arb: "arb-mainnet",
  op: "opt-mainnet",
  matic: "matic-mainnet",
  polygon: "matic-mainnet",
  bsc: "bnb-mainnet",
};

/** @type {Record<string, string>} */
const NETWORK_TO_CHAIN = Object.fromEntries(
  Object.entries(ALCHEMY_NETWORK).map(([c, n]) => [n, c]),
);

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

function chainsToNetworks(chains) {
  const nets = [];
  for (const c of chains) {
    const n = ALCHEMY_NETWORK[String(c).toLowerCase()];
    if (n && !nets.includes(n)) nets.push(n);
  }
  return nets;
}

export function networkToChainSlug(network) {
  const n = String(network || "").toLowerCase();
  if (NETWORK_TO_CHAIN[n]) return NETWORK_TO_CHAIN[n];
  const m = n.match(/^([a-z]+)-/);
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
    const msg = json?.message || json?.error || text.slice(0, 200);
    throw new Error(`ALCHEMY_HTTP_${r.status}:${msg}`);
  }
  return json;
}

/**
 * @param {string} wallet
 * @param {string[]} chains slugs: base, eth, arb
 */
export async function fetchAlchemyTokens(wallet, chains = ["base", "eth", "arb"]) {
  const networks = chainsToNetworks(chains);
  if (!networks.length) return [];
  const json = await portfolioPost("/assets/tokens/by-address", {
    addresses: [{ address: wallet.toLowerCase(), networks }],
    includeNativeTokens: true,
    includeErc20Tokens: true,
    withMetadata: true,
    withPrices: true,
  });
  const tokens = json?.data?.tokens || json?.data?.tokenBalances || [];
  return Array.isArray(tokens) ? tokens : [];
}

/**
 * @param {string} wallet
 * @param {string[]} chains
 */
export async function fetchAlchemyNfts(wallet, chains = ["base", "eth", "arb"]) {
  const networks = chainsToNetworks(chains);
  if (!networks.length) return [];
  const all = [];
  let pageKey;
  for (let page = 0; page < 8; page++) {
    const body = {
      addresses: [{ address: wallet.toLowerCase(), networks }],
      withMetadata: true,
      pageSize: 100,
    };
    if (pageKey) body.pageKey = pageKey;
    const json = await portfolioPost("/assets/nfts/by-address", body);
    const data = json?.data || {};
    const owned = data.ownedNfts || data.nfts || [];
    if (Array.isArray(owned)) all.push(...owned);
    pageKey = data.pageKey;
    if (!pageKey) break;
  }
  return all;
}
