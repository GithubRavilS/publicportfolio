/**
 * Исправление LP после Jina-scrape DeBank:
 * - дубли NFT на arb/eth → одна сеть через ownerOf
 * - USD / стейк / CAKE — с on-chain (scrape часто занижает или путает сеть)
 */
import { verifyLpTokenOwners } from "./portfolio-onchain-finalize.js";
import { extractLpTokenId } from "./lp-onchain.js";
import { dedupeLiquidityByTokenId, buildProtocolGroups } from "./debank-parse.js";
import { syncDisplayTotals } from "./portfolio-normalize.js";
import { scanProtocolPositions } from "./protocols/scan.js";

function collectLp(portfolio) {
  const rows = [];
  for (const g of portfolio.protocolGroups || []) {
    for (const p of g.liquidity || []) {
      rows.push({ ...p, protocol: p.protocol || g.protocol, chain: p.chain || g.chain });
    }
  }
  for (const p of portfolio.liquidity || []) rows.push(p);
  return rows;
}

function isOverviewRow(p) {
  const s = `${p.poolId || ""} ${p.pair || ""}`.toLowerCase();
  return s.includes("overview") || (String(p.pair || "") === String(p.protocol || "") && !extractLpTokenId(p));
}

function protocolScanId(protocol) {
  const n = String(protocol || "").toLowerCase();
  if (n.includes("pancake")) return "pancakeswap-v3";
  if (n.includes("uniswap") && n.includes("v3")) return "uniswap-v3";
  if (n.includes("aerodrome")) return "aerodrome-v3";
  return null;
}

async function onchainLpByTokenId(wallet, liquidityRows) {
  const chains = [
    ...new Set(liquidityRows.map((p) => p.chain).filter((c) => c && c !== "unknown")),
  ];
  const scanIds = [
    ...new Set(liquidityRows.map((p) => protocolScanId(p.protocol)).filter(Boolean)),
  ];
  const map = new Map();
  for (const scanId of scanIds) {
    try {
      const positions = await scanProtocolPositions(scanId, wallet, {
        chains: chains.length ? chains : undefined,
      });
      for (const p of positions) {
        if (p.tokenId) map.set(String(p.tokenId), p);
      }
    } catch {
      /* */
    }
  }
  return map;
}

function mergeOnchainIntoRow(debankRow, onchainRow) {
  return {
    ...debankRow,
    chain: onchainRow.chain,
    positionUsd: onchainRow.positionUsd,
    netUsd: onchainRow.netUsd ?? onchainRow.positionUsd,
    inPool: onchainRow.inPool?.length ? onchainRow.inPool : debankRow.inPool,
    pair: onchainRow.pair || debankRow.pair,
    pairKey: onchainRow.pairKey || debankRow.pairKey,
    poolId: onchainRow.poolId || debankRow.poolId,
    tokenId: onchainRow.tokenId,
    staked: onchainRow.staked,
    kind: onchainRow.kind,
    claimable: onchainRow.claimable,
    claimableUsd: onchainRow.claimableUsd,
    cakeReward: onchainRow.cakeReward,
    cakeRewardUsd: onchainRow.cakeRewardUsd,
    feeTier: onchainRow.feeTier ?? debankRow.feeTier,
    rangeMin: onchainRow.rangeMin ?? debankRow.rangeMin,
    rangeMax: onchainRow.rangeMax ?? debankRow.rangeMax,
    rangeCurrent: onchainRow.rangeCurrent ?? debankRow.rangeCurrent,
    onchain: true,
    chainVerified: true,
    source: "debank-onchain-merge",
  };
}

function applyChainFix(portfolio, verified, onchainByTid) {
  const lending = portfolio.lending || [];
  let liquidity = dedupeLiquidityByTokenId(collectLp(portfolio));
  const walletTokens = portfolio.walletTokens || [];
  const hasNft = onchainByTid.size > 0;

  liquidity = liquidity
    .map((p) => {
      const tid = extractLpTokenId(p) || p.tokenId;
      if (!tid) return p;
      const hit = verified.get(String(tid));
      const oc = onchainByTid.get(String(tid));
      if (oc) return mergeOnchainIntoRow(p, oc);
      if (hit) return { ...p, chain: hit.chain, tokenId: tid, chainVerified: true };
      return p;
    })
    .filter((p) => {
      if (isOverviewRow(p) && hasNft) return false;
      const tid = extractLpTokenId(p) || p.tokenId;
      if (tid && !verified.has(String(tid)) && !onchainByTid.has(String(tid))) return false;
      if (!tid && (p.positionUsd || 0) < 1) return false;
      if (!tid && /farming/i.test(String(p.kind || p.pair || "")) && (p.positionUsd || 0) < 1)
        return false;
      return true;
    });

  const protocolTabs = portfolio.protocolTabs || [];
  const protocolGroups = buildProtocolGroups(lending, liquidity, walletTokens, protocolTabs);

  const liqUsd = liquidity.reduce((s, p) => s + (p.positionUsd || 0), 0);
  const lendUsd = lending.reduce((s, p) => s + (p.netUsd || 0), 0);
  const walletUsd = walletTokens.reduce((s, t) => s + (t.usd || 0), 0);

  return syncDisplayTotals({
    ...portfolio,
    liquidity,
    protocolGroups,
    liqUsd: Math.round(liqUsd * 100) / 100,
    lendUsd: Math.round(lendUsd * 100) / 100,
    walletUsd: Math.round(walletUsd * 100) / 100,
    computedTotalUsd: Math.round((liqUsd + lendUsd + walletUsd) * 100) / 100,
    debankChainsCorrected: true,
  });
}

/**
 * @param {object} portfolio
 * @param {string} wallet
 * @param {{ enrichUsd?: boolean }} [opts]
 */
export async function correctDebankLiquidityChains(portfolio, wallet, opts = {}) {
  if (!portfolio) return portfolio;
  const enrichUsd = process.env.PT_SKIP_ONCHAIN_ENRICH !== "1" && opts.enrichUsd !== false;
  const rows = collectLp(portfolio);
  const tids = [...new Set(rows.map((p) => extractLpTokenId(p) || p.tokenId).filter(Boolean))];
  if (!tids.length) return dedupeLiquidityByTokenId(portfolio);

  const verified = await verifyLpTokenOwners(wallet, tids);
  const onchainByTid = enrichUsd ? await onchainLpByTokenId(wallet, rows) : new Map();

  if (!verified.size && !onchainByTid.size) {
    return { ...portfolio, liquidity: dedupeLiquidityByTokenId(rows) };
  }

  return applyChainFix(portfolio, verified, onchainByTid);
}
