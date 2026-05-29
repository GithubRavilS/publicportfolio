/** Минимальная математика Uniswap V3 для оценки amount0/amount1 из liquidity. */

const Q96 = 2n ** 96n;

/** Fallback when bit-twiddling path underflows (large |tick|). */
export function tickToSqrtPriceX96Approx(tick) {
  const sqrtP = Math.sqrt(Math.pow(1.0001, tick));
  if (!Number.isFinite(sqrtP) || sqrtP <= 0) return 0n;
  return BigInt(Math.floor(sqrtP * Number(Q96)));
}

export function tickToSqrtPriceX96(tick) {
  const absTick = tick < 0 ? -tick : tick;
  let ratio = (absTick & 0x1) !== 0 ? 0xfffcb933bd6fb80000n : 0x1000000000000000000000000n;
  if (absTick & 0x2) ratio = (ratio * 0xfff97272373d400000n) >> 128n;
  if (absTick & 0x4) ratio = (ratio * 0xfff2e50f5f65700000n) >> 128n;
  if (absTick & 0x8) ratio = (ratio * 0xffe5caca7e10f00000n) >> 128n;
  if (absTick & 0x10) ratio = (ratio * 0xffcb9843d60f700000n) >> 128n;
  if (absTick & 0x20) ratio = (ratio * 0xff973b41fa98e80000n) >> 128n;
  if (absTick & 0x40) ratio = (ratio * 0xff2ea16466c9b00000n) >> 128n;
  if (absTick & 0x80) ratio = (ratio * 0xfe5dee046a9a380000n) >> 128n;
  if (absTick & 0x100) ratio = (ratio * 0xfcbe86c7900bb00000n) >> 128n;
  if (absTick & 0x200) ratio = (ratio * 0xf987a7253ac6580000n) >> 128n;
  if (absTick & 0x400) ratio = (ratio * 0xf3392b6822bb600000n) >> 128n;
  if (absTick & 0x800) ratio = (ratio * 0xe7159470a1652c0000n) >> 128n;
  if (absTick & 0x1000) ratio = (ratio * 0xd097f3bdfd2f20000n) >> 128n;
  if (absTick & 0x2000) ratio = (ratio * 0xa9f746462d9f80000n) >> 128n;
  if (absTick & 0x4000) ratio = (ratio * 0x70d869a156f31c0000n) >> 128n;
  if (absTick & 0x8000) ratio = (ratio * 0x31be13598b48b80000n) >> 128n;
  if (absTick & 0x10000) ratio = (ratio * 0x9aa508b5b7a840000n) >> 128n;
  if (absTick & 0x20000) ratio = (ratio * 0x5d6af8dedc582c0000n) >> 128n;
  if (absTick & 0x40000) ratio = (ratio * 0x2216e584f5fa00000n) >> 128n;
  if (absTick & 0x80000) ratio = (ratio * 0x48a170391f7e40000n) >> 128n;
  if (tick > 0) ratio = (2n ** 256n - 1n) / ratio;
  const out = (ratio * Q96) >> 128n;
  if (out === 0n && absTick > 0) return tickToSqrtPriceX96Approx(tick);
  return out;
}

function mulDiv(a, b, denom) {
  return (a * b) / denom;
}

function getAmount0Delta(sqrtRatioAX96, sqrtRatioBX96, liquidity) {
  if (sqrtRatioAX96 > sqrtRatioBX96)
    [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
  if (sqrtRatioAX96 === 0n) return 0n;
  return mulDiv(liquidity << 96n, sqrtRatioBX96 - sqrtRatioAX96, sqrtRatioBX96) / sqrtRatioAX96;
}

function getAmount1Delta(sqrtRatioAX96, sqrtRatioBX96, liquidity) {
  if (sqrtRatioAX96 > sqrtRatioBX96)
    [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
  return mulDiv(liquidity, sqrtRatioBX96 - sqrtRatioAX96, Q96);
}

export function amountsForLiquidity(liquidity, tickLower, tickUpper, tickCurrent) {
  const L = BigInt(liquidity);
  if (L === 0n) return { amount0: 0n, amount1: 0n };
  const sqrtL = tickToSqrtPriceX96(tickLower);
  const sqrtU = tickToSqrtPriceX96(tickUpper);
  const sqrtC = tickToSqrtPriceX96(tickCurrent);
  if (tickCurrent < tickLower) {
    return { amount0: getAmount0Delta(sqrtL, sqrtU, L), amount1: 0n };
  }
  if (tickCurrent >= tickUpper) {
    return { amount0: 0n, amount1: getAmount1Delta(sqrtL, sqrtU, L) };
  }
  return {
    amount0: getAmount0Delta(sqrtC, sqrtU, L),
    amount1: getAmount1Delta(sqrtL, sqrtC, L),
  };
}

export function formatAmount(raw, decimals) {
  return Number(raw) / 10 ** decimals;
}
