#!/usr/bin/env node
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
  .filter(Boolean);

const BASE = process.env.PT_BASE || "http://127.0.0.1:5500";
const REFRESH = process.env.PT_REFRESH === "1";

function isV3Dex(proto) {
  const s = String(proto || "").toLowerCase();
  return (
    /uniswap|pancake|aerodrome|curve|balancer|sushi|velodrome/.test(s) &&
    !/yearn|beefy|gmx|supernova|pendle/.test(s)
  );
}

function hasUsableRange(p) {
  return p.rangeMin != null && p.rangeMax != null;
}

function primaryMarketPrice(supplied) {
  const rows = (supplied || [])
    .map((x) => ({
      usd: Number(x.usd || 0),
      amt: parseFloat(String(x.amount || "0").replace(/,/g, "")),
    }))
    .filter((x) => x.usd > 0 && x.amt > 0)
    .sort((a, b) => b.usd - a.usd);
  return rows.length ? rows[0].usd / rows[0].amt : 0;
}

function audit(p) {
  const w = p.walletUsd || 0;
  const l = p.liqUsd || 0;
  const le = p.lendUsd || 0;
  const computed = p.computedTotalUsd ?? w + l + le;
  const total = p.totalUsd || 0;
  const debank = p.debankTotalUsd ?? total;
  const gap = Math.abs(debank - computed);
  const gapPct = debank > 0 ? gap / debank : 0;
  let zeroProto = 0;
  let noRange = 0;
  let badLiq = 0;
  for (const g of p.protocolGroups || []) {
    if (g.protocol === "Wallet") continue;
    const n = (g.liquidity?.length || 0) + (g.lending?.length || 0);
    if (n && (g.protocolUsd || 0) < 0.01) zeroProto++;
    for (const x of g.liquidity || []) {
      if (x.debankFill || String(x.poolId || "").includes("DeBank")) continue;
      if (
        isV3Dex(g.protocol) &&
        (x.positionUsd || 0) > 10 &&
        !hasUsableRange(x) &&
        !x.revert?.rangeMin
      ) {
        noRange++;
      }
    }
    for (const x of g.lending || []) {
      const hf = Number(x.healthFactor);
      if (!hf || hf <= 0 || hf > 10) continue;
      const mkt = primaryMarketPrice(x.supplied) || Number(x.marketPrice || 0);
      if (mkt <= 0) continue;
      const expected = mkt / hf;
      const liq = Number(x.liquidationPrice || 0);
      if (!liq) {
        badLiq++;
        continue;
      }
      const rel = Math.abs(liq - expected) / expected;
      if (rel > 0.12) badLiq++;
    }
  }
  const absTol = Math.max(6, debank * 0.03);
  const ok =
    gapPct < 0.1 &&
    zeroProto === 0 &&
    Math.abs(total - computed) < absTol &&
    noRange === 0 &&
    badLiq === 0;
  return {
    ok,
    total,
    debank,
    computed,
    gap,
    gapPct,
    zeroProto,
    noRange,
    badLiq,
    partial: p.partial,
  };
}

const results = [];
for (const wallet of WALLETS) {
  let last = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const url = `${BASE}/api/portfolio?wallet=${encodeURIComponent(wallet)}${REFRESH ? "&refresh=1" : ""}&_=${Date.now()}`;
    const t0 = Date.now();
    try {
      const r = await fetch(url, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || String(r.status));
      const a = audit(j.portfolio);
      last = { wallet: wallet.slice(0, 10), ms: Date.now() - t0, ...a };
      if (a.ok || attempt === 2) break;
      if (a.gapPct > 0.12 || a.zeroProto > 0) {
        await new Promise((res) => setTimeout(res, 3500));
      } else break;
    } catch (e) {
      last = { wallet: wallet.slice(0, 10), ok: false, error: e.message };
      if (attempt === 2) break;
      await new Promise((res) => setTimeout(res, 2000));
    }
  }
  results.push(last);
  console.log(last.ok ? "OK" : "WARN", last.wallet, JSON.stringify(last));
}

const failed = results.filter((r) => !r.ok);
console.log("\n=== SUMMARY ===", {
  total: results.length,
  passed: results.filter((r) => r.ok).length,
  failed: failed.length,
});
process.exit(failed.length ? 1 : 0);
