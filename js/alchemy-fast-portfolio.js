/**
 * Быстрый слой: Alchemy Portfolio API (токены + NFT в кошельке) + eth_call только по найденным NFT.
 */
import { CHAINS, PANCAKE_V3_NFPM, UNI_V3_NFPM } from "./onchain-registry.js";
import {
  alchemyEnabled,
  fetchAlchemyNfts,
  fetchAlchemyTokens,
  networkToChainSlug,
} from "./alchemy-api.js";
import {
  readPosition,
  readTokenMeta,
  displayRangeFromTicks,
  readNfpmOwner,
  isLpOwnerForWallet,
} from "./onchain-lp.js";
import { amountsForLiquidity, formatAmount } from "./onchain-v3-math.js";
import { normPair } from "./revert-parse.js";
import { fetchPricesUsd, usdValue } from "./onchain-prices.js";
import {
  buildProtocolGroups,
  buildChains,
  buildProtocolTabs,
} from "./onchain-portfolio.js";
import { ONCHAIN_PORTFOLIO_SCHEMA } from "./portfolio-onchain-finalize.js";

/** @type {Map<string, { protocol: string, chain: string, address: string, factory?: string, feeDiv?: number }>} */
function buildNfpmIndex() {
  const idx = new Map();
  for (const [chain, cfg] of Object.entries(CHAINS)) {
    for (const nf of cfg?.nfpm || []) {
      idx.set(`${chain}|${nf.address.toLowerCase()}`, nf);
    }
  }
  for (const [chain, addr] of Object.entries(PANCAKE_V3_NFPM)) {
    const a = addr.toLowerCase();
    if (!idx.has(`${chain}|${a}`)) {
      idx.set(`${chain}|${a}`, {
        protocol: "PancakeSwap V3",
        chain,
        address: a,
        factory: CHAINS[chain]?.nfpm?.find((n) => n.protocol?.includes("Pancake"))?.factory,
        feeDiv: 10000,
      });
    }
  }
  for (const [chain, addr] of Object.entries(UNI_V3_NFPM)) {
    const a = addr.toLowerCase();
    if (!idx.has(`${chain}|${a}`)) {
      idx.set(`${chain}|${a}`, {
        protocol: "Uniswap V3",
        chain,
        address: a,
        factory: CHAINS[chain]?.nfpm?.find((n) => n.protocol?.includes("Uniswap"))?.factory,
        feeDiv: 10000,
      });
    }
  }
  return idx;
}

const NFPM_INDEX = buildNfpmIndex();

function tokenRowToWallet(t) {
  const chain = networkToChainSlug(t.network);
  const addr = (t.tokenAddress || t.contractAddress || "").toLowerCase();
  const isNative = !addr || addr === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  const decimals = Number(t.decimals ?? t.tokenDecimals ?? 18);
  const rawBal = t.tokenBalance ?? t.balance ?? t.rawBalance ?? "0";
  let amount = 0;
  try {
    if (typeof rawBal === "string" && rawBal.startsWith("0x")) {
      amount = Number(BigInt(rawBal)) / 10 ** decimals;
    } else {
      amount = Number(rawBal) / 10 ** decimals;
    }
  } catch {
    amount = Number(t.balance ?? 0);
  }
  const symbol =
    t.symbol ||
    t.tokenMetadata?.symbol ||
    (isNative ? "ETH" : addr.slice(2, 6).toUpperCase());
  const priceUsd = Number(t.price ?? t.tokenPrices?.[0]?.value ?? 0);
  const usd =
    priceUsd > 0
      ? amount * priceUsd
      : Number(t.usdValue ?? t.value ?? 0);
  return {
    symbol,
    amount: amount.toFixed(amount < 1 ? 6 : 4),
    usd: Math.round((usd || 0) * 100) / 100,
    chain,
    address: isNative ? "native" : addr,
    source: "alchemy",
    onchain: true,
  };
}

function nftContract(nft) {
  return (
    nft.contract?.address ||
    nft.contractAddress ||
    nft.contract?.contractAddress ||
    ""
  ).toLowerCase();
}

function nftTokenId(nft) {
  const raw = nft.tokenId || nft.id?.tokenId;
  if (raw == null) return null;
  try {
    if (typeof raw === "string" && raw.startsWith("0x")) return BigInt(raw).toString();
    return BigInt(raw).toString();
  } catch {
    return String(raw).replace(/\D/g, "") || null;
  }
}

