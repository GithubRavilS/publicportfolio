/**
 * Build Public Portfolio v2 from the DeFi Navigator personal-cabinet cache snapshot.
 *
 * Source of truth: data/navigator-cabinet-snapshot.json (or NAVIGATOR_SNAPSHOT_URL),
 * produced by portfolio-check `backend/public_navigator_export.py` from the same
 * cockpit_client_detail cache the VIP cabinet uses. Not a live Jupiter/Debank rebuild.
 *
 * summary.netWorthUsd = navigatorBalanceUsd + INTERNAL_EQUITY_ADJUSTMENT_USD
 * The +$800 adjustment is applied only to netWorthUsd — never to positions,
 * categories, Yield, Rewards, or meta.navigatorBalanceUsd.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const INTERNAL_EQUITY_ADJUSTMENT_USD = Number(
  process.env.PUBLIC_PORTFOLIO_EQUITY_ADJ_USD ?? 800
);

const STALE_AFTER_MS = Number(process.env.PUBLIC_PORTFOLIO_STALE_MS ?? 36 * 60 * 60 * 1000);
const NAV_TOLERANCE_USD = Number(process.env.PUBLIC_PORTFOLIO_NAVIGATOR_TOLERANCE_USD ?? 50);

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
  const a = String(addr || "");
  const k = kind || (a.startsWith("0x") ? "evm" : "sol");
  return `${k === "sol" ? "Solana" : "EVM"} · ${shortAddr(a)}`;
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

function candidatePaths(explicit, names) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const roots = [process.cwd(), path.resolve(here, "../..")];
  const out = [];
  if (explicit) out.push(explicit);
  for (const root of roots) {
    for (const name of names) out.push(path.join(root, "data", name));
  }
  return out;
}

/**
 * Load Navigator cabinet snapshot (export module / PA endpoint payload).
 */
export function loadNavigatorSnapshot(explicitPath) {
  const files = candidatePaths(explicitPath, [
    "navigator-cabinet-snapshot.json",
    "navigator-cabinet-snapshot.js",
  ]);
  let lastErr = null;
  for (const file of files) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, "utf8");
      if (file.endsWith(".json")) {
        return { data: JSON.parse(raw), path: file };
      }
      const eq = raw.indexOf("=");
      if (eq < 0) throw new Error("navigator snapshot js: missing assignment");
      let json = raw.slice(eq + 1).trim();
      if (json.endsWith(";")) json = json.slice(0, -1).trim();
      return { data: JSON.parse(json), path: file };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("navigator-cabinet-snapshot not found");
}

export const DEFAULT_NAVIGATOR_SNAPSHOT_URL =
  "https://cry-maden008.pythonanywhere.com/portfolio-check/api/public/navigator-snapshot";

/**
 * Fetch live PA read-only export.
 * @param {string} url
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function fetchNavigatorSnapshot(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 12000;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`navigator snapshot HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data || data.ok === false) {
      throw new Error(
        `navigator snapshot payload not ok (${data?.error || "unknown"})`
      );
    }
    if (!data.snapshotId || !data.updatedAt) {
      throw new Error("navigator snapshot missing snapshotId/updatedAt");
    }
    return {
      data,
      path: url,
      sourceKind: "endpoint",
      endpointUrl: url,
      liveFromEndpoint: true,
      endpointError: null,
    };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Resolve snapshot source.
 *
 * When NAVIGATOR_SNAPSHOT_URL is configured (Vercel Preview/Production):
 * - success → live endpoint payload (liveFromEndpoint=true)
 * - failure → optional file only as degraded cache; never marked live/complete
 *
 * When URL is unset (local dump): file is the primary source.
 */
