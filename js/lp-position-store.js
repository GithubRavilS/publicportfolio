/**
 * Снимки LP по позициям: накопленные комиссии и APY между визитами (файловый кэш).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "..");
const STORE_DIR = resolve(ROOT, ".cache", "lp-snapshots");

export const ONCHAIN_DEX_PROTOCOLS = ["Uniswap V3", "PancakeSwap V3", "Aerodrome V3"];

export function positionStoreKey(protocol, chain, tokenId) {
  return `${protocol}|${String(chain).toLowerCase()}|${tokenId}`;
}

function storePath(wallet) {
  return resolve(STORE_DIR, `${wallet.toLowerCase()}.json`);
}

export function loadPositionStore(wallet) {
  const p = storePath(wallet);
  if (!existsSync(p)) return { v: 1, positions: {} };
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return { v: 1, positions: {} };
  }
}

export function savePositionStore(wallet, store) {
  mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(storePath(wallet), JSON.stringify(store, null, 0), "utf8");
}

/**
 * @param {object} snap — { feesUsd, principalUsd, collectedUsd, unclaimedUsd, at }
 */
export function applyPositionSnapshot(wallet, key, snap) {
  const store = loadPositionStore(wallet);
  const prev = store.positions[key];
  const now = snap.at || Date.now();
  let apyFromSnapshots = null;

  if (prev?.at && prev.feesUsd != null && snap.feesUsd != null) {
    const hours = (now - prev.at) / 3600000;
    const dFees = snap.feesUsd - prev.feesUsd;
    const principal = snap.principalUsd || prev.principalUsd || 1;
    if (hours >= 0.25 && principal > 0.5 && dFees >= 0) {
      apyFromSnapshots = (dFees / principal) * (8760 / hours) * 100;
    }
  }

  store.positions[key] = { ...snap, at: now };
  savePositionStore(wallet, store);

  return { apyFromSnapshots, prev };
}

export function annualizedApy(feesUsd, principalUsd, hoursOpen) {
  if (!principalUsd || principalUsd < 0.01 || !hoursOpen || hoursOpen < 0.25) return null;
  return (feesUsd / principalUsd) * (8760 / hoursOpen) * 100;
}

export function isOnchainDexProtocol(protocol) {
  return ONCHAIN_DEX_PROTOCOLS.includes(protocol);
}
