/**
 * Гибрид: Alchemy (секунды) → RPC enrich (farm, награды, unstaked LP).
 */
import { buildAlchemyFastPortfolio } from "./alchemy-fast-portfolio.js";
import { buildRpcPortfolio } from "./rpc-portfolio.js";
import { finalizeOnchainPortfolio, ONCHAIN_PORTFOLIO_SCHEMA } from "./portfolio-onchain-finalize.js";
import {
  buildProtocolGroups,
  buildChains,
  buildProtocolTabs,
} from "./onchain-portfolio.js";
import { syncDisplayTotals } from "./portfolio-normalize.js";

function liqKey(p) {
  return `${p.chain}|${p.tokenId || p.poolId || p.pair}`;
}

/**
 * @param {object} fast
 * @param {object} rpc
 */
export function mergeHybridEnrichment(fast, rpc) {
  const w = (fast.wallet || rpc.wallet || "").toLowerCase();
  const liqMap = new Map();
  for (const p of fast.liquidity || []) {
    liqMap.set(liqKey(p), { ...p });
  }
  for (const p of rpc.liquidity || []) {
    const k = liqKey(p);
    const prev = liqMap.get(k);
    if (!prev) {
      liqMap.set(k, { ...p, source: p.source || "onchain-farm" });
      continue;
    }
    liqMap.set(k, {
      ...prev,
      ...p,
      tokenId: p.tokenId || prev.tokenId,
      kind: p.kind || prev.kind,
      staked: p.staked ?? prev.staked,
      positionUsd: p.positionUsd || prev.positionUsd,
      claimable: p.claimable?.length ? p.claimable : prev.claimable,
      cakeReward: p.cakeReward || prev.cakeReward,
      enrichmentPending: false,
      source: p.source || prev.source,
    });
  }

  const walletMap = new Map();
  for (const t of [...(fast.walletTokens || []), ...(rpc.walletTokens || [])]) {
    const k = `${t.chain}|${(t.address || t.symbol || "").toLowerCase()}`;
    const prev = walletMap.get(k);
    if (!prev || (t.usd || 0) > (prev.usd || 0)) walletMap.set(k, t);
  }

  const walletTokens = [...walletMap.values()];
  const liquidity = [...liqMap.values()];

  const protocolGroups = buildProtocolGroups(
    rpc.lending || fast.lending || [],
    liquidity,
    walletTokens,
  );
  const walletUsd = walletTokens.reduce((s, t) => s + (t.usd || 0), 0);
  const liqUsd = liquidity.reduce((s, p) => s + (p.positionUsd || 0), 0);
  const lendUsd = (rpc.lending || []).reduce(
    (s, p) => s + Math.max(p.netUsd || 0, 0),
    0,
  );

  let portfolio = {
    totalUsd: Math.round((walletUsd + liqUsd + lendUsd) * 100) / 100,
    walletUsd: Math.round(walletUsd * 100) / 100,
    liqUsd: Math.round(liqUsd * 100) / 100,
    lendUsd: Math.round(lendUsd * 100) / 100,
    chains: buildChains(protocolGroups, walletTokens),
    protocolTabs: buildProtocolTabs(protocolGroups),
    protocolGroups,
    walletTokens,
    walletByChain: rpc.walletByChain || fast.walletByChain || {},
    liquidity,
    lending: rpc.lending || [],
    source: "hybrid",
    phase: "enriched",
    partial: false,
    enrichmentPending: false,
    alchemy: true,
    onchain: true,
    scanMs: (fast.scanMs || 0) + (rpc.scanMs || 0),
    scannedChains: rpc.scannedChains || fast.scannedChains,
    schemaVersion: ONCHAIN_PORTFOLIO_SCHEMA,
  };

  return portfolio;
}

/**
 * @param {string} wallet
 * @param {{ chains?: string[] }} [opts]
 */
export async function buildHybridFastPortfolio(wallet, opts = {}) {
  return buildAlchemyFastPortfolio(wallet, opts);
}

/**
 * @param {string} wallet
 * @param {object} [fastPortfolio] — если есть, не дергаем Alchemy повторно
 */
export async function buildHybridEnrichedPortfolio(wallet, fastPortfolio = null) {
  const t0 = Date.now();
  const fast = fastPortfolio || (await buildAlchemyFastPortfolio(wallet));
  const rpc = await buildRpcPortfolio(wallet, {
    pancakeOnly: true,
    fastLp: true,
    lpOnly: false,
    rpcOnlyWallet: true,
  });
  let merged = mergeHybridEnrichment(fast, rpc);
  merged = await finalizeOnchainPortfolio(merged, wallet);
  merged.source = "hybrid";
  merged.phase = "enriched";
  merged.scanMs = Date.now() - t0;
  merged = syncDisplayTotals(merged);
  return merged;
}
