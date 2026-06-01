#!/usr/bin/env node
/** stdout: portfolio JSON via free Jina markdown (no DeBank API key) */
import { fetchDebankFreeBundle } from "../js/debank-free-fetch.js";
import { buildPortfolioFromDebank } from "../js/portfolio-pipeline.js";

const wallet = process.argv[2];
const quick = process.env.PT_QUICK === "1";
const showSmall = process.env.PT_SHOW_SMALL === "1";

if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
  process.stderr.write("usage: fetch-debank-free.mjs 0x...\n");
  process.exit(1);
}

try {
  const bundle = await fetchDebankFreeBundle(wallet, { quick });
  const { correctDebankLiquidityChains } = await import("../js/debank-lp-chains.js");
  let p = buildPortfolioFromDebank(bundle.mainText, {
    showSmallBalances: showSmall,
    chainTexts: bundle.chainTexts,
  });
  p = await correctDebankLiquidityChains(p, wallet);
  p.fromFreeFetch = true;
  p.fetchSource = bundle.source;
  p.fetchMs = bundle.ms;
  p.partial = quick || Object.keys(bundle.chainTexts).length < 3;
  process.stdout.write(JSON.stringify(p));
} catch (e) {
  process.stderr.write(String(e.message || e));
  process.exit(1);
}
