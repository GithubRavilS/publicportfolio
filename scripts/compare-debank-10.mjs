#!/usr/bin/env node
/**
 * Сверка API с DeBank: total, число LP, фантомные debankFill, chain=unknown.
 * PT_BASE=https://cry-maden008.pythonanywhere.com/portfolio node scripts/compare-debank-10.mjs
 */
import { normalizePortfolioChains } from "../js/portfolio-normalize.js";
import { isSyntheticLiquidityRow } from "../js/portfolio-dedupe.js";

const WALLETS = (
  process.env.PT_WALLETS ||
  `
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
0x1371c88da1b58ef82d1e7e8a094fa5140e6f6b7c
`
)
  .trim()
  .split(/\s+/)
  .filter((w) => /^0x[a-fA-F0-9]{40}$/i.test(w));

const BASE = process.env.PT_BASE || "http://127.0.0.1:5500";
const TIMEOUT_MS = Number(process.env.PT_TIMEOUT_MS || 120000);

function auditPortfolio(p) {
  const normalized = normalizePortfolioChains(JSON.parse(JSON.stringify(p)));
  let liq = 0;
  let realLiq = 0;
  let fills = 0;
  let unknownChain = 0;
  const rows = [];
  for (const g of normalized.protocolGroups || []) {
    for (const x of g.liquidity || []) {
      liq++;
      const syn = isSyntheticLiquidityRow(x, g.protocol);
      if (syn) fills++;
      else realLiq++;
      if (!x.chain || x.chain === "unknown") unknownChain++;
      rows.push({
        proto: g.protocol,
        chain: x.chain || g.chain,
        pair: x.pair || x.poolId,
        usd: x.positionUsd,
        syn,
      });
    }
  }
  const debank = normalized.debankTotalUsd ?? normalized.totalUsd ?? 0;
  const computed = normalized.computedTotalUsd ?? 0;
  const gapPct = debank > 0 ? Math.abs(debank - computed) / debank : 0;
  return {
    debank,
    computed,
    gapPct,
    liq,
    realLiq,
    fills,
    unknownChain,
    partial: normalized.partial,
    rows,
  };
}

async function fetchPortfolio(wallet) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(
      `${BASE}/api/portfolio?wallet=${encodeURIComponent(wallet)}&quick=1&refresh=1&_=${Date.now()}`,
      { cache: "no-store", signal: ctrl.signal },
    );
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j.portfolio;
  } finally {
    clearTimeout(t);
  }
}

let fail = 0;
console.log(`Base: ${BASE}\n`);

for (const wallet of WALLETS) {
  const short = wallet.slice(0, 10);
  try {
    const raw = await fetchPortfolio(wallet);
    const a = auditPortfolio(raw);
    const ok = a.fills === 0 && a.unknownChain === 0 && a.gapPct < 0.12 && a.realLiq <= 24;
    const tag = ok ? "OK" : "WARN";
    if (!ok) fail++;
    console.log(
      `${tag} ${short} debank=$${a.debank.toFixed(0)} gap=${(a.gapPct * 100).toFixed(1)}% lp=${a.realLiq} fill=${a.fills} unk=${a.unknownChain}`,
    );
    if (!ok) {
      a.rows
        .sort((x, y) => (y.usd || 0) - (x.usd || 0))
        .slice(0, 8)
        .forEach((r) => {
          console.log(
            `    ${r.syn ? "FILL" : "    "} ${r.proto} @${r.chain} ${r.pair} $${(r.usd || 0).toFixed(2)}`,
          );
        });
    }
  } catch (e) {
    fail++;
    console.log(`FAIL ${short}`, e.message || e);
  }
}

process.exit(fail ? 1 : 0);
