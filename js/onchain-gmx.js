/**
 * GMX V2: Reader.getAccountPositions — on-chain позиции на Arbitrum.
 */
import { CHAINS } from "./onchain-registry.js";
import { rpcForChain, padAddr, encodeUint256 } from "./onchain-rpc.js";
import { SEL } from "./onchain-selectors.js";

/** Эвристика: ищем sizeInUsd (1e30 scale) в ABI-ответе Reader. */
function extractGmxUsdValues(hex) {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const usd = [];
  for (let i = 0; i < h.length / 64; i++) {
    const v = BigInt("0x" + h.slice(i * 64, (i + 1) * 64));
    if (v > 10n ** 28n && v < 10n ** 35n) {
      usd.push(Number(v) / 1e30);
    }
  }
  return usd.filter((x) => x >= 0.5 && x < 50_000_000);
}

export async function scanGmxPositions(wallet, chains = ["arb"]) {
  const w = wallet.toLowerCase();
  const liquidity = [];

  for (const chain of chains) {
    const gmx = CHAINS[chain]?.gmx;
    if (!gmx?.reader || !gmx?.dataStore) continue;
    const rpc = rpcForChain(chain);
    const data =
      SEL.getAccountPositions +
      padAddr(gmx.dataStore) +
      padAddr(w) +
      encodeUint256(0) +
      encodeUint256(64);

    let raw;
    try {
      raw = await rpc.ethCall(gmx.reader, data);
    } catch {
      continue;
    }
    if (!raw || raw.length < 130) continue;

    const sizes = extractGmxUsdValues(raw);
    if (!sizes.length) continue;

    let total = 0;
    for (const s of sizes) total += s;

    liquidity.push({
      protocol: gmx.protocol || "GMX V2",
      chain,
      poolId: "gmx-positions",
      pair: "GMX",
      kind: "Perpetuals",
      inPool: [{ amount: sizes.length.toString(), symbol: "positions" }],
      positionUsd: total,
      claimable: [],
      claimableUsd: 0,
      netUsd: total,
      source: "onchain",
      onchain: true,
    });
  }

  return liquidity;
}
