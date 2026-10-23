/**
 * Build Public Portfolio v2 snapshot from precomputed Navigator cache
 * (`data/portfolio-data.js`). No live Debank/protocol calls.
 *
 * netWorthUsd = walletIdle + collateral + liquidity + yieldPrincipal − debt
 *             + INTERNAL_EQUITY_ADJUSTMENT
 *
 * The internal equity adjustment is applied only to summary.netWorthUsd.
 * It is never returned as its own field and never added to positions,
 * category totals, rewards, wallets, or history rows.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

/** Single backend config source for the headline equity adjustment. */
export const INTERNAL_EQUITY_ADJUSTMENT_USD = Number(
  process.env.PUBLIC_PORTFOLIO_EQUITY_ADJ_USD ?? 800
);

const STALE_AFTER_MS = Number(process.env.PUBLIC_PORTFOLIO_STALE_MS ?? 36 * 60 * 60 * 1000);

const CHAIN_LABEL = {
  "1": "Ethereum",
  eth: "Ethereum",
  ethereum: "Ethereum",
  mainnet: "Ethereum",
  "42161": "Arbitrum",
  arb: "Arbitrum",
  arbitrum: "Arbitrum",
  "10": "Optimism",
  op: "Optimism",
  optimism: "Optimism",
  "8453": "Base",
  base: "Base",
  sol: "Solana",
  solana: "Solana",
  matic: "Polygon",
  polygon: "Polygon",
  bsc: "BNB Chain",
};

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round2(v) {
  return Math.round(num(v) * 100) / 100;
}

function chainLabel(raw) {
  const key = String(raw || "").trim().toLowerCase();
  return CHAIN_LABEL[key] || (raw ? String(raw) : "—");
}

function shortAddr(addr) {
  const a = String(addr || "").trim();
  if (a.length < 12) return a || "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function walletLabel(addr, kind) {
  const prefix = kind === "sol" ? "Solana" : "EVM";
  return `${prefix} · ${shortAddr(addr)}`;
}

function stableId(...parts) {
  const raw = parts.map((p) => String(p ?? "").toLowerCase().trim()).join("|");
  return createHash("sha1").update(raw).digest("hex").slice(0, 16);
}

function dayKey(iso) {
  const s = String(iso || "");
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Load portfolio-data.js / .json from disk (Vercel project root or cwd).
 */
export function loadPortfolioCache(explicitPath) {
  const candidates = [];
  if (explicitPath) candidates.push(explicitPath);

  const here = path.dirname(fileURLToPath(import.meta.url));
  candidates.push(
    path.join(process.cwd(), "data", "portfolio-data.js"),
    path.join(process.cwd(), "data", "portfolio-data.json"),
    path.resolve(here, "../../data/portfolio-data.js"),
    path.resolve(here, "../../data/portfolio-data.json")
  );

  let lastErr = null;
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, "utf8");
      if (file.endsWith(".json")) return { data: JSON.parse(raw), path: file };
      const eq = raw.indexOf("=");
      if (eq < 0) throw new Error("portfolio-data.js: missing assignment");
      let json = raw.slice(eq + 1).trim();
      if (json.endsWith(";")) json = json.slice(0, -1).trim();
      return { data: JSON.parse(json), path: file };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("portfolio-data cache not found");
}

function buildHistory(snapshots) {
  const byDay = new Map();
  for (const snap of snapshots || []) {
    const date = dayKey(snap?.timestamp || snap?.date || snap?.asOfDate);
    if (!date) continue;
    // Snapshot equity already includes the internal adjustment from the export pipeline.
    // Do not add INTERNAL_EQUITY_ADJUSTMENT again.
    byDay.set(date, {
      date,
      equityUsd: round2(snap.equityUsd),
    });
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function changePct30d(history) {
  if (!history?.length) return null;
  const last = history[history.length - 1];
  const target = dayKey(
    new Date(Date.parse(`${last.date}T00:00:00Z`) - 30 * 24 * 60 * 60 * 1000).toISOString()
  );
  let prior = null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].date <= target) {
      prior = history[i];
      break;
    }
  }
  if (!prior && history.length >= 31) prior = history[history.length - 31];
  if (!prior || !prior.equityUsd) return null;
  return round2(((last.equityUsd - prior.equityUsd) / prior.equityUsd) * 100);
}