export async function loadNavigatorSnapshotSource(opts = {}) {
  const log = opts.log || console.warn.bind(console);
  const url = String(opts.url || process.env.NAVIGATOR_SNAPSHOT_URL || "").trim();
  const requireEndpoint =
    opts.requireEndpoint === true ||
    Boolean(url) ||
    String(process.env.VERCEL_ENV || "") === "preview" ||
    String(process.env.VERCEL_ENV || "") === "production";

  if (url) {
    try {
      return await fetchNavigatorSnapshot(url, opts);
    } catch (err) {
      const endpointError = String(err?.message || err);
      log("[public-portfolio/v2] NAVIGATOR_SNAPSHOT_URL failed:", endpointError);
      if (opts.allowFileFallback === false) {
        return {
          data: {
            ok: false,
            error: "ENDPOINT_UNAVAILABLE",
            endpointError,
            endpointUrl: url,
          },
          path: url,
          sourceKind: "endpoint-error",
          endpointUrl: url,
          liveFromEndpoint: false,
          endpointError,
        };
      }
      try {
        const file = loadNavigatorSnapshot(opts.snapshotPath);
        return {
          ...file,
          sourceKind: "file-fallback",
          endpointUrl: url,
          liveFromEndpoint: false,
          endpointError,
        };
      } catch (fileErr) {
        return {
          data: {
            ok: false,
            error: "ENDPOINT_UNAVAILABLE",
            endpointError,
            fileError: String(fileErr?.message || fileErr),
            endpointUrl: url,
          },
          path: url,
          sourceKind: "endpoint-error",
          endpointUrl: url,
          liveFromEndpoint: false,
          endpointError,
        };
      }
    }
  }

  if (requireEndpoint) {
    return {
      data: {
        ok: false,
        error: "NAVIGATOR_SNAPSHOT_URL_UNSET",
        endpointError:
          "NAVIGATOR_SNAPSHOT_URL не задан в окружении — live-снимок Navigator недоступен.",
      },
      path: null,
      sourceKind: "endpoint-error",
      endpointUrl: null,
      liveFromEndpoint: false,
      endpointError: "NAVIGATOR_SNAPSHOT_URL unset",
    };
  }

  const file = loadNavigatorSnapshot(opts.snapshotPath);
  return {
    ...file,
    sourceKind: "file",
    endpointUrl: null,
    liveFromEndpoint: false,
    endpointError: null,
  };
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

function mapLending(pack) {
  const label = walletLabel(pack.address, pack.kind);
  const out = [];
  for (const p of pack.lendingPositions || []) {
    const coll = round2(p.collateralUsd);
    const debt = round2(p.debtUsd ?? p.borrowUsd);
    const reward = round2(p.rewardsUsd || 0);
    const rewardsOnly = coll <= 0 && debt <= 0 && reward > 0;
    if (coll <= 0 && debt <= 0 && reward <= 0) continue;
    const protocol = String(p.protocol || "Lending");
    const assetParts = [];
    if (p.collateralAsset) assetParts.push(String(p.collateralAsset));
    if (p.borrowAsset) assetParts.push(String(p.borrowAsset));
    const fromSupplied = (p.supplied || []).map((x) => x.token || x.symbol || x.asset).filter(Boolean);
    const asset =
      assetParts.length > 0
        ? assetParts.join(" / ")
        : fromSupplied.join(" + ") || "Lending";
    out.push({
      id: stableId("lending", pack.address, protocol, p.chain, asset, coll, debt),
      type: rewardsOnly ? "rewards" : "lending",
      protocol,
      chain: chainLabel(p.chain || p.chainLabel),
      walletLabel: label,
      asset,
      valueUsd: rewardsOnly ? 0 : round2(coll - debt),
      collateralUsd: coll,
      debtUsd: debt,
      ratePct: p.borrowApy ?? p.supplyApy ?? null,
      rewardUsd: reward,
      healthFactor: p.healthFactor == null ? null : num(p.healthFactor, null),
      closeFactor: p.closeFactor ?? p.close_factor ?? null,
      includedInNetWorth: !rewardsOnly,
      detail: rewardsOnly ? "Начисленные награды (вне капитала)" : debt > 0 ? "Залоговая позиция" : "Снабжение без долга",
      details: {
        collateralAsset: p.collateralAsset || null,
        borrowAsset: p.borrowAsset || null,
        supplyApy: p.supplyApy ?? null,
        borrowApy: p.borrowApy ?? null,
        closeFactor: p.closeFactor ?? p.close_factor ?? null,
        liquidationPrice: p.liquidationPrice ?? null,
        marketPrice: p.marketPrice ?? null,
        link: p.link || null,
        supplied: p.supplied || null,
        borrowed: p.borrowed || null,
        rewards: p.rewards || [],
        sourceTimestamp: p.updatedAt || pack.updatedAt || null,
      },
    });
  }
  return out;
}

function mapLiquidity(pack) {
  const label = walletLabel(pack.address, pack.kind);
  const out = [];
  for (const p of pack.liquidityPositions || []) {
    if (p.isActive === false) continue;
    const value = round2(p.positionValueUsd ?? p.valueUsd);
    if (value <= 0 && !p.positionId) continue;
    const reward = round2(num(p.feesUsd) + num(p.incentivesUsd));
    const protocol = String(p.platform || p.protocol || "LP");
    const pair = String(p.pair || "LP");
    out.push({
      id: stableId("lp", pack.address, p.chain, p.positionId || pair, protocol),
      type: "liquidity",
      protocol,
      chain: chainLabel(p.chain),
      walletLabel: label,
      asset: pair,
      valueUsd: value,
      collateralUsd: 0,
      debtUsd: 0,
      ratePct: p.displayApr ?? p.apr ?? p.aprPct ?? null,
      rewardUsd: reward,
      healthFactor: null,
      includedInNetWorth: true,
      detail: "Активная LP-позиция",
      details: {
        positionId: p.positionId || null,
        feesUsd: p.feesUsd ?? null,
        incentivesUsd: p.incentivesUsd ?? null,
        feeTier: p.feeTier ?? null,
        // Explicit units only. Never guess whether 100 means percent, bps or pips.
        feeTierPct: p.feeTierPct ?? (p.feeTierUnit === "percent" ? p.feeTier : null),
        dynamicFee: p.dynamicFee ?? null,
        rangeQuote: p.rangeQuote ?? null,
        rateKind: p.rateKind || "APR",
        rateSource: p.rateSource ?? null,
        isFullRange: p.isFullRange ?? false,
        ratePeriod: p.ratePeriod ?? null,
        rangeMin: p.rangeMin ?? null,
        rangeMax: p.rangeMax ?? null,
        rangeCurrent: p.rangeCurrent ?? null,
        openedAt: p.openedAt || null,
        inRange: p.inRange ?? null,
        earnings: p.earnings || null,
        link: p.link || null,
        sourceTimestamp: p.updatedAt || pack.updatedAt || null,
      },
    });
  }
  return out;
}

function mapYield(pack) {
  const label = walletLabel(pack.address, pack.kind);
  const out = [];
  for (const p of pack.yieldPositions || []) {
    if (p.isActive === false) continue;
    const value = round2(p.positionUsd ?? p.valueUsd ?? p.netUsd);
    if (value <= 0) continue;
    const protocol = String(p.protocol || p.platform || "Yield");
    const asset = String(p.asset || p.pair || "Yield");
    out.push({
      id: stableId("yield", pack.address, protocol, p.chain, p.marketId || p.poolId || asset),
      type: "yield",
      protocol,
      chain: chainLabel(p.chain),
      walletLabel: label,
      asset,
      valueUsd: value,
      collateralUsd: 0,
      debtUsd: 0,
      ratePct: p.displayApr ?? p.apr ?? p.aprPct ?? null,
      rewardUsd: round2(p.rewardsUsd || 0),
      healthFactor: null,
      includedInNetWorth: true,
      detail: "Yield / Deposit позиция",
      details: {
        marketId: p.marketId || p.poolId || null,
        kind: p.kind || null,
        supplied: p.supplied || null,
        rewards: p.rewards || [],
        link: p.link || null,
        sourceTimestamp: p.updatedAt || pack.updatedAt || null,
      },
    });
  }
  return out;
}

function mapWallets(packs, walletIdleUsd) {
  const list = packs || [];
  if (!list.length) {
    if (walletIdleUsd <= 0) return [];
    return [
      {
        id: stableId("wallet", "aggregate"),
        type: "wallet",
        protocol: "Wallet",
        chain: "Multi",
        walletLabel: "Все кошельки",
        asset: "Idle assets",
        valueUsd: walletIdleUsd,
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
  // Attribute idle per pack from summary.walletUsd (already in Navigator totals).
  return list.map((pack) => {
    const idle = round2((pack.summary || {}).walletUsd);
    return {
      id: stableId("wallet", pack.kind, pack.address),
      type: "wallet",
      protocol: "Wallet",
      chain: pack.kind === "sol" ? "Solana" : "Multi",
      walletLabel: walletLabel(pack.address, pack.kind),
      asset: "Idle assets",
      valueUsd: idle,
      collateralUsd: 0,
      debtUsd: 0,
      ratePct: null,
      rewardUsd: 0,
      healthFactor: null,
      includedInNetWorth: idle > 0,
      detail: "Свободные средства на кошельке",
      details: {
        addressMasked: pack.addressMasked || shortAddr(pack.address),
        kind: pack.kind,
        sourceTimestamp: pack.updatedAt || null,
      },
    };
  });
}

function loadLegacyHistoryArchive() {
  for (const file of candidatePaths(null, ["portfolio-data.js"])) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, "utf8");
      const eq = raw.indexOf("=");
      if (eq < 0) continue;
      const payload = JSON.parse(raw.slice(eq + 1).trim().replace(/;\\s*$/, ""));
      return Array.isArray(payload.snapshots) ? payload.snapshots : [];
    } catch (err) {
      console.warn("[public-portfolio/v2] historical archive unavailable:", String(err?.message || err));
    }
  }
  return [];
}

function buildHistory(snap, currentNetWorthUsd) {
  // Legacy chart values are retained as historical observations per product
  // requirements. They already contain the public equity adjustment.
  const byDay = new Map();
  const updatedDate = dayKey(snap.updatedAt || snap.generatedAt);
  // Never show archive rows dated after the latest cabinet snapshot: they are
  // not yet confirmed by a live balance.
  for (const row of loadLegacyHistoryArchive()) {
    const date = dayKey(row?.timestamp || row?.date || row?.day);
    const equity = Number(row?.equityUsd);
    if (date && (!updatedDate || date <= updatedDate) && Number.isFinite(equity)) {
      byDay.set(date, round2(equity));
    }
  }
  // Prefer the more recent Navigator daily cache where it overlaps the archive.
  for (const h of Array.isArray(snap.historyDaily) ? snap.historyDaily : []) {
    const date = dayKey(h?.date || h?.day);
    const raw = h.equityUsd ?? h.totalUsd;
    const equity = Number(raw);
    if (date && (!updatedDate || date <= updatedDate) && raw != null && raw !== "" && Number.isFinite(equity)) {
      byDay.set(date, round2(equity + INTERNAL_EQUITY_ADJUSTMENT_USD));
    }
  }
  // Today's live cabinet total is authoritative and replaces its archive row.
  if (updatedDate && Number.isFinite(Number(currentNetWorthUsd))) {
    byDay.set(updatedDate, round2(currentNetWorthUsd));
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, equityUsd]) => ({ date, equityUsd }));
}

