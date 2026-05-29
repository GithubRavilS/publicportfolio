/**
 * Приоритет: 1) ончейн (RPC) заменяет совпадения  2) Revert (APY)  3) DeBank — база + пробелы.
 * Старт с DeBank → подмена совпавших позиций ончейн → добавление только ончейн-эксклюзивных.
 */
import { normalizeChain, poolPairKey } from "./revert-match.js";
import { extractLpTokenId } from "./lp-onchain.js";
import { recalcLiquidityTotals } from "./revert-portfolio-merge.js";
import { saneLendingPosition, saneLiquidityPosition } from "./portfolio-sanity.js";
import { syncDisplayTotals } from "./portfolio-normalize.js";

function clone(p) {
  return JSON.parse(JSON.stringify(p || {}));
}

function roundUsd(n) {
  return Math.round((n || 0) * 100) / 100;
}

function findOrCreateGroup(portfolio, protocol, chain) {
  const ch = normalizeChain(chain || "unknown");
  let g = (portfolio.protocolGroups || []).find(
    (x) => x.protocol === protocol && normalizeChain(x.chain) === ch,
  );
  if (!g) {
    g = {
      protocol,
      chain: ch,
      protocolUsd: 0,
      kinds: [],
      lending: [],
      liquidity: [],
      walletTokens: [],
      id: `${protocol}|${ch}`,
    };
    if (!portfolio.protocolGroups) portfolio.protocolGroups = [];
    portfolio.protocolGroups.push(g);
  }
  return g;
}

function addKind(g, kind) {
  if (kind && !g.kinds.includes(kind)) g.kinds.push(kind);
}

/** Совпадение LP: NFT id (DeBank #…) или протокол + сеть + пара. */
function lpKey(protocol, p, chainHint) {
  const ch = normalizeChain(p.chain || chainHint);
  const tid = extractLpTokenId(p);
  if (tid) return `liq|tid|${ch}|${tid}`;
  return `liq|${protocol}|${ch}|${poolPairKey(p)}`;
}

function normAsset(sym) {
  return String(sym || "")
    .toUpperCase()
    .replace(/\s/g, "");
}

function lendKey(protocol, p, chainHint) {
  const sup = (p.supplied || [])
    .map((x) => normAsset(x.asset))
    .filter(Boolean)
    .sort()
    .join("+");
  const bor = (p.borrowed || [])
    .map((x) => normAsset(x.asset))
    .filter(Boolean)
    .sort()
    .join("+");
  return `lend|${protocol}|${normalizeChain(p.chain || chainHint)}|${sup}|${bor}`;
}

function walletKey(t) {
  return `wal|${normalizeChain(t.chain)}|${String(t.symbol || "").toUpperCase()}`;
}

function recomputeChainsAndTabs(portfolio) {
  const byChain = new Map();
  for (const g of portfolio.protocolGroups || []) {
    if (g.protocol === "Wallet") continue;
    const ch = normalizeChain(g.chain);
    byChain.set(ch, (byChain.get(ch) || 0) + (g.protocolUsd || 0));
  }
  for (const t of portfolio.walletTokens || []) {
    const ch = normalizeChain(t.chain);
    byChain.set(ch, (byChain.get(ch) || 0) + (t.usd || 0));
  }
  const total = [...byChain.values()].reduce((s, v) => s + v, 0) || 1;
  portfolio.chains = [...byChain.entries()]
    .map(([slug, usd]) => ({
      slug,
      name: slug.toUpperCase(),
      usd: roundUsd(usd),
      pct: Math.round((usd / total) * 100),
    }))
    .sort((a, b) => b.usd - a.usd);

  portfolio.protocolTabs = (portfolio.protocolGroups || [])
    .filter((g) => g.protocol !== "Wallet")
    .map((g) => ({ protocol: g.protocol, usd: g.protocolUsd }))
    .sort((a, b) => b.usd - a.usd);
}

function flattenLending(portfolio) {
  const flat = [];
  for (const g of portfolio.protocolGroups || []) {
    for (const p of g.lending || []) {
      flat.push({ ...p, protocol: g.protocol, chain: g.chain });
    }
  }
  portfolio.lending = flat;
}

