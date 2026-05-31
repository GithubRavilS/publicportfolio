#!/usr/bin/env node
/**
 * 10 wallets: PA hybrid vs PA debank (refresh).
 * PT_BASE=https://cry-maden008.pythonanywhere.com/portfolio
 */
const BASE = (process.env.PT_BASE || "https://cry-maden008.pythonanywhere.com/portfolio").replace(
  /\/$/,
  "",
);
const TIMEOUT = Number(process.env.PT_TIMEOUT_MS || 300000);
const GAP_MAX = Number(process.env.PT_GAP_MAX || 0.12);

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

async function fetchPortfolio(wallet, source) {
  const u = `${BASE}/api/portfolio?wallet=${encodeURIComponent(wallet)}&source=${source}&refresh=1&refreshOnchain=1&_=${Date.now()}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch(u, { signal: ctrl.signal, cache: "no-store" });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j.portfolio;
  } finally {
    clearTimeout(t);
  }
}

function gapPct(debank, computed) {
  if (!debank || debank <= 0) return 0;
  return Math.abs(debank - computed) / debank;
}

console.log(`PA compare @ ${BASE} | wallets=${WALLETS.length} | gap<=${GAP_MAX * 100}%\n`);
console.log(
  "wallet".padEnd(12),
  "debank$".padStart(9),
  "hybrid$".padStart(9),
  "computed".padStart(9),
  "gap%".padStart(7),
  "es".padStart(4),
  "status".padStart(8),
);
console.log("-".repeat(62));

let fails = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

for (let wi = 0; wi < WALLETS.length; wi++) {
  const wallet = WALLETS[wi];
  if (wi > 0) await sleep(Number(process.env.PT_WALLET_PAUSE_MS || 12000));
  const short = `${wallet.slice(0, 6)}…`;
  let status = "OK";
  try {
    const hybrid = await fetchPortfolio(wallet, "hybrid");
    const db = debank.debankTotalUsd ?? debank.totalUsd ?? 0;
    const hy = hybrid.debankTotalUsd ?? hybrid.totalUsd ?? 0;
    const computed = hybrid.computedTotalUsd ?? hy;
    const g = gapPct(db, computed);
    const over = hybrid.overCountUsd ?? Math.max(0, computed - db);
    const es = hybrid.stats?.etherscan;
    if (db < 1) status = "SKIP";
    else if (g > GAP_MAX || over > Math.max(50, db * GAP_MAX)) {
      status = "GAP";
      fails++;
    }
    if (hybrid.partial) {
      status = "PART";
      fails++;
    }
    console.log(
      short.padEnd(12),
      `$${Math.round(db)}`.padStart(9),
      `$${Math.round(hy)}`.padStart(9),
      `$${Math.round(computed)}`.padStart(9),
      `${(g * 100).toFixed(1)}%`.padStart(7),
      (es ? "Y" : "—").padStart(4),
      status.padStart(8),
    );
  } catch (e) {
    fails++;
    console.log(short.padEnd(12), "—".padStart(9), "—".padStart(9), "—".padStart(9), "—".padStart(7), "—".padStart(4), `ERR ${String(e.message || e).slice(0, 24)}`.padStart(8));
  }
}

console.log("\n" + (fails ? `FAILED: ${fails}` : "ALL OK"));
process.exit(fails ? 1 : 0);
