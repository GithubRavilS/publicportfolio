/**
 * Morpho Blue + Vaults — официальный GraphQL (бесплатно, не DeBank).
 */
import { CHAIN_IDS } from "./onchain-registry.js";

const MORPHO_API = "https://blue-api.morpho.org/graphql";
const CHAIN_SLUG_TO_ID = Object.fromEntries(
  Object.entries(CHAIN_IDS).map(([slug, id]) => [slug, id]),
);

const QUERY = `
query UserPortfolio($address: String!, $chainId: Int!) {
  userByAddress(address: $address, chainId: $chainId) {
    marketPositions {
      market { uniqueKey loanAsset { symbol } collateralAsset { symbol } }
      state {
        supplyAssetsUsd
        borrowAssetsUsd
        collateralUsd
      }
    }
    vaultPositions {
      vault { name address }
      state { assetsUsd }
    }
    vaultV2Positions {
      vault { name address }
      assetsUsd
    }
  }
}`;

async function morphoGraphql(chainId, address) {
  const r = await fetch(MORPHO_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: QUERY,
      variables: { address, chainId },
    }),
  });
  const j = await r.json();
  if (j.errors?.length) throw new Error(j.errors[0].message || "MORPHO_GQL");
  return j.data?.userByAddress;
}

function mapMarketPositions(items, chain) {
  const lending = [];
  for (const mp of items || []) {
    const sup = Number(mp?.state?.supplyAssetsUsd || 0);
    const bor = Number(mp?.state?.borrowAssetsUsd || 0);
    const col = Number(mp?.state?.collateralUsd || 0);
    const net = sup + col - bor;
    if (Math.abs(net) < 0.01 && sup < 0.01 && bor < 0.01) continue;
    const loan = mp?.market?.loanAsset?.symbol || "?";
    const coll = mp?.market?.collateralAsset?.symbol || "";
    lending.push({
      protocol: "Morpho Blue",
      chain,
      netUsd: Math.round(net * 100) / 100,
      supplied: sup > 0 ? [{ asset: loan, usd: sup }] : [],
      borrowed: bor > 0 ? [{ asset: loan, usd: bor }] : [],
      collateral: col > 0 && coll ? [{ asset: coll, usd: col }] : [],
      onchain: true,
      source: "morpho-api",
      poolId: mp?.market?.uniqueKey?.slice(0, 18) || "market",
    });
  }
  return lending;
}

function mapVaultPositions(v1, v2, chain) {
  const liquidity = [];
  for (const vp of v1 || []) {
    const usd = Number(vp?.state?.assetsUsd || 0);
    if (usd < 0.01) continue;
    liquidity.push({
      protocol: "Morpho Vault",
      chain,
      positionUsd: Math.round(usd * 100) / 100,
      pair: vp?.vault?.name || "Vault",
      poolId: vp?.vault?.address || "",
      onchain: true,
      source: "morpho-api",
      kind: "Vault",
    });
  }
  for (const vp of v2 || []) {
    const usd = Number(vp?.assetsUsd || 0);
    if (usd < 0.01) continue;
    liquidity.push({
      protocol: "Morpho Vault V2",
      chain,
      positionUsd: Math.round(usd * 100) / 100,
      pair: vp?.vault?.name || "Vault V2",
      poolId: vp?.vault?.address || "",
      onchain: true,
      source: "morpho-api",
      kind: "Vault",
    });
  }
  return liquidity;
}

/** @param {string} wallet @param {string[]} chains — slug */
export async function scanMorphoPositions(wallet, chains) {
  const w = wallet.toLowerCase();
  const lending = [];
  const liquidity = [];
  const chainIds = chains
    .map((c) => CHAIN_SLUG_TO_ID[c])
    .filter((id) => id != null);

  const results = await Promise.all(
    chainIds.map(async (chainId) => {
      const chain = Object.entries(CHAIN_SLUG_TO_ID).find(([, id]) => id === chainId)?.[0] || "eth";
      try {
        const user = await morphoGraphql(chainId, w);
        if (!user) return { lending: [], liquidity: [] };
        return {
          lending: mapMarketPositions(user.marketPositions, chain),
          liquidity: [
            ...mapVaultPositions(user.vaultPositions, user.vaultV2Positions, chain),
          ],
        };
      } catch {
        return { lending: [], liquidity: [] };
      }
    }),
  );

  for (const r of results) {
    lending.push(...r.lending);
    liquidity.push(...r.liquidity);
  }
  return { lending, liquidity };
}
