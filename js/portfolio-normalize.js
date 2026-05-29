/**
 * Нормализация slug сетей; итог = DeBank, KPI = сумма категорий.
 */
import { chainSlug } from "./chains.js";
import { dedupePortfolioPositions, isSyntheticLiquidityRow } from "./portfolio-dedupe.js";
import { recalcLiquidityTotals } from "./revert-portfolio-merge.js";
import { saneLendingPosition } from "./portfolio-sanity.js";
import {
  fillCoverageResidual,
  fillCoverageFromProtocolTabs,
  fillCoverageFromChainGaps,
  fillCoverageCatchUp,
} from "./portfolio-debank-fill.js";
import { applyLendingMetrics } from "./lending-metrics.js";

export const PORTFOLIO_SCHEMA = 12;

function inferChainFromProtocolName(protocol) {
  const p = String(protocol || "").toLowerCase();
  if (p.includes("aerodrome")) return "base";
  if (p.includes("velodrome")) return "op";
  if (p.includes("gmx")) return "arb";
  if (p.includes("hyperliquid")) return "hyperliquid";
  if (p.includes("fluid") || p.includes("aave") || p.includes("compound")) return "eth";
  return null;
}

/** Quick DeBank: LP без сети — сопоставляем вкладки протокола с breakdown по chain. */
export function assignUnknownLiquidityChains(portfolio) {
  if (!portfolio?.protocolGroups?.length) return portfolio;
  const chains = (portfolio.chains || []).filter((c) => c.slug && c.slug !== "unknown");
  if (!chains.length) return portfolio;

  const tabsByProto = new Map();
  for (const tab of portfolio.protocolTabs || []) {
    if (!tab.protocol || tab.protocol === "Wallet") continue;
    if (!tabsByProto.has(tab.protocol)) tabsByProto.set(tab.protocol, []);
    tabsByProto.get(tab.protocol).push(tab);
  }

  for (const g of portfolio.protocolGroups) {
    if (g.protocol === "Wallet" || g.protocol === "DeBank") continue;

    const unknownPools = (g.liquidity || []).filter(
      (p) => !isSyntheticLiquidityRow(p, g.protocol) && (!p.chain || p.chain === "unknown"),
    );
    if (!unknownPools.length) continue;

    const protoTabs = (tabsByProto.get(g.protocol) || [])
      .slice()
      .sort((a, b) => (b.usd || 0) - (a.usd || 0));
    const sortedPools = unknownPools
      .slice()
      .sort((a, b) => (b.positionUsd || 0) - (a.positionUsd || 0));

    if (protoTabs.length >= 1 && sortedPools.length >= 1) {
      const usedTabs = new Set();
      const usedChains = new Set();
      for (const pool of sortedPools) {
        let bestTab = null;
        let bestTabDist = Infinity;
        for (const tab of protoTabs) {
          if (usedTabs.has(tab)) continue;
          const d = Math.abs((tab.usd || 0) - (pool.positionUsd || 0));
          if (d < bestTabDist) {
            bestTabDist = d;
            bestTab = tab;
          }
        }
        if (bestTab) usedTabs.add(bestTab);
        const targetUsd = bestTab?.usd ?? pool.positionUsd ?? 0;
        let best = null;
        let bestDist = Infinity;
        for (const c of chains) {
          if (usedChains.has(c.slug) && sortedPools.length > 1) continue;
          const d = Math.abs((c.usd || 0) - targetUsd);
          if (d < bestDist) {
            bestDist = d;
            best = c.slug;
          }
        }
        if (!best) best = inferChainFromProtocolName(g.protocol) || chains[0]?.slug;
        pool.chain = best;
        usedChains.add(best);
      }
    }

    for (const p of g.lending || []) {
      if (p.chain && p.chain !== "unknown") continue;
      const hint = inferChainFromProtocolName(g.protocol);
      if (hint) {
        p.chain = hint;
        if (!g.chain || g.chain === "unknown") g.chain = hint;
      } else if (chains.length === 1) {
        p.chain = chains[0].slug;
        g.chain = chains[0].slug;
      }
    }
  }

  return portfolio;
}

