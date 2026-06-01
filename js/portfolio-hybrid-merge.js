/**
 * Приоритет: 1) ончейн (RPC/Etherscan) — истина  2) Revert (APY)  3) DeBank только сверка, без фантомов.
 */
import { normalizeChain, poolPairKey } from "./revert-match.js";
import { extractLpTokenId } from "./lp-onchain.js";
import { recalcLiquidityTotals } from "./revert-portfolio-merge.js";
import { saneLendingPosition, saneLiquidityPosition } from "./portfolio-sanity.js";
import { syncDisplayTotals, rebuildChainBreakdown } from "./portfolio-normalize.js";
import { removeLegacyDebankGroups, recalcAllProtocolUsd } from "./portfolio-debank-fill.js";

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

/** LP: по NFT id (сеть с DeBank может быть неверной). */
function lpKey(protocol, p, chainHint) {
  const tid = extractLpTokenId(p);
  if (tid) return `liq|tid|${tid}`;
  const ch = normalizeChain(p.chain || chainHint);
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
  return `wal|${normalizeChain(t.chain)}|${String(t.symbol || "").toUpperCase()}|${String(t.address || "").toLowerCase()}`;
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
  portfolio.totalUsd = computed;
  portfolio.coverageGapUsd = Math.max(0, roundUsd(debank - computed));
  portfolio.partial = portfolio.coverageGapUsd > Math.max(5, debank * 0.03);
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

function collectOnchainTokenIds(oc) {
  const ids = new Set();
  for (const g of oc.protocolGroups || []) {
    for (const p of g.liquidity || []) {
      const tid = extractLpTokenId(p);
      if (tid) ids.add(tid);
    }
  }
  return ids;
}

/** Убрать DeBank LP с тем же NFT id, но неверной сетью / без ончейн-подтверждения. */
function stripPhantomDebankLp(portfolio, onchainTids) {
  if (!onchainTids.size) return;
  for (const g of portfolio.protocolGroups || []) {
    g.liquidity = (g.liquidity || []).filter((p) => {
      if (p.onchain || p.source === "onchain") return true;
      const tid = extractLpTokenId(p);
      if (!tid || !onchainTids.has(tid)) return true;
      return false;
    });
  }
}

function stripSyntheticFills(portfolio) {
  for (const g of portfolio.protocolGroups || []) {
    g.liquidity = (g.liquidity || []).filter((p) => !p.overviewFill && !p.debankFill);
    g.lending = (g.lending || []).filter((p) => !p.overviewFill);
  }
}

/** DeBank wallet на сетях, где ончейн уже сканировал — только если баланс подтверждён RPC/Etherscan. */
function pruneUnverifiedWalletTokens(portfolio, oc) {
  const verified = new Set((oc.walletTokens || []).map(walletKey));
  const scanned = new Set(
    (oc.stats?.scannedChains || oc.stats?.chains || []).map((c) => normalizeChain(c)),
  );
  if (!scanned.size) return;

  portfolio.walletTokens = (portfolio.walletTokens || []).filter((t) => {
    const ch = normalizeChain(t.chain);
    if (!scanned.has(ch)) return true;
    if (verified.has(walletKey(t))) return true;
    return false;
  });

  const wg = (portfolio.protocolGroups || []).find((g) => g.protocol === "Wallet");
  if (wg) {
    wg.walletTokens = (wg.walletTokens || []).filter((t) => {
      const ch = normalizeChain(t.chain);
      if (!scanned.has(ch)) return true;
      return verified.has(walletKey(t));
    });
  }
}

function dedupeGroups(portfolio) {
  for (const g of portfolio.protocolGroups || []) {
    const liqBy = new Map();
    for (const p of g.liquidity || []) {
      const tid = extractLpTokenId(p);
      const k = tid ? `tid|${tid}` : poolPairKey(p);
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
  stripSyntheticFills(out);
  const liqMap = indexDebankLiquidity(out);
  const lendMap = indexDebankLending(out);
  let replacedCount = 0;
  let onchainOnlyCount = 0;
  const debankTotal = db.debankTotalUsd ?? db.totalUsd ?? 0;
  const onchainTids = collectOnchainTokenIds(oc);

  for (const og of oc.protocolGroups || []) {
    if (og.protocol === "Wallet") continue;

    for (const p of og.liquidity || []) {
      if (!saneLiquidityPosition(p, debankTotal)) continue;
      const k = lpKey(og.protocol, p, og.chain);
      const hit = liqMap.get(k);
      const enriched = {
        ...clone(p),
        protocol: og.protocol,
        chain: normalizeChain(p.chain || og.chain),
        onchain: true,
        debankFill: false,
        overviewFill: false,
        source: "onchain",
      };
      if (hit) {
        const prev = hit.g.liquidity[hit.idx];
        hit.g.liquidity[hit.idx] = {
          ...prev,
          ...enriched,
          chain: enriched.chain,
          pair: enriched.pair || prev.pair,
          pairKey: enriched.pairKey || prev.pairKey,
          poolId: enriched.poolId || prev.poolId,
          positionUsd: Math.max(prev.positionUsd || 0, enriched.positionUsd || 0),
          inPool: (enriched.inPool || []).length ? enriched.inPool : prev.inPool,
          rangeMin: enriched.rangeMin ?? prev.rangeMin,
          rangeMax: enriched.rangeMax ?? prev.rangeMax,
          rangeCurrent: enriched.rangeCurrent ?? prev.rangeCurrent,
          feeTier: enriched.feeTier || prev.feeTier,
          feesEarned: enriched.feesEarned || prev.feesEarned,
          onchainMetrics: !!(enriched.onchainMetrics || prev.onchainMetrics),
          revert: prev.revert || enriched.revert,
        };
        if (normalizeChain(hit.g.chain) !== enriched.chain) {
          hit.g.chain = enriched.chain;
        }
        replacedCount += 1;
      } else {
        const g = findOrCreateGroup(out, og.protocol, enriched.chain);
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

  stripPhantomDebankLp(out, onchainTids);

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

  pruneUnverifiedWalletTokens(out, oc);

  dedupeGroups(out);

  recomputeTotals(out);
  removeLegacyDebankGroups(out);
  recalcAllProtocolUsd(out);
  dedupeGroups(out);
  recomputeTotals(out);
  rebuildChainBreakdown(out);
  const computedTotal = out.computedTotalUsd ?? 0;

  out.source = "hybrid";
  out.onchain = true;
  out.hybrid = true;
  out.debankTotalUsd = roundUsd(debankTotal);
  const gapUsd = roundUsd(Math.max(0, debankTotal - computedTotal));
  const coveragePct =
    debankTotal > 0 ? Math.min(100, Math.round((computedTotal / debankTotal) * 1000) / 10) : 100;
  out.hybridMeta = {
    onchainUsd: roundUsd(oc.totalUsd || computedTotal),
    debankTotalUsd: roundUsd(debankTotal),
    computedUsd: roundUsd(computedTotal),
    mergedTotalUsd: roundUsd(computedTotal),
    gapUsd,
    coveragePct,
    onchainCoveragePct: coveragePct,
    replacedCount,
    onchainOnlyCount,
    fillCount: 0,
    debankFillUsd: gapUsd,
    scanChains: oc.stats?.scannedChains ?? oc.stats?.chains,
    priority: ["onchain", "revert", "debank"],
  };
  out.coverageGapUsd = gapUsd;
  out.partial = gapUsd > Math.max(5, debankTotal * 0.05);
  out.stats = {
    ...(oc.stats || {}),
    ...(out.stats || {}),
    debankFillCount: 0,
    onchainReplaced: replacedCount,
    etherscan: oc.stats?.etherscan ?? out.stats?.etherscan,
    etherscanUsage: oc.stats?.etherscanUsage ?? out.stats?.etherscanUsage,
  };

  return syncDisplayTotals(out);
}
