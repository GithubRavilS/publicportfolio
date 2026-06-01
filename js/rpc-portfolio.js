/**
 * Портфель только через RPC (без DeBank scrape, без Etherscan в wallet при rpcOnly).
 * Прод: кэш на сервере; Pancake/Uniswap LP через eth_call + getLogs.
 */
import { scanWalletBalances } from "./onchain-wallet.js";
import { scanLpPositions } from "./onchain-lp.js";
import { finalizeOnchainPortfolio, ONCHAIN_PORTFOLIO_SCHEMA } from "./portfolio-onchain-finalize.js";
import {
  buildProtocolGroups,
  buildChains,
  buildProtocolTabs,
} from "./onchain-portfolio.js";

function mergeWalletTokens(base, extra) {
  const map = new Map();
  for (const t of base) {
    map.set(`${t.chain}|${(t.address || t.symbol || "").toLowerCase()}`, t);
  }
  for (const t of extra) {
    const k = `${t.chain}|${(t.address || t.symbol || "").toLowerCase()}`;
    if (!map.has(k)) map.set(k, t);
  }
  return [...map.values()];
}

/**
 * @param {string} wallet
 * @param {{ chains?: string[], lpChains?: string[], rpcOnlyWallet?: boolean, fastLp?: boolean, pancakeOnly?: boolean, lpOnly?: boolean }} [opts]
 */
export async function buildRpcPortfolio(wallet, opts = {}) {
  const t0 = Date.now();
  const w = wallet.toLowerCase();
  const pancakeOnly =
    opts.pancakeOnly === true || process.env.PT_PANCAKE_ONLY === "1";
  const lpOnly = opts.lpOnly === true || process.env.PT_RPC_LP_ONLY === "1";
  const lpChains = (
    opts.lpChains ||
    (pancakeOnly ? ["base"] : null) ||
    (process.env.PT_RPC_LP_CHAINS || process.env.PT_LP_CHAINS || "base,arb,op,eth,bsc,matic")
  )
    .toString()
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const walletChains = opts.chains || lpChains;
  const fastLp = opts.fastLp !== false;
  const rpcOnlyWallet = opts.rpcOnlyWallet !== false;

  const liquidity = await scanLpPositions(w, lpChains, {
    fast: fastLp,
    pancakeOnly,
  });
  const walletRes = lpOnly
    ? { walletTokens: [], walletByChain: {} }
    : await scanWalletBalances(w, walletChains, { rpcOnly: rpcOnlyWallet });
  for (const p of liquidity) {
    if (p.tokenId && !p.onchainTokenId) p.onchainTokenId = String(p.tokenId);
  }

  const walletTokens = walletRes.walletTokens || [];
  const protocolGroups = buildProtocolGroups([], liquidity, walletTokens);
  const chains = buildChains(protocolGroups, walletTokens);
  const protocolTabs = buildProtocolTabs(protocolGroups);

  const walletUsd = walletTokens.reduce((s, t) => s + (t.usd || 0), 0);
  const liqUsd = liquidity.reduce((s, p) => s + (p.positionUsd || 0), 0);
  const totalUsd = walletUsd + liqUsd;

  let portfolio = {
    totalUsd: Math.round(totalUsd * 100) / 100,
    walletUsd: Math.round(walletUsd * 100) / 100,
    liqUsd: Math.round(liqUsd * 100) / 100,
    lendUsd: 0,
    chains,
    protocolTabs,
    protocolGroups,
    walletTokens,
    walletByChain: walletRes.walletByChain || {},
    lending: [],
    liquidity,
    source: "rpc",
    partial: lpOnly,
    onchain: true,
    rpcOnly: true,
    scanMs: 0,
    scannedChains: lpChains,
    schemaVersion: ONCHAIN_PORTFOLIO_SCHEMA,
  };

  portfolio = await finalizeOnchainPortfolio(portfolio, w);
  portfolio.source = "rpc";
  portfolio.scanMs = Date.now() - t0;
  return portfolio;
}