function recomputeTotals(portfolio) {
  recalcLiquidityTotals(portfolio);
  flattenLending(portfolio);
  const walletUsd = (portfolio.walletTokens || []).reduce((s, t) => s + (t.usd || 0), 0);
  const lendUsd = portfolio.lending.reduce((s, p) => s + (p.netUsd || 0), 0);
  portfolio.walletUsd = roundUsd(walletUsd);
  portfolio.lendUsd = roundUsd(lendUsd);
  const computed = roundUsd(portfolio.liqUsd + portfolio.lendUsd + portfolio.walletUsd);
  portfolio.computedTotalUsd = computed;
  const debank =
    portfolio.debankTotalUsd ?? portfolio.hybridMeta?.debankTotalUsd ?? portfolio.totalUsd;
  portfolio.debankTotalUsd = roundUsd(debank);
  portfolio.totalUsd = portfolio.debankTotalUsd;
  portfolio.coverageGapUsd = Math.max(0, roundUsd(debank - computed));
  portfolio.partial = portfolio.coverageGapUsd > 0.5;
  recomputeChainsAndTabs(portfolio);
}

function indexDebankLiquidity(portfolio) {
  const map = new Map();
  for (const g of portfolio.protocolGroups || []) {
    (g.liquidity || []).forEach((p, idx) => {
      map.set(lpKey(g.protocol, p, g.chain), { g, idx });
    });
  }
  return map;
}

function indexDebankLending(portfolio) {
  const map = new Map();
  for (const g of portfolio.protocolGroups || []) {
    (g.lending || []).forEach((p, idx) => {
      map.set(lendKey(g.protocol, p, g.chain), { g, idx });
    });
  }
  return map;
}

/** Убрать дубли LP/lend: приоритет onchain. */
function dedupeGroups(portfolio) {
  for (const g of portfolio.protocolGroups || []) {
    const liqBy = new Map();
    for (const p of g.liquidity || []) {
      const k = poolPairKey(p);
      const prev = liqBy.get(k);
      if (!prev || p.onchain) liqBy.set(k, p);
    }
    g.liquidity = [...liqBy.values()];

    const lendBy = new Map();
    for (const p of g.lending || []) {
      const k = lendKey(g.protocol, p, g.chain);
      const prev = lendBy.get(k);
      const prevOk = prev && saneLendingPosition(prev, portfolio.debankTotalUsd);
      const nextOk = saneLendingPosition(p, portfolio.debankTotalUsd);
      if (!nextOk) continue;
      if (!prevOk || p.onchain) lendBy.set(k, p);
    }
    g.lending = [...lendBy.values()];
  }
}

/**
 * @param {object|null} onchain
 * @param {object|null} debank
 */
