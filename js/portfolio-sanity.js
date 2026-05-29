/** Отсекаем битый ончейн/парс (wei как USD, неверный decode). */
export function saneUsd(n, cap = 5_000_000) {
  const v = Number(n) || 0;
  if (!Number.isFinite(v) || v < 0) return false;
  return v <= cap;
}

/** @param {object} p lending row */
export function saneLendingPosition(p, debankTotalUsd = 0) {
  if (!p) return false;
  const cap = Math.max(50_000, (debankTotalUsd || 0) * 5, 5_000_000);
  const c = p.collateralUsd || 0;
  const d = p.debtUsd || 0;
  const n = Math.abs(p.netUsd || 0);
  return saneUsd(c, cap) && saneUsd(d, cap) && saneUsd(n, cap);
}

/** @param {object} p liquidity row */
export function saneLiquidityPosition(p, debankTotalUsd = 0) {
  if (!p) return false;
  const cap = Math.max(50_000, (debankTotalUsd || 0) * 5, 5_000_000);
  return saneUsd(p.positionUsd || 0, cap);
}
