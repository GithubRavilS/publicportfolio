#!/usr/bin/env node
/**
 * Качество портфеля: LP только на реальной сети (ownerOf), без arb/eth фантомов.
 * node scripts/verify-wallet-quality.mjs 0x6942...
 */
import { scanOnchainPortfolio } from "../js/onchain-portfolio.js";
import { extractLpTokenId } from "../js/lp-onchain.js";
import { verifyLpTokenOwners } from "../js/portfolio-onchain-finalize.js";

const wallet = (process.argv[2] || "0x6942F83A927154f1AAd2C9443061D1B88030e230").trim();
if (!/^0x[a-fA-F0-9]{40}$/i.test(wallet)) {
  console.error("Usage: node scripts/verify-wallet-quality.mjs 0xWallet");
  process.exit(1);
}

process.env.PT_QUICK = process.env.PT_QUICK || "0";

console.log("Scan onchain (full)…");
const p = await scanOnchainPortfolio(wallet, { quick: false });

const badChains = new Set(["arb", "eth"]);
const liq = [];
for (const g of p.protocolGroups || []) {
  for (const row of g.liquidity || []) {
    liq.push({ protocol: g.protocol, chain: g.chain, ...row });
  }
}

console.log("\nLP positions:", liq.length);
let fails = 0;
for (const row of liq) {
  const tid = extractLpTokenId(row);
  const line = `${row.chain}\t${row.protocol}\t${row.pair || row.poolId}\t$${(row.positionUsd || 0).toFixed(2)}\t#${tid || "?"}`;
  console.log(line);
  if (badChains.has(String(row.chain || "").toLowerCase()) && row.protocol?.includes("Pancake")) {
    console.error("  FAIL: Pancake on wrong chain (expected base)");
    fails++;
  }
  if (tid === "2023595" && row.chain !== "base") {
    console.error("  FAIL: #2023595 must be base only");
    fails++;
  }
}

const tids = [...new Set(liq.map((r) => extractLpTokenId(r)).filter(Boolean))];
const verified = await verifyLpTokenOwners(wallet, tids);
console.log(
  "\nownerOf verified:",
  [...verified.entries()].map(([id, v]) => `${id}→${v.chain}`).join(", "),
);

const dup = liq.filter((r) => extractLpTokenId(r) === "2023595");
if (dup.length > 1) {
  console.error("FAIL: duplicate #2023595 rows:", dup.map((d) => d.chain).join(","));
  fails++;
}

const bsc = (p.walletTokens || []).filter((t) => t.chain === "bsc" && t.symbol === "USDC");
if (bsc.length && (bsc[0].usd || 0) > 1) {
  console.error("FAIL: phantom BSC USDC", bsc[0]);
  fails++;
}

console.log("\nTotals: $", p.totalUsd, "liq $", p.liqUsd, "wallet $", p.walletUsd);
console.log("onchainVerified:", p.onchainVerified, "schema:", p.schemaVersion);

if (fails) {
  console.error(`\n${fails} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll quality checks passed.");