export function mergeHybridPortfolio(onchain, debank) {
  const oc = onchain?.protocolGroups?.length ? onchain : null;
  const db = debank?.protocolGroups?.length ? debank : null;

  if (!oc && !db) {
    return {
      totalUsd: 0,
      walletUsd: 0,
      liqUsd: 0,
      lendUsd: 0,
      protocolGroups: [],
      walletTokens: [],
      lending: [],
      liquidity: [],
      chains: [],
      protocolTabs: [],
      source: "empty",
    };
  }
  if (!oc) {
    const only = clone(db);
    only.source = "debank";
    only.hybridMeta = {
      onchainUsd: 0,
      debankFillUsd: only.totalUsd || 0,
      debankTotalUsd: only.totalUsd || 0,
      fillCount: 0,
      replacedCount: 0,
      priority: ["onchain", "revert", "debank"],
    };
    return only;
  }
  if (!db) {
    const only = clone(oc);
    only.source = "onchain";
    only.onchain = true;
    only.hybridMeta = {
      onchainUsd: only.totalUsd || 0,
      debankFillUsd: 0,
      debankTotalUsd: 0,
      fillCount: 0,
      replacedCount: 0,
      priority: ["onchain", "revert", "debank"],
    };
    return only;
  }

  const out = clone(db);
  const liqMap = indexDebankLiquidity(out);
  const lendMap = indexDebankLending(out);
  let replacedCount = 0;
  let onchainOnlyCount = 0;
  const debankTotal = db.debankTotalUsd ?? db.totalUsd ?? 0;

  for (const og of oc.protocolGroups || []) {
    if (og.protocol === "Wallet") continue;

    for (const p of og.liquidity || []) {
      if (!saneLiquidityPosition(p, debankTotal)) continue;
      const k = lpKey(og.protocol, p, og.chain);
      const hit = liqMap.get(k);
      const enriched = {
        ...clone(p),
        protocol: og.protocol,
        onchain: true,
        debankFill: false,
        source: "onchain",
      };
      if (hit) {
        const prev = hit.g.liquidity[hit.idx];
        hit.g.liquidity[hit.idx] = {
          ...prev,
          ...enriched,
          positionUsd: prev.positionUsd || enriched.positionUsd,
          pair: prev.pair || enriched.pair,
          poolId: prev.poolId || enriched.poolId,
          inPool: (prev.inPool || []).length ? prev.inPool : enriched.inPool,
          rangeMin: enriched.rangeMin ?? prev.rangeMin,
          rangeMax: enriched.rangeMax ?? prev.rangeMax,
          rangeCurrent: enriched.rangeCurrent ?? prev.rangeCurrent,
          feeTier: enriched.feeTier || prev.feeTier,
          feesEarned: enriched.feesEarned || prev.feesEarned,
          onchainMetrics: !!(enriched.onchainMetrics || prev.onchainMetrics),
          revert: prev.revert || enriched.revert,
        };
        replacedCount += 1;
      } else {
        const g = findOrCreateGroup(out, og.protocol, p.chain || og.chain);
        g.liquidity.push(enriched);
        onchainOnlyCount += 1;
        addKind(g, p.kind || "Liquidity Pool");
      }
    }

    for (const p of og.lending || []) {
      if (!saneLendingPosition(p, debankTotal)) continue;
      const k = lendKey(og.protocol, p, og.chain);
      const hit = lendMap.get(k);
      const enriched = {
        ...clone(p),
        protocol: og.protocol,
        onchain: true,
        debankFill: false,
        source: "onchain",
      };
      if (hit) {
        hit.g.lending[hit.idx] = enriched;
        replacedCount += 1;
      } else {
        const g = findOrCreateGroup(out, og.protocol, p.chain || og.chain);
        g.lending.push(enriched);
        onchainOnlyCount += 1;
        addKind(g, "Lending");
      }
    }
  }

  const walMap = new Map();
  for (const t of out.walletTokens || []) {
    walMap.set(walletKey(t), t);
  }
  const walletG = findOrCreateGroup(out, "Wallet", "all");
  for (const t of oc.walletTokens || []) {
    const k = walletKey(t);
    const enriched = { ...clone(t), onchain: true, debankFill: false, source: "onchain" };
    if (walMap.has(k)) {
      const i = out.walletTokens.findIndex((x) => walletKey(x) === k);
      if (i >= 0) out.walletTokens[i] = enriched;
      const wi = walletG.walletTokens.findIndex((x) => walletKey(x) === k);
      if (wi >= 0) walletG.walletTokens[wi] = enriched;
      replacedCount += 1;
    } else {
      out.walletTokens.push(enriched);
      walletG.walletTokens.push(enriched);
      onchainOnlyCount += 1;
    }
  }

  dedupeGroups(out);

  for (const g of out.protocolGroups || []) {
    for (const p of g.liquidity || []) {
      if (!p.onchain && !p.debankFill) {
        p.debankFill = true;
        p.source = p.source || "debank";
      }
    }
    for (const p of g.lending || []) {
      if (!p.onchain && !p.debankFill) {
        p.debankFill = true;
        p.source = p.source || "debank";
      }
    }
  }
  for (const t of out.walletTokens || []) {
    if (!t.onchain) {
      t.debankFill = true;
      t.source = t.source || "debank";
    }
  }

  recomputeTotals(out);
  const computedTotal = out.totalUsd;

  const fillCount = (out.protocolGroups || []).reduce((n, g) => {
    return (
      n +
      (g.liquidity || []).filter((p) => p.debankFill).length +
      (g.lending || []).filter((p) => p.debankFill).length
    );
  }, 0);

  out.source = "hybrid";
  out.onchain = true;
  out.hybrid = true;
  out.partial = !!db.partial;
  out.totalUsd = roundUsd(debankTotal);
  out.debankTotalUsd = roundUsd(debankTotal);
  out.hybridMeta = {
    onchainUsd: roundUsd(oc.totalUsd || 0),
    debankTotalUsd: roundUsd(debankTotal),
    computedUsd: roundUsd(computedTotal),
    mergedTotalUsd: roundUsd(debankTotal),
    gapUsd: roundUsd(debankTotal - computedTotal),
    replacedCount,
    onchainOnlyCount,
    fillCount,
    priority: ["onchain", "revert", "debank"],
  };
  out.stats = {
    ...(out.stats || {}),
    debankFillCount: fillCount,
    onchainReplaced: replacedCount,
  };

  return syncDisplayTotals(out);
}
