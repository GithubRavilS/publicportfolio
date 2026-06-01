/**
 * Сборка LP: ончейн NFT/RPC (пара, сеть, диапазон) + метрики Revert (APR, fees, USD).
 */
import { scanLpPositions } from "./onchain-lp.js";
import { fetchPricesUsd, usdValue } from "./onchain-prices.js";
import { formatPairDisplay } from "./revert-parse.js";
import {
  enrichPositionsByDebankTokenIds,
  enrichPositionsWithOnchain,
  extractLpTokenId,
} from "./lp-onchain.js";
import { parseRevertAccountText } from "./revert-parse.js";
import { revertExchangeToProtocol } from "./revert-portfolio-merge.js";

const JINA = "https://r.jina.ai/";

async function fetchRevertText(wallet) {
  if (process.env.PT_SKIP_NETWORK === "1") return "";
  const page = `https://revert.finance/account/${wallet}`;
  const url = `${JINA}${encodeURIComponent(page)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { Accept: "text/plain, text/markdown, */*" },
        signal: AbortSignal.timeout(60_000),
      });
      if (!r.ok) continue;
      const text = await r.text();
      if (text.length > 400) return text;
    } catch {
      /* */
    }
    await new Promise((res) => setTimeout(res, 1200 * (attempt + 1)));
  }
  return "";
}

/** Только метрики Revert (APR, fees, pooled USD) — без подстановки пар/сетей. */
export async function fetchRevertMetrics(wallet) {
  const text = await fetchRevertText(wallet);
  if (!text) return [];
  return parseRevertAccountText(text).filter((r) => (r.pooledUsd || 0) > 1);
}

function lpRowToPoolShape(row) {
  return {
    protocol: row.protocol,
    chain: row.chain,
    poolId: row.poolId || row.tokenId,
    pair: row.pair,
    pairKey: row.pairKey,
    positionUsd: row.positionUsd || 0,
    poolAddress: row.poolAddress,
    positionId: row.tokenId,
    feeTier: row.feeTier,
    feeTierPct: row.feeTierPct,
    rangeMin: row.rangeMin,
    rangeMax: row.rangeMax,
    rangeCurrent: row.rangeCurrent,
    inPool: row.inPool || [],
    claimable: row.claimable || [],
    claimableUsd: row.claimableUsd || 0,
    onchain: true,
    source: row.source || "onchain-rpc",
  };
}

function revertTokenId(rev) {
  const raw = String(rev?.positionId || "").trim();
  if (/^revert-slot-/i.test(raw)) return "";
  const hash = raw.match(/#?(\d{4,})/);
  return hash ? hash[1] : "";
}

function attachRevertMetrics(pool, rev) {
  const r = rev;
  const revUsd = r.pooledUsd || 0;
  let posUsd = pool.positionUsd > 0.02 ? pool.positionUsd : revUsd;
  if (revUsd > posUsd * 1.08) posUsd = revUsd;
  return {
    ...pool,
    positionUsd: posUsd,
    netUsd: posUsd,
    claimableUsd: r.uncollectedUsd ?? pool.claimableUsd,
    feeApr: r.feeApr ?? pool.feeApr,
    totalApr: r.totalApr,
    totalPnlUsd: r.totalPnlUsd,
    revert: { ...r, pair: pool.pair, pairKey: pool.pairKey, chain: pool.chain },
    fromRevert: true,
    rangeMin: pool.rangeMin ?? r.rangeMin,
    rangeMax: pool.rangeMax ?? r.rangeMax,
    rangeCurrent: pool.rangeCurrent ?? r.rangeCurrent,
    rangeNums: pool.rangeNums?.length ? pool.rangeNums : r.rangeNums,
  };
}

function findRevertMatch(pool, metrics, used) {
  const tid = extractLpTokenId(pool) || String(pool.tokenId || pool.positionId || "");
  if (tid) {
    for (let i = 0; i < metrics.length; i++) {
      if (used.has(i)) continue;
      if (revertTokenId(metrics[i]) === tid) return { rev: metrics[i], idx: i };
    }
  }

  const usd = pool.positionUsd || 0;
  let best = null;
  let bestDiff = Infinity;
  for (let i = 0; i < metrics.length; i++) {
    if (used.has(i)) continue;
    const m = metrics[i];
    const revUsd = m.pooledUsd || 0;
    const diff = Math.abs(revUsd - usd);
    const ref = Math.max(usd, revUsd, 1);
    const tol = Math.max(80, ref * 0.08);
    if (diff <= tol && diff < bestDiff) {
      bestDiff = diff;
      best = { rev: m, idx: i };
    }
  }
  return best;
}

/** Jina plain: только USD/APR — сопоставляем с ончейн (по рангу USD или по близости). */
function matchOrphanMetrics(pools, metrics, usedRev) {
  const orphans = pools.filter(
    (p) => !p.fromRevert && (p.onchain || p.source?.includes("onchain")),
  );
  const free = metrics.map((m, i) => ({ m, i })).filter(({ i }) => !usedRev.has(i));
  if (!orphans.length || !free.length) return pools;

  const sortedPools = [...orphans].sort((a, b) => (b.positionUsd || 0) - (a.positionUsd || 0));
  const sortedRev = [...free].sort((a, b) => (b.m.pooledUsd || 0) - (a.m.pooledUsd || 0));
  const out = [...pools];
  const pairs =
    orphans.length === free.length && free.every(({ m }) => m.jinaPlain || m.metricsOnly)
      ? sortedPools.map((pool, ri) => ({ pool, ...sortedRev[ri] }))
      : null;

  const assign = (pool, { m, i }) => {
    usedRev.add(i);
    const idx = out.findIndex(
      (x) => x.chain === pool.chain && extractLpTokenId(x) === extractLpTokenId(pool),
    );
    if (idx >= 0) out[idx] = attachRevertMetrics(out[idx], m);
  };

  if (pairs) {
    for (const { pool, m, i } of pairs) assign(pool, { m, i });
    return out;
  }

  const usedPool = new Set();
  for (let ri = 0; ri < sortedRev.length; ri++) {
    const { m, i } = sortedRev[ri];
    let bestPi = -1;
    let bestDiff = Infinity;
    for (let pi = 0; pi < sortedPools.length; pi++) {
      if (usedPool.has(pi)) continue;
      const p = sortedPools[pi];
      const diff = Math.abs((m.pooledUsd || 0) - (p.positionUsd || 0));
      const ref = Math.max(m.pooledUsd || 0, p.positionUsd || 0, 1);
      if (diff <= Math.max(120, ref * 0.1) && diff < bestDiff) {
        bestDiff = diff;
        bestPi = pi;
      }
    }
    if (bestPi < 0) continue;
    usedPool.add(bestPi);
    assign(sortedPools[bestPi], { m, i });
  }
  return out;
}

function positionUsdFromRow(row, prices) {
  if ((row.positionUsd || 0) >= 0.02) return row.positionUsd;
  const usd0 = usdValue(row._amt0, row._sym0, prices);
  const usd1 = usdValue(row._amt1, row._sym1, prices);
  if (usd0 + usd1 >= 0.02) return Math.round((usd0 + usd1) * 100) / 100;
  if (row.inPool?.length >= 2) {
    const a0 = parseFloat(row.inPool[0]?.amount || 0);
    const a1 = parseFloat(row.inPool[1]?.amount || 0);
    const u0 = usdValue(a0, row.inPool[0]?.symbol, prices);
    const u1 = usdValue(a1, row.inPool[1]?.symbol, prices);
    return Math.round((u0 + u1) * 100) / 100;
  }
  return row.positionUsd || 0;
}

/**
 * @param {string} wallet
 * @param {string[]} chains
 */
export async function buildLiquidityPositions(wallet, chains) {
  const w = wallet.toLowerCase();
  const [rpcRaw, revertMetrics] = await Promise.all([
    scanLpPositions(w, chains),
    fetchRevertMetrics(w).catch(() => []),
  ]);

  const symbols = new Set();
  for (const row of rpcRaw) {
    if (row._sym0) symbols.add(row._sym0);
    if (row._sym1) symbols.add(row._sym1);
    for (const leg of row.inPool || []) {
      if (leg?.symbol) symbols.add(leg.symbol);
    }
  }
  const prices = await fetchPricesUsd([...symbols]);

  let pools = rpcRaw
    .map((row) => {
      const positionUsd = positionUsdFromRow(row, prices);
      return lpRowToPoolShape({
        protocol: row.protocol,
        chain: row.chain,
        poolId: `#${row.tokenId}`,
        tokenId: row.tokenId,
        pair: formatPairDisplay(row.pairKey?.replace("+", "/") || row.pair),
        pairKey: row.pairKey,
        positionUsd,
        netUsd: positionUsd,
        poolAddress: row.poolAddress,
        feeTier: row.feeTier,
        feeTierPct: row.feeTierPct,
        rangeMin: row.rangeMin,
        rangeMax: row.rangeMax,
        rangeCurrent: row.rangeCurrent,
        inPool: row.inPool?.length
          ? row.inPool
          : [
              { amount: row._amt0?.toFixed?.(6) ?? String(row._amt0 ?? 0), symbol: row._sym0 },
              { amount: row._amt1?.toFixed?.(8) ?? String(row._amt1 ?? 0), symbol: row._sym1 },
            ],
        claimable: row.claimable,
        claimableUsd: row.claimableUsd,
        feeApr: row.feeApr,
        apyAnnualized: row.apyAnnualized,
        source: row.source || "onchain-rpc",
      });
    })
    .filter((p) => (p.positionUsd || 0) >= 0.02 || extractLpTokenId(p));

  const usedRev = new Set();
  pools = pools.map((p) => {
    const hit = findRevertMatch(p, revertMetrics, usedRev);
    if (hit) {
      usedRev.add(hit.idx);
      return attachRevertMetrics(p, hit.rev);
    }
    return p;
  });

  pools = matchOrphanMetrics(pools, revertMetrics, usedRev);

  pools = await enrichPositionsByDebankTokenIds(pools, w);
  const onchainList = rpcRaw.map((r) => ({
    chain: r.chain,
    tokenId: r.tokenId,
    pairKey: r.pairKey,
    poolAddress: r.poolAddress,
    rangeMin: r.rangeMin,
    rangeMax: r.rangeMax,
    rangeCurrent: r.rangeCurrent,
    fee: r.fee,
    feeTierPct: r.feeTierPct,
    liquidity: r.liquidity,
  }));
  pools = enrichPositionsWithOnchain(pools, onchainList);

  return pools.filter(
    (p) => (p.positionUsd || 0) >= 0.02 || (extractLpTokenId(p) && p.chain && p.pair),
  );
}
