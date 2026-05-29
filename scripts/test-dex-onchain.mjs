#!/usr/bin/env node
/**
 * Фактический тест Uni V3 / Pancake V3 / Aerodrome V3 (on-chain only).
 * PT_WALLET=0x... node scripts/test-dex-onchain.mjs
 */
import { scanLpPositions } from "../js/onchain-lp.js";
import { ONCHAIN_DEX_PROTOCOLS } from "../js/lp-position-store.js";
import { SCAN_CHAINS } from "../js/onchain-registry.js";

const WALLET = process.env.PT_WALLET || "0xE6C9B6407676432a95cE23fd414021ED31fC0566";

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

async function main() {
  const t0 = Date.now();
  const positions = await scanLpPositions(WALLET, SCAN_CHAINS);
  const ms = Date.now() - t0;

  const dex = positions.filter((p) => ONCHAIN_DEX_PROTOCOLS.includes(p.protocol));
  if (!dex.length) fail("no DEX LP positions found on base/arb/bsc");

  const report = dex.map((p) => ({
    protocol: p.protocol,
    chain: p.chain,
    tokenId: p.tokenId,
    pair: p.pair,
    positionUsd: +(p.positionUsd || 0).toFixed(2),
    poolAddress: p.poolAddress || null,
    claimableUsd: +(p.claimableUsd || 0).toFixed(4),
    collectedFeesUsd: +(p.collectedFeesUsd || 0).toFixed(4),
    totalFeesUsd: +(p.totalFeesUsd || 0).toFixed(4),
    apyAnnualized: p.apyAnnualized != null ? +p.apyAnnualized.toFixed(2) : null,
    apyRecent: p.apyRecent != null ? +p.apyRecent.toFixed(2) : null,
    hoursOpen: p.hoursOpen != null ? +p.hoursOpen.toFixed(1) : null,
    onchainMetrics: !!p.onchainMetrics,
  }));

  const missingPool = report.filter((r) => !r.poolAddress);
  const missingMetrics = report.filter((r) => !r.onchainMetrics);

  console.log(JSON.stringify({ ok: true, ms, count: report.length, positions: report }, null, 2));

  if (missingMetrics.length) fail(`${missingMetrics.length} positions without onchainMetrics`);
  if (missingPool.length === report.length) fail("all positions missing poolAddress");
}

main().catch((e) => {
  fail(e.message || String(e));
});