function lendingPositions(data, evmLabel) {
  const out = [];
  for (const p of data.lendingPositions || []) {
    const coll = round2(p.collateralUsd);
    const debt = round2(p.borrowUsd ?? p.debtUsd);
    const protocol = String(p.protocol || "Lending");
    const chain = chainLabel(p.chain);
    const assetParts = [];
    if (p.collateralAsset) assetParts.push(String(p.collateralAsset));
    if (p.borrowAsset) assetParts.push(String(p.borrowAsset));
    const asset =
      assetParts.length > 0
        ? assetParts.join(" / ")
        : (p.supplied || []).map((x) => x.asset).filter(Boolean).join(" + ") || "Lending";

    const isSol =
      String(p.chain || "").toLowerCase().includes("sol") ||
      String(protocol).toLowerCase().includes("jupiter");
    const label = isSol
      ? walletLabel((data.solanaWallets || [])[0], "sol")
      : evmLabel;

    out.push({
      id: stableId("lending", protocol, p.chain, p.collateralAsset, p.borrowAsset, p.link),
      type: "lending",
      protocol,
      chain,
      walletLabel: label,
      asset,
      valueUsd: round2(coll - debt),
      collateralUsd: coll,
      debtUsd: debt,
      ratePct: p.borrowAprPct ?? p.supplyAprPct ?? p.apr ?? null,
      rewardUsd: round2(p.rewardUsd || 0),
      healthFactor: p.healthFactor == null ? null : num(p.healthFactor, null),
      includedInNetWorth: true,
      detail: debt > 0 ? "Залоговая позиция" : "Снабжение без долга",
      details: {
        collateralAmount: p.collateralAmount ?? null,
        borrowAmount: p.borrowAmount ?? null,
        collateralAsset: p.collateralAsset || null,
        borrowAsset: p.borrowAsset || null,
        liquidationPrice: p.liquidationPrice ?? null,
        marketPrice: p.marketPrice ?? null,
        link: p.link || null,
        dataSource: p.dataSource || null,
        sourceTimestamp: p.timestamp || null,
        supplied: p.supplied || null,
        borrowed: p.borrowed || null,
      },
    });
  }
  return out;
}

function liquidityPositions(data, primaryLabel) {
  const out = [];
  for (const p of data.liquidityPositions || []) {
    if (p.isActive === false) continue;
    const value = round2(p.valueUsd);
    if (value <= 0 && !p.positionId) continue;
    const reward = round2(num(p.feesUsd) + num(p.incentivesUsd));
    const protocol = String(p.platform || p.protocol || "LP");
    const pair = String(p.pair || p.symbol || "LP");
    out.push({
      id: stableId("lp", p.chain, p.positionId || pair, protocol),
      type: "liquidity",
      protocol,
      chain: chainLabel(p.chain),
      walletLabel: primaryLabel,
      asset: pair,
      valueUsd: value,
      collateralUsd: 0,
      debtUsd: 0,
      ratePct: p.displayApr ?? p.apr ?? null,
      rewardUsd: reward,
      healthFactor: null,
      includedInNetWorth: true,
      detail: "Активная LP-позиция",
      details: {
        positionId: p.positionId || null,
        investedUsd: p.investedUsd ?? null,
        feesUsd: p.feesUsd ?? null,
        incentivesUsd: p.incentivesUsd ?? null,
        feeTier: p.feeTier ?? null,
        rangeMin: p.rangeMin ?? null,
        rangeMax: p.rangeMax ?? null,
        rangeCurrent: p.rangeCurrent ?? null,
        openedAt: p.openedAt || null,
        link: p.link || null,
        dataSource: p.dataSource || null,
      },
    });
  }
  return out;
}

