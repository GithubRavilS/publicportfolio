import { normPair, normToken } from "./revert-parse.js";
import { rpcForChain, padAddr } from "./onchain-rpc.js";
import { fetchPricesUsd, usdValue } from "./onchain-prices.js";

const SEL_BALANCE = "0x70a08231";
const SEL_DECIMALS = "0x313ce567";
const SEL_PRICE_PER_SHARE = "0x99530b06";
const SEL_TOTAL_SUPPLY = "0x18160ddd";

const CHAIN_MAP = {
  ethereum: "eth",
  base: "base",
  arbitrum: "arb",
  optimism: "op",
  polygon: "matic",
  bsc: "bsc",
  avax: "avax",
};

let vaultCache = null;
let vaultCacheAt = 0;

async function loadBeefyVaults() {
  if (vaultCache && Date.now() - vaultCacheAt < 600_000) return vaultCache;
  const r = await fetch("https://api.beefy.finance/vaults", {
    headers: { Accept: "application/json" },
  });
  const list = await r.json();
  vaultCache = list.filter((v) => v.status === "active" && !v.retired);
  vaultCacheAt = Date.now();
  return vaultCache;
}

async function erc4626BalanceUsd(rpc, vaultAddr, wallet, tokenSym, prices) {
  const balRaw = await rpc.ethCall(vaultAddr, SEL_BALANCE + padAddr(wallet));
  const shares = BigInt(balRaw || 0);
  if (shares === 0n) return null;

  let assets = shares;
  try {
    const pps = await rpc.ethCall(vaultAddr, SEL_PRICE_PER_SHARE);
    const dec = parseInt(await rpc.ethCall(vaultAddr, SEL_DECIMALS), 16) || 18;
    assets = (shares * BigInt(pps || 0)) / 10n ** BigInt(dec);
  } catch {
    /* not erc4626 */
  }

  const amount = Number(assets) / 1e18;
  const usd = usdValue(amount, tokenSym, prices);
  return { amount, usd };
}

export async function scanVaultPositions(wallet, chains) {
  const w = wallet.toLowerCase();
  const chainSet = new Set(chains);
  const liquidity = [];
  let vaults;
  try {
    vaults = await loadBeefyVaults();
  } catch {
    return liquidity;
  }

  const symbols = new Set();
  for (const v of vaults) {
    const ch = CHAIN_MAP[v.chain] || v.chain;
    if (!chainSet.has(ch)) continue;
    symbols.add(normToken(v.assets?.[0] || v.token || "USDC"));
  }
  const prices = await fetchPricesUsd([...symbols]);

  for (const v of vaults) {
    const ch = CHAIN_MAP[v.chain] || v.chain;
    if (!chainSet.has(ch)) continue;
    const earn = v.earnContractAddress || v.earnedTokenAddress;
    if (!earn || !/^0x[a-fA-F0-9]{40}$/.test(earn)) continue;

    const rpc = rpcForChain(ch);
    const sym = normToken(v.assets?.[0] || v.token || "USDC");
    let bal;
    try {
      bal = await erc4626BalanceUsd(rpc, earn, w, sym, prices);
    } catch {
      continue;
    }
    if (!bal || bal.usd < 0.02) continue;

    const pair =
      v.assets?.length >= 2
        ? normPair(`${v.assets[0]}+${v.assets[1]}`)
        : normToken(v.assets?.[0] || sym);

    liquidity.push({
      protocol: "Beefy",
      chain: ch,
      poolId: v.id || earn,
      pair,
      kind: "Yield",
      inPool: [{ amount: bal.amount.toFixed(6), symbol: sym }],
      positionUsd: bal.usd,
      claimable: [],
      claimableUsd: 0,
      netUsd: bal.usd,
      source: "onchain",
      onchain: true,
    });
  }

  return liquidity;
}
