/**
 * Revert для Uni / Aerodrome / Pancake:
 * если сумма USD на DeBank ≈ сумма на Revert (±1%) — все LP этих платформ только с Revert.
 * Иначе: все позиции Revert + DeBank без дублей по паре/сети.
 */

import {
  normPair,
  finalizeRevertPosition,
  buildMarketHints,
  formatPairDisplay,
  spotFromInPool,
  isCoarseMicroRange,
  isDisplayRangeUsable,
} from "./revert-parse.js";
import { isSyntheticLiquidityRow } from "./portfolio-dedupe.js";
import {
  attachRevertToPortfolio as matchRevertToPools,
  normalizeChain,
  poolPairKey,
} from "./revert-match.js";

export const REVERT_DEX_PROTOCOLS = ["Uniswap V3", "Uniswap V4", "Aerodrome V3", "PancakeSwap V3"];

/** DeBank и Revert слегка расходятся по USD — допуск ~12%. */
const SUM_TOLERANCE = 0.12;

export function revertExchangeToProtocol(exchange) {
  const ex = String(exchange || "").toLowerCase();
  if (ex.includes("uniswapv4")) return "Uniswap V4";
  if (ex.includes("uniswap")) return "Uniswap V3";
  if (ex.includes("aerodrome")) return "Aerodrome V3";
  if (ex.includes("pancake")) return "PancakeSwap V3";
  return null;
}

export function isRevertDexDebankProtocol(protocol) {
  const p = String(protocol || "").toLowerCase();
  if (p.includes("uniswap v3")) return "Uniswap V3";
  if (p.includes("uniswap v4")) return "Uniswap V4";
  if (p.includes("aerodrome")) return "Aerodrome V3";
  if (p.includes("pancake")) return "PancakeSwap V3";
  return null;
}

export function isRevertDexFamily(protocolOrExchange) {
  const s = String(protocolOrExchange || "").toLowerCase();
  return s.includes("uniswap") || s.includes("aerodrome") || s.includes("pancake");
}

export function isUsefulRevertPosition(rev) {
  if (!rev || !revertExchangeToProtocol(rev.exchange)) return false;
  if ((rev.pooledUsd || 0) < 0.02) return false;
  const pair = String(rev.pair || "");
  if (!/^[\w.+-]+\/[\w.+-]+$/i.test(pair.replace(/\s/g, ""))) return false;
  return true;
}

export function revertPositionToPool(rev, protocol) {
  const fixed = finalizeRevertPosition(rev);
  return {
    protocol,
    chain: normalizeChain(fixed.chain),
    poolId: fixed.positionId || fixed.poolAddress || formatPairDisplay(fixed.pair),
    pair: formatPairDisplay(fixed.pair),
    inPool: [],
    positionUsd: fixed.pooledUsd || 0,
    claimable: [],
    claimableUsd: fixed.uncollectedUsd || 0,
    netUsd: fixed.pooledUsd || 0,
    fromRevert: true,
    revert: fixed,
  };
}

