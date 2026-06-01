import { CHAINS, NATIVE_SYMBOL, SCAN_CHAINS } from "./onchain-registry.js";
import { rpcForChain } from "./onchain-rpc.js";
import { fetchPricesUsd, usdValue } from "./onchain-prices.js";
import { fetchExplorerWalletTokens } from "./explorer-scrape.js";
import { multicallBalances } from "./onchain-multicall.js";
import { CORE_ERC20 } from "./onchain-core-tokens.js";
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

async function rpcCoreErc20(chain, wallet) {
  const list = CORE_ERC20[chain];
  if (!list?.length || !CHAINS[chain]?.scan) return [];
  const addrs = list.map((t) => t.address);
  const bals = await multicallBalances(chain, wallet, addrs);
  const out = [];
  for (const t of list) {
    const raw = bals.get(t.address.toLowerCase());
    if (!raw || raw === 0n) continue;
    const amount = Number(raw) / 10 ** t.decimals;
    if (amount < 1e-12 || amount > 1e12) continue;
    out.push({
      address: t.address.toLowerCase(),
      symbol: t.symbol,
      amount,
      chain,
      source: "rpc-multicall",
    });
  }
  return out;
}

function mergeTokenRows(a, b) {
  const map = new Map();
  for (const t of [...a, ...b]) {
    const k = `${t.chain}|${(t.address || t.symbol || "").toLowerCase()}`;
    const prev = map.get(k);
    if (!prev || t.amount > prev.amount) map.set(k, t);
  }
  return [...map.values()];
}

async function verifyTokenRows(chain, wallet, rows) {
  const w = wallet.toLowerCase();
  const erc20 = rows.filter((t) => t.address && t.address !== "native");
  const natives = rows.filter((t) => t.address === "native");
  if (!erc20.length) return natives;

  const meta = new Map();
  for (const t of erc20) {
    meta.set(t.address.toLowerCase(), t);
  }
  const bals = await multicallBalances(chain, w, [...meta.keys()]);
  const out = [...natives];
  for (const [addr, raw] of bals) {
    if (!raw || raw === 0n) continue;
    const t = meta.get(addr);
    const dec = t?.decimals ?? 18;
    const amount = Number(raw) / 10 ** dec;
    if (amount < 1e-12 || amount > 1e12) continue;
    out.push({ ...t, amount, chain, source: t.source || "rpc-verify" });
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

  let out = mergeTokenRows(await rpcNativeOnly(chain, w), await rpcCoreErc20(chain, w));
  if (!out.length) {
    try {
      const scraped = await fetchExplorerWalletTokens(chain, w);
      out = await verifyTokenRows(chain, w, scraped);
    } catch {
      /* */
    }
  }
  return out;
}

async function supplementEtherscanWithRpc(chain, wallet, rows) {
  const rpcRows = mergeTokenRows(
    await rpcNativeOnly(chain, wallet),
    await rpcCoreErc20(chain, wallet),
  );
  return mergeTokenRows(rows, rpcRows);
}

export async function scanWalletBalances(wallet, chains = SCAN_CHAINS, opts = {}) {
  const w = wallet.toLowerCase();
  const symbols = new Set();
  const rpcOnly = opts.rpcOnly === true || process.env.PT_RPC_ONLY_WALLET === "1";

  // Etherscan: последовательно (глобальная очередь 3 rps), остальные сети — параллельно RPC/Jina
  const esChains = rpcOnly
    ? []
    : chains.filter((c) => etherscanEnabled() && ETHERSCAN_FREE_CHAINS.has(c));
  const otherChains = chains.filter((c) => !esChains.includes(c));

  const esResults = [];
  for (const chain of esChains) {
    let rows = await scanWalletOnChain(chain, w);
    rows = await supplementEtherscanWithRpc(chain, w, rows);
    esResults.push(rows);
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
