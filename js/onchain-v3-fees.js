/**
 * Невостребованные комиссии V3-позиции: tokensOwed + feeGrowthInside (без Revert).
 */
import { ethCallRotate } from "./onchain-rpc.js";

const SEL = {
  feeGrowthGlobal0: "0xf3058399",
  feeGrowthGlobal1: "0x46141319",
  ticks: "0xd7878484",
  slot0: "0x3850c7bd",
};

function encodeInt24(tick) {
  let v = BigInt(tick);
  if (v < 0n) v = (1n << 256n) + v;
  return v.toString(16).padStart(64, "0");
}

function decodeUint128(word) {
  return BigInt(word) & (2n ** 128n - 1n);
}

function decodeUint256(hexWord) {
  return BigInt("0x" + hexWord.replace(/^0x/, ""));
}

async function readTickFeeGrowthOutside(chain, pool, tick) {
  const data = SEL.ticks + encodeInt24(tick);
  const raw = await ethCallRotate(chain, pool, data);
  if (!raw || raw.length < 130) return null;
  const hex = raw.slice(2);
  return {
    outside0: decodeUint256(hex.slice(0, 64)),
    outside1: decodeUint256(hex.slice(64, 128)),
  };
}

async function readFeeGrowthGlobals(chain, pool) {
  const [g0, g1] = await Promise.all([
    ethCallRotate(chain, pool, SEL.feeGrowthGlobal0),
    ethCallRotate(chain, pool, SEL.feeGrowthGlobal1),
  ]);
  if (!g0 || !g1 || g0 === "0x" || g1 === "0x") return null;
  const w0 = g0.replace(/^0x/, "").padStart(64, "0").slice(-64);
  const w1 = g1.replace(/^0x/, "").padStart(64, "0").slice(-64);
  return {
    global0: BigInt("0x" + w0),
    global1: BigInt("0x" + w1),
  };
}

function feeGrowthInside(global, outsideLower, outsideUpper, tickLower, tickUpper, tickCurrent) {
  let below0;
  let below1;
  let above0;
  let above1;
  if (tickCurrent >= tickUpper) {
    below0 = outsideUpper.outside0;
    below1 = outsideUpper.outside1;
    above0 = outsideLower.outside0;
    above1 = outsideLower.outside1;
  } else if (tickCurrent < tickLower) {
    below0 = outsideLower.outside0;
    below1 = outsideLower.outside1;
    above0 = outsideUpper.outside0;
    above1 = outsideUpper.outside1;
  } else {
    below0 = global.global0 - outsideLower.outside0;
    below1 = global.global1 - outsideLower.outside1;
    above0 = global.global0 - outsideUpper.outside0;
    above1 = global.global1 - outsideUpper.outside1;
  }
  const inside0 = global.global0 - below0 - above0;
  const inside1 = global.global1 - below1 - above1;
  return { inside0, inside1 };
}

function feesFromGrowth(liquidity, inside, lastInside, tokensOwed0, tokensOwed1) {
  const Q128 = 2n ** 128n;
  const liq = BigInt(liquidity || 0);
  let d0 = inside.inside0 - BigInt(lastInside.feeGrowthInside0LastX128 || 0);
  let d1 = inside.inside1 - BigInt(lastInside.feeGrowthInside1LastX128 || 0);
  if (d0 < 0n) d0 = 0n;
  if (d1 < 0n) d1 = 0n;
  const f0 = (liq * d0) / Q128 + BigInt(tokensOwed0 || 0);
  const f1 = (liq * d1) / Q128 + BigInt(tokensOwed1 || 0);
  return { amount0Raw: f0, amount1Raw: f1 };
}

export async function computeUnclaimedFees(chain, poolAddress, pos, tickCurrent) {
  if (!poolAddress || !pos?.liquidity) return null;
  try {
    const globals = await readFeeGrowthGlobals(chain, poolAddress);
    const outLower = await readTickFeeGrowthOutside(chain, poolAddress, pos.tickLower);
    const outUpper = await readTickFeeGrowthOutside(chain, poolAddress, pos.tickUpper);
    if (!globals || !outLower || !outUpper) return null;
    const inside = feeGrowthInside(
      globals,
      outLower,
      outUpper,
      pos.tickLower,
      pos.tickUpper,
      tickCurrent,
    );
    return feesFromGrowth(pos.liquidity, inside, pos, pos.tokensOwed0, pos.tokensOwed1);
  } catch {
    return null;
  }
}

export function rawFeesToAmounts(fees, decimals0, decimals1) {
  if (!fees) return { amount0: 0, amount1: 0 };
  const d0 = 10 ** decimals0;
  const d1 = 10 ** decimals1;
  return {
    amount0: Number(fees.amount0Raw) / d0,
    amount1: Number(fees.amount1Raw) / d1,
  };
}
