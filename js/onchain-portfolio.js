/**
 * Полный ончейн-портфель: кошелёк + LP + лендинг + Beefy-вольты.
 * Формат совместим с DeBank parse (protocolGroups, liquidity, lending, walletTokens).
 */
import { SCAN_CHAINS, TOP20_CHAINS } from "./onchain-registry.js";
import { ETHERSCAN_FREE_CHAINS } from "./etherscan-api.js";
import { scanWalletBalances } from "./onchain-wallet.js";
import { scanLpPositions } from "./onchain-lp.js";
import { scanAaveLending } from "./onchain-lending.js";
import { scanVaultPositions } from "./onchain-vaults.js";
import { scanFluidLending } from "./onchain-fluid.js";
import { scanYearnVaults } from "./onchain-yearn.js";
import { scanGmxPositions } from "./onchain-gmx.js";
import { scanMorphoPositions } from "./onchain-morpho.js";
import { scanCompoundV3 } from "./onchain-compound.js";
import { scanLlamaYieldTokens, loadYieldIndex } from "./onchain-llama-scan.js";
import { etherscanEnabled, getEtherscanUsageStats } from "./etherscan-api.js";
import { formatPairDisplay } from "./revert-parse.js";

function mergeWalletTokens(base, extra) {
  const map = new Map();
  for (const t of base) {
    map.set(`${t.chain}|${(t.address || t.symbol || "").toLowerCase()}`, t);
  }
  for (const t of extra) {
    const k = `${t.chain}|${(t.address || t.symbol || "").toLowerCase()}`;
    const prev = map.get(k);
    if (!prev || (t.usd || 0) > (prev.usd || 0)) map.set(k, t);
  }
  return [...map.values()];
}

function mergePositions(base, extra, keyFn) {
  const map = new Map();
  for (const p of base) map.set(keyFn(p), p);
  for (const p of extra) {
    const k = keyFn(p);
    if (!map.has(k) || p.onchain) map.set(k, p);
  }
  return [...map.values()];
}

function buildProtocolGroups(lending, liquidity, walletTokens) {
  const map = new Map();
  const ensure = (protocol, chain) => {
    const k = `${protocol}\0${chain || "unknown"}`;
    if (!map.has(k)) {
      map.set(k, {
        protocol,
        chain: chain || "unknown",
        protocolUsd: 0,
        kinds: [],
        lending: [],
        liquidity: [],
        walletTokens: [],
      });
    }
    return map.get(k);
  };
  const addKind = (g, kind) => {
    if (!g.kinds.includes(kind)) g.kinds.push(kind);
  };

  for (const p of lending) {
    const ch = String(p.protocol || "")
      .toLowerCase()
      .includes("hyperliquid")
      ? "hyperliquid"
      : p.chain;
    const g = ensure(p.protocol, ch);
    g.lending.push(p);
    addKind(g, "Lending");
  }
  for (const p of liquidity) {
    const ch = String(p.protocol || "")
      .toLowerCase()
      .includes("hyperliquid")
      ? "hyperliquid"
      : p.chain;
    const g = ensure(p.protocol, ch);
    g.liquidity.push({
      ...p,
      pair: formatPairDisplay(p.pair || p.pairKey || p.poolId),
    });
    addKind(g, p.kind || "Liquidity Pool");
  }

  const walletUsd = (walletTokens || []).reduce((s, t) => s + (t.usd || 0), 0);
  if (walletTokens?.length) {
    const g = ensure("Wallet", "all");
    g.walletTokens = walletTokens;
    addKind(g, "Wallet");
  }

  for (const g of map.values()) {
    const lendU = g.lending.reduce((s, p) => s + Math.max(p.netUsd || 0, 0), 0);
    const liqU = g.liquidity.reduce((s, p) => s + (p.positionUsd || 0), 0);
    if (g.protocol === "Wallet") g.protocolUsd = walletUsd;
    else g.protocolUsd = lendU + liqU;
  }

  return [...map.values()]
    .map((g) => ({
      ...g,
      id: `${g.protocol}|${g.chain}`,
      protocolUsd: Math.round((g.protocolUsd || 0) * 100) / 100,
    }))
    .filter(
      (g) =>
        g.protocolUsd > 0.005 || g.walletTokens?.length || g.liquidity?.length || g.lending?.length,
    )
    .sort((a, b) => b.protocolUsd - a.protocolUsd);
}

function buildChains(protocolGroups, walletTokens) {
  const byChain = new Map();
  for (const g of protocolGroups) {
    if (g.protocol === "Wallet") continue;
    const ch = g.chain || "unknown";
    byChain.set(ch, (byChain.get(ch) || 0) + (g.protocolUsd || 0));
  }
  for (const t of walletTokens || []) {
    byChain.set(t.chain, (byChain.get(t.chain) || 0) + (t.usd || 0));
  }
  const total = [...byChain.values()].reduce((s, v) => s + v, 0) || 1;
  return [...byChain.entries()]
    .map(([slug, usd]) => ({
      slug,
      name: slug.toUpperCase(),
      usd: Math.round(usd * 100) / 100,
      pct: Math.round((usd / total) * 100),
    }))
    .sort((a, b) => b.usd - a.usd);
}