function yieldPositions(data, primaryLabel) {
  const out = [];
  for (const p of data.yieldPositions || []) {
    if (p.isActive === false) continue;
    const value = round2(p.valueUsd);
    if (value <= 0) continue;
    const protocol = String(p.protocol || p.platform || "Yield");
    const asset = String(p.asset || p.pair || "Yield");
    const chainRaw = p.chain;
    const chain =
      String(chainRaw) === "1" || String(chainRaw) === "eth"
        ? "Ethereum"
        : chainLabel(chainRaw);
    out.push({
      id: stableId("yield", protocol, p.chain, p.marketId || asset),
      type: "yield",
      protocol,
      chain,
      walletLabel: primaryLabel,
      asset,
      valueUsd: value,
      collateralUsd: 0,
      debtUsd: 0,
      ratePct: p.displayApr ?? p.apr ?? null,
      rewardUsd: round2(p.rewardUsd || 0),
      healthFactor: null,
      includedInNetWorth: true,
      detail: "Yield / Deposit позиция",
      details: {
        marketId: p.marketId || null,
        ptUsd: p.ptUsd ?? null,
        ytUsd: p.ytUsd ?? null,
        lpUsd: p.lpUsd ?? null,
        link: p.link || null,
        dataSource: p.dataSource || null,
      },
    });
  }
  return out;
}

function walletPositions(data) {
  const idle = round2(data.walletIdleUsd);
  const evm = (data.debankWallets || []).filter(Boolean);
  const sol = (data.solanaWallets || []).filter(Boolean);
  const wallets = [
    ...evm.map((a) => ({ addr: a, kind: "evm" })),
    ...sol.map((a) => ({ addr: a, kind: "sol" })),
  ];
  if (!wallets.length) {
    if (idle <= 0) return [];
    return [
      {
        id: stableId("wallet", "aggregate"),
        type: "wallet",
        protocol: "Wallet",
        chain: "Multi",
        walletLabel: "Все кошельки",
        asset: "Idle assets",
        valueUsd: idle,
        collateralUsd: 0,
        debtUsd: 0,
        ratePct: null,
        rewardUsd: 0,
        healthFactor: null,
        includedInNetWorth: true,
        detail: "Свободные средства (агрегат)",
        details: { aggregate: true },
      },
    ];
  }
  // Cache stores one idle total; attribute it to the primary EVM wallet and
  // emit zero-value placeholders for other wallets so both addresses appear.
  return wallets.map((w, idx) => ({
    id: stableId("wallet", w.kind, w.addr),
    type: "wallet",
    protocol: "Wallet",
    chain: w.kind === "sol" ? "Solana" : "Multi",
    walletLabel: walletLabel(w.addr, w.kind),
    asset: "Idle assets",
    valueUsd: idx === 0 ? idle : 0,
    collateralUsd: 0,
    debtUsd: 0,
    ratePct: null,
    rewardUsd: 0,
    healthFactor: null,
    includedInNetWorth: idx === 0,
    detail: idx === 0 ? "Свободные средства на кошельках" : "Кошелёк в периметре (idle в агрегате)",
    details: { addressMasked: shortAddr(w.addr), kind: w.kind },
  }));
}

