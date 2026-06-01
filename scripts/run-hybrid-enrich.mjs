#!/usr/bin/env node
import { readFileSync } from "fs";
import { buildHybridEnrichedPortfolio } from "../js/hybrid-portfolio.js";

const wallet = (process.argv[2] || "").trim();
const fastPath = process.argv[3];
if (!/^0x[a-fA-F0-9]{40}$/i.test(wallet)) {
  process.stderr.write("Usage: node scripts/run-hybrid-enrich.mjs 0xWallet [fast.json]\n");
  process.exit(1);
}

let fast = null;
if (fastPath) {
  try {
    fast = JSON.parse(readFileSync(fastPath, "utf8"));
  } catch {
    /* */
  }
}

const portfolio = await buildHybridEnrichedPortfolio(wallet, fast);
process.stdout.write(JSON.stringify({ ok: true, portfolio }));
