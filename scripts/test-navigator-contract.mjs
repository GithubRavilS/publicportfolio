import assert from "node:assert/strict";
const { buildPublicPortfolioV2FromNavigator: build } = await import(
  process.argv[2] || new URL("../api/_lib/build-public-portfolio-v2.js", import.meta.url)
);
const scannedAt = "2020-01-01T00:00:00Z";
const cacheUpdatedAt = new Date().toISOString();
const snapshot = {
  ok: true, snapshotId: "contract-fixture", scannedAt,
  updatedAt: cacheUpdatedAt, cacheUpdatedAt, generatedAt: cacheUpdatedAt, refreshStatus: "ok",
  wallets: ["fixture"], historyDaily: [],
  totals: { totalUsd: 120, liquidityUsd: 100, collateralUsd: 10, yieldUsd: 10 },
  walletPacks: [{
    address: "fixture", kind: "evm", scannedAt, updatedAt: cacheUpdatedAt,
    summary: {}, lendingPositions: [{protocol:"Fixture Lend", collateralUsd:10}], yieldPositions: [{protocol:"Fixture Yield", valueUsd:10}],
    liquidityPositions: [{
      positionId: "fixture-position", chain: "fixture", platform: "Fixture DEX",
      pair: "TOKEN/USD", valueUsd: 100, displayApr: 0.25,
      rateKind: "APR", rateSource: "computed", ratePeriod: "current",
      feeTierPct: 0.045, feeSource: "position-manager", dynamicFee: false,
      rangeMin: 1000, rangeMax: 3000, rangeQuote: "USD/TOKEN"
    }]
  }]
};
const result = build(snapshot, { log() {}, liveFromEndpoint: true });
assert.equal(result.meta.updatedAt, scannedAt);
assert.equal(result.meta.scannedAt, scannedAt);
assert.equal(result.meta.cacheUpdatedAt, cacheUpdatedAt);
assert.equal(result.meta.generatedAt, cacheUpdatedAt);
assert.equal(result.meta.refreshStatus, "ok");
assert.equal(result.meta.stale, true);
assert.equal(result.meta.complete, true);
const lp = result.positions.find(p => p.type === "liquidity");
assert.equal(lp.details.sourceTimestamp, scannedAt);
assert.equal(lp.details.feeSource, "position-manager");
assert.equal(lp.details.feeTierPct, 0.045);
assert.equal(lp.details.dynamicFee, false);
assert.equal(lp.ratePct, 0.25);
assert.equal(lp.details.rateKind, "APR");
assert.equal(lp.details.rangeMin, 1000);
assert.equal(lp.details.rangeMax, 3000);
console.log("PASS: scan freshness is independent of cache writes; LP rates, ranges and fee provenance survive mapping.");