function sumDebankDexUsd(portfolio) {
  let sum = 0;
  const seen = new Set();
  for (const g of portfolio.protocolGroups || []) {
    const canon = isRevertDexDebankProtocol(g.protocol);
    if (!canon) continue;
    for (const p of g.liquidity || []) {
      const key = `${canon}|${normalizeChain(p.chain)}|${poolPairKey(p)}|${p.poolId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sum += p.positionUsd || 0;
    }
  }
  return sum;
}

function collectDebankDexPools(portfolio) {
  const pools = [];
  const seen = new Set();
  for (const g of portfolio.protocolGroups || []) {
    const canon = isRevertDexDebankProtocol(g.protocol);
    if (!canon) continue;
    for (const p of g.liquidity || []) {
      const key = `${canon}|${normalizeChain(p.chain)}|${poolPairKey(p)}|${p.poolId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pools.push({
        pool: p,
        protocol: canon,
        chain: normalizeChain(p.chain),
        pairKey: poolPairKey(p),
      });
    }
  }
  return pools;
}

function filterRevertPositions(positions) {
  return (positions || []).filter(isUsefulRevertPosition).map((rev) => ({
    rev,
    protocol: revertExchangeToProtocol(rev.exchange),
    chain: normalizeChain(rev.chain),
    pairKey: rev.pairKey || normPair(rev.pair),
  }));
}

function sumUsd(items, getUsd) {
  return items.reduce((s, it) => s + (getUsd(it) || 0), 0);
}

function sumsClose(a, b, tol = SUM_TOLERANCE) {
  const mx = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / mx <= tol;
}

function debankSpotHints(debankItems) {
  const hints = {};
  for (const { pool, chain, pairKey } of debankItems) {
    const spot = spotFromInPool(pool.inPool, pool.positionUsd, pairKey);
    if (spot) hints[`${chain}|${pairKey}`] = spot;
  }
  return hints;
}

function applyMarketHints(revertItems, debankItems = []) {
  const spotHints = debankSpotHints(debankItems);
  const pass1 = buildMarketHints(revertItems.map((x) => x.rev));
  function spotForItem(rev, hints) {
    const nums = rev.rangeNums || [];
    if (isCoarseMicroRange(nums) && hints.btcUsd) return hints.btcUsd;
    return spotHints[`${rev.chain}|${rev.pairKey}`] ?? hints.btcUsd;
  }

  revertItems.forEach((it) => {
    it.rev = finalizeRevertPosition(it.rev, { ...pass1, spotUsd: spotForItem(it.rev, pass1) });
  });
  const pass2 = buildMarketHints(revertItems.map((x) => x.rev));
  revertItems.forEach((it) => {
    it.rev = finalizeRevertPosition(it.rev, {
      ...pass1,
      ...pass2,
      spotUsd: spotForItem(it.rev, { ...pass1, ...pass2 }),
    });
  });
}

function stripAllDebankDex(portfolio) {
  for (const g of portfolio.protocolGroups || []) {
    if (isRevertDexDebankProtocol(g.protocol)) g.liquidity = [];
  }
  portfolio.liquidity = (portfolio.liquidity || []).filter(
    (p) => !isRevertDexDebankProtocol(p.protocol),
  );
}

function revertKeysSet(revertItems) {
  const s = new Set();
  for (const { protocol, chain, pairKey } of revertItems) {
    s.add(`${protocol}|${chain}|${pairKey}`);
  }
  return s;
}

function stripDebankOverlappingRevert(portfolio, revertItems) {
  const keys = revertKeysSet(revertItems);
  for (const g of portfolio.protocolGroups || []) {
    const canon = isRevertDexDebankProtocol(g.protocol);
    if (!canon) continue;
    g.liquidity = (g.liquidity || []).filter((p) => {
      const pk = poolPairKey(p);
      const ch = normalizeChain(p.chain);
      return !keys.has(`${canon}|${ch}|${pk}`);
    });
  }
  portfolio.liquidity = (portfolio.liquidity || []).filter((p) => {
    const canon = isRevertDexDebankProtocol(p.protocol);
    if (!canon) return true;
    return !keys.has(`${canon}|${normalizeChain(p.chain)}|${poolPairKey(p)}`);
  });
}

function injectAllRevertPools(portfolio, revertItems) {
  for (const { rev, protocol } of revertItems) {
    const pool = revertPositionToPool(rev, protocol);
    const g = findOrCreateGroup(portfolio, protocol, pool.chain);
    const dup = (g.liquidity || []).some(
      (p) =>
        p.revert?.positionId === rev.positionId ||
        (p.fromRevert && p.poolId === pool.poolId && p.pair === pool.pair),
    );
    if (!dup) g.liquidity.push(pool);
  }
}

function findOrCreateGroup(portfolio, protocol, chain) {
  let g = (portfolio.protocolGroups || []).find(
    (x) => x.protocol === protocol && normalizeChain(x.chain) === chain,
  );
  if (!g) {
    g = {
      protocol,
      chain,
      protocolUsd: 0,
      kinds: ["Liquidity Pool"],
      lending: [],
      liquidity: [],
      walletTokens: [],
      id: `${protocol}|${chain}`,
    };
    portfolio.protocolGroups.push(g);
  }
  return g;
}

function liquidityRowKey(protocol, p) {
  const pid = String(p.poolId || p.pair || poolPairKey(p) || "")
    .trim()
    .toLowerCase();
  return `${protocol}|${normalizeChain(p.chain)}|${pid}`;
}

export function recalcLiquidityTotals(portfolio) {
  let liqUsd = 0;
  const flat = [];
  const seen = new Set();
  for (const g of portfolio.protocolGroups || []) {
    let liqPart = 0;
    for (const p of g.liquidity || []) {
      if (isSyntheticLiquidityRow(p, g.protocol)) continue;
      const k = liquidityRowKey(g.protocol, p);
      if (seen.has(k)) continue;
      seen.add(k);
      const usd = p.positionUsd || 0;
      liqPart += usd;
      liqUsd += usd;
      flat.push({ ...p, protocol: g.protocol });
    }
    let lendPart = (g.lending || []).reduce((s, x) => s + (x.netUsd || 0), 0);
    if ((g.lending || []).length && lendPart < 0.01) {
      lendPart = (g.lending || []).reduce((s, x) => s + Math.max(x.collateralUsd || 0, 0), 0);
    }
    const wallPart = (g.walletTokens || []).reduce((s, x) => s + (x.usd || 0), 0);
    let protoUsd = Math.round((liqPart + lendPart + wallPart) * 100) / 100;
    if (((g.liquidity || []).length || (g.lending || []).length) && protoUsd < 0.01) {
      const liqAll = (g.liquidity || []).reduce((s, p) => s + (p.positionUsd || 0), 0);
      const lendAll = (g.lending || []).reduce(
        (s, x) => s + Math.max(x.netUsd || 0, x.collateralUsd || 0, 0),
        0,
      );
      protoUsd = Math.round(Math.max(liqAll + lendAll, 0.01) * 100) / 100;
    }
    g.protocolUsd = protoUsd;
  }
  portfolio.liquidity = flat;
  portfolio.liqUsd = Math.round(liqUsd * 100) / 100;
}

/**
 * @param {object} portfolio
 * @param {object[]} revertPositions
 */
function onchainRangeUsable(p, pairKey) {
  return isDisplayRangeUsable(p.rangeMin, p.rangeMax, p.rangeCurrent, pairKey);
}

function revertRangeUsable(rev, pairKey) {
  if (!rev) return false;
  return isDisplayRangeUsable(rev.rangeMin, rev.rangeMax, rev.rangeCurrent, pairKey || rev.pairKey);
}

/** Подмешать Revert в существующий пул: диапазон, APY, комиссии; USD/onchain не затираем. */
function applyRevertEnrichmentToPool(p) {
  const r = p.revert;
  if (!r) return false;
  const fixed = finalizeRevertPosition(r);
  p.revert = fixed;
  p.revertEnriched = true;
  const pk = poolPairKey(p);

  if (revertRangeUsable(fixed, pk)) {
    p.rangeMin = fixed.rangeMin;
    p.rangeMax = fixed.rangeMax;
    p.rangeCurrent = fixed.rangeCurrent;
    p.feeTier = fixed.feeTier || p.feeTier;
  }

  if (p.apyRecent == null && p.apyAnnualized == null && fixed.displayApy != null) {
    p.apyRecent = fixed.displayApy;
    p.apyAnnualized = fixed.displayApy;
  }
  if ((p.claimableUsd ?? 0) < 0.001 && (fixed.uncollectedUsd ?? 0) > 0) {
    p.claimableUsd = fixed.uncollectedUsd;
  }
  return true;
}

/** Гибрид/onchain: полный Revert (диапазоны, APY) через matchRevertToPools, не только APY по ключу. */
export function mergeRevertApyOnly(portfolio, revertPositions) {
  if (!portfolio) return portfolio;
  const revertItems = filterRevertPositions(revertPositions);
  if (!revertItems.length) {
    portfolio._revertMerge = {
      mode: "onchain+revert-apy",
      sumMatched: false,
      revertDexCount: 0,
      revertPoolsOnSite: 0,
      revertPositionsLoaded: 0,
      revertMatched: 0,
    };
    return portfolio;
  }

  applyMarketHints(revertItems, collectDebankDexPools(portfolio));
  matchRevertToPools(
    portfolio,
    revertItems.map((x) => x.rev),
  );

  let matched = 0;
  for (const g of portfolio.protocolGroups || []) {
    for (const p of g.liquidity || []) {
      if (applyRevertEnrichmentToPool(p)) matched += 1;
    }
  }

  const usedIds = new Set();
  for (const g of portfolio.protocolGroups || []) {
    for (const p of g.liquidity || []) {
      const id = p.revert?.positionId || p.poolId;
      if (id) usedIds.add(String(id).toLowerCase());
    }
  }
  const unmatched = revertItems.filter(({ rev, pairKey, chain }) => {
    const id = rev.positionId || rev.poolAddress;
    if (id && usedIds.has(String(id).toLowerCase())) return false;
    const usd = rev.pooledUsd || 0;
    for (const g of portfolio.protocolGroups || []) {
      for (const p of g.liquidity || []) {
        if (p.debankFill) continue;
        if (poolPairKey(p) !== pairKey) continue;
        const pu = p.positionUsd || 0;
        if (Math.abs(pu - usd) < Math.max(2.5, usd * 0.12)) return false;
        if (
          normalizeChain(p.chain) === "unknown" &&
          normalizeChain(chain) !== "unknown" &&
          Math.abs(pu - usd) < 8
        ) {
          return false;
        }
      }
    }
    return true;
  });
  if (unmatched.length) injectAllRevertPools(portfolio, unmatched);

  recalcLiquidityTotals(portfolio);

  const revertPoolsOnSite = (portfolio.protocolGroups || []).reduce(
    (n, g) => n + (g.liquidity || []).filter((p) => p.revert || p.fromRevert).length,
    0,
  );

  portfolio._revertMerge = {
    mode: "onchain+revert-apy",
    sumMatched: matched > 0,
    revertDexCount: revertItems.length,
    revertPoolsOnSite,
    revertPositionsLoaded: revertItems.length,
    revertMatched: matched,
  };
  return portfolio;
}

export function mergeRevertLiquidity(portfolio, revertPositions) {
  if (!portfolio) return portfolio;

  if (
    portfolio.onchain ||
    portfolio.hybrid ||
    portfolio.source === "onchain" ||
    portfolio.source === "hybrid"
  ) {
    return mergeRevertApyOnly(portfolio, revertPositions);
  }

  const debankItems = collectDebankDexPools(portfolio);
  let revertItems = filterRevertPositions(revertPositions);
  applyMarketHints(revertItems, debankItems);

  const debankDexUsd = sumDebankDexUsd(portfolio);
  const revertDexUsd = sumUsd(revertItems, (x) => x.rev.pooledUsd);
  const sumMatched = debankDexUsd > 0 && revertDexUsd > 0 && sumsClose(debankDexUsd, revertDexUsd);

  const pairOnRevert = new Set(revertItems.map((x) => x.pairKey));
  const debankOnlyPools = debankItems.filter((x) => !pairOnRevert.has(x.pairKey));

  stripDebankOverlappingRevert(portfolio, revertItems);
  if (sumMatched) {
    stripAllDebankDex(portfolio);
  }

  injectAllRevertPools(portfolio, revertItems);

  for (const { pool, protocol } of debankOnlyPools) {
    const g = findOrCreateGroup(portfolio, protocol, normalizeChain(pool.chain));
    const dup = (g.liquidity || []).some(
      (p) => !p.fromRevert && p.poolId === pool.poolId && p.pair === pool.pair,
    );
    if (!dup) {
      g.liquidity.push({
        ...pool,
        protocol,
        fromRevert: false,
        revert: null,
      });
    }
  }
  recalcLiquidityTotals(portfolio);

  const revertPoolsOnSite = (portfolio.protocolGroups || []).reduce(
    (n, g) => n + (g.liquidity || []).filter((p) => p.fromRevert).length,
    0,
  );

  portfolio._revertMerge = {
    mode: sumMatched ? "sum-platforms" : "revert-all",
    sumMatched,
    debankDexUsd,
    revertDexUsd,
    debankDexCount: debankItems.length,
    revertDexCount: revertItems.length,
    revertPoolsOnSite,
    revertPositionsLoaded: revertItems.length,
  };

  return portfolio;
}

export { attachRevertToPortfolio } from "./revert-match.js";
