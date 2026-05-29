/**
 * Ликвидация по залогу: liqPrice ≈ marketPrice / healthFactor.
 * marketPrice — USD за 1 единицу основного залога (крупнейший supplied).
 */

function parseAmount(amount) {
  const n = parseFloat(String(amount || "0").replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** @param {{ asset?: string, amount?: string, usd?: number }[]} supplied */
export function primaryCollateralMarketPrice(supplied) {
  const rows = (supplied || [])
    .map((x) => ({
      usd: Number(x.usd || 0),
      amt: parseAmount(x.amount),
    }))
    .filter((x) => x.usd > 0 && x.amt > 0)
    .sort((a, b) => b.usd - a.usd);
  if (!rows.length) return 0;
  return rows[0].usd / rows[0].amt;
}

/** @param {object} pos — lending row with supplied, healthFactor */
export function liquidationPriceFromHealth(pos) {
  const hf = Number(pos?.healthFactor);
  if (!hf || hf <= 0 || hf > 10) return 0;
  const market =
    Number(pos?.marketPrice) > 0
      ? Number(pos.marketPrice)
      : primaryCollateralMarketPrice(pos?.supplied);
  if (!market || market <= 0) return 0;
  return market / hf;
}

/** @param {object} pos */
export function applyLendingMetrics(pos) {
  if (!pos) return pos;
  const marketPrice = primaryCollateralMarketPrice(pos.supplied);
  const liquidationPrice = liquidationPriceFromHealth({
    ...pos,
    marketPrice: marketPrice || pos.marketPrice,
  });
  return {
    ...pos,
    marketPrice: marketPrice || pos.marketPrice || 0,
    liquidationPrice: liquidationPrice || 0,
  };
}
