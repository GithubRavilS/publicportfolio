#!/usr/bin/env node
import { buildHybridFastPortfolio } from "../js/hybrid-portfolio.js";

const wallet = (process.argv[2] || "").trim();
if (!/^0x[a-fA-F0-9]{40}$/i.test(wallet)) {
  process.stderr.write("Usage: node scripts/run-hybrid-fast.mjs 0xWallet\n");
  process.exit(1);
}

const portfolio = await buildHybridFastPortfolio(wallet);
process.stdout.write(JSON.stringify({ ok: true, portfolio }));