/** Разнести LP по сетям в отдельные protocolGroups (Uniswap arb / op / eth). */
export function splitLiquidityGroupsByChain(portfolio) {
  if (!portfolio?.protocolGroups?.length) return portfolio;
  const out = [];
  for (const g of portfolio.protocolGroups) {
    if (g.protocol === "Wallet") {
      out.push(g);
      continue;
    }
    const liq = (g.liquidity || []).filter((p) => !isSyntheticLiquidityRow(p, g.protocol));
    const lend = g.lending || [];
    if (!liq.length) {
      out.push(g);
      continue;
    }
    const byChain = new Map();
    for (const p of liq) {
      const ch = normChain(p.chain || g.chain);
      p.chain = ch;
      if (!byChain.has(ch)) byChain.set(ch, []);
      byChain.get(ch).push(p);
    }
    if (byChain.size <= 1) {
      const ch = [...byChain.keys()][0] || normChain(g.chain);
      g.chain = ch;
      g.liquidity = liq;
      out.push(g);
      continue;
    }
    for (const [ch, rows] of byChain) {
      const lendHere = lend.filter((p) => normChain(p.chain || g.chain) === ch);
      out.push({
        ...g,
        chain: ch,
        liquidity: rows,
        lending: lendHere,
        walletTokens: [],
        id: `${g.protocol}|${ch}`,
      });
    }
  }
  portfolio.protocolGroups = out.filter(
    (g) =>
      g.protocol === "Wallet" ||
      (g.liquidity || []).length ||
      (g.lending || []).length ||
      (g.walletTokens || []).length,
  );
  return portfolio;
}

function purgeSyntheticFills(portfolio) {
  for (const g of portfolio.protocolGroups || []) {
    g.liquidity = (g.liquidity || []).filter((p) => !isSyntheticLiquidityRow(p, g.protocol));
    g.lending = (g.lending || []).filter((p) => !p.debankFill);
  }
  portfolio.protocolGroups = (portfolio.protocolGroups || []).filter(
    (g) =>
      g.protocol === "Wallet" ||
      (g.liquidity || []).length ||
      (g.lending || []).length ||
      (g.walletTokens || []).length,
  );
}

function normChain(c) {
  return chainSlug(c || "unknown");
}

function roundUsd(n) {
  return Math.round((n || 0) * 100) / 100;
}

/** DeBank total — главный; wallet/liq/lend пересчитываем из позиций. */
function normalizeLendingMetrics(portfolio) {
  for (const g of portfolio?.protocolGroups || []) {
    g.lending = (g.lending || []).map((p) => applyLendingMetrics(p));
  }
  if (portfolio?.lending?.length) {
    portfolio.lending = portfolio.lending.map((p) => applyLendingMetrics(p));
  }
}

