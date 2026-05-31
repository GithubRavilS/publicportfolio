import { CHAINS, NATIVE_SYMBOL, SCAN_CHAINS } from "./onchain-registry.js";
import { rpcForChain } from "./onchain-rpc.js";
import { fetchPricesUsd, usdValue } from "./onchain-prices.js";
import { fetchExplorerWalletTokens } from "./explorer-scrape.js";
import {
  chainSupported,
  etherscanEnabled,
  fetchWalletTokensEtherscan,
  ETHERSCAN_FREE_CHAINS,
} from "./etherscan-api.js";

async function rpcNativeOnly(chain, wallet) {
  const out = [];
  if (!CHAINS[chain]?.scan) return out;
  const rpc = rpcForChain(chain);
  const nativeSym = NATIVE_SYMBOL[chain] || "ETH";
  try {
    const wei = await rpc.nativeBalance(wallet);
    const amount = Number(wei) / 1e18;
    if (amount > 1e-9) {
      out.push({ symbol: nativeSym, amount, chain, address: "native", source: "rpc" });
    }
  } catch {
    /* */
  }
  return out;
}

async function scanWalletOnChain(chain, wallet) {
  const w = wallet.toLowerCase();

  if (etherscanEnabled() && chainSupported(chain)) {
    try {
      return await fetchWalletTokensEtherscan(chain, w);
    } catch (e) {
      if (String(e.message || e).includes("ETHERSCAN_DAILY_LIMIT")) throw e;
    }
  }

  let out = await rpcNativeOnly(chain, w);
  if (!out.length) {
    try {
      out = await fetchExplorerWalletTokens(chain, w);
    } catch {
      /* */
    }
  }
  return out;
}

export async function scanWalletBalances(wallet, chains = SCAN_CHAINS) {
  const w = wallet.toLowerCase();
  const symbols = new Set();

  // Etherscan: последовательно (глобальная очередь 3 rps), остальные сети — параллельно RPC/Jina
  const esChains = chains.filter((c) => etherscanEnabled() && ETHERSCAN_FREE_CHAINS.has(c));
  const otherChains = chains.filter((c) => !esChains.includes(c));

  const esResults = [];
  for (const chain of esChains) {
    esResults.push(await scanWalletOnChain(chain, w));
  }
  const otherResults = await Promise.all(otherChains.map((chain) => scanWalletOnChain(chain, w)));

  const tokens = [...esResults, ...otherResults].flat();
  for (const t of tokens) symbols.add(t.symbol);

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
        address: t.address,
        source: t.source || "onchain",
      };
    })
    .filter((t) => {
      const usd = t.usd || 0;
      if (usd >= 500_000) return false;
      if (usd > 8_000 && (t.source === "rpc" || t.source === "explorer")) return false;
      return true;
    });

  const walletByChain = {};
  for (const t of walletTokens) {
    if (!walletByChain[t.chain]) walletByChain[t.chain] = [];
    walletByChain[t.chain].push(t);
  }

  return { walletTokens, walletByChain };
}
