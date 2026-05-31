#!/usr/bin/env node
/**
 * Smoke: Etherscan Free wallet tokens (eth + arb + matic).
 * Usage: node scripts/test-etherscan-wallet.mjs 0x...
 */
import { scanWalletBalances } from "../js/onchain-wallet.js";
import { getEtherscanUsageStats, etherscanEnabled } from "../js/etherscan-api.js";

const wallet = process.argv[2];
if (!wallet?.startsWith("0x")) {
  console.error("Usage: node scripts/test-etherscan-wallet.mjs 0x...");
  process.exit(1);
}

if (!etherscanEnabled()) {
  console.error("Set etherscan_api_key in config.json");
  process.exit(1);
}

const chains = ["eth", "arb", "matic"];
const t0 = Date.now();
const { walletTokens } = await scanWalletBalances(wallet, chains);
const usd = walletTokens.reduce((s, t) => s + (t.usd || 0), 0);
console.log(JSON.stringify({ ms: Date.now() - t0, chains, tokens: walletTokens.length, usd, usage: getEtherscanUsageStats() }, null, 2));
for (const t of walletTokens.filter((x) => (x.usd || 0) > 0.01).slice(0, 15)) {
  console.log(`  ${t.chain} ${t.symbol} $${(t.usd || 0).toFixed(2)}`);
}
