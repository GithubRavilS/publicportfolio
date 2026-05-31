/**
 * Данные с блок-эксплореров (Etherscan / Basescan / Arbiscan …) через r.jina.ai — без API-ключей.
 */
import { CHAIN_IDS } from "./onchain-registry.js";

export const EXPLORER_HOST = {
  eth: "https://etherscan.io",
  base: "https://basescan.org",
  arb: "https://arbiscan.io",
  op: "https://optimistic.etherscan.io",
  matic: "https://polygonscan.com",
  bsc: "https://bscscan.com",
  avax: "https://snowtrace.io",
  scroll: "https://scrollscan.com",
  linea: "https://lineascan.build",
  blast: "https://blastscan.io",
  gnosis: "https://gnosisscan.io",
  era: "https://era.zksync.network",
  mantle: "https://mantlescan.xyz",
  ftm: "https://ftmscan.com",
  celo: "https://celoscan.io",
  cro: "https://cronoscan.com",
  metis: "https://andromeda-explorer.metis.io",
  mode: "https://explorer.mode.network",
  sonic: "https://sonicscan.org",
  zora: "https://explorer.zora.energy",
};

const cache = new Map();
const CACHE_MS = 10 * 60 * 1000;

export function explorerAddressUrl(chain, wallet) {
  const host = EXPLORER_HOST[chain];
  if (!host) return null;
  return `${host}/address/${wallet}`;
}

export async function fetchExplorerMarkdown(url, timeoutMs = 55000) {
  const key = url;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.text;

  const jina = `https://r.jina.ai/${url}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(jina, {
      signal: ctrl.signal,
      headers: {
        Accept: "text/plain",
        "User-Agent": "PortfolioTracker/1.0",
        "X-Return-Format": "text",
      },
    });
    const text = await r.text();
    if (!text || text.length < 200) throw new Error("EXPLORER_EMPTY");
    cache.set(key, { text, at: Date.now() });
    return text;
  } finally {
    clearTimeout(t);
  }
}

/** ERC-20 из страницы address (таблица токенов на эксплорере). */
export function parseExplorerTokenBalances(text, chain) {
  const out = [];
  const seen = new Set();
  const lines = String(text || "").split(/\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const m = line.match(
      /^([A-Za-z0-9.$+-]{2,12})\s+([\d,]+\.?\d*)\s*$|^\|\s*([A-Za-z0-9.$+-]{2,12})\s*\|\s*([\d,]+\.?\d*)/,
    );
    if (!m) continue;
    const sym = (m[1] || m[3] || "").toUpperCase();
    const amt = parseFloat((m[2] || m[4] || "0").replace(/,/g, ""));
    if (!sym || !Number.isFinite(amt) || amt <= 0 || amt > 1e9) continue;
    if (sym.length > 10) continue;
    if (["ETH", "USD", "EUR", "API", "TXN", "AGE"].includes(sym)) continue;
    const k = `${chain}|${sym}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ symbol: sym, amount: amt, chain, source: "explorer" });
  }
  const alt = text.matchAll(/([A-Z][A-Z0-9]{1,10})\s*\(([^)]+)\)[^\d]*([\d,]+\.?\d*)/g);
  for (const m of alt) {
    const sym = m[1].toUpperCase();
    const amt = parseFloat(m[3].replace(/,/g, ""));
    if (!Number.isFinite(amt) || amt <= 0 || amt > 1e9) continue;
    if (sym.length > 10) continue;
    const k = `${chain}|${sym}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ symbol: sym, amount: amt, chain, source: "explorer" });
  }
  return out;
}

export async function fetchExplorerWalletTokens(chain, wallet) {
  const url = explorerAddressUrl(chain, wallet);
  if (!url || !CHAIN_IDS[chain]) return [];
  try {
    const text = await fetchExplorerMarkdown(url);
    return parseExplorerTokenBalances(text, chain);
  } catch {
    return [];
  }
}