function mapTransactions(data, { limit, cursor } = {}) {
  const all = (data.transactions || []).map((tx, i) => {
    const id =
      tx.id ||
      stableId(
        "tx",
        tx.hash || tx.txid || "",
        tx.timestamp || tx.date || "",
        tx.action || "",
        i
      );
    return {
      id,
      date: tx.timestamp || tx.date || null,
      chain: chainLabel(tx.chain),
      protocol: tx.protocol || null,
      action: tx.action || tx.type || null,
      asset: tx.asset || tx.symbol || null,
      amount: tx.amount ?? null,
      amountUsd: tx.amountUsd == null ? null : round2(tx.amountUsd),
      category: tx.category || null,
      explorerUrl: tx.explorerUrl || tx.link || null,
    };
  });

  let start = 0;
  if (cursor) {
    const idx = all.findIndex((t) => t.id === cursor);
    start = idx >= 0 ? idx + 1 : 0;
  }
  const pageLimit = Math.min(Math.max(Number(limit) || all.length || 0, 0), 500) || all.length;
  const slice = all.slice(start, start + (pageLimit || all.length));
  const next =
    start + slice.length < all.length && slice.length
      ? slice[slice.length - 1].id
      : null;
  return { transactions: slice, nextCursor: next, total: all.length };
}

function isJupiterLendingRow(p) {
  const chain = String(p?.chain || "").toLowerCase();
  const proto = String(p?.protocol || "").toLowerCase();
  const link = String(p?.link || "").toLowerCase();
  return chain.includes("sol") || proto.includes("jupiter") || link.includes("jup.ag/lend");
}

function collectCompleteness(data, ctx) {
  const reasons = [];
  const evmConfigured = (data.debankWallets || []).filter(Boolean).length > 0;
  const solConfigured = (data.solanaWallets || []).filter(Boolean).length > 0;
  const rawLending = data.lendingPositions || [];
  const hasJupiter = rawLending.some(isJupiterLendingRow);
  const hasEvmLending = rawLending.some((p) => !isJupiterLendingRow(p));
  const hasYield =
    (data.yieldPositions || []).some((p) => p.isActive !== false && num(p.valueUsd) > 0) ||
    ctx.yieldPrincipalUsd > 0;
  const jupiterSyncedAt = data.jupiterLendSyncedAt || null;
  const jupiterSyncMs = jupiterSyncedAt ? Date.parse(jupiterSyncedAt) : NaN;
  const jupiterSyncFresh =
    Number.isFinite(jupiterSyncMs) && Date.now() - jupiterSyncMs <= STALE_AFTER_MS;

  if (!evmConfigured) {
    reasons.push("Не настроен EVM-кошелёк (debankWallets) в кэше Navigator.");
  }
  if (!solConfigured) {
    reasons.push("Не настроен Solana-кошелёк (solanaWallets) в кэше Navigator.");
  }
  if (evmConfigured && !hasEvmLending) {
    reasons.push("Нет EVM lending-позиций в снимке (ожидался Fluid/Debank).");
  }
  if (solConfigured && !hasJupiter) {
    reasons.push(
      "Нет Jupiter/Solana lending в снимке при настроенном Solana-кошельке. Перезапустите sync."
    );
  }
  if (solConfigured && hasJupiter && !jupiterSyncFresh) {
    reasons.push(
      `Метка jupiterLendSyncedAt устарела или отсутствует (${jupiterSyncedAt || "нет"}).`
    );
  }
  if (!hasYield) {
    reasons.push(
      "В снимке нет Yield-позиции (Pendle/Deposit). В кабинете DeFi Navigator Yield входит в баланс — перезапустите sync."
    );
  }
  if (ctx.ageMs > STALE_AFTER_MS) {
    reasons.push(
      `Кэш старше ${round2(STALE_AFTER_MS / 3600000)} ч (updatedAt=${ctx.updatedAt}).`
    );
  }
  if (ctx.lpListingGapUsd > 100) {
    reasons.push(
      `Разобранные LP NFT ($${ctx.lpFromPositions}) меньше liquidityUsd снимка ($${ctx.liquidityUsd}) на $${ctx.lpListingGapUsd}.`
    );
  }
  if (!(ctx.navigatorBalanceUsd > 0)) {
    reasons.push(
      "В кэше нет независимого navigatorBalanceUsd из снимка DeFi Navigator. Запустите scripts/sync_jupiter_into_portfolio_data.py."
    );
  } else {
    // Public headline must be navigator balance + internal adj only.
    const expectedPublic = round2(ctx.navigatorBalanceUsd + INTERNAL_EQUITY_ADJUSTMENT_USD);
    const gapPublic = round2(ctx.netWorthUsd - expectedPublic);
    if (Math.abs(gapPublic) > ctx.navigatorToleranceUsd) {
      reasons.push(
        `Чистый капитал Public Portfolio ($${ctx.netWorthUsd}) не равен балансу снимка Navigator ($${ctx.navigatorBalanceUsd}) + внутренняя корректировка (ожидалось $${expectedPublic}, Δ=${gapPublic >= 0 ? "+" : ""}$${gapPublic}, допуск ±$${ctx.navigatorToleranceUsd}).`
      );
    }
    // Component integrity vs stored Navigator snapshot (not a circular API self-sum for SoT).
    const componentSum = round2(
      ctx.walletIdleUsd +
        ctx.collateralUsd +
        ctx.liquidityUsd +
        ctx.yieldPrincipalUsd -
        ctx.debtUsd
    );
    const gapComponents = round2(componentSum - ctx.navigatorBalanceUsd);
    if (Math.abs(gapComponents) > ctx.navigatorToleranceUsd) {
      reasons.push(
        `Сумма категорий API ($${componentSum}) расходится с navigatorBalanceUsd снимка ($${ctx.navigatorBalanceUsd}) на ${gapComponents >= 0 ? "+" : ""}$${gapComponents}.`
      );
    }
  }
  if (!(rawLending.length > 0) && ctx.collateralUsd <= 0 && ctx.debtUsd <= 0) {
    reasons.push("Lending-данные пустые: нет залога и долга в снимке.");
  }
  return reasons;
}