export function syncDisplayTotals(portfolio) {
  if (!portfolio) return portfolio;
  dedupePortfolioPositions(portfolio);
  normalizeLendingMetrics(portfolio);
  recalcLiquidityTotals(portfolio);

  const chainSum = (portfolio.chains || []).reduce((s, c) => s + (c.usd || 0), 0);
  const parseChains = (portfolio.chains || []).some(
    (c) => c.pct != null && c.name && c.name !== String(c.slug || "").toUpperCase(),
  );
  if (parseChains && chainSum > 20 && (portfolio.debankTotalUsd || 0) > chainSum * 1.5) {
    portfolio.debankTotalUsd = roundUsd(chainSum);
  }

  const walletUsd = (portfolio.walletTokens || []).reduce((s, t) => s + (t.usd || 0), 0);
  const nonWalletGroups = (portfolio.protocolGroups || []).filter((g) => g.protocol !== "Wallet");
  const debankEarly = portfolio.debankTotalUsd ?? portfolio.totalUsd ?? 0;
  let walletFinal = walletUsd;
  const wg = (portfolio.protocolGroups || []).find((g) => g.protocol === "Wallet");
  if (nonWalletGroups.length === 0 && debankEarly > 80 && walletUsd > debankEarly * 1.15) {
    walletFinal = 0;
    portfolio.walletTokens = [];
    if (wg) {
      wg.walletTokens = [];
      wg.protocolUsd = 0;
    }
  }
  let lendUsd = 0;
  const seenLend = new Set();
  for (const g of portfolio.protocolGroups || []) {
    for (const x of g.lending || []) {
      if (!saneLendingPosition(x, portfolio.debankTotalUsd ?? portfolio.totalUsd)) continue;
      const k = `${g.protocol}|${x.chain}|${x.collateralUsd}|${x.debtUsd}`;
      if (seenLend.has(k)) continue;
      seenLend.add(k);
      lendUsd += x.netUsd || 0;
    }
  }
  let liqUsd = portfolio.liqUsd ?? 0;
  let computed = roundUsd(walletFinal + liqUsd + lendUsd);

  const debankTotal =
    portfolio.debankTotalUsd ??
    portfolio.hybridMeta?.debankTotalUsd ??
    portfolio.totalUsd ??
    computed;

  let debank = roundUsd(debankTotal);
  let lendFinal = lendUsd;
  if (debank > 0 && computed > debank * 1.1) {
    dedupePortfolioPositions(portfolio);
    recalcLiquidityTotals(portfolio);
    walletFinal = (portfolio.walletTokens || []).reduce((s, t) => s + (t.usd || 0), 0);
    lendFinal = 0;
    const seenL2 = new Set();
    for (const g of portfolio.protocolGroups || []) {
      for (const x of g.lending || []) {
        if (!saneLendingPosition(x, debank)) continue;
        const k = `${g.protocol}|${x.chain}|${x.collateralUsd}|${x.debtUsd}`;
        if (seenL2.has(k)) continue;
        seenL2.add(k);
        lendFinal += x.netUsd || 0;
      }
    }
    liqUsd = portfolio.liqUsd ?? 0;
    computed = roundUsd(walletFinal + liqUsd + lendFinal);
  }

  portfolio.debankTotalUsd = debank;
  portfolio.computedTotalUsd = computed;
  const gap = roundUsd(debank - computed);
  portfolio.coverageGapUsd = Math.max(0, gap);
  portfolio.overCountUsd = gap < 0 ? roundUsd(-gap) : 0;
  portfolio.walletUsd = roundUsd(walletFinal);
  portfolio.lendUsd = roundUsd(lendFinal);
  portfolio.liqUsd = roundUsd(liqUsd);
  if (debank > 0 && computed > debank && computed <= debank * 1.15) {
    debank = roundUsd(computed);
    portfolio.debankTotalUsd = debank;
    portfolio.coverageGapUsd = 0;
    portfolio.overCountUsd = 0;
  }

  if (debank > 0 && computed > debank * 1.12) {
    for (const g of portfolio.protocolGroups || []) {
      g.liquidity = (g.liquidity || []).filter((p) => !p.debankFill);
      g.lending = (g.lending || []).filter((p) => !p.debankFill);
    }
    dedupePortfolioPositions(portfolio);
    recalcLiquidityTotals(portfolio);
    walletFinal = (portfolio.walletTokens || []).reduce((s, t) => s + (t.usd || 0), 0);
    lendFinal = 0;
    const seenOx = new Set();
    for (const g of portfolio.protocolGroups || []) {
      for (const x of g.lending || []) {
        if (!saneLendingPosition(x, debank)) continue;
        const k = `${g.protocol}|${x.chain}|${x.collateralUsd}|${x.debtUsd}`;
        if (seenOx.has(k)) continue;
        seenOx.add(k);
        lendFinal += x.netUsd || 0;
      }
    }
    liqUsd = portfolio.liqUsd ?? 0;
    computed = roundUsd(walletFinal + liqUsd + lendFinal);
    portfolio.walletUsd = roundUsd(walletFinal);
    portfolio.lendUsd = roundUsd(lendFinal);
    portfolio.liqUsd = roundUsd(liqUsd);
    portfolio.computedTotalUsd = computed;
    portfolio.coverageGapUsd = Math.max(0, roundUsd(debank - computed));
    portfolio.overCountUsd = computed > debank ? roundUsd(computed - debank) : 0;
  }

  let gapBeforeFill = debank - computed;
  if (debank >= 80 && gapBeforeFill > debank * 0.05 && computed < debank * 0.995) {
    fillCoverageFromProtocolTabs(portfolio);
    fillCoverageFromChainGaps(portfolio);
    dedupePortfolioPositions(portfolio);
    recalcLiquidityTotals(portfolio);
    walletFinal = (portfolio.walletTokens || []).reduce((s, t) => s + (t.usd || 0), 0);
    lendFinal = 0;
    const seenFill = new Set();
    for (const g of portfolio.protocolGroups || []) {
      for (const x of g.lending || []) {
        if (!saneLendingPosition(x, debank)) continue;
        const k = `${g.protocol}|${x.chain}|${x.collateralUsd}|${x.debtUsd}`;
        if (seenFill.has(k)) continue;
        seenFill.add(k);
        lendFinal += x.netUsd || 0;
      }
    }
    liqUsd = portfolio.liqUsd ?? 0;
    computed = roundUsd(walletFinal + liqUsd + lendFinal);
    gapBeforeFill = debank - computed;
  }
  if (debank >= 80 && gapBeforeFill > debank * 0.03 && gapBeforeFill <= debank * 0.55) {
    fillCoverageResidual(portfolio);
    dedupePortfolioPositions(portfolio);
    recalcLiquidityTotals(portfolio);
    walletFinal = (portfolio.walletTokens || []).reduce((s, t) => s + (t.usd || 0), 0);
    lendFinal = 0;
    const seenL3 = new Set();
    for (const g of portfolio.protocolGroups || []) {
      for (const x of g.lending || []) {
        if (!saneLendingPosition(x, debank)) continue;
        const k = `${g.protocol}|${x.chain}|${x.collateralUsd}|${x.debtUsd}`;
        if (seenL3.has(k)) continue;
        seenL3.add(k);
        lendFinal += x.netUsd || 0;
      }
    }
    liqUsd = portfolio.liqUsd ?? 0;
    computed = roundUsd(walletFinal + liqUsd + lendFinal);
    portfolio.walletUsd = roundUsd(walletFinal);
    portfolio.lendUsd = roundUsd(lendFinal);
    portfolio.liqUsd = roundUsd(liqUsd);
    portfolio.computedTotalUsd = computed;
    portfolio.coverageGapUsd = Math.max(0, roundUsd(debank - computed));
    portfolio.overCountUsd = computed > debank ? roundUsd(computed - debank) : 0;
  }

  if (debank > 0 && computed > debank * 1.12) {
    portfolio.walletTokens = [];
    const wg = (portfolio.protocolGroups || []).find((g) => g.protocol === "Wallet");
    if (wg) {
      wg.walletTokens = [];
      wg.protocolUsd = 0;
    }
    dedupePortfolioPositions(portfolio);
    recalcLiquidityTotals(portfolio);
    walletFinal = 0;
    lendFinal = 0;
    const seenEnd = new Set();
    for (const g of portfolio.protocolGroups || []) {
      for (const x of g.lending || []) {
        if (!saneLendingPosition(x, debank)) continue;
        const k = `${g.protocol}|${x.chain}|${x.collateralUsd}|${x.debtUsd}`;
        if (seenEnd.has(k)) continue;
        seenEnd.add(k);
        lendFinal += x.netUsd || 0;
      }
    }
    liqUsd = portfolio.liqUsd ?? 0;
    computed = roundUsd(walletFinal + liqUsd + lendFinal);
    portfolio.walletUsd = 0;
    portfolio.lendUsd = roundUsd(lendFinal);
    portfolio.liqUsd = roundUsd(liqUsd);
    portfolio.computedTotalUsd = computed;
    portfolio.overCountUsd = computed > debank ? roundUsd(computed - debank) : 0;
    portfolio.coverageGapUsd = Math.max(0, roundUsd(debank - computed));
  }

  if (debank > 0 && computed < debank * 0.98) {
    fillCoverageCatchUp(portfolio);
    dedupePortfolioPositions(portfolio);
    recalcLiquidityTotals(portfolio);
    walletFinal = (portfolio.walletTokens || []).reduce((s, t) => s + (t.usd || 0), 0);
    lendFinal = 0;
    const seenCu = new Set();
    for (const g of portfolio.protocolGroups || []) {
      for (const x of g.lending || []) {
        if (!saneLendingPosition(x, debank)) continue;
        const k = `${g.protocol}|${x.chain}|${x.collateralUsd}|${x.debtUsd}`;
        if (seenCu.has(k)) continue;
        seenCu.add(k);
        lendFinal += x.netUsd || 0;
      }
    }
    liqUsd = portfolio.liqUsd ?? 0;
    computed = roundUsd(walletFinal + liqUsd + lendFinal);
    portfolio.walletUsd = roundUsd(walletFinal);
    portfolio.lendUsd = roundUsd(lendFinal);
    portfolio.liqUsd = roundUsd(liqUsd);
    portfolio.computedTotalUsd = computed;
    portfolio.coverageGapUsd = Math.max(0, roundUsd(debank - computed));
    portfolio.overCountUsd = 0;
  }

  portfolio.totalUsd = roundUsd(debank > 0 ? debank : computed);
  portfolio.partial =
    portfolio.coverageGapUsd > Math.max(0.5, debank * 0.08) ||
    portfolio.overCountUsd > Math.max(0.5, debank * 0.08);

  if (portfolio.coverageGapUsd <= Math.max(1, debank * 0.03)) {
    purgeSyntheticFills(portfolio);
    dedupePortfolioPositions(portfolio);
    recalcLiquidityTotals(portfolio);
    walletFinal = (portfolio.walletTokens || []).reduce((s, t) => s + (t.usd || 0), 0);
    lendFinal = 0;
    const seenFin = new Set();
    for (const g of portfolio.protocolGroups || []) {
      for (const x of g.lending || []) {
        if (!saneLendingPosition(x, debank)) continue;
        const k = `${g.protocol}|${x.chain}|${x.collateralUsd}|${x.debtUsd}`;
        if (seenFin.has(k)) continue;
        seenFin.add(k);
        lendFinal += x.netUsd || 0;
      }
    }
    liqUsd = portfolio.liqUsd ?? 0;
    computed = roundUsd(walletFinal + liqUsd + lendFinal);
    portfolio.walletUsd = roundUsd(walletFinal);
    portfolio.lendUsd = roundUsd(lendFinal);
    portfolio.liqUsd = roundUsd(liqUsd);
    portfolio.computedTotalUsd = computed;
    portfolio.coverageGapUsd = Math.max(0, roundUsd(debank - computed));
    portfolio.overCountUsd = computed > debank ? roundUsd(computed - debank) : 0;
    portfolio.partial =
      portfolio.coverageGapUsd > Math.max(0.5, debank * 0.08) ||
      portfolio.overCountUsd > Math.max(0.5, debank * 0.08);
  }

  return portfolio;
}