async function nftToLiquidity(wallet, nft, chain, nf, symbols) {
  const tokenIdStr = nftTokenId(nft);
  if (!tokenIdStr) return null;
  const tokenId = BigInt(tokenIdStr);
  const owner = await readNfpmOwner(chain, nf.address, tokenId);
  if (!isLpOwnerForWallet(owner, wallet, chain)) return null;

  let pos;
  try {
    pos = await readPosition(chain, nf.address, tokenId);
  } catch {
    return null;
  }
  if (!pos || pos.liquidity === 0n) return null;

  const t0 = await readTokenMeta(chain, pos.token0);
  const t1 = await readTokenMeta(chain, pos.token1);
  symbols.add(t0.symbol);
  symbols.add(t1.symbol);
  const pairKey = normPair(`${t0.symbol}+${t1.symbol}`);
  const tickCurrent = Math.round((pos.tickLower + pos.tickUpper) / 2);
  const range = displayRangeFromTicks(
    pos.tickLower,
    pos.tickUpper,
    tickCurrent,
    t0.decimals,
    t1.decimals,
    pairKey,
  );
  const { amount0, amount1 } = amountsForLiquidity(
    pos.liquidity,
    pos.tickLower,
    pos.tickUpper,
    tickCurrent,
  );
  const amt0 = formatAmount(amount0, t0.decimals);
  const amt1 = formatAmount(amount1, t1.decimals);
  const feeTierPct = pos.fee / (nf.feeDiv || 10000);

  return {
    protocol: nf.protocol,
    chain,
    poolId: tokenIdStr,
    tokenId: tokenIdStr,
    onchainTokenId: tokenIdStr,
    pair: pairKey.replace("+", "+"),
    pairKey,
    feeTier: `${feeTierPct.toFixed(2)}%`,
    feeTierPct,
    kind: "Liquidity Pool",
    staked: false,
    inPool: [
      { amount: amt0.toFixed(6), symbol: t0.symbol },
      { amount: amt1.toFixed(8), symbol: t1.symbol },
    ],
    positionUsd: 0,
    claimable: [],
    source: "alchemy-nft",
    onchain: true,
    enrichmentPending: true,
    _amt0: amt0,
    _amt1: amt1,
    _sym0: t0.symbol,
    _sym1: t1.symbol,
    ...range,
  };
}

/**
 * @param {string} wallet
 * @param {{ chains?: string[] }} [opts]
 */
export async function buildAlchemyFastPortfolio(wallet, opts = {}) {
  const t0 = Date.now();
  const w = wallet.toLowerCase();
  const chains = (
    opts.chains ||
    (process.env.PT_ALCHEMY_CHAINS || "base,eth,arb,op,matic")
  )
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  if (!alchemyEnabled()) {
    return {
      totalUsd: 0,
      walletUsd: 0,
      liqUsd: 0,
      lendUsd: 0,
      chains: [],
      protocolTabs: [],
      protocolGroups: [],
      walletTokens: [],
      liquidity: [],
      lending: [],
      source: "alchemy",
      partial: true,
      enrichmentPending: true,
      alchemyError: "ALCHEMY_API_KEY_MISSING",
      scanMs: Date.now() - t0,
      schemaVersion: ONCHAIN_PORTFOLIO_SCHEMA,
    };
  }

  const [tokenRows, nftRows] = await Promise.all([
    fetchAlchemyTokens(w, chains),
    fetchAlchemyNfts(w, chains),
  ]);

  const symbols = new Set();
  const walletTokens = tokenRows
    .map(tokenRowToWallet)
    .filter((t) => (t.usd || 0) > 0.01 || t.chain);

  for (const t of walletTokens) symbols.add(t.symbol);

  const liquidity = [];
  const lpNfts = nftRows.slice(0, 40);
  for (const nft of lpNfts) {
    const chain = networkToChainSlug(nft.network);
    const contract = nftContract(nft);
    const nf = NFPM_INDEX.get(`${chain}|${contract}`);
    if (!nf) continue;
    const row = await nftToLiquidity(w, nft, chain, nf, symbols);
    if (row) liquidity.push(row);
  }

  const prices = await fetchPricesUsd([...symbols]);
  for (const p of liquidity) {
    p.positionUsd =
      usdValue(p._amt0, p._sym0, prices) + usdValue(p._amt1, p._sym1, prices);
    p.netUsd = p.positionUsd;
    delete p._amt0;
    delete p._amt1;
    delete p._sym0;
    delete p._sym1;
  }

  const protocolGroups = buildProtocolGroups([], liquidity, walletTokens);
  const chainsBreakdown = buildChains(protocolGroups, walletTokens);
  const protocolTabs = buildProtocolTabs(protocolGroups);

  const walletUsd = walletTokens.reduce((s, t) => s + (t.usd || 0), 0);
  const liqUsd = liquidity.reduce((s, p) => s + (p.positionUsd || 0), 0);

  return {
    totalUsd: Math.round((walletUsd + liqUsd) * 100) / 100,
    walletUsd: Math.round(walletUsd * 100) / 100,
    liqUsd: Math.round(liqUsd * 100) / 100,
    lendUsd: 0,
    chains: chainsBreakdown,
    protocolTabs,
    protocolGroups,
    walletTokens,
    liquidity,
    lending: [],
    source: "hybrid",
    phase: "fast",
    partial: true,
    enrichmentPending: true,
    alchemy: true,
    onchain: true,
    scanMs: Date.now() - t0,
    scannedChains: chains,
    schemaVersion: ONCHAIN_PORTFOLIO_SCHEMA,
  };
}