/**
 * @param {object} data parsed portfolio-data
 * @param {{ limit?: number, cursor?: string, log?: Function }} [opts]
 */
export function buildPublicPortfolioV2(data, opts = {}) {
  const log = opts.log || console.info.bind(console);
  const evmAddr = (data.debankWallets || [])[0] || data.portfolioWallet || "";
  const solAddr = (data.solanaWallets || [])[0] || "";
  const evmLabel = walletLabel(evmAddr, "evm");
  const primaryLabel = evmLabel;

  const lending = lendingPositions(data, evmLabel);
  // Only real LP NFT/sheet rows — never invent a residual LP row (avoids double-count).
  const liquidity = liquidityPositions(data, primaryLabel);
  const yields = yieldPositions(data, primaryLabel);
  const wallets = walletPositions(data);

  const collateralUsd = round2(lending.reduce((s, p) => s + num(p.collateralUsd), 0));
  const debtUsd = round2(lending.reduce((s, p) => s + num(p.debtUsd), 0));
  const lpFromPositions = round2(liquidity.reduce((s, p) => s + num(p.valueUsd), 0));
  const yieldFromPositions = round2(yields.reduce((s, p) => s + num(p.valueUsd), 0));

  const snaps = data.snapshots || [];
  const lastSnap = snaps.length ? snaps[snaps.length - 1] : null;
  const snapLiq = lastSnap ? round2(lastSnap.liquidityUsd) : 0;
  // Capital path: prefer daily snapshot liquidity (sheet aggregate). Positions list stays NFT-only.
  let liquidityUsd = snapLiq > 0 ? Math.max(snapLiq, lpFromPositions) : lpFromPositions;
  const lpListingGapUsd = round2(Math.max(0, liquidityUsd - lpFromPositions));

  const walletIdleUsd = round2(data.walletIdleUsd);
  const yieldPrincipalUsd = round2(
    data.yieldPrincipalUsd != null ? data.yieldPrincipalUsd : yieldFromPositions
  );
  const rewardsAccruedUsd = round2(data.openLiquidityUnclaimedUsd);

  // Independent Navigator SoT from cache (balance BEFORE internal adj; rewards excluded).
  const navSnap = data.navigatorSnapshot || {};
  const navigatorBalanceUsd = round2(
    data.navigatorBalanceUsd != null
      ? data.navigatorBalanceUsd
      : navSnap.balanceUsd != null
        ? navSnap.balanceUsd
        : walletIdleUsd + collateralUsd + liquidityUsd + yieldPrincipalUsd - debtUsd
  );

  // Public headline = Navigator cabinet balance + internal adj only.
  const netWorthUsd = round2(navigatorBalanceUsd + INTERNAL_EQUITY_ADJUSTMENT_USD);

  // Include configured wallets even with $0 idle so both addresses stay visible.
  const positions = [...lending, ...liquidity, ...yields, ...wallets];

  const history = buildHistory(snaps);
  const { transactions, nextCursor, total: txTotal } = mapTransactions(data, opts);

  const hfCandidates = lending
    .map((p) => p.healthFactor)
    .filter((h) => h != null && Number.isFinite(h) && h > 0);
  const healthFactor = hfCandidates.length ? Math.min(...hfCandidates) : null;

  const rateCandidates = lending
    .map((p) => p.ratePct)
    .filter((r) => r != null && Number.isFinite(Number(r)));
  const borrowAprPct = rateCandidates.length
    ? round2(rateCandidates.reduce((a, b) => a + Number(b), 0) / rateCandidates.length)
    : null;

  const updatedAt = data.exportedAt || lastSnap?.timestamp || new Date().toISOString();
  const updatedMs = Date.parse(updatedAt);
  const ageMs = Number.isFinite(updatedMs) ? Date.now() - updatedMs : Infinity;

  const navigatorToleranceUsd = Number(
    process.env.PUBLIC_PORTFOLIO_NAVIGATOR_TOLERANCE_USD || 50
  );

  const incompleteReasons = collectCompleteness(data, {
    updatedAt,
    ageMs,
    walletIdleUsd,
    collateralUsd,
    debtUsd,
    liquidityUsd,
    yieldPrincipalUsd,
    lpFromPositions,
    lpListingGapUsd,
    netWorthUsd,
    navigatorBalanceUsd,
    navigatorToleranceUsd,
  });
  const complete = incompleteReasons.length === 0;
  // stale = age only (incompleteReasons explain reconciliation separately).
  const stale = ageMs > STALE_AFTER_MS;

  const chains = new Set();
  for (const p of positions) {
    if (p.chain && p.chain !== "—" && p.chain !== "Multi") chains.add(p.chain);
  }

  const walletCount =
    new Set([...(data.debankWallets || []), ...(data.solanaWallets || [])].filter(Boolean))
      .size || 0;

  const snapshotId =
    String(navSnap.snapshotId || "").trim() ||
    stableId(
      "ppv2",
      updatedAt,
      navigatorBalanceUsd,
      netWorthUsd,
      collateralUsd,
      debtUsd,
      liquidityUsd,
      yieldPrincipalUsd,
      walletIdleUsd
    );

  const jupiterRows = lending.filter((p) => String(p.protocol).toLowerCase().includes("jupiter"));
  const jupiterNet = round2(
    jupiterRows.reduce((s, p) => s + num(p.collateralUsd) - num(p.debtUsd), 0)
  );
  const fluidRows = lending.filter((p) => !String(p.protocol).toLowerCase().includes("jupiter"));
  const fluidNet = round2(
    fluidRows.reduce((s, p) => s + num(p.collateralUsd) - num(p.debtUsd), 0)
  );

  const txCount = (data.transactions || []).length;
  const transactionsAvailable = txCount > 0;
  const transactionsNote = transactionsAvailable
    ? null
    : "В кэше Navigator нет транзакций (data/transactions.json пуст). История операций недоступна — интерфейс может показать пустое состояние.";

  // Server-side reconciliation only — never expose adjustment amount in the response.
  log("[public-portfolio/v2] reconciliation", {
    snapshotId,
    updatedAt,
    complete,
    incompleteReasons,
    stale,
    cacheAgeHours: Number.isFinite(ageMs) ? round2(ageMs / 3600000) : null,
    wallets: { evm: evmAddr ? shortAddr(evmAddr) : null, sol: solAddr ? shortAddr(solAddr) : null },
    navigatorBalanceUsd,
    netWorthUsd,
    adjAppliedInNetWorthOnly: true,
    components: {
      walletIdleUsd,
      collateralUsd,
      liquidityUsd,
      yieldPrincipalUsd,
      debtUsd,
      rewardsAccruedUsd,
    },
    positionCounts: {
      lending: lending.length,
      liquidityNft: liquidity.length,
      yield: yields.length,
      lpListingGapUsd,
      wallet: wallets.length,
      total: positions.length,
      breakdown: {
        jupiterLending: jupiterRows.length,
        evmLending: fluidRows.length,
        lpNft: liquidity.length,
        yield: yields.length,
        walletRows: wallets.length,
      },
    },
    gapBridge: {
      navigatorBalanceUsd,
      publicNetWorthUsd: netWorthUsd,
      jupiterNetUsd: jupiterNet,
      evmLendingNetUsd: fluidNet,
      yieldPrincipalUsd,
      transactionsAvailable,
    },
  });

  const payload = {
    meta: {
      updatedAt: navSnap.updatedAt || updatedAt,
      source: "DeFi Navigator",
      walletCount,
      chains: chains.size,
      stale,
      complete,
      incompleteReasons,
      snapshotId,
      navigatorBalanceUsd,
      formula:
        "navigatorBalanceUsd(= walletIdle + collateral + liquidity + yieldPrincipal - debt) + internalEquityAdjustment",
      rewardsInNetWorth: false,
      positionCounts: {
        total: positions.length,
        lending: lending.length,
        liquidity: liquidity.length,
        yield: yields.length,
        wallet: wallets.length,
        lpListingGapUsd,
      },
      transactionsAvailable,
      transactionsNote,
      navigatorSnapshot: {
        snapshotId,
        updatedAt: navSnap.updatedAt || updatedAt,
        balanceUsd: navigatorBalanceUsd,
        balanceHintUsd: navSnap.balanceHintUsd ?? 15189,
        components: navSnap.components || {
          walletIdleUsd,
          collateralUsd,
          liquidityUsd,
          yieldPrincipalUsd,
          debtUsd,
          rewardsAccruedUsd,
          rewardsInBalance: false,
        },
      },
    },
    summary: {
      netWorthUsd,
      walletIdleUsd,
      collateralUsd,
      liquidityUsd,
      yieldPrincipalUsd,
      debtUsd,
      rewardsAccruedUsd,
      borrowAprPct,
      healthFactor,
      changePct30d: changePct30d(history),
    },
    positions,
    transactions,
    history,
  };

  if (nextCursor != null || (opts.limit != null && txTotal > transactions.length)) {
    payload.meta.transactionsCursor = nextCursor;
    payload.meta.transactionsTotal = txTotal;
  }

  // Hard guard: never leak the adjustment as its own field.
  assertNoAdjustmentLeak(payload);

  return payload;
}

function assertNoAdjustmentLeak(payload) {
  const banned = [
    "manualVisualAdjustmentUsd",
    "equityAdjustmentUsd",
    "internalEquityAdjustment",
    "internalEquityAdjustmentUsd",
    "adjUsd",
    "visualAdjustmentUsd",
  ];
  const json = JSON.stringify(payload);
  for (const key of banned) {
    if (json.includes(`"${key}"`)) {
      throw new Error(`public portfolio v2 leaked adjustment field: ${key}`);
    }
  }
}

export function buildFromDisk(opts = {}) {
  const { data, path: cachePath } = loadPortfolioCache(opts.cachePath);
  const log = opts.log || console.info.bind(console);
  log("[public-portfolio/v2] cache file", path.basename(cachePath));
  return buildPublicPortfolioV2(data, opts);
}
