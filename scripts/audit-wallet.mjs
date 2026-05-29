#!/usr/bin/env node
/** Детальный аудит одного кошелька после API refresh. */
const wallet = process.argv[2];
const BASE = process.env.PT_BASE || "http://127.0.0.1:5500";
if (!wallet) {
  console.error("usage: node audit-wallet.mjs 0x...");
  process.exit(1);
}

const r = await fetch(
  `${BASE}/api/portfolio?wallet=${encodeURIComponent(wallet)}&refresh=1&_=${Date.now()}`,
  { cache: "no-store" },
);
const j = await r.json();
if (!r.ok || !j.ok) {
  console.error("FAIL", j.error || r.status);
  process.exit(1);
}
const p = j.portfolio;
const w = p.walletUsd || 0;
const l = p.liqUsd || 0;
const le = p.lendUsd || 0;
const computed = p.computedTotalUsd ?? w + l + le;
const total = p.totalUsd || 0;
const gap = total - computed;
const over = p.overCountUsd || 0;

const zeroProto = [];
const noRange = [];
const noApy = [];
let liqSum = 0;

for (const g of p.protocolGroups || []) {
  if (g.protocol === "Wallet") continue;
  const hasPos = (g.liquidity?.length || 0) + (g.lending?.length || 0);
  if (hasPos && (g.protocolUsd || 0) < 0.01) {
    zeroProto.push(`${g.protocol}|${g.chain} liq=${g.liquidity?.length} usd=${g.protocolUsd}`);
  }
  for (const x of g.liquidity || []) {
    liqSum += x.positionUsd || 0;
    const pair = x.pair || x.poolId || "?";
    const hasR = x.rangeMin != null && x.rangeMax != null;
    const hasRev = !!x.revert;
    const isV3 =
      /uniswap|pancake|aerodrome|curve/i.test(g.protocol) && !/yearn|beefy|gmx/i.test(g.protocol);
    if (x.debankFill || String(x.poolId || "").includes("DeBank")) continue;
    if (isV3 && (x.positionUsd || 0) > 10 && !hasR && !hasRev) {
      noRange.push(`${g.protocol} ${g.chain} ${pair} $${x.positionUsd}`);
    }
    if ((x.positionUsd || 0) > 3 && !x.revert?.apy && !x.apy && !x.feeApr) {
      noApy.push(`${g.protocol} ${pair} $${x.positionUsd}`);
    }
  }
}

console.log(
  JSON.stringify(
    {
      wallet: wallet.slice(0, 10),
      total,
      computed,
      gap: Math.round(gap * 100) / 100,
      over,
      walletUsd: w,
      liqUsd: l,
      lendUsd: le,
      partial: p.partial,
      zeroProtoCount: zeroProto.length,
      zeroProto: zeroProto.slice(0, 8),
      noRangeCount: noRange.length,
      noRange: noRange.slice(0, 6),
      noApyCount: noApy.length,
    },
    null,
    2,
  ),
);
