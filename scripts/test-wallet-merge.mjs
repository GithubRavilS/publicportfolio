#!/usr/bin/env node
/** Полный тест merge Revert на кошельке 0xE6C9…0566 */
import { readFileSync, existsSync } from "fs";
import { mergeRevertLiquidity } from "../js/revert-portfolio-merge.js";

const WALLET = (process.argv[2] || "0xE6C9B6407676432a95cE23fd414021ED31fC0566").toLowerCase();
const BASE = process.env.PT_BASE || "http://127.0.0.1:5500";

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
  } else {
    console.log("OK:", msg);
  }
}

async function loadRevertPositions() {
  try {
    const r = await fetch(`${BASE}/api/revert?wallet=${WALLET}&_=${Date.now()}`, {
      cache: "no-store",
    });
    const d = await r.json();
    if (d.ok && d.positions?.length) return { positions: d.positions, source: "api" };
  } catch {
    /* */
  }
  const path = `.cache/revert/${WALLET}.json`;
  if (existsSync(path)) {
    const positions = JSON.parse(readFileSync(path, "utf8")).positions || [];
    if (positions.length) return { positions, source: "disk-cache" };
  }
  return { positions: [], source: "none" };
}

async function loadPortfolio() {
  try {
    const r = await fetch(`${BASE}/api/portfolio?wallet=${WALLET}&_=${Date.now()}`, {
      cache: "no-store",
    });
    const d = await r.json();
    if (d.ok && d.portfolio) return { portfolio: d.portfolio, source: "api" };
  } catch {
    /* */
  }
  const path = `.cache/portfolio/${WALLET}.json`;
  if (existsSync(path)) {
    return {
      portfolio: JSON.parse(readFileSync(path, "utf8")).portfolio,
      source: "disk-cache",
    };
  }
  return { portfolio: null, source: "none" };
}

const { positions, source: revSrc } = await loadRevertPositions();
const { portfolio, source: portSrc } = await loadPortfolio();

console.log(`Wallet: ${WALLET}`);
console.log(`Portfolio: ${portSrc} | Revert: ${revSrc} (${positions.length} positions)\n`);

assert(portfolio, "portfolio loaded");
assert(positions.length >= 10, `revert has >=10 positions (got ${positions.length})`);

if (!portfolio || !positions.length) {
  process.exit(1);
}

mergeRevertLiquidity(portfolio, positions);
const m = portfolio._revertMerge;

assert(m.mode === "sum-platforms" || m.mode === "revert-all", `merge mode (${m.mode})`);
assert(m.revertPositionsLoaded >= 10, `revert positions loaded (${m.revertPositionsLoaded})`);

let fromRevert = 0;
let withApy = 0;
let withRange = 0;
for (const g of portfolio.protocolGroups) {
  for (const p of g.liquidity || []) {
    if (p.fromRevert && p.revert) {
      fromRevert++;
      if (p.revert.displayApy != null || p.revert.apy != null) withApy++;
      if (p.revert.rangeMin != null) withRange++;
    }
  }
}

assert(fromRevert >= 10, `>=10 pools from Revert (got ${fromRevert})`);
assert(withApy >= 6, `>=6 pools with APY (got ${withApy})`);
assert(withRange >= 5, `>=5 pools with range bar (got ${withRange})`);
assert(m.revertPoolsOnSite === fromRevert, "revertPoolsOnSite matches count");

console.log("\n--- Pools from Revert ---");
for (const g of portfolio.protocolGroups) {
  for (const p of g.liquidity || []) {
    if (!p.fromRevert) continue;
    const apy = p.revert.displayApy ?? p.revert.apy;
    console.log(
      `  ${g.protocol} | ${p.chain} | ${p.pair} | $${p.positionUsd?.toFixed(2)} | APY ${apy?.toFixed(1) ?? "—"}%`,
    );
  }
}

console.log(
  `\nMerge: ${m.mode} | sumMatched: ${m.sumMatched} | USD ${m.debankDexUsd?.toFixed(2)} / ${m.revertDexUsd?.toFixed(2)}`,
);
const totalPools = (portfolio.protocolGroups || []).reduce(
  (n, g) => n + (g.liquidity || []).length,
  0,
);
console.log(`Revert on site: ${fromRevert}/${totalPools} | loaded ${m.revertPositionsLoaded}`);

process.exit(failed ? 1 : 0);
