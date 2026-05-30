/**
 * Добор позиций из protocolTabs DeBank, когда Jina не отдаёт детали секций.
 */
import { chainSlug } from "./chains.js";
import { cleanProtocolName, protocolKey, isValidProtocolTab } from "./debank-parse.js";

function roundUsd(n) {
  return Math.round((n || 0) * 100) / 100;
}

function findGroup(portfolio, protocol, chain) {
  const ch = chainSlug(chain || "unknown");
  return (portfolio.protocolGroups || []).find(
    (g) => g.protocol === protocol && chainSlug(g.chain || "unknown") === ch,
  );
}

function ensureGroup(portfolio, protocol, chain) {
  let g = findGroup(portfolio, protocol, chain);
  if (g) return g;
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

/** Добавить debankFill-строки по вкладкам протоколов, если парсер не вытянул LP. */
export function fillCoverageFromProtocolTabs(portfolio) {
  if (!portfolio?.protocolTabs?.length) return portfolio;

  const debank = portfolio.debankTotalUsd ?? portfolio.totalUsd ?? 0;
  let computed =
    portfolio.computedTotalUsd ??
    (portfolio.walletUsd || 0) + (portfolio.liqUsd || 0) + (portfolio.lendUsd || 0);

  if (debank < 50) return portfolio;

  for (const tab of [...portfolio.protocolTabs].sort((a, b) => (b.usd || 0) - (a.usd || 0))) {
    const protocol = cleanProtocolName(tab.protocol);
    if (!isValidProtocolTab(protocol)) continue;
    const tabUsd = tab.usd || 0;
    if (tabUsd < 2) continue;

    const haveUsd = sumProtocolUsd(portfolio, protocol);
    const need = tabUsd - haveUsd;
    if (need < 2) continue;
    if (haveUsd >= tabUsd * 0.88) continue;

    const chain = inferChainForProtocol(portfolio, protocol);
    const g = ensureGroup(portfolio, protocol, chain);
    const headroom = Math.max(0, debank - computed);
    const fillUsd = roundUsd(Math.min(need, headroom));
    if (fillUsd < 1) continue;

    g.liquidity.push({
      protocol,
      chain: g.chain,
      poolId: `${protocol} · DeBank`,
      pair: protocol,
      kind: "Deposit",
      positionUsd: fillUsd,
      debankFill: true,
      debankSectionUsd: tabUsd,
      netUsd: fillUsd,
      inPool: [],
    });
    if (!g.kinds) g.kinds = [];
    if (!g.kinds.includes("Deposit")) g.kinds.push("Deposit");
    computed += fillUsd;
  }

  return portfolio;
}

/** Добор по chain breakdown (Unfold / неполные chain-страницы Jina). */
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

    const g = ensureGroup(portfolio, `DeBank · ${c.name || slug}`, slug);
    g.liquidity.push({
      protocol: g.protocol,
      chain: slug,
      poolId: `${c.name || slug} · chain`,
      pair: c.name || slug,
      kind: "Deposit",
      positionUsd: need,
      debankFill: true,
      debankChainUsd: target,
      netUsd: need,
      inPool: [],
    });
    if (!g.kinds.includes("Deposit")) g.kinds.push("Deposit");
    computed += need;
  }

  return portfolio;
}

function countRealLiquidityUsd(portfolio) {
  let n = 0;
  let usd = 0;
  for (const g of portfolio.protocolGroups || []) {
    for (const p of g.liquidity || []) {
      if (p.debankFill) continue;
      if (String(p.poolId || "").match(/#/)) n += 1;
      usd += p.positionUsd || 0;
    }
  }
  return { n, usd };
}

/** Остаток до debank (3–15%), если Jina не отдал детали. */
export function fillCoverageResidual(portfolio) {
  const debank = portfolio.debankTotalUsd ?? portfolio.totalUsd ?? 0;
  let computed =
    portfolio.computedTotalUsd ??
    (portfolio.walletUsd || 0) + (portfolio.liqUsd || 0) + (portfolio.lendUsd || 0);

  const hasResidual = (portfolio.protocolGroups || []).some((g) =>
    (g.liquidity || []).some((p) => String(p.poolId || "").includes("residual")),
  );
  if (hasResidual) return portfolio;

  const real = countRealLiquidityUsd(portfolio);
  if (real.n >= 1 && real.usd >= debank * 0.35) return portfolio;

  if (debank < 80) return portfolio;
  let gap = debank - computed;
  if (gap <= 0 || gap < debank * 0.02) return portfolio;
  if (gap > debank * 0.55) {
    const headroom = roundUsd(gap * 0.4);
    if (headroom >= 5) {
      const g = ensureGroup(portfolio, "DeBank", "all");
      g.liquidity.push({
        protocol: "DeBank",
        chain: "unknown",
        poolId: "Coverage · large gap",
        pair: "Unparsed (Jina)",
        kind: "Deposit",
        positionUsd: headroom,
        debankFill: true,
        netUsd: headroom,
        inPool: [],
      });
      if (!g.kinds.includes("Deposit")) g.kinds.push("Deposit");
    }
    computed = (portfolio.walletUsd || 0) + (portfolio.liqUsd || 0) + (portfolio.lendUsd || 0);
    gap = debank - computed;
    if (gap <= 0 || gap < debank * 0.03) return portfolio;
  }

  const g = ensureGroup(portfolio, "DeBank", "all");
  g.liquidity.push({
    protocol: "DeBank",
    chain: "unknown",
    poolId: "Coverage · residual",
    pair: "Unparsed positions",
    kind: "Deposit",
    positionUsd: roundUsd(gap),
    debankFill: true,
    debankSectionUsd: debank,
    netUsd: roundUsd(gap),
    inPool: [],
  });
  if (!g.kinds.includes("Deposit")) g.kinds.push("Deposit");
  return portfolio;
}

/** Финальный добор до debankTotal (Jina не отдал часть протоколов). */
export function fillCoverageCatchUp(portfolio) {
  const debank = portfolio.debankTotalUsd ?? portfolio.totalUsd ?? 0;
  let computed =
    portfolio.computedTotalUsd ??
    (portfolio.walletUsd || 0) + (portfolio.liqUsd || 0) + (portfolio.lendUsd || 0);
  const gap = debank - computed;
  if (debank < 80 || gap < debank * 0.02) return portfolio;

  const g = ensureGroup(portfolio, "DeBank", "all");
  const exists = (g.liquidity || []).some((p) => String(p.poolId || "").includes("catch-up"));
  if (exists) return portfolio;

  g.liquidity.push({
    protocol: "DeBank",
    chain: "unknown",
    poolId: "Coverage · catch-up",
    pair: "Unparsed (DeBank)",
    kind: "Deposit",
    positionUsd: roundUsd(gap),
    debankFill: true,
    netUsd: roundUsd(gap),
    inPool: [],
  });
  if (!g.kinds.includes("Deposit")) g.kinds.push("Deposit");
  return portfolio;
}
