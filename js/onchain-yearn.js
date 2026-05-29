/**
 * Yearn V3: список вольтов с ydaemon (только адреса), балансы — on-chain balanceOf.
 */
import { rpcForChain, padAddr, encodeUint256 } from "./onchain-rpc.js";
import { SEL } from "./onchain-selectors.js";
import { fetchPricesUsd, usdValue } from "./onchain-prices.js";
import { normToken } from "./revert-parse.js";

const YDAEMON = {
  eth: "https://ydaemon.yearn.finance/v1/chains/1/vaults/all?limit=500&hideAlways=true",
  base: "https://ydaemon.yearn.finance/v1/chains/8453/vaults/all?limit=200&hideAlways=true",
};

async function erc20Balance(rpc, token, wallet) {
  const raw = await rpc.ethCall(token, SEL.balanceOf + padAddr(wallet));
  return BigInt(raw || 0);
}

async function readMeta(rpc, token) {
  let decimals = 18;
  let symbol = "LP";
  try {
    decimals = parseInt(await rpc.ethCall(token, SEL.decimals), 16) || 18;
    const symHex = await rpc.ethCall(token, SEL.symbol);
    if (symHex?.length > 130) {
      const len = parseInt(symHex.slice(66, 130), 16);
      symbol = normToken(
        Buffer.from(symHex.slice(130, 130 + len * 2), "hex")
          .toString("utf8")
          .replace(/\0/g, ""),
      );
    }
  } catch {
    /* */
  }
  return { decimals, symbol };
}

export async function scanYearnVaults(wallet, chains = ["eth", "base"]) {
  const w = wallet.toLowerCase();
  const liquidity = [];
  const chainSet = new Set(chains);

  for (const [chain, url] of Object.entries(YDAEMON)) {
    if (!chainSet.has(chain)) continue;
    let vaults;
    try {
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      vaults = await r.json();
    } catch {
      continue;
    }
    const rpc = rpcForChain(chain);
    const symbols = new Set();

    for (const v of vaults || []) {
      const addr = (v.address || v.token?.address || "").toLowerCase();
      if (!/^0x[a-f0-9]{40}$/.test(addr)) continue;
      let shares;
      try {
        shares = await erc20Balance(rpc, addr, w);
      } catch {
        continue;
      }
      if (shares === 0n) continue;

      const meta = await readMeta(rpc, addr);
      let assets = shares;
      try {
        const pps = await rpc.ethCall(addr, SEL.convertToAssets + encodeUint256(shares));
        assets = BigInt(pps || 0);
      } catch {
        /* legacy yVault */
      }
      const amount = Number(assets) / 10 ** meta.decimals;
      const sym = normToken(v.token?.symbol || v.symbol || meta.symbol);
      symbols.add(sym);

      liquidity.push({
        protocol: "Yearn V3",
        chain,
        poolId: v.name || addr,
        pair: sym,
        kind: "Yield",
        inPool: [{ amount: amount.toFixed(4), symbol: sym }],
        positionUsd: 0,
        claimable: [],
        claimableUsd: 0,
        netUsd: 0,
        source: "onchain",
        onchain: true,
        _sym: sym,
        _amt: amount,
      });
    }

    const prices = await fetchPricesUsd([...symbols]);
    for (const p of liquidity.filter((x) => x.chain === chain)) {
      p.positionUsd = usdValue(p._amt, p._sym, prices);
      p.netUsd = p.positionUsd;
      delete p._sym;
      delete p._amt;
    }
  }

  return liquidity.filter((p) => p.positionUsd >= 0.02);
}
