import { normFeeTier, normPair, normToken } from "./revert-parse.js";

const PROTOCOL_EXCHANGES = {
  "uniswap v3": ["uniswapv3", "uniswap"],
  "uniswap v4": ["uniswapv4", "uniswap", "uniswapv3"],
  aerodrome: ["aerodrome", "aerodromecl"],
  "aerodrome v3": ["aerodrome", "aerodromecl"],
  pancakeswap: ["pancakeswap", "pancake", "pancakeswapv3"],
  "pancakeswap v3": ["pancakeswap", "pancake", "pancakeswapv3"],
  sushiswap: ["sushi", "sushiswap"],
  curve: ["curve"],
  balancer: ["balancer"],
  "velodrome v2": ["velodrome"],
  "velodrome v3": ["velodrome"],
};

/** DeBank slug → Revert network slug */
const CHAIN_ALIASES = {
  eth: "eth",
  ethereum: "eth",
  arb: "arb",
  arbitrum: "arb",
  base: "base",
  op: "op",
  optimism: "op",
  matic: "matic",
  polygon: "matic",
  bsc: "bsc",
  unichain: "unichain",
};

export function poolPairKey(pool) {
  const raw = pool.pair || pool.poolId || "";
  if (raw.includes("+") || raw.includes("/")) return normPair(raw);
  const syms = (pool.inPool || []).map((x) => x.symbol).filter(Boolean);
  if (syms.length >= 2) return normPair(syms.join("+"));
  return normPair(raw);
}

export function normalizeChain(chain) {
  const c = String(chain || "").toLowerCase();
  return CHAIN_ALIASES[c] || c;
}

export function protocolExchanges(protocol) {
  const p = String(protocol || "").toLowerCase();
  for (const [key, exs] of Object.entries(PROTOCOL_EXCHANGES)) {
    if (p.includes(key.replace(/\s+/g, "")) || p.includes(key)) return exs;
  }
  if (p.includes("uniswap")) return ["uniswapv3", "uniswap", "uniswapv4", "uni"];
  if (p.includes("aerodrome")) return ["aerodrome", "aerodromecl"];
  if (p.includes("pancake")) return ["pancakeswap", "pancakeswapv3", "pancake"];
  return [];
}

