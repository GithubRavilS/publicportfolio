/**
 * Подмешивание ончейн-диапазонов в портфель после scanAndEnrich.
 */
import { normalizeChain, poolPairKey } from "./revert-match.js";
import { extractLpTokenId } from "./lp-onchain.js";

function lpMatchKey(protocol, p, chainHint) {
  const ch = normalizeChain(p.chain || chainHint);
  const tid = extractLpTokenId(p);
  if (tid) return `tid|${ch}|${tid}`;
  return `pair|${protocol}|${ch}|${poolPairKey(p)}`;
}

export function flattenPortfolioLiquidity(portfolio) {
  const out = [];
  for (const g of portfolio?.protocolGroups || []) {
    for (const p of g.liquidity || []) {
      out.push({
        ...p,
        protocol: g.protocol,
        chain: p.chain || g.chain,
      });
    }
  }
  return out;
}

/**
 * @param {object} portfolio
 * @param {object[]} enriched — результат scanAndEnrich (positions)
 */
export function applyEnrichedLpRanges(portfolio, enriched) {
  if (!portfolio?.protocolGroups?.length || !enriched?.length) return portfolio;

  const byKey = new Map();
  for (const p of enriched) {
    if (p.rangeMin == null || p.rangeMax == null) continue;
    const proto = p.protocol || "";
    byKey.set(lpMatchKey(proto, p, p.chain), p);
  }
  if (!byKey.size) return portfolio;

  for (const g of portfolio.protocolGroups) {
    g.liquidity = (g.liquidity || []).map((p) => {
      const hit = byKey.get(lpMatchKey(g.protocol, p, g.chain));
      if (!hit) return p;
      return {
        ...p,
        rangeMin: hit.rangeMin ?? p.rangeMin,
        rangeMax: hit.rangeMax ?? p.rangeMax,
        rangeCurrent: hit.rangeCurrent ?? p.rangeCurrent,
        rangeNums: hit.rangeNums || p.rangeNums,
        onchain: true,
        onchainTokenId: hit.onchainTokenId || p.onchainTokenId,
        tickLower: hit.tickLower ?? p.tickLower,
        tickUpper: hit.tickUpper ?? p.tickUpper,
        poolAddress: p.poolAddress || hit.poolAddress,
      };
    });
  }
  return portfolio;
}
