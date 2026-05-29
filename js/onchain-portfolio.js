/**
 * Полный ончейн-портфель: кошелёк + LP + лендинг + Beefy-вольты.
 * Формат совместим с DeBank parse (protocolGroups, liquidity, lending, walletTokens).
 */
import { SCAN_CHAINS } from "./onchain-registry.js";
import { scanWalletBalances } from "./onchain-wallet.js";
import { scanLpPositions } from "./onchain-lp.js";
import { scanAaveLending } from "./onchain-lending.js";
import { scanVaultPositions } from "./onchain-vaults.js";
import { scanFluidLending } from "./onchain-fluid.js";
import { scanYearnVaults } from "./onchain-yearn.js";
import { scanGmxPositions } from "./onchain-gmx.js";
import { formatPairDisplay } from "./revert-parse.js";

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
  const chains = opts.chains || SCAN_CHAINS;
  const w = wallet.toLowerCase();

  const [walletRes, liquidity, aaveLending, vaults, fluidLending, yearnLiq, gmxLiq] =
    await Promise.all([
      opts.includeWallet !== false
        ? scanWalletBalances(w, chains)
        : { walletTokens: [], walletByChain: {} },
      scanLpPositions(w, chains),
      scanAaveLending(w, chains),
      opts.includeVaults !== false ? scanVaultPositions(w, chains) : [],
      scanFluidLending(w, chains),
      scanYearnVaults(w, chains),
      scanGmxPositions(w, chains),
    ]);

  const lending = [...aaveLending, ...fluidLending];
  const allLiquidity = [...liquidity, ...vaults, ...yearnLiq, ...gmxLiq];
  const { walletTokens } = walletRes;

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
    partial: false,
    onchain: true,
    scannedAt: Date.now(),
    stats: {
      lpCount: liquidity.length,
      vaultCount: vaults.length,
      lendCount: lending.length,
      fluidCount: fluidLending.length,
      chains: chains.length,
    },
  };
}
