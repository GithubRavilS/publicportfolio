#!/usr/bin/env node
import { scanOnchainPortfolio } from "../js/onchain-portfolio.js";

const wallet = (process.argv[2] || "").trim();
if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
  process.stderr.write("Usage: node scripts/run-onchain-portfolio.mjs 0xWallet\n");
  process.exit(1);
}

const portfolio = await scanOnchainPortfolio(wallet);
process.stdout.write(JSON.stringify({ ok: true, portfolio }));
