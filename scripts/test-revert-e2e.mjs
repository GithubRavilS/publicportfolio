#!/usr/bin/env node
/** Проверка Revert API + сопоставление с портфелем. Запуск: node scripts/test-revert-e2e.mjs [wallet] */
import { readFileSync } from "fs";
import { mergeRevertLiquidity } from "../js/revert-portfolio-merge.js";

const wallet = (process.argv[2] || "0x6aF9874250e7250223148e12C811Ea7643Db8A20").toLowerCase();
const base = "http://127.0.0.1:5500";

let revRes = await fetch(`${base}/api/revert?wallet=${wallet}`);
let revJson = await revRes.json();
if (!revJson.ok || !revJson.positions?.length) {
  revRes = await fetch(`${base}/api/revert?wallet=${wallet}&refresh=1`);
  revJson = await revRes.json();
}
if (!revJson.ok) {
  console.error("REVERT API FAIL", revJson);
  process.exit(1);
}
console.log("Revert positions:", revJson.positions?.length ?? 0);

let portfolio;
try {
  const cached = JSON.parse(readFileSync(`.cache/portfolio/${wallet}.json`, "utf8"));
  portfolio = cached.portfolio;
  console.log("Portfolio: disk cache");
} catch {
  const pRes = await fetch(`${base}/api/portfolio?wallet=${wallet}&quick=1`);
  const pJson = await pRes.json();
  portfolio = pJson.portfolio;
  console.log("Portfolio: quick API");
}

mergeRevertLiquidity(portfolio, revJson.positions || []);
const m = portfolio._revertMerge || {};
let total = 0;
let fromRevert = 0;
for (const g of portfolio.protocolGroups || []) {
  for (const p of g.liquidity || []) {
    total++;
    if (p.fromRevert && p.revert) {
      fromRevert++;
      const apy = p.revert.displayApy ?? p.revert.feeApy ?? p.revert.apy;
      console.log(
        `  ✓ ${g.protocol} | ${p.chain} | ${p.pair || p.poolId} | $${p.positionUsd?.toFixed(2)} | APY ${apy?.toFixed(2) ?? "—"}%`,
      );
    }
  }
}
console.log(`\nMerge: ${m.mode} | replaced: ${(m.replacedProtocols || []).join(", ")}`);
console.log(
  `Revert pools on site: ${fromRevert}/${total} (DeBank dex ${m.debankDexCount} / Revert ${m.revertDexCount})`,
);
process.exit(fromRevert > 0 ? 0 : 1);
