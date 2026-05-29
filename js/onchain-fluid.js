/**
 * Fluid: vault NFT-позиции (VaultResolver) + fToken депозиты (LendingResolver).
 */
import {
  CHAINS,
  SCAN_CHAINS,
  FLUID_LENDING_RESOLVER,
  FLUID_VAULT_RESOLVER,
} from "./onchain-registry.js";
import { rpcForChain, padAddr, encodeUint256 } from "./onchain-rpc.js";
import { decodeAddressArray, decodeUint256Array } from "./onchain-abi.js";
import { SEL } from "./onchain-selectors.js";
import { fetchPricesUsd, usdValue } from "./onchain-prices.js";
import { applyLendingMetrics } from "./lending-metrics.js";

async function readErc20Symbol(rpc, addr) {
  const k = String(addr).toLowerCase();
  if (KNOWN_SYMBOLS[k]) return KNOWN_SYMBOLS[k];
  try {
    const symHex = await rpc.ethCall(addr, SEL.symbol);
    if (symHex?.length > 130) {
      const len = parseInt(symHex.slice(66, 130), 16);
      return Buffer.from(symHex.slice(130, 130 + len * 2), "hex")
        .toString("utf8")
        .replace(/\0/g, "")
        .toUpperCase();
    }
  } catch {
    /* */
  }
  return addr.slice(2, 8).toUpperCase();
}

const KNOWN_DECIMALS = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": 6,
  "0x52aa899454998be5b000ad077a46bbe360f4e497": 8,
  "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": 8,
  "0x5ddf07980add152d518ae463269e1a97e93ee1a9": 6,
};

const KNOWN_SYMBOLS = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "USDC",
  "0x52aa899454998be5b000ad077a46bbe360f4e497": "CBBTC",
  "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": "CBBTC",
  "0x5ddf07980add152d518ae463269e1a97e93ee1a9": "USDC",
};

async function readDecimals(rpc, addr) {
  const k = String(addr).toLowerCase();
  if (KNOWN_DECIMALS[k]) return KNOWN_DECIMALS[k];
  try {
    return parseInt(await rpc.ethCall(k, SEL.decimals), 16) || 18;
  } catch {
    return 18;
  }
}

/** @returns {{ supply: bigint, borrow: bigint, vault: string, colToken: string, debtToken: string } | null} */
function decodeFluidVaultPosition(hex) {
  if (!hex || hex.length < 64 * 12) return null;
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const word = (i) => h.slice(i * 64, (i + 1) * 64);
  const nftId = BigInt("0x" + word(0));
  if (nftId === 0n) return null;
  const supply = BigInt("0x" + word(9));
  const borrow = BigInt("0x" + word(10));
  if (supply === 0n && borrow === 0n) return null;
  const vault = "0x" + word(12).slice(24);
  const colToken = ("0x" + word(15).slice(24)).toLowerCase();
  const debtToken = ("0x" + word(18).slice(24)).toLowerCase();
  return { supply, borrow, vault, colToken, debtToken };
}

async function scanFluidVaults(wallet, chain) {
  const rpc = rpcForChain(chain);
  const resolver = FLUID_VAULT_RESOLVER;
  const positions = [];

  let nftIds = [];
  try {
    const raw = await rpc.ethCall(resolver, SEL.positionsNftIdOfUser + padAddr(wallet));
    nftIds = decodeUint256Array(raw);
  } catch {
    return positions;
  }

  const symbols = new Set();
  for (const id of nftIds) {
    if (id === 0n) continue;
    let raw;
    try {
      raw = await rpc.ethCall(resolver, SEL.positionByNftId + encodeUint256(id));
    } catch {
      continue;
    }
    const decoded = decodeFluidVaultPosition(raw);
    if (!decoded) continue;

    const colSym = await readErc20Symbol(rpc, decoded.colToken);
    const debtSym = await readErc20Symbol(rpc, decoded.debtToken);
    symbols.add(colSym);
    symbols.add(debtSym);
    const colDec = await readDecimals(rpc, decoded.colToken);
    const debtDec = await readDecimals(rpc, decoded.debtToken);

    positions.push({
      nftId: id.toString(),
      colSym,
      debtSym,
      colAmt: Number(decoded.supply) / 10 ** colDec,
      debtAmt: Number(decoded.borrow) / 10 ** debtDec,
    });
  }

  const prices = await fetchPricesUsd([...symbols]);
  return positions
    .filter((p) => p.colAmt < 500 && p.debtAmt < 1_000_000)
    .map((p) => {
      const collateralUsd = usdValue(p.colAmt, p.colSym, prices);
      const debtUsd = usdValue(p.debtAmt, p.debtSym, prices);
      if (collateralUsd > 5_000_000 || debtUsd > 5_000_000) return null;
      const hf = debtUsd > 0 ? collateralUsd / debtUsd : 10;
      return applyLendingMetrics({
        protocol: "Fluid",
        chain,
        healthFactor: hf > 10 ? 10 : Math.round(hf * 100) / 100,
        supplied: [{ asset: p.colSym, amount: String(p.colAmt), usd: collateralUsd }],
        borrowed: [{ asset: p.debtSym, amount: String(p.debtAmt), usd: debtUsd }],
        rewards: [],
        rewardsUsd: 0,
        collateralUsd,
        debtUsd,
        netUsd: collateralUsd - debtUsd,
        source: "onchain",
      });
    })
    .filter(Boolean);
}

export async function scanFluidLending(wallet, chains = SCAN_CHAINS) {
  const w = wallet.toLowerCase();
  const all = [];
  for (const chain of chains) {
    if (!CHAINS[chain]?.fluid) continue;
    const vaults = await scanFluidVaults(w, chain);
    all.push(...vaults);
  }
  return all;
}
