/**
 * Бесплатная загрузка DeBank через Jina Reader (markdown).
 * Быстрее text/plain и содержит Wallet + LP + Lending на одной странице.
 */
import { normalizeDebankInput, parseChainBreakdown } from "./debank-parse.js";

const JINA_HEADERS = {
  accept: "text/markdown, text/plain, */*",
  "X-Return-Format": "markdown",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 PortfolioTracker/1.0",
};

const PRIORITY_CHAINS = ["arb", "base", "op", "eth", "matic", "bsc", "hyperliquid"];
const MAX_CHAINS = Number(process.env.PT_MAX_CHAINS) || 8;
const JINA_TIMEOUT = Number(process.env.PT_JINA_TIMEOUT_MS) || 55000;
const CHAIN_BATCH = Number(process.env.PT_CHAIN_BATCH) || 3;

/** @param {string} wallet @param {string|null} chain */
export function debankPageUrl(wallet, chain = null) {
  const base = `https://debank.com/profile/${wallet}`;
  return chain ? `${base}?chain=${chain}` : base;
}

/** @param {string} pageUrl @param {number} timeoutMs */
export async function fetchJinaMarkdown(pageUrl, timeoutMs = JINA_TIMEOUT) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`https://r.jina.ai/${pageUrl}`, {
      headers: JINA_HEADERS,
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`JINA_${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

function chainsFromMain(mainText) {
  const lines = normalizeDebankInput(mainText).split("\n");
  const fromBreakdown = parseChainBreakdown(lines)
    .filter((c) => (c.usd || 0) > 1 && c.slug && c.slug !== "unknown")
    .map((c) => c.slug);
  if (fromBreakdown.length) return fromBreakdown.slice(0, MAX_CHAINS);
  return PRIORITY_CHAINS.slice(0, Math.min(5, MAX_CHAINS));
}

async function fetchChainsBatched(wallet, chainSlugs) {
  /** @type {Record<string, string>} */
  const chainTexts = {};
  for (let i = 0; i < chainSlugs.length; i += CHAIN_BATCH) {
    const batch = chainSlugs.slice(i, i + CHAIN_BATCH);
    const results = await Promise.all(
      batch.map(async (chain) => {
        try {
          const text = await fetchJinaMarkdown(debankPageUrl(wallet, chain));
          if (text.length >= 250) return { chain, text };
        } catch {
          /* skip */
        }
        return null;
      }),
    );
    for (const r of results) {
      if (r) chainTexts[r.chain] = r.text;
    }
  }
  return chainTexts;
}

/**
 * main → discover chains → parallel chain pages.
 * @param {string} wallet
 * @param {{ chains?: string[], quick?: boolean }} opts
 */
export async function fetchDebankFreeBundle(wallet, opts = {}) {
  const w = wallet.toLowerCase();
  const t0 = Date.now();

  const mainText = await fetchJinaMarkdown(debankPageUrl(w));
  if (!mainText || mainText.length < 400) throw new Error("DEBANK_MAIN_EMPTY");

  /** @type {Record<string, string>} */
  const chainTexts = {};
  if (!opts.quick) {
    const chainSlugs = opts.chains?.length ? opts.chains : chainsFromMain(mainText);
    Object.assign(chainTexts, await fetchChainsBatched(w, chainSlugs));
  }

  return {
    mainText,
    chainTexts,
    ms: Date.now() - t0,
    source: "debank-free-jina",
  };
}
