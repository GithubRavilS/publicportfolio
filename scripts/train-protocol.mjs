#!/usr/bin/env node
/**
 * Обучение / сверка одного протокола: on-chain vs DeBank (+ Revert для LP).
 *
 *   node scripts/train-protocol.mjs uniswap-v3 0xWallet [0xWallet2 ...]
 *   node scripts/train-protocol.mjs --list
 *   node scripts/train-protocol.mjs uniswap-v3 --wallets scripts/training-wallets.txt
 */
import { readFileSync } from "fs";
import { scanProtocolPositions } from "../js/protocols/scan.js";
import {
  getProtocol,
  listProtocols,
  DEFAULT_TRAINING_WALLETS,
} from "../js/protocols/registry.js";
import {
  extractDebankPositions,
  extractRevertPositions,
  comparePositionSets,
  formatCompareReport,
} from "../js/protocol-compare.js";

const args = process.argv.slice(2);
if (!args.length || args[0] === "--help" || args[0] === "-h") {
  console.log(`Usage:
  node scripts/train-protocol.mjs --list
  node scripts/train-protocol.mjs <protocol-id> 0x... [0x...]
  node scripts/train-protocol.mjs <protocol-id> --wallets path.txt

Protocols: ${listProtocols()
    .map((p) => p.id)
    .join(", ")}`);
  process.exit(0);
}

if (args[0] === "--list") {
  console.log("Protocol training queue:\n");
  for (const p of listProtocols()) {
    console.log(`  ${p.id.padEnd(18)} ${p.status.padEnd(10)} ${p.name} (${p.type})`);
  }
  process.exit(0);
}

const protocolId = args[0];
let wallets = args.slice(1).filter((a) => /^0x[a-fA-F0-9]{40}$/.test(a));

const wIdx = args.indexOf("--wallets");
if (wIdx >= 0 && args[wIdx + 1]) {
  const text = readFileSync(args[wIdx + 1], "utf8");
  wallets = text
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => /^0x[a-fA-F0-9]{40}$/.test(s));
}

if (!wallets.length) wallets = [...DEFAULT_TRAINING_WALLETS];

const def = getProtocol(protocolId);
const type = def.type === "lending" ? "lending" : "liquidity";

async function fetchDebank(wallet) {
  const { fetchDebankFreeBundle } = await import("../js/debank-free-fetch.js");
  const { buildPortfolioFromDebank } = await import("../js/portfolio-pipeline.js");
  const { correctDebankLiquidityChains } = await import("../js/debank-lp-chains.js");
  const bundle = await fetchDebankFreeBundle(wallet, { quick: false });
  let p = buildPortfolioFromDebank(bundle.mainText, { chainTexts: bundle.chainTexts });
  p = await correctDebankLiquidityChains(p, wallet);
  return p;
}

async function fetchRevert(wallet) {
  const { parseRevertAccountText } = await import("../js/revert-parse.js");
  const url = `https://r.jina.ai/${encodeURIComponent(`https://revert.finance/account/${wallet}`)}`;
  const r = await fetch(url, {
    headers: { Accept: "text/plain, */*" },
    signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) return [];
  return parseRevertAccountText(await r.text());
}

console.log(`\nTrain ${def.name} (${protocolId}) · ${wallets.length} wallet(s)\n`);

let passed = 0;
let failed = 0;

for (const wallet of wallets) {
  process.stdout.write(`${wallet} … `);
  try {
    const [onchain, debank] = await Promise.all([
      scanProtocolPositions(protocolId, wallet),
      fetchDebank(wallet),
    ]);
    const debankRows = extractDebankPositions(debank, def.debankPatterns, type);
    const result = comparePositionSets(onchain, debankRows, { usdTolerancePct: 15 });
    console.log(formatCompareReport(def.name, wallet, result));

    if (def.revertPatterns && type === "liquidity") {
      try {
        const rev = await fetchRevert(wallet);
        const revRows = extractRevertPositions(rev, def.revertPatterns);
        const revCmp = comparePositionSets(onchain, revRows, { usdTolerancePct: 20 });
        console.log(
          `  vs Revert: on $${revCmp.onchainUsd} rev $${revCmp.debankUsd} gap ${revCmp.totalGapPct}% ${revCmp.pass ? "OK" : "DIFF"}`,
        );
      } catch (e) {
        console.log(`  vs Revert: skip (${e.message})`);
      }
    }

    if (result.pass) passed++;
    else failed++;
  } catch (e) {
    console.log(`ERROR ${e.message}\n`);
    failed++;
  }
}

console.log(`\nSummary: ${passed} passed, ${failed} failed / ${wallets.length}`);
process.exit(failed > 0 ? 1 : 0);
