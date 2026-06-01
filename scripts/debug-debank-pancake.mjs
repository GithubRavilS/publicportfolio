#!/usr/bin/env node
/** До/после: сети Pancake в Jina-scrape vs ownerOf. */
import { fetchDebankFreeBundle } from "../js/debank-free-fetch.js";
import { buildPortfolioFromDebank } from "../js/portfolio-pipeline.js";
import { correctDebankLiquidityChains } from "../js/debank-lp-chains.js";
import { dedupeLiquidityByTokenId } from "../js/debank-parse.js";

const wallet = (process.argv[2] || "0x6942F83A927154f1AAd2C9443061D1B88030e230").trim();

function pancakeRows(p) {
  const rows = [];
  for (const g of p.protocolGroups || []) {
    if (!/pancake/i.test(g.protocol || "")) continue;
    for (const r of g.liquidity || []) {
      rows.push({
        chain: r.chain || g.chain,
        poolId: r.poolId,
        usd: r.positionUsd,
        tokenId: r.tokenId,
      });
    }
  }
  return rows;
}

const bundle = await fetchDebankFreeBundle(wallet, { quick: false });
const raw = buildPortfolioFromDebank(bundle.mainText, { chainTexts: bundle.chainTexts });
const fixed = await correctDebankLiquidityChains(raw, wallet);

console.log("RAW scrape (after tokenId dedupe only):");
for (const r of dedupeLiquidityByTokenId(raw.liquidity || [])) {
  if (!/pancake/i.test(r.protocol || "")) continue;
  console.log(`  ${r.chain}\t${r.poolId}\t$${(r.positionUsd || 0).toFixed(2)}`);
}

console.log("\nAFTER ownerOf chain fix:");
for (const r of pancakeRows(fixed)) {
  console.log(`  ${r.chain}\t${r.poolId}\t$${(r.usd || 0).toFixed(2)}`);
}