export function extractPoolFeeTier(pool) {
  const src = `${pool.poolId || ""} ${pool.pair || ""}`;
  const m = src.match(/(\d+(?:\.\d+)?)\s*%/);
  if (m) return parseFloat(m[1]);
  const m2 = src.match(/#(\d+(?:\.\d+)?)/);
  if (m2) {
    const v = parseFloat(m2[1]);
    if (v < 100) return v;
  }
  return null;
}

export function extractPoolAddress(pool) {
  const src = `${pool.poolId || ""} ${pool.pair || ""}`;
  const m = src.match(/(0x[a-fA-F0-9]{40})/i);
  return m ? m[1].toLowerCase() : "";
}

function exchangeMatches(protocol, revExchange) {
  const hints = protocolExchanges(protocol);
  const ex = String(revExchange || "").toLowerCase();
  if (!hints.length) {
    return /uniswap|aerodrome|pancake|velodrome|sushi|curve|balancer/i.test(protocol);
  }
  return hints.some((h) => ex.includes(h) || h.includes(ex));
}

function usdTolerance(usd, factor = 1) {
  const u = Math.max(0, usd || 0);
  return Math.max(2.5, u * 1.8 * factor + 1.5);
}

function collectLiquidityTasks(portfolio) {
  const tasks = [];
  const seen = new Set();
  const add = (pool, protocol) => {
    const key = `${pool.chain}|${protocol}|${pool.poolId || pool.pair}|${pool.positionUsd}`;
    if (seen.has(key)) return;
    seen.add(key);
    tasks.push({ pool, protocol });
  };
  for (const g of portfolio.protocolGroups || []) {
    for (const pool of g.liquidity || []) {
      add(pool, g.protocol);
    }
  }
  for (const pool of portfolio.liquidity || []) {
    add(pool, pool.protocol || "Liquidity");
  }
  tasks.sort((a, b) => (b.pool.positionUsd || 0) - (a.pool.positionUsd || 0));
  return tasks;
}

function tryAssign(pool, rev, score) {
  pool.revert = rev;
  pool.revertMatchScore = score;
}

/** Скоринг: чем меньше, тем лучше. null = не подходит. */
export function scoreRevertMatch(pool, protocol, rev, { strictUsd = true } = {}) {
  const chain = normalizeChain(pool.chain);
  if (normalizeChain(rev.chain) !== chain) return null;

  const pairKey = poolPairKey(pool);
  if (rev.pairKey !== pairKey) return null;

  if (!exchangeMatches(protocol, rev.exchange)) return null;

  const poolAddr = extractPoolAddress(pool);
  if (poolAddr && rev.poolAddress && poolAddr === rev.poolAddress.toLowerCase()) return 0;
  if (poolAddr && rev.positionId && poolAddr === rev.positionId.toLowerCase()) return 0;

  const usd = pool.positionUsd || 0;
  const revUsd = rev.pooledUsd || 0;
  const usdDiff = Math.abs(revUsd - usd);
  const tol = usdTolerance(usd, strictUsd ? 1 : 2.5);
  if (usdDiff > tol) return null;

  const claim = pool.claimableUsd || 0;
  const feeDiff = Math.abs((rev.uncollectedUsd || 0) - claim) * 1.5;
  let score = usdDiff + feeDiff;

  const poolFee = extractPoolFeeTier(pool);
  if (poolFee != null && rev.feeTierPct != null) {
    score += Math.abs(poolFee - rev.feeTierPct) * 0.08;
  }
  return score;
}

function greedyPass(tasks, available, matcher) {
  for (const { pool, protocol } of tasks) {
    if (pool.revert) continue;
    let bestIdx = -1;
    let bestScore = Infinity;
    for (let i = 0; i < available.length; i++) {
      const s = matcher(pool, protocol, available[i]);
      if (s == null) continue;
      if (s < bestScore) {
        bestScore = s;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      tryAssign(pool, available[bestIdx], bestScore);
      available.splice(bestIdx, 1);
    }
  }
}

export function attachRevertToPortfolio(portfolio, revertPositions) {
  const available = [...(revertPositions || [])];
  const tasks = collectLiquidityTasks(portfolio);

  for (const t of tasks) {
    t.pool.revert = null;
    t.pool.revertMatchScore = null;
  }

  // 1) строгий: chain + pair + DEX + USD
  greedyPass(tasks, available, (pool, protocol, rev) =>
    scoreRevertMatch(pool, protocol, rev, { strictUsd: true }),
  );

  // 2) мягче по USD
  greedyPass(tasks, available, (pool, protocol, rev) =>
    scoreRevertMatch(pool, protocol, rev, { strictUsd: false }),
  );

  // 3) chain + pair + DEX, USD очень широко
  for (const { pool, protocol } of tasks) {
    if (pool.revert) continue;
    const usd = pool.positionUsd || 0;
    let bestIdx = -1;
    let bestDiff = Infinity;
    for (let i = 0; i < available.length; i++) {
      const rev = available[i];
      if (normalizeChain(rev.chain) !== normalizeChain(pool.chain)) continue;
      if (rev.pairKey !== poolPairKey(pool)) continue;
      if (!exchangeMatches(protocol, rev.exchange)) continue;
      const d = Math.abs((rev.pooledUsd || 0) - usd);
      if (d < bestDiff) {
        bestDiff = d;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestDiff <= Math.max(5, usd * 3 + 3)) {
      tryAssign(pool, available[bestIdx], bestDiff);
      available.splice(bestIdx, 1);
    }
  }

  // 4) Jina plain: только USD (застейканные NFT, пара не в scrape)
  for (const { pool } of tasks) {
    if (pool.revert) continue;
    let bestIdx = -1;
    let bestDiff = Infinity;
    const usd = pool.positionUsd || 0;
    for (let i = 0; i < available.length; i++) {
      const rev = available[i];
      if (!rev.jinaPlain) continue;
      if (rev.chain && normalizeChain(rev.chain) !== normalizeChain(pool.chain)) continue;
      const d = Math.abs((rev.pooledUsd || 0) - usd);
      if (d < bestDiff) {
        bestDiff = d;
        bestIdx = i;
      }
    }
    const tol = Math.max(12, usd * 0.06 + 8);
    if (bestIdx >= 0 && bestDiff <= tol) {
      tryAssign(pool, available[bestIdx], bestDiff);
      available.splice(bestIdx, 1);
    }
  }

  // 5) только chain + pair (одинаковые пары на DEX не указанном в Revert — редко)
  for (const { pool } of tasks) {
    if (pool.revert) continue;
    let bestIdx = -1;
    let bestDiff = Infinity;
    const usd = pool.positionUsd || 0;
    for (let i = 0; i < available.length; i++) {
      const rev = available[i];
      if (normalizeChain(rev.chain) !== normalizeChain(pool.chain)) continue;
      if (rev.pairKey !== poolPairKey(pool)) continue;
      const d = Math.abs((rev.pooledUsd || 0) - usd);
      if (d < bestDiff) {
        bestDiff = d;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestDiff <= Math.max(8, usd * 4 + 5)) {
      tryAssign(pool, available[bestIdx], bestDiff);
      available.splice(bestIdx, 1);
    }
  }

  portfolio._revertAvailable = available.length;
  return portfolio;
}

/** Проставить chain на Jina-блоках без сети (по доминирующей сети портфеля). */
export function assignJinaPlainChains(portfolio, revertPositions) {
  const chains = portfolio?.chains || [];
  const dominant = chains.length ? normalizeChain(chains[0].slug) : "";
  if (!dominant) return revertPositions;
  return (revertPositions || []).map((r) =>
    r.jinaPlain && !r.chain ? { ...r, chain: dominant, network: dominant } : r,
  );
}
