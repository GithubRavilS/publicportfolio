import { CHAINS, CHAIN_IDS, NATIVE_SYMBOL, SCAN_CHAINS } from "./onchain-registry.js";
import { rpcForChain, etherscanKey } from "./onchain-rpc.js";
import { fetchPricesUsd, usdValue } from "./onchain-prices.js";
import { fetchExplorerWalletTokens } from "./explorer-scrape.js";

const SEL = {
  balanceOf: "0x70a08231",
  decimals: "0x313ce567",
  symbol: "0x95d89b41",
};

function padAddr(addr) {
  return addr.slice(2).toLowerCase().padStart(64, "0");
}

async function etherscanTokenBalances(chain, wallet) {
  const key = etherscanKey(chain) || etherscanKey("default");
  const chainId = CHAIN_IDS[chain];
  if (!key || !chainId) return [];

  const url = new URL("https://api.etherscan.io/v2/api");
  url.searchParams.set("chainid", String(chainId));
  url.searchParams.set("module", "account");
  url.searchParams.set("action", "addresstokenbalance");
  url.searchParams.set("address", wallet);
  url.searchParams.set("page", "1");
  url.searchParams.set("offset", "100");
  url.searchParams.set("apikey", key);

  try {
    const r = await fetch(url.toString());
    const j = await r.json();
    if (j.status !== "1" || !Array.isArray(j.result)) return [];
    return j.result
      .map((row) => ({
        address: String(row.TokenAddress || "").toLowerCase(),
        symbol: String(row.TokenSymbol || "").toUpperCase(),
        amount: Number(row.TokenQuantity || 0) / 10 ** Number(row.TokenDivisor || 18),
        chain,
      }))
      .filter((t) => t.amount > 1e-12);
  } catch {
    return [];
  }
}

async function readErc20Meta(rpc, address) {
  const dec = parseInt(await rpc.ethCall(address, SEL.decimals), 16) || 18;
  let symbol = "???";
  try {
    const symHex = await rpc.ethCall(address, SEL.symbol);
    if (symHex?.length > 130) {
      const len = parseInt(symHex.slice(66, 130), 16);
      symbol = Buffer.from(symHex.slice(130, 130 + len * 2), "hex")
        .toString("utf8")
        .replace(/\0/g, "")
        .toUpperCase();
    }
  } catch {
    /* */
  }
  return { address, decimals: dec, symbol };
}

export async function scanWalletBalances(wallet, chains = SCAN_CHAINS) {
  const w = wallet.toLowerCase();
  const tokens = [];
  const symbols = new Set();

  for (const chain of chains) {
    if (!CHAINS[chain]?.scan) continue;
    const rpc = rpcForChain(chain);
    const nativeSym = NATIVE_SYMBOL[chain] || "ETH";
    symbols.add(nativeSym);

    try {
      const wei = await rpc.nativeBalance(w);
      const amount = Number(wei) / 1e18;
      if (amount > 1e-9) {
        tokens.push({
          symbol: nativeSym,
          amount,
          chain,
          address: "native",
        });
      }
    } catch {
      /* */
    }

    let fromApi = await etherscanTokenBalances(chain, w);
    if (!fromApi.length) {
      fromApi = await fetchExplorerWalletTokens(chain, w);
    }
    for (const t of fromApi) {
      if (t.amount > 1e9) continue;
      symbols.add(t.symbol);
      tokens.push(t);
    }
  }

  const prices = await fetchPricesUsd([...symbols]);
  const walletTokens = tokens
    .map((t) => {
      const usd = usdValue(t.amount, t.symbol, prices);
      return {
        symbol: t.symbol,
        price: prices[t.symbol] != null ? `$${prices[t.symbol]}` : "—",
        amount: t.amount.toFixed(t.amount < 1 ? 6 : 4),
        usd,
        chain: t.chain,
      };
    })
    .filter((t) => (t.usd || 0) < 500_000);

  const walletByChain = {};
  for (const t of walletTokens) {
    if (!walletByChain[t.chain]) walletByChain[t.chain] = [];
    walletByChain[t.chain].push(t);
  }

  return { walletTokens, walletByChain };
}
