#!/usr/bin/env node
/**
 * Сверка: onchain-only vs hybrid vs DeBank (Jina, бесплатно).
 * PT_FAST=1 — укороченный llama-scan
 */
import { scanOnchainPortfolio } from "../js/onchain-portfolio.js";
import { mergeHybridPortfolio } from "../js/portfolio-hybrid-merge.js";
import { fetchDebankFreeBundle } from "../js/debank-free-fetch.js";
import { buildPortfolioFromDebank } from "../js/portfolio-pipeline.js";

const WALLETS = `
0xE6C9B6407676432a95cE23fd414021ED31fC0566
0x6aF9874250e7250223148e12C811Ea7643Db8A20
0x1fb07ac5643428710ee3bf5a73a4a66d0762f355
0x6942F83A927154f1AAd2C9443061D1B88030e230
0x6627409A5F314ECFdDd7e5F4A2C8d49832104E02
0x758A412c099db81d6C3295dce75dcA02D1721311
0x3215e176C249B84941Ae21B488f9BE6e4296E432
0xAb84e63aaecF78cd31d0B72cE5378FEdAaFE1220
0x754F7FEB4d0A75beC8f6914f1F6f09EE9fe00606
0x857421C02a31Db043C068bECc437AFa6D234C30E
`
  .trim()
  .split(/\s+/)
  .filter((w) => /^0x[a-fA-F0-9]{40}$/i.test(w));

function pct(a, b) {
  if (!b || b <= 0) return "—";
  return `${Math.round((a / b) * 1000) / 10}%`;
}

function gapPct(debank, computed) {
  if (!debank || debank <= 0) return 0;
  return Math.abs(debank - computed) / debank;
}

console.log(`Wallets: ${WALLETS.length} | PT_FAST=${process.env.PT_FAST || "0"}\n`);
console.log(
  "wallet".padEnd(12),
  "debank".padStart(10),
  "onchain".padStart(10),
  "hybrid".padStart(10),
  "on%/db".padStart(8),
  "hy%/db".padStart(8),
  "gapHy".padStart(8),
);
console.log("-".repeat(72));

let sumDb = 0;
let sumOc = 0;
let sumHy = 0;
let n = 0;

for (const wallet of WALLETS) {
  const short = `${wallet.slice(0, 6)}…`;
  let debank = null;
  try {
    const bundle = await fetchDebankFreeBundle(wallet, { quick: false });
    debank = buildPortfolioFromDebank(bundle.mainText, {
      showSmallBalances: false,
      chainTexts: bundle.chainTexts || {},
    });
  } catch (e) {
    console.log(short.padEnd(12), "DEBANK_FAIL", e.message?.slice(0, 40));
    continue;
  }

  let onchain;
  try {
    onchain = await scanOnchainPortfolio(wallet, { includeVaults: true });
  } catch (e) {
    console.log(short.padEnd(12), "ONCHAIN_FAIL", e.message?.slice(0, 40));
    continue;
  }

  const hybrid = mergeHybridPortfolio(onchain, debank);
  const db = debank.debankTotalUsd ?? debank.totalUsd ?? 0;
  const oc = onchain.totalUsd ?? 0;
  const hy = hybrid.debankTotalUsd ?? hybrid.totalUsd ?? 0;
  const gHy = gapPct(db, hybrid.computedTotalUsd ?? hy);

  sumDb += db;
  sumOc += oc;
  sumHy += db;
  n++;

  console.log(
    short.padEnd(12),
    `$${Math.round(db)}`.padStart(10),
    `$${Math.round(oc)}`.padStart(10),
    `$${Math.round(hy)}`.padStart(10),
    pct(oc, db).padStart(8),
    pct(hybrid.computedTotalUsd ?? hy, db).padStart(8),
    `${(gHy * 100).toFixed(1)}%`.padStart(8),
  );
}

if (n) {
  console.log("-".repeat(72));
  console.log(
    "AVG".padEnd(12),
    `$${Math.round(sumDb / n)}`.padStart(10),
    `$${Math.round(sumOc / n)}`.padStart(10),
    `$${Math.round(sumHy / n)}`.padStart(10),
    pct(sumOc / n, sumDb / n).padStart(8),
    "hybrid≈db".padStart(8),
  );
}
