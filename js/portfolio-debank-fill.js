/**
 * Добор позиций из protocolTabs DeBank, когда Jina не отдаёт детали секций.
 * Без строк «DeBank / Unparsed» — только имена реальных протоколов.
 */
import { chainSlug } from "./chains.js";
import { cleanProtocolName, protocolKey, isValidProtocolTab } from "./debank-parse.js";

function roundUsd(n) {
  return Math.round((n || 0) * 100) / 100;
}

const LENDING_PROTO =
  /aave|compound|fluid|spark|morpho|euler|venus|benqi|radiant|moonwell|kinza|lista|maker/i;

function isLendingProtocol(name) {
  return LENDING_PROTO.test(cleanProtocolName(name));
}

function findGroup(portfolio, protocol, chain) {
  const ch = chainSlug(chain || "unknown");
  return (portfolio.protocolGroups || []).find(
    (g) => g.protocol === protocol && chainSlug(g.chain || "unknown") === ch,
  );
}

function ensureGroup(portfolio, protocol, chain) {
  let g = findGroup(portfolio, protocol, chain);
  if (!g) {
    if (!portfolio.protocolGroups) portfolio.protocolGroups = [];
    g = {
      protocol,
      chain: chainSlug(chain || "unknown"),
      protocolUsd: 0,
      liquidity: [],
      lending: [],
      walletTokens: [],
      kinds: [],
    };
    g.id = `${g.protocol}|${g.chain}`;
    portfolio.protocolGroups.push(g);
  }
  return g;
}

function sumProtocolUsd(portfolio, protocol) {
  const key = protocolKey(protocol);
  let s = 0;
  for (const g of portfolio.protocolGroups || []) {
    if (protocolKey(g.protocol) !== key) continue;
    for (const p of g.liquidity || []) s += p.positionUsd || 0;
    for (const p of g.lending || []) {
      s += Math.max(p.netUsd || 0, p.collateralUsd || 0, 0);
    }
  }
  return s;
}

function inferChainForProtocol(portfolio, protocol) {
  const key = protocolKey(protocol);
  const chains = portfolio.chains || [];
  const byProto = (portfolio.protocolGroups || []).filter(
    (g) => protocolKey(g.protocol) === key && g.chain && g.chain !== "unknown",
  );
  if (byProto.length) return byProto[0].chain;
  if (chains.length) return chains[0].slug;
  return "unknown";
}

function recalcGroupUsd(g) {
  if (g.protocol === "Wallet") {
    g.protocolUsd = roundUsd((g.walletTokens || []).reduce((s, t) => s + (t.usd || 0), 0));
    return;
  }
  let u = 0;
  for (const p of g.liquidity || []) u += p.positionUsd || 0;
  for (const p of g.lending || []) u += Math.max(p.netUsd || 0, 0);
  g.protocolUsd = roundUsd(u);
}

export function recalcAllProtocolUsd(portfolio) {
  for (const g of portfolio.protocolGroups || []) recalcGroupUsd(g);
  return portfolio;
}

