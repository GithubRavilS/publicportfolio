/**
 * Обогащение LP из Krystal (Aerodrome, PancakeSwap и др.) поверх DeBank-клона.
 * USD с DeBank — источник истины; Krystal даёт APY, invested, диапазоны где есть.
 */
import { chainSlug } from "./chains.js";
import { normPair } from "./revert-parse.js";
import { isRevertDexDebankProtocol } from "./revert-portfolio-merge.js";

const CHAIN_ID = {
  1: "eth",
  10: "op",
  56: "bsc",
  137: "matic",
  8453: "base",
  42161: "arb",
  324: "era",
  59144: "linea",
  534352: "scroll",
  81457: "blast",
};

const KRYSTAL_DEX = /aerodrome|pancake|velodrome|sushi|curve|balancer|quickswap|trader.?joe/i;

function chainFromKrystal(p) {
  const id = p?.chainId ?? p?.chain_id;
  if (id != null && CHAIN_ID[id]) return CHAIN_ID[id];
  const name = String(p?.chain || p?.chainName || "").toLowerCase();
  return chainSlug(name || "unknown");
}

function protocolFromKrystal(p) {
  const raw = String(p?.protocol || p?.dexId || p?.dex || "Krystal");
  if (/aerodrome/i.test(raw)) return "Aerodrome V3";
  if (/pancake/i.test(raw)) return "PancakeSwap V3";
  if (/uniswap.*v4/i.test(raw)) return "Uniswap V4";
  if (/uniswap/i.test(raw)) return "Uniswap V3";
  return raw;
}

function pairFromKrystal(p) {
  const pool = p?.pool || {};
  const t0 = pool?.token0?.symbol || "?";
  const t1 = pool?.token1?.symbol || "?";
  return `${t0}/${t1}`;
}

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function apyFromKrystal(p) {
  let apy = num(p?.apr) || num(p?.farmApr) || num(p?.apy);
  if (apy > 0 && apy < 1) apy *= 100;
  return apy || null;
}

function poolKey(protocol, chain, pair) {
  return `${protocol}|${chainSlug(chain)}|${normPair(pair)}`;
}

function findGroup(portfolio, protocol, chain) {
  const ch = chainSlug(chain);
  return (portfolio.protocolGroups || []).find(
    (g) => g.protocol === protocol && chainSlug(g.chain) === ch,
  );
}

function ensureGroup(portfolio, protocol, chain) {
  let g = findGroup(portfolio, protocol, chain);
  if (g) return g;
  if (!portfolio.protocolGroups) portfolio.protocolGroups = [];
  g = {
    protocol,
    chain: chainSlug(chain),
    protocolUsd: 0,
    liquidity: [],
    lending: [],
    walletTokens: [],
    kinds: [],
  };
  g.id = `${g.protocol}|${g.chain}`;
  portfolio.protocolGroups.push(g);
  return g;
}

function krystalToPool(p, protocol, chain) {
  const pair = pairFromKrystal(p);
  const current = num(p?.currentUSD) || num(p?.liquidityUSD);
  const invested = num(p?.initialUSD) || num(p?.depositedUSD);
  const apy = apyFromKrystal(p);
  const id = p?.id || p?.positionId || "";
  return {
    protocol,
    chain: chainSlug(chain),
    poolId: id ? `${pair} #${id}` : pair,
    pair,
    inPool: [],
    positionUsd: current,
    netUsd: current,
    investedUsd: invested || null,
    apyPercent: apy,
    fromKrystal: true,
    krystal: p,
    kind: "Liquidity Pool",
  };
}

function enrichPoolRow(row, kPool) {
  const apy = apyFromKrystal(kPool.krystal || kPool);
  if (apy != null && !row.apyPercent) row.apyPercent = apy;
  if (kPool.investedUsd && !row.investedUsd) row.investedUsd = kPool.investedUsd;
  const kr = kPool.krystal || kPool;
  const min = num(kr?.minPrice) || num(kr?.priceRangeMin);
  const max = num(kr?.maxPrice) || num(kr?.priceRangeMax);
  if (min && max && row.rangeMin == null) {
    row.rangeMin = min;
    row.rangeMax = max;
  }
  row.fromKrystal = true;
  return row;
}

/** @param {object} portfolio @param {object[]} krystalPositions */
export function mergeKrystalLiquidity(portfolio, krystalPositions) {
  if (!portfolio || !krystalPositions?.length) return portfolio;
  const p = portfolio;
  const index = new Map();
  for (const g of p.protocolGroups || []) {
    for (const row of g.liquidity || []) {
      if (row.debankFill) continue;
      index.set(poolKey(g.protocol, row.chain, row.pair || row.poolId), { g, row });
      index.set(
        `${chainSlug(row.chain)}|${normPair(row.pair || row.poolId)}`,
        { g, row },
      );
    }
  }

  for (const kr of krystalPositions) {
    const protocol = protocolFromKrystal(kr);
    const chain = chainFromKrystal(kr);
    const pair = pairFromKrystal(kr);
    const isUni = !!isRevertDexDebankProtocol(protocol);
    if (isUni) continue;
    if (!KRYSTAL_DEX.test(protocol) && !KRYSTAL_DEX.test(String(kr?.dexId || ""))) continue;

    const key = poolKey(protocol, chain, pair);
    const alt = `${chainSlug(chain)}|${normPair(pair)}`;
    const hit = index.get(key) || index.get(alt);
    if (hit) {
      enrichPoolRow(hit.row, krystalToPool(kr, protocol, chain));
      continue;
    }

    const usd = num(kr?.currentUSD) || num(kr?.liquidityUSD);
    if (usd < 2) continue;
    const g = ensureGroup(p, protocol, chain);
    const pool = krystalToPool(kr, protocol, chain);
    g.liquidity.push(pool);
    index.set(key, { g, row: pool });
    index.set(alt, { g, row: pool });
  }

  return p;
}
