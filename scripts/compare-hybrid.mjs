#!/usr/bin/env node
/**
 * Сверка hybrid vs onchain-only vs debank: coverage %, gap USD.
 * PT_BASE=http://127.0.0.1:5500 node scripts/compare-hybrid.mjs [wallet]
 */
const BASE = (process.env.PT_BASE || "http://127.0.0.1:5500").replace(/\/$/, "");
const WALLET =
  process.argv[2] || process.env.PT_WALLET || "0x5853ed4f26a3fcea565b3fbc698bb19cdf6deb85";
const TIMEOUT = Number(process.env.PT_TIMEOUT_MS || 180000);

async function fetchPortfolio(source) {
  const u = `${BASE}/api/portfolio?wallet=${encodeURIComponent(WALLET)}&source=${source}&refresh=1&_=${Date.now()}`;
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

function summarize(p, label) {
  const hm = p?.hybridMeta || {};
  return {
    label,
    source: p?.source,
    totalUsd: p?.debankTotalUsd ?? p?.totalUsd ?? 0,
    computedUsd: p?.computedTotalUsd ?? 0,
    gapUsd: p?.coverageGapUsd ?? hm.gapUsd ?? 0,
    coveragePct: hm.coveragePct ?? hm.onchainCoveragePct,
    chains: (p?.chains || []).length,
    lp: p?.stats?.lpCount ?? (p?.liquidity || []).length,
    partial: !!p?.partial,
  };
}

console.log(`Wallet ${WALLET.slice(0, 10)}… @ ${BASE}\n`);

const [hybrid, onchain, debank] = await Promise.all([
  fetchPortfolio("hybrid").catch((e) => ({ _err: e.message })),
  fetchPortfolio("onchain").catch((e) => ({ _err: e.message })),
  fetchPortfolio("debank").catch((e) => ({ _err: e.message })),
]);

for (const [name, raw] of [
  ["hybrid", hybrid],
  ["onchain", onchain],
  ["debank", debank],
]) {
  if (raw._err) {
    console.log(`${name}: ERROR ${raw._err}`);
    continue;
  }
  const s = summarize(raw, name);
  console.log(
    `${name.padEnd(8)} total=$${s.totalUsd.toFixed(0)} computed=$${s.computedUsd.toFixed(0)} gap=$${s.gapUsd.toFixed(0)} cov=${s.coveragePct ?? "?"}% chains=${s.chains} lp=${s.lp} partial=${s.partial}`,
  );
}

if (!hybrid._err && !onchain._err) {
  const h = summarize(hybrid);
  const o = summarize(onchain);
  const lift = h.computedUsd - o.computedUsd;
  console.log(`\nHybrid lifts computed by $${lift.toFixed(0)} vs onchain-only (DeBank fill).`);
}
