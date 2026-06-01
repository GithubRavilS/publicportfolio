/**
 * Compound V3 (Comet) — borrowBalanceOf + userCollateral по рынкам (динамические assets).
 */
import { rpcForChain, padAddr } from "./onchain-rpc.js";
import { fetchPricesUsd, usdValue } from "./onchain-prices.js";

const SEL_BALANCE = "0x70a08231";
const SEL_BORROW = "0x374c49b4";
const SEL_COLLATERAL = "0x2b92a07d";
const SEL_NUM_ASSETS = "0xa46fe83b";
const SEL_GET_ASSET = "0xc8c7fe6b";

/** @type {Record<string, { protocol: string; markets: { base: string; comet: string }[] }>} */
export const COMPOUND_V3_MARKETS = {
  eth: {
    protocol: "Compound V3",
    markets: [{ base: "USDC", comet: "0xc3d688B667034DDe054682F4D2D3B99c9333afa5" }],
  },
  base: {
    protocol: "Compound V3",
    markets: [{ base: "USDC", comet: "0xb125E6677dDEE4DD1208Cc6eF336EB67fcf0E710" }],
  },
  arb: {
    protocol: "Compound V3",
    markets: [{ base: "USDC", comet: "0x9c4ec68cA225b1E5b67A9e6B201f30C656fD120" }],
  },
  op: {
    protocol: "Compound V3",
    markets: [{ base: "USDT", comet: "0x995E394b8B2437aC8Ce61Ee0bC610D617962B214" }],
  },
  matic: {
    protocol: "Compound V3",
    markets: [{ base: "USDC", comet: "0xF25212E676D1F7F89B72d29e2d064a4479a880b3" }],
  },
};

const ASSET_SYMBOL = {
  "0x4200000000000000000000000000000000000006": "WETH",
  "0x68f180fcce6836688e9084f035309e29bf0a2095": "WBTC",
  "0x1f32b1c2345538c0c6f582fcb022739c4a194ebb": "wstETH",
  "0xaf88d065e77c8cc2239328c0dfb60a416255c15": "USDC",
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "USDC",
};

function decodeUint(hex) {
  if (!hex || hex === "0x") return 0n;
  return BigInt(hex);
}

function parseAssetInfo(raw) {
  const h = String(raw || "").slice(2);
  if (h.length < 192) return null;
  const base = 64;
  const asset = `0x${h.slice(base + 24, base + 64)}`;
  const scale = Number(BigInt(`0x${h.slice(base + 128, base + 192)}`));
  if (!scale || scale > 1e30) return null;
  return { asset, scale };
}

function guessSymbol(asset, scale) {
  const key = asset.toLowerCase();
  if (ASSET_SYMBOL[key]) return ASSET_SYMBOL[key];
  if (scale === 1e8) return "WBTC";
  if (scale === 1e6) return "USDC";
  return "WETH";
}

async function readUserCollateral(rpc, comet, wallet, asset) {
  const raw = await rpc.ethCall(comet, SEL_COLLATERAL + padAddr(wallet) + padAddr(asset));
  if (!raw || raw.length < 66) return 0n;
  return BigInt(`0x${raw.slice(2, 66)}`);
}

async function readCometMarket(rpc, market, wallet, prices) {
  const { comet, base } = market;
  const baseDec = base === "USDC" || base === "USDT" ? 6 : 18;

  let borRaw = 0n;
  try {
    borRaw = decodeUint(await rpc.ethCall(comet, SEL_BORROW + padAddr(wallet)));
  } catch {
    /* */
  }

  const supplied = [];
  const borrowed = [];
  let collateralUsd = 0;

  let n = 0;
  try {
    n = Number(decodeUint(await rpc.ethCall(comet, SEL_NUM_ASSETS)));
  } catch {
    n = 0;
  }

  for (let i = 0; i < n; i++) {
    let info;
    try {
      const raw = await rpc.ethCall(comet, SEL_GET_ASSET + i.toString(16).padStart(64, "0"));
      info = parseAssetInfo(raw);
    } catch {
      continue;
    }
    if (!info) continue;

    let bal = 0n;
    try {
      bal = await readUserCollateral(rpc, comet, wallet, info.asset);
    } catch {
      continue;
    }
    if (bal === 0n) continue;

    const amount = Number(bal) / info.scale;
    if (amount < 1e-12) continue;
    const sym = guessSymbol(info.asset, info.scale);
    const usd = usdValue(amount, sym, prices);
    if (usd < 0.01) continue;
    supplied.push({
      asset: sym,
      amount: amount.toFixed(amount < 1 ? 6 : 4),
      usd: Math.round(usd * 100) / 100,
    });
    collateralUsd += usd;
  }

  const borBase = Number(borRaw) / 10 ** baseDec;
  if (borBase > 1e-9) {
    const u = usdValue(borBase, base, prices);
    if (u > 0.01) {
      borrowed.push({
        asset: base,
        amount: borBase.toFixed(4),
        usd: Math.round(u * 100) / 100,
      });
    }
  }

  const debtUsd = borrowed.reduce((s, b) => s + (b.usd || 0), 0);
  if (collateralUsd < 0.01 && debtUsd < 0.01) return null;

  return {
    supplied,
    borrowed,
    collateralUsd: Math.round(collateralUsd * 100) / 100,
    debtUsd: Math.round(debtUsd * 100) / 100,
    netUsd: Math.round((collateralUsd - debtUsd) * 100) / 100,
  };
}

export async function scanCompoundV3(wallet, chains) {
  const w = wallet.toLowerCase();
  const lending = [];
  const symbols = new Set(["USDC", "USDT", "WETH", "ETH", "WBTC", "wstETH", "WSTETH"]);
  const prices = await fetchPricesUsd([...symbols]);

  for (const chain of chains) {
    const cfg = COMPOUND_V3_MARKETS[chain];
    if (!cfg) continue;
    const rpc = rpcForChain(chain);
    for (const m of cfg.markets) {
      try {
        const pos = await readCometMarket(rpc, m, w, prices);
        if (!pos || Math.abs(pos.netUsd) < 0.01) continue;
        lending.push({
          protocol: cfg.protocol,
          chain,
          ...pos,
          onchain: true,
          source: "compound-v3",
          poolId: `${m.base} · Comet`,
        });
      } catch {
        /* */
      }
    }
  }
  return lending;
}
