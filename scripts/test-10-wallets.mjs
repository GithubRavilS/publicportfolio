#!/usr/bin/env node
/** Проверка KPI: total ≈ wallet + liq + lend; protocolUsd > 0 при позициях. */
import { buildPortfolioFromDebank } from "../js/portfolio-pipeline.js";

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
`
)
  .trim()
  .split(/\s+/)
  .filter((w) => /^0x[a-fA-F0-9]{40}$/.test(w));

const BASE = process.env.PT_BASE || "http://127.0.0.1:5500";

async function testApi(wallet) {
  const r = await fetch(
    `${BASE}/api/portfolio?wallet=${encodeURIComponent(wallet)}&refresh=1&_=${Date.now()}`,
    { cache: "no-store" },
  );
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j.portfolio;
}

function audit(p) {
  const w = p.walletUsd || 0;
  const l = p.liqUsd || 0;
  const le = p.lendUsd || 0;
  const computed = p.computedTotalUsd ?? w + l + le;
  const total = p.totalUsd || 0;
  const gap = Math.abs(total - computed);
  const over = p.overCountUsd || 0;
  const zeroGroups = (p.protocolGroups || []).filter(
    (g) =>
      g.protocol !== "Wallet" &&
      (g.liquidity?.length || g.lending?.length) &&
      (g.protocolUsd || 0) < 0.01,
  );
  return { total, computed, gap, over, zeroGroups: zeroGroups.length, partial: p.partial };
}

async function main() {
  let fail = 0;
  for (const wallet of WALLETS) {
    try {
      const p = await testApi(wallet);
      const a = audit(p);
      const ok = a.gap < Math.max(5, a.total * 0.08) && a.zeroGroups === 0;
      console.log(ok ? "OK" : "WARN", wallet.slice(0, 10), JSON.stringify(a));
      if (!ok) fail++;
    } catch (e) {
      console.log("FAIL", wallet.slice(0, 10), e.message);
      fail++;
    }
  }
  process.exit(fail ? 1 : 0);
}

main();
