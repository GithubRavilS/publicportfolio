/**
 * Финальная очистка портфеля перед отдачей клиенту / кэшем.
 * LP только с подтверждённым ownerOf (кошелёк или Pancake farm).
 */
import { CHAINS } from "./onchain-registry.js";
import { readNfpmOwner, isLpOwnerForWallet } from "./onchain-lp.js";
import { extractLpTokenId } from "./lp-onchain.js";
import { normalizeChain, poolPairKey } from "./revert-match.js";
import { isRevertDexDebankProtocol } from "./revert-portfolio-merge.js";
import { syncDisplayTotals } from "./portfolio-normalize.js";

export const ONCHAIN_PORTFOLIO_SCHEMA = 13;

const VERIFY_CHAINS = ["base", "arb", "op", "eth", "bsc", "matic"];

/** @returns {Promise<Map<string, { chain: string, protocol: string }>>} */
export async function verifyLpTokenOwners(wallet, tokenIds) {
  const w = wallet.toLowerCase();
  const out = new Map();
  for (const tid of tokenIds) {
    for (const chain of VERIFY_CHAINS) {
      const cfg = CHAINS[chain];
      if (!cfg?.nfpm?.length) continue;
      for (const nf of cfg.nfpm) {
        if (
          !nf.protocol?.toLowerCase().includes("pancake") &&
          !nf.protocol?.includes("Uniswap") &&
          !nf.protocol?.includes("Aerodrome")
        )
          continue;
        try {
          const owner = await readNfpmOwner(chain, nf.address, BigInt(tid));
          if (!isLpOwnerForWallet(owner, w, chain)) continue;
          const posData = { chain, protocol: nf.protocol, nfpm: nf.address };
          const prev = out.get(tid);
          if (!prev || chain === "base") out.set(tid, posData);
          break;
        } catch {
          /* */
        }
      }
      if (out.has(tid)) break;
    }
  }
  return out;
}

function collectTokenIds(portfolio) {
  const ids = new Set();
  for (const g of portfolio.protocolGroups || []) {
    for (const p of g.liquidity || []) {
      const tid = extractLpTokenId(p);
      if (tid) ids.add(tid);
    }
  }
  for (const p of portfolio.liquidity || []) {
    const tid = extractLpTokenId(p);
    if (tid) ids.add(tid);
  }
  return [...ids];
}

function roundUsd(n) {
  return Math.round((n || 0) * 100) / 100;
}

/**
 * @param {object} portfolio
 * @param {string} wallet
 */
export async function finalizeOnchainPortfolio(portfolio, wallet) {
  if (!portfolio?.protocolGroups) return portfolio;

  const w = wallet.toLowerCase();
  const tids = collectTokenIds(portfolio);
  const verified = tids.length ? await verifyLpTokenOwners(w, tids) : new Map();

  for (const g of portfolio.protocolGroups || []) {
    const nextLiq = [];
    for (const p of g.liquidity || []) {
      const tid = extractLpTokenId(p);
      const canon = isRevertDexDebankProtocol(g.protocol);

      if (p.overviewFill || p.debankFill || String(p.poolId || "").includes("overview-")) continue;
      if ((p.positionUsd || 0) < 0.02 && !tid) continue;
      if (String(p.poolId || "").includes("overview-")) continue;
      if (String(p.pair || "") === g.protocol && !tid) continue;

      if (tid) {
        const hit = verified.get(tid);
        const fromRpc =
          p.onchain &&
          (p.source === "onchain-farm" ||
            p.source === "onchain-rpc" ||
            String(p.source || "").startsWith("onchain"));
        if (hit) {
          p.chain = hit.chain;
          g.chain = hit.chain;
        } else if (!fromRpc) {
          continue;
        }
        p.onchain = true;
        p.debankFill = false;
        p.overviewFill = false;
        p.source = p.source || "onchain";
      } else if (canon && !p.onchain && p.source !== "onchain") {
        continue;
      }

      if ((p.positionUsd || 0) < 0.02 && tid) {
        const hit = verified.get(tid);
        if (hit) p.positionUsd = p.positionUsd || 0.02;
        else continue;
      }

      nextLiq.push(p);
    }

    const byTid = new Map();
    for (const p of nextLiq) {
      const tid = extractLpTokenId(p);
      const k = tid || `${poolPairKey(p)}|${p.feeTier || ""}`;
      const prev = byTid.get(k);
      if (!prev || p.onchain) byTid.set(k, p);
    }
    g.liquidity = [...byTid.values()];

    g.lending = (g.lending || []).filter((p) => !p.overviewFill && !p.debankFill);
    g.walletTokens = (g.walletTokens || []).filter((t) => (t.usd || 0) >= 0.02 || t.onchain);

    let u = 0;
    for (const p of g.liquidity) u += p.positionUsd || 0;
    for (const p of g.lending) u += Math.max(p.netUsd || 0, 0);
    if (g.protocol !== "Wallet") g.protocolUsd = roundUsd(u);
  }

  portfolio.protocolGroups = (portfolio.protocolGroups || []).filter((g) => {
    if (g.protocol === "Wallet") return true;
    return (g.liquidity || []).length || (g.lending || []).length;
  });

  portfolio.walletTokens = (portfolio.walletTokens || []).filter((t) => {
    if ((t.usd || 0) >= 0.02) return true;
    return t.onchain && (t.usd || 0) > 0.001;
  });

  portfolio.source = portfolio.source === "rpc" ? "rpc" : "onchain";
  portfolio.onchain = true;
  portfolio.hybrid = false;
  portfolio.onchainVerified = true;
  portfolio.schemaVersion = ONCHAIN_PORTFOLIO_SCHEMA;
  portfolio.partial = false;

  return syncDisplayTotals(portfolio);
}
