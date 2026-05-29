#!/usr/bin/env node
/** stdin: DeBank text → stdout: portfolio JSON (ESM, без inline -e) */
import { buildPortfolioFromDebank } from "../js/portfolio-pipeline.js";

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const text = Buffer.concat(chunks).toString("utf8");
const showSmall = process.env.PT_SHOW_SMALL === "1";
let chainTexts = {};
if (process.env.PT_CHAIN_TEXTS) {
  try {
    chainTexts = JSON.parse(process.env.PT_CHAIN_TEXTS);
  } catch {
    chainTexts = {};
  }
}

const p = buildPortfolioFromDebank(text, {
  showSmallBalances: showSmall,
  chainTexts,
});
process.stdout.write(
  JSON.stringify({
    totalUsd: p.totalUsd,
    debankTotalUsd: p.debankTotalUsd,
    walletUsd: p.walletUsd,
    liqUsd: p.liqUsd,
    lendUsd: p.lendUsd,
    computedTotalUsd: p.computedTotalUsd,
    coverageGapUsd: p.coverageGapUsd,
    partial: p.partial,
    chains: p.chains,
    protocolTabs: p.protocolTabs,
    protocolGroups: p.protocolGroups,
    lending: p.lending,
    liquidity: p.liquidity,
    walletTokens: p.walletTokens,
    walletByChain: p.walletByChain,
    hasSmallBalanceHint: p.hasSmallBalanceHint,
  }),
);