/** Распределить gap по вкладкам протоколов (без «DeBank»). */
export function allocateGapToProtocolTabs(portfolio, maxUsd) {
  if (!portfolio?.protocolTabs?.length || maxUsd < 1) return 0;

  let remaining = maxUsd;
  const tabs = [...portfolio.protocolTabs]
    .filter((t) => t.protocol && t.protocol !== "Wallet" && (t.usd || 0) >= 2)
    .sort((a, b) => (b.usd || 0) - (a.usd || 0));

  for (const tab of tabs) {
    if (remaining < 1) break;
    const protocol = cleanProtocolName(tab.protocol);
    if (!isValidProtocolTab(protocol)) continue;
    const tabUsd = tab.usd || 0;
    const haveUsd = sumProtocolUsd(portfolio, protocol);
    const need = tabUsd - haveUsd;
    if (need < 2) continue;
    if (haveUsd >= tabUsd * 0.88) continue;

    const chain = inferChainForProtocol(portfolio, protocol);
    const g = ensureGroup(portfolio, protocol, chain);
    const fillUsd = roundUsd(Math.min(need, remaining));
    if (fillUsd < 1) continue;

    if (isLendingProtocol(protocol)) {
      const exists = (g.lending || []).some((p) => p.overviewFill);
      if (!exists) {
        if (!g.kinds.includes("Lending")) g.kinds.push("Lending");
        g.lending.push({
          protocol,
          chain: g.chain,
          healthFactor: null,
          supplied: [{ asset: protocol, amount: "—", usd: fillUsd }],
          borrowed: [],
          collateralUsd: fillUsd,
          debtUsd: 0,
          netUsd: fillUsd,
          overviewFill: true,
        });
      }
    } else {
      g.liquidity.push({
        protocol,
        chain: g.chain,
        poolId: `#overview-${protocolKey(protocol)}`,
        pair: protocol,
        kind: "Liquidity Pool",
        positionUsd: fillUsd,
        netUsd: fillUsd,
        overviewFill: true,
        inPool: [],
      });
      if (!g.kinds.includes("Liquidity Pool")) g.kinds.push("Liquidity Pool");
    }
    recalcGroupUsd(g);
    remaining -= fillUsd;
  }

  return maxUsd - remaining;
}

/** Добавить overview-строки по вкладкам протоколов, если парсер не вытянул LP/lend. */
export function fillCoverageFromProtocolTabs(portfolio) {
  if (!portfolio?.protocolTabs?.length) return portfolio;

  const debank = portfolio.debankTotalUsd ?? portfolio.totalUsd ?? 0;
  let computed =
    portfolio.computedTotalUsd ??
    (portfolio.walletUsd || 0) + (portfolio.liqUsd || 0) + (portfolio.lendUsd || 0);

  if (debank < 20) return portfolio;

  const gap = debank - computed;
  if (gap < 2) return portfolio;

  allocateGapToProtocolTabs(portfolio, gap);
  recalcAllProtocolUsd(portfolio);
  return portfolio;
}

/** Добор по chain breakdown (без группы DeBank). */
export function fillCoverageFromChainGaps(portfolio) {
  const debank = portfolio.debankTotalUsd ?? portfolio.totalUsd ?? 0;
  let computed =
    portfolio.computedTotalUsd ??
    (portfolio.walletUsd || 0) + (portfolio.liqUsd || 0) + (portfolio.lendUsd || 0);

  if (debank < 100 || computed >= debank * 0.93) return portfolio;

  const parseChains = (portfolio.chains || []).filter(
    (c) => c.pct != null && c.name && c.name !== String(c.slug || "").toUpperCase(),
  );

  for (const c of parseChains) {
    const slug = chainSlug(c.slug);
    const target = c.usd || 0;
    if (target < 10) continue;

    let have = 0;
    for (const t of portfolio.walletTokens || []) {
      if (chainSlug(t.chain) === slug) have += t.usd || 0;
    }
    for (const g of portfolio.protocolGroups || []) {
      if (chainSlug(g.chain) !== slug) continue;
      have += g.protocolUsd || 0;
    }

    const need = roundUsd(target - have);
    if (need < 5) continue;

    const tabMatch = (portfolio.protocolTabs || []).find(
      (t) => protocolKey(t.protocol).includes(slug) && (t.usd || 0) >= need * 0.5,
    );
    if (tabMatch) continue;

    const g = ensureGroup(portfolio, "Other", slug);
    g.liquidity.push({
      protocol: g.protocol,
      chain: slug,
      poolId: `#chain-${slug}`,
      pair: c.name || slug.toUpperCase(),
      kind: "Deposit",
      positionUsd: need,
      overviewFill: true,
      netUsd: need,
      inPool: [],
    });
    if (!g.kinds.includes("Deposit")) g.kinds.push("Deposit");
    recalcGroupUsd(g);
    computed += need;
  }

  return portfolio;
}