export function normalizePortfolioChains(portfolio) {
  if (!portfolio) return portfolio;
  const p = portfolio;
  assignUnknownLiquidityChains(p);
  splitLiquidityGroupsByChain(p);

  for (const t of p.walletTokens || []) {
    t.chain = normChain(t.chain);
  }
  if (p.walletByChain) {
    const next = {};
    for (const [ch, list] of Object.entries(p.walletByChain)) {
      const slug = normChain(ch);
      if (!next[slug]) next[slug] = [];
      next[slug].push(...list);
    }
    p.walletByChain = next;
  }

  for (const row of p.liquidity || []) {
    row.chain = normChain(row.chain);
  }
  for (const row of p.lending || []) {
    row.chain = normChain(row.chain);
  }

  for (const g of p.protocolGroups || []) {
    if (g.chain && g.chain !== "all") g.chain = normChain(g.chain);
    for (const t of g.walletTokens || []) {
      t.chain = normChain(t.chain);
    }
    for (const x of g.liquidity || []) {
      x.chain = normChain(x.chain);
    }
    for (const x of g.lending || []) {
      x.chain = normChain(x.chain);
    }
  }

  for (const c of p.chains || []) {
    c.slug = normChain(c.slug);
  }

  p.schemaVersion = PORTFOLIO_SCHEMA;
  dedupePortfolioPositions(p);
  return syncDisplayTotals(p);
}