function buildProtocolTabs(protocolGroups) {
  return protocolGroups
    .map((g) => ({ protocol: g.protocol, usd: g.protocolUsd }))
    .sort((a, b) => b.usd - a.usd);
}

/**
 * @param {string} wallet
 * @param {{ chains?: string[], includeWallet?: boolean, includeVaults?: boolean }} opts
 */
export async function scanOnchainPortfolio(wallet, opts = {}) {
  const quick = opts.quick || process.env.PT_QUICK === "1";
  const chains =
    opts.chains ||
    (quick ? [...ETHERSCAN_FREE_CHAINS] : SCAN_CHAINS);
  const w = wallet.toLowerCase();

  const [
    walletRes,
    liquidity,
    aaveLending,
    vaults,
    fluidLending,
    yearnLiq,
    gmxLiq,
    morphoRes,
    compoundLending,
    llamaRes,
  ] = await Promise.all([
    opts.includeWallet !== false
      ? scanWalletBalances(w, chains)
      : { walletTokens: [], walletByChain: {} },
    quick ? Promise.resolve([]) : scanLpPositions(w, chains),
    quick ? Promise.resolve([]) : scanAaveLending(w, chains),
    quick || opts.includeVaults === false ? Promise.resolve([]) : scanVaultPositions(w, chains),
    quick ? Promise.resolve([]) : scanFluidLending(w, chains),
    quick ? Promise.resolve([]) : scanYearnVaults(w, chains),
    quick ? Promise.resolve([]) : scanGmxPositions(w, chains),
    quick ? Promise.resolve([]) : scanMorphoPositions(w, chains),
    quick ? Promise.resolve([]) : scanCompoundV3(w, chains),
    loadYieldIndex() && !etherscanEnabled()
      ? scanLlamaYieldTokens(w, chains)
      : Promise.resolve({ walletTokens: [], liquidity: [], lending: [], projectsHit: [] }),
  ]);

  const lending = mergePositions(
    [
      ...aaveLending,
      ...fluidLending,
      ...compoundLending,
      ...(morphoRes?.lending || []),
      ...(llamaRes?.lending || []),
    ],
    [],
    (p) => `${p.protocol}|${p.chain}|${p.netUsd}`,
  );
  const allLiquidity = mergePositions(
    [
      ...liquidity,
      ...vaults,
      ...yearnLiq,
      ...gmxLiq,
      ...(morphoRes?.liquidity || []),
      ...(llamaRes?.liquidity || []),
    ],
    [],
    (p) => `${p.protocol}|${p.chain}|${p.pair}|${p.poolId}`,
  );
  const walletTokens = mergeWalletTokens(walletRes.walletTokens, llamaRes?.walletTokens || []);
  const protocolGroups = buildProtocolGroups(lending, allLiquidity, walletTokens);
  const chainsBreakdown = buildChains(protocolGroups, walletTokens);
  const protocolTabs = buildProtocolTabs(protocolGroups);

  const walletUsd = walletTokens.reduce((s, t) => s + (t.usd || 0), 0);
  const liqUsd = allLiquidity.reduce((s, p) => s + (p.positionUsd || 0), 0);
  const lendUsd = lending.reduce((s, p) => s + (p.netUsd || 0), 0);
  const totalUsd = walletUsd + liqUsd + lendUsd;

  return {
    totalUsd: Math.round(totalUsd * 100) / 100,
    walletUsd: Math.round(walletUsd * 100) / 100,
    liqUsd: Math.round(liqUsd * 100) / 100,
    lendUsd: Math.round(lendUsd * 100) / 100,
    chains: chainsBreakdown,
    protocolTabs,
    protocolGroups,
    walletTokens,
    walletByChain: walletRes.walletByChain,
    lending,
    liquidity: allLiquidity,
    source: "onchain",
    partial: quick,
    onchain: true,
    scannedAt: Date.now(),
    stats: {
      lpCount: liquidity.length,
      vaultCount: vaults.length,
      lendCount: lending.length,
      fluidCount: fluidLending.length,
      morphoCount: (morphoRes?.lending || []).length + (morphoRes?.liquidity || []).length,
      compoundCount: compoundLending.length,
      llamaProjectsHit: (llamaRes?.projectsHit || []).length,
      llamaTokenScan: !!loadYieldIndex() && !etherscanEnabled(),
      etherscan: etherscanEnabled(),
      etherscanUsage: etherscanEnabled() ? getEtherscanUsageStats() : null,
      chains: chains.length,
      chainCount: chains.length,
      top20: chains.length >= TOP20_CHAINS.length,
      scannedChains: chains,
    },
  };
}
