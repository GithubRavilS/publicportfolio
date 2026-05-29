#!/usr/bin/env node
/** stdin: portfolio JSON, argv[2]: wallet → stdout: portfolio with on-chain ranges */
import { scanAndEnrich } from "../js/lp-onchain.js";
import { flattenPortfolioLiquidity, applyEnrichedLpRanges } from "../js/portfolio-range-apply.js";
import { syncDisplayTotals } from "../js/portfolio-normalize.js";

const wallet = (process.argv[2] || "").trim();
if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
  process.stderr.write("INVALID_WALLET\n");
  process.exit(1);
}

let portfolio = {};
try {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw) portfolio = JSON.parse(raw);
} catch (e) {
  process.stderr.write(`PARSE_FAIL:${e.message}\n`);
  process.exit(1);
}

const flat = flattenPortfolioLiquidity(portfolio);
if (!flat.length) {
  process.stdout.write(JSON.stringify(portfolio));
  process.exit(0);
}

const { positions } = await scanAndEnrich(wallet, flat);
applyEnrichedLpRanges(portfolio, positions);
syncDisplayTotals(portfolio);
process.stdout.write(JSON.stringify(portfolio));
