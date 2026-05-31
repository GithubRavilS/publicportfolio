/**
 * Compound V3 (Comet) — balanceOf + borrowBalanceOf на известных рынках.
 */
import { rpcForChain, padAddr } from "./onchain-rpc.js";
import { fetchPricesUsd, usdValue } from "./onchain-prices.js";

const SEL_BALANCE = "0x70a08231";
/** borrowBalanceOf(address) */
const SEL_BORROW = "0x1fe3b130";

/** @type {Record<string, { protocol: string, markets: { asset: string, comet: string }[] }>} */
export const COMPOUND_V3_MARKETS = {
  eth: {
    protocol: "Compound V3",
    markets: [
      { asset: "USDC", comet: "0xc3d688B667034DDe054682F4D2D3B99c9333afa5" },
      { asset: "WETH", comet: "0xA17581A9E335D22ED4e8b2A19040B0b346831BEE" },
    ],
  },
  base: {
    protocol: "Compound V3",
    markets: [{ asset: "USDC", comet: "0xb125E6677dDEE4DD1208Cc6eF336EB67fcf0E710" }],
  },
  arb: {
    protocol: "Compound V3",
    markets: [
      { asset: "USDC", comet: "0x9c4ec68cA225b1E5b67A9e6B201f30C656fD120" },
      { asset: "WETH", comet: "0x9c4ec68cA225b1E5b67A9e6B201f30C656fD120" },
    ],
  },
  op: {
    protocol: "Compound V3",
    markets: [{ asset: "USDC", comet: "0x9c4ec68cA225b1E5b67A9e6B201f30C656fD120" }],
  },
  matic: {
    protocol: "Compound V3",
    markets: [{ asset: "USDC", comet: "0xF25212E676D1F7F89B72d29e2d064a4479a880b3" }],
  },
};

function decodeUint(hex) {
  if (!hex || hex === "0x") return 0n;
  return BigInt(hex);
}

async function readCometPosition(rpc, comet, wallet, asset, prices) {
  const supRaw = decodeUint(await rpc.ethCall(comet, SEL_BALANCE + padAddr(wallet)));
  let borRaw = 0n;
  try {
    borRaw = decodeUint(await rpc.ethCall(comet, SEL_BORROW + padAddr(wallet)));
  } catch {
    /* */
  }
  const dec = asset === "USDC" ? 6 : 18;
  const supplied = Number(supRaw) / 10 ** dec;
  const borrowed = Number(borRaw) / 10 ** dec;
  if (supplied < 1e-9 && borrowed < 1e-9) return null;
  const supUsd = usdValue(supplied, asset, prices);
  const borUsd = usdValue(borrowed, asset, prices);
  return {
    supplied: supUsd > 0 ? [{ asset, usd: Math.round(supUsd * 100) / 100 }] : [],
    borrowed: borUsd > 0 ? [{ asset, usd: Math.round(borUsd * 100) / 100 }] : [],
    netUsd: Math.round((supUsd - borUsd) * 100) / 100,
  };
}

export async function scanCompoundV3(wallet, chains) {
  const w = wallet.toLowerCase();
  const lending = [];
  const symbols = new Set(["USDC", "WETH", "ETH"]);
  const prices = await fetchPricesUsd([...symbols]);

  for (const chain of chains) {
    const cfg = COMPOUND_V3_MARKETS[chain];
    if (!cfg) continue;
    const rpc = rpcForChain(chain);
    const seen = new Set();
    for (const m of cfg.markets) {
      const key = m.comet.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const pos = await readCometPosition(rpc, m.comet, w, m.asset, prices);
        if (!pos || Math.abs(pos.netUsd) < 0.01) continue;
        lending.push({
          protocol: cfg.protocol,
          chain,
          ...pos,
          onchain: true,
          source: "compound-v3",
          poolId: `${m.asset} · Comet`,
        });
      } catch {
        /* */
      }
    }
  }
  return lending;
}