function countRealLiquidityUsd(portfolio) {
  let n = 0;
  let usd = 0;
  for (const g of portfolio.protocolGroups || []) {
    for (const p of g.liquidity || []) {
      if (p.overviewFill && !String(p.poolId || "").includes("#")) continue;
      if (String(p.poolId || "").match(/#/)) n += 1;
      usd += p.positionUsd || 0;
    }
  }
  return { n, usd };
}

/** Остаток до debankTotal — только через protocolTabs / «Other». */
export function fillCoverageResidual(portfolio) {
  const debank = portfolio.debankTotalUsd ?? portfolio.totalUsd ?? 0;
  let computed =
    portfolio.computedTotalUsd ??
    (portfolio.walletUsd || 0) + (portfolio.liqUsd || 0) + (portfolio.lendUsd || 0);

  if (debank < 20) return portfolio;
  let gap = debank - computed;
  if (gap <= 0 || gap < debank * 0.02) return portfolio;

  const real = countRealLiquidityUsd(portfolio);
  if (real.n >= 2 && real.usd >= debank * 0.4) {
    allocateGapToProtocolTabs(portfolio, gap);
  } else {
    allocateGapToProtocolTabs(portfolio, gap);
  }

  computed =
    (portfolio.walletUsd || 0) + (portfolio.liqUsd || 0) + (portfolio.lendUsd || 0);
  gap = debank - computed;
  if (gap > debank * 0.03 && gap >= 5) {
    const g = ensureGroup(portfolio, "Other", "unknown");
    const exists = (g.liquidity || []).some((p) => String(p.poolId || "").includes("other-residual"));
    if (!exists) {
      g.liquidity.push({
        protocol: "Other",
        chain: "unknown",
        poolId: "other-residual",
        pair: "Other protocols",
        kind: "Deposit",
        positionUsd: roundUsd(gap),
        overviewFill: true,
        netUsd: roundUsd(gap),
        inPool: [],
      });
      recalcGroupUsd(g);
    }
  }

  removeLegacyDebankGroups(portfolio);
  recalcAllProtocolUsd(portfolio);
  return portfolio;
}

/** Финальный добор до debankTotal. */
export function fillCoverageCatchUp(portfolio) {
  const debank = portfolio.debankTotalUsd ?? portfolio.totalUsd ?? 0;
  let computed =
    portfolio.computedTotalUsd ??
    (portfolio.walletUsd || 0) + (portfolio.liqUsd || 0) + (portfolio.lendUsd || 0);
  const gap = debank - computed;
  if (debank < 20 || gap < debank * 0.02) return portfolio;

  allocateGapToProtocolTabs(portfolio, gap);
  removeLegacyDebankGroups(portfolio);
  recalcAllProtocolUsd(portfolio);
  return portfolio;
}

/** Убрать старые синтетические группы DeBank / Unparsed. */
export function removeLegacyDebankGroups(portfolio) {
  if (!portfolio?.protocolGroups) return portfolio;
  for (const g of portfolio.protocolGroups) {
    g.liquidity = (g.liquidity || []).filter((p) => {
      const pair = String(p.pair || "");
      const poolId = String(p.poolId || "");
      if (/unparsed/i.test(pair)) return false;
      if (/coverage|residual|catch-up/i.test(poolId)) return false;
      if (p.debankFill && !p.overviewFill) return false;
      return true;
    });
    g.lending = (g.lending || []).filter((p) => !p.debankFill || p.overviewFill);
    recalcGroupUsd(g);
  }
  portfolio.protocolGroups = portfolio.protocolGroups.filter((g) => {
    if (g.protocol === "DeBank" || String(g.protocol || "").startsWith("DeBank ·")) {
      return false;
    }
    return (
      g.protocol === "Wallet" ||
      (g.liquidity || []).length ||
      (g.lending || []).length ||
      (g.walletTokens || []).length
    );
  });
  return portfolio;
}