function collectCompleteness(snap, ctx) {
  const reasons = [];
  if (ctx.endpointError) {
    reasons.push(
      `Read-only endpoint Navigator недоступен: ${ctx.endpointError}. Сохранённый JSON не считается актуальным снимком.`
    );
  }
  if (ctx.sourceKind === "file-fallback") {
    reasons.push(
      "Показан устаревший файловый кэш (file-fallback) — live snapshotId/updatedAt с endpoint не получены."
    );
  }
  if (ctx.requireLiveEndpoint && !ctx.liveFromEndpoint) {
    reasons.push(
      "Ожидался live-снимок с NAVIGATOR_SNAPSHOT_URL, но endpoint не отдал актуальные данные."
    );
  }
  if (!snap || snap.ok === false) {
    reasons.push(
      snap?.error
        ? `Снимок Navigator недоступен (${snap.error}).`
        : "Снимок Navigator отсутствует или повреждён."
    );
    return reasons;
  }
  if (!snap.snapshotId) {
    reasons.push("В снимке Navigator нет snapshotId.");
  }
  if (!snap.updatedAt) {
    reasons.push("В снимке Navigator нет updatedAt.");
  }
  if (!(ctx.navigatorBalanceUsd > 0)) {
    reasons.push("В снимке Navigator нулевой или отсутствующий баланс кабинета.");
  }
  const wallets = snap.wallets || (snap.walletPacks || []).map((p) => p.address);
  if (!wallets.length) {
    reasons.push("В снимке Navigator нет кошельков.");
  }
  const packs = snap.walletPacks || [];
  const hasLending = packs.some((p) => (p.lendingPositions || []).length > 0);
  const hasLp = packs.some((p) => (p.liquidityPositions || []).length > 0);
  const hasYield =
    packs.some((p) => (p.yieldPositions || []).some((y) => num(y.positionUsd ?? y.valueUsd) > 0)) ||
    ctx.yieldPrincipalUsd > 0;
  if (!hasLending && ctx.collateralUsd <= 0 && ctx.debtUsd <= 0) {
    reasons.push("В снимке Navigator нет lending-позиций.");
  }
  if (!hasLp && ctx.liquidityUsd <= 0) {
    reasons.push("В снимке Navigator нет LP-позиций.");
  }
  if (!hasYield) {
    reasons.push("В снимке Navigator нет Yield-позиции (в кабинете Yield входит в баланс).");
  }
  // Age alone must never mark the snapshot incomplete or blank metrics.
  // Stale is signaled separately via meta.stale + honest updatedAt.

  // Independent SoT: navigatorBalanceUsd from export totals — not a self-sum of this API.
  const expectedPublic = round2(ctx.navigatorBalanceUsd + INTERNAL_EQUITY_ADJUSTMENT_USD);
  const gapPublic = round2(ctx.netWorthUsd - expectedPublic);
  if (Math.abs(gapPublic) > NAV_TOLERANCE_USD) {
    reasons.push(
      `Чистый капитал Public Portfolio ($${ctx.netWorthUsd}) не равен балансу снимка Navigator ($${ctx.navigatorBalanceUsd}) + внутренняя корректировка (ожидалось $${expectedPublic}, Δ=${gapPublic >= 0 ? "+" : ""}$${gapPublic}).`
    );
  }

  const componentSum = round2(
    ctx.walletIdleUsd + ctx.collateralUsd + ctx.liquidityUsd + ctx.yieldPrincipalUsd - ctx.debtUsd
  );
  const gapComponents = round2(componentSum - ctx.navigatorBalanceUsd);
  if (Math.abs(gapComponents) > NAV_TOLERANCE_USD) {
    reasons.push(
      `Сумма категорий API ($${componentSum}) расходится с балансом снимка Navigator ($${ctx.navigatorBalanceUsd}) на ${gapComponents >= 0 ? "+" : ""}$${gapComponents}.`
    );
  }

  return reasons;
}

