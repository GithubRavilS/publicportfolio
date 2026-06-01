#!/usr/bin/env node
/**
 * Сверка onchain-портфеля с DeBank (reference).
 * Usage: node scripts/compare-onchain-debank.mjs 0x...
 */
import { scanOnchainPortfolio } from "../js/onchain-portfolio.js";

const wallet = (process.argv[2] || "").trim();
if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
  console.error("Usage: node scripts/compare-onchain-debank.mjs 0x<wallet>");
  process.exit(1);
}

async function fetchDebank() {
  const { fetchDebankFreeBundle } = await import("../js/debank-free-fetch.js");
  const { buildPortfolioFromDebank } = await import("../js/portfolio-pipeline.js");
  const bundle = await fetchDebankFreeBundle(wallet, { quick: false });
  return buildPortfolioFromDebank(bundle.mainText, { chainTexts: bundle.chainTexts });
}

const [debank, onchain] = await Promise.all([
  fetchDebank(),
  scanOnchainPortfolio(wallet, { quick: false }),
]);

const rows = [
  ["total", debank.totalUsd, onchain.totalUsd],
  ["wallet", debank.walletUsd, onchain.walletUsd],
  ["liquidity", debank.liqUsd, onchain.liqUsd],
  ["lending", debank.lendUsd, onchain.lendUsd],
];

console.log(`\nWallet ${wallet}\n`);
console.log("metric\tdebank\tonchain\tgap%");
for (const [name, d, o] of rows) {
  const gap = d ? Math.round(((o - d) / d) * 1000) / 10 : 0;
  console.log(`${name}\t$${Math.round(d)}\t$${Math.round(o)}\t${gap}%`);
}

const debankChains = new Map((debank.chains || []).map((c) => [c.slug, c.usd]));
const onchainChains = new Map((onchain.chains || []).map((c) => [c.slug, c.usd]));
const allChains = new Set([...debankChains.keys(), ...onchainChains.keys()]);
console.log("\nchains (debank vs onchain):");
for (const ch of [...allChains].sort()) {
  const d = debankChains.get(ch) || 0;
  const o = onchainChains.get(ch) || 0;
  if (d < 1 && o < 1) continue;
  console.log(`  ${ch}\t$${Math.round(d)}\t$${Math.round(o)}`);
}

process.exit(
  Math.abs(onchain.totalUsd - debank.totalUsd) / Math.max(debank.totalUsd, 1) > 0.15 ? 1 : 0,
);
