#!/usr/bin/env node
/**
 * Бенчмарк бесплатных источников портфеля (без DeBank OpenAPI).
 * node scripts/benchmark-free-sources.mjs [0xwallet]
 */
import { fetchDebankFreeBundle } from "../js/debank-free-fetch.js";
import { buildPortfolioFromDebank } from "../js/portfolio-pipeline.js";

const WALLET = process.argv[2] || "0x3215e176C249B84941Ae21B488f9BE6e4296E432";

async function timed(name, fn) {
  const t0 = Date.now();
  try {
    const data = await fn();
    return { name, ok: true, ms: Date.now() - t0, ...data };
  } catch (e) {
    return { name, ok: false, ms: Date.now() - t0, err: String(e.message || e).slice(0, 100) };
  }
}

const tests = [
  {
    name: "jina-md-main-only",
    fn: async () => {
      const b = await fetchDebankFreeBundle(WALLET, { quick: true });
      const p = buildPortfolioFromDebank(b.mainText, { chainTexts: {} });
      return {
        fetchMs: b.ms,
        total: p.debankTotalUsd,
        wallet: p.walletUsd,
        liq: p.liqUsd,
        lend: p.lendUsd,
        gap: p.coverageGapUsd,
        liqN: p.liquidity?.length,
        lendN: p.lending?.length,
        walletN: p.walletTokens?.length,
      };
    },
  },
  {
    name: "jina-md-parallel-7chains",
    fn: async () => {
      const b = await fetchDebankFreeBundle(WALLET, { quick: false });
      const p = buildPortfolioFromDebank(b.mainText, { chainTexts: b.chainTexts });
      return {
        fetchMs: b.ms,
        chains: Object.keys(b.chainTexts).length,
        total: p.debankTotalUsd,
        wallet: p.walletUsd,
        liq: p.liqUsd,
        lend: p.lendUsd,
        gap: p.coverageGapUsd,
        computed: p.computedTotalUsd,
        liqN: p.liquidity?.length,
        lendN: p.lending?.length,
        walletN: p.walletTokens?.length,
      };
    },
  },
  {
    name: "revert-jina",
    fn: async () => {
      const t0 = Date.now();
      const r = await fetch(`https://r.jina.ai/https://revert.finance/account/${WALLET}`, {
        headers: { accept: "text/markdown", "X-Return-Format": "markdown" },
        signal: AbortSignal.timeout(90000),
      });
      const text = await r.text();
      return { ms: Date.now() - t0, len: text.length, hasRange: /range/i.test(text) };
    },
  },
];

console.log(`Benchmark wallet: ${WALLET}\n`);
for (const t of tests) {
  const r = await timed(t.name, t.fn);
  console.log(JSON.stringify(r));
}