/**
 * @param {object} snap navigator-cabinet-snapshot payload
 * @param {{ limit?: number, cursor?: string, log?: Function }} [opts]
 */
export function buildPublicPortfolioV2FromNavigator(snap, opts = {}) {
  const log = opts.log || console.info.bind(console);
  const sourceKind = opts.sourceKind || "unknown";
  const liveFromEndpoint = opts.liveFromEndpoint === true;
  const endpointUrl = opts.endpointUrl || null;
  const endpointError = opts.endpointError || null;
  const requireLiveEndpoint =
    opts.requireLiveEndpoint === true ||
    Boolean(endpointUrl) ||
    String(process.env.VERCEL_ENV || "") === "preview" ||
    String(process.env.VERCEL_ENV || "") === "production";

  if (!snap || snap.ok === false) {
    const updatedAt = snap?.generatedAt || new Date().toISOString();
    const incompleteReasons = collectCompleteness(snap, {
      updatedAt,
      ageMs: Infinity,
      navigatorBalanceUsd: 0,
      netWorthUsd: 0,
      walletIdleUsd: 0,
      collateralUsd: 0,
      liquidityUsd: 0,
      yieldPrincipalUsd: 0,
      debtUsd: 0,
      sourceKind,
      liveFromEndpoint,
      endpointError,
      requireLiveEndpoint,
    });
    const payload = {
      meta: {
        updatedAt,
        source: "DeFi Navigator",
        walletCount: 0,
        chains: 0,
        stale: true,
        complete: false,
        incompleteReasons,
        snapshotId: snap?.snapshotId || null,
        navigatorBalanceUsd: 0,
        formula: "navigatorBalanceUsd + internalEquityAdjustment",
        rewardsInNetWorth: false,
        liveFromEndpoint: false,
        snapshotSource: sourceKind,
        endpointUrl,
        endpointError,
        transactionsAvailable: false,
        transactionsNote:
          "Снимок Navigator недоступен — позиции и история не сформированы.",
        navigatorSnapshot: {
          snapshotId: snap?.snapshotId || null,
          updatedAt,
          balanceUsd: 0,
          error: snap?.error || "MISSING_SNAPSHOT",
          liveFromEndpoint: false,
          sourceKind,
          endpointError,
        },
      },
      summary: {
        netWorthUsd: 0,
        walletIdleUsd: 0,
        collateralUsd: 0,
        liquidityUsd: 0,
        yieldPrincipalUsd: 0,
        debtUsd: 0,
        rewardsAccruedUsd: 0,
        borrowAprPct: null,
        healthFactor: null,
        changePct30d: null,
      },
      positions: [],
      transactions: [],
      history: [],
    };
    assertNoAdjustmentLeak(payload);
    return payload;
  }

  const totals = snap.totals || {};
  const packs = snap.walletPacks || [];

  const lending = packs.flatMap(mapLending);
  const liquidity = packs.flatMap(mapLiquidity);
  const yields = packs.flatMap(mapYield);

  // Categories from Navigator snapshot totals (cabinet formula), not recomputed live APIs.
  const walletIdleUsd = round2(totals.walletUsd);
  const collateralUsd = round2(totals.collateralUsd);
  const debtUsd = round2(totals.borrowUsd);
  const liquidityUsd = round2(totals.liquidityUsd);
  const yieldPrincipalUsd = round2(totals.yieldUsd);
  // Rewards are unclaimed / not in cabinet balance.
  const rewardsAccruedUsd = round2(totals.rewardsUsd);
  const rewardsInBalance = Boolean(totals.rewardsInBalance);

  const navigatorBalanceUsd = round2(totals.totalUsd);
  const netWorthUsd = round2(navigatorBalanceUsd + INTERNAL_EQUITY_ADJUSTMENT_USD);

  const wallets = mapWallets(packs, walletIdleUsd);
  const positions = [...lending, ...liquidity, ...yields, ...wallets];

  const history = buildHistory(snap, netWorthUsd);

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

  const updatedAt = snap.updatedAt || snap.generatedAt || new Date().toISOString();
  const updatedMs = Date.parse(updatedAt);
  const ageMs = Number.isFinite(updatedMs) ? Date.now() - updatedMs : Infinity;

  const incompleteReasons = collectCompleteness(snap, {
    updatedAt,
    ageMs,
    walletIdleUsd,
    collateralUsd,
    debtUsd,
    liquidityUsd,
    yieldPrincipalUsd,
    netWorthUsd,
    navigatorBalanceUsd,
    sourceKind,
    liveFromEndpoint,
    endpointError,
    requireLiveEndpoint,
  });
  // File cache must never report complete/live when an endpoint is expected.
  const complete = incompleteReasons.length === 0 && (!requireLiveEndpoint || liveFromEndpoint);
  const stale =
    ageMs > STALE_AFTER_MS ||
    sourceKind === "file-fallback" ||
    Boolean(endpointError) ||
    (requireLiveEndpoint && !liveFromEndpoint);

  const chains = new Set();
  for (const p of positions) {
    if (p.chain && p.chain !== "—" && p.chain !== "Multi") chains.add(p.chain);
  }

  const walletCount = new Set(
    (snap.wallets || packs.map((p) => p.address)).filter(Boolean)
  ).size;

  const snapshotId = String(snap.snapshotId || "").trim() || stableId("nav", updatedAt, navigatorBalanceUsd);

  const transactionsAvailable = false;
  const transactionsNote =
    "В кэше личного кабинета DeFi Navigator нет ленты транзакций для публичной витрины.";

  log("[public-portfolio/v2] navigator snapshot", {
    snapshotId,
    updatedAt,
    complete,
    incompleteReasons,
    stale,
    liveFromEndpoint,
    sourceKind,
    endpointUrl,
    endpointError,
    navigatorBalanceUsd,
    netWorthUsd,
    components: {
      walletIdleUsd,
      collateralUsd,
      liquidityUsd,
      yieldPrincipalUsd,
      debtUsd,
      rewardsAccruedUsd,
      rewardsInBalance,
    },
    positionCounts: {
      lending: lending.length,
      liquidity: liquidity.length,
      yield: yields.length,
      wallet: wallets.length,
      total: positions.length,
    },
  });

  const payload = {
    meta: {
      updatedAt,
      source: "DeFi Navigator",
      walletCount,
      chains: chains.size,
      stale,
      complete,
      incompleteReasons,
      snapshotId,
      navigatorBalanceUsd,
      formula:
        "navigatorBalanceUsd(= wallet + collateral + liquidity + yield − debt from cabinet cache) + internalEquityAdjustment",
      rewardsInNetWorth: rewardsInBalance,
      liveFromEndpoint,
      snapshotSource: sourceKind,
      endpointUrl,
      endpointError,
      positionCounts: {
        total: positions.length,
        lending: lending.length,
        liquidity: liquidity.length,
        yield: yields.length,
        wallet: wallets.length,
      },
      transactionsAvailable,
      transactionsNote,
      navigatorSnapshot: {
        snapshotId,
        updatedAt,
        generatedAt: snap.generatedAt || null,
        balanceUsd: navigatorBalanceUsd,
        source: snap.source || "DeFi Navigator cockpit cache",
        clientId: snap.clientId ?? null,
        liveFromEndpoint,
        sourceKind,
        endpointUrl,
        endpointError,
        components: {
          walletIdleUsd,
          collateralUsd,
          liquidityUsd,
          yieldPrincipalUsd,
          debtUsd,
          rewardsAccruedUsd,
          rewardsInBalance,
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
    transactions: [],
    history,
  };

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

/** @deprecated Use buildPublicPortfolioV2FromNavigator */
export function buildPublicPortfolioV2(data, opts = {}) {
  // Accept either a navigator snapshot or a legacy wrapper.
  if (data?.walletPacks || data?.totals?.totalUsd != null || data?.schema?.includes?.("navigator")) {
    return buildPublicPortfolioV2FromNavigator(data, opts);
  }
  if (data?.navigatorCabinetSnapshot) {
    return buildPublicPortfolioV2FromNavigator(data.navigatorCabinetSnapshot, opts);
  }
  return buildPublicPortfolioV2FromNavigator(
    { ok: false, error: "LEGACY_PORTFOLIO_DATA_NOT_SUPPORTED" },
    opts
  );
}

export function buildFromDisk(opts = {}) {
  const { data, path: snapPath } = loadNavigatorSnapshot(opts.snapshotPath || opts.cachePath);
  const log = opts.log || console.info.bind(console);
  log("[public-portfolio/v2] navigator snapshot file", path.basename(snapPath));
  return buildPublicPortfolioV2FromNavigator(data, {
    ...opts,
    sourceKind: "file",
    liveFromEndpoint: false,
    endpointUrl: null,
    endpointError: null,
    requireLiveEndpoint: false,
  });
}

export async function buildFromSource(opts = {}) {
  const loaded = await loadNavigatorSnapshotSource(opts);
  const log = opts.log || console.info.bind(console);
  log(
    "[public-portfolio/v2] navigator snapshot source",
    loaded.sourceKind,
    String(loaded.path || "").slice(0, 120),
    loaded.liveFromEndpoint ? "live" : "not-live"
  );
  return buildPublicPortfolioV2FromNavigator(loaded.data, {
    ...opts,
    sourceKind: loaded.sourceKind,
    liveFromEndpoint: loaded.liveFromEndpoint === true,
    endpointUrl: loaded.endpointUrl || null,
    endpointError: loaded.endpointError || null,
    requireLiveEndpoint:
      opts.requireLiveEndpoint != null
        ? Boolean(opts.requireLiveEndpoint)
        : Boolean(loaded.endpointUrl) ||
          String(process.env.VERCEL_ENV || "") === "preview" ||
          String(process.env.VERCEL_ENV || "") === "production",
  });
}
