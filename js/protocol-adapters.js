/**
 * Маппинг DeFiLlama slug → тип ончейн-адаптера.
 */
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = resolve(__dir, "../data/llama-adapter-registry.json");

export const ADAPTER_TYPES = {
  AAVE_V3: "aave_v3",
  SPARK: "spark",
  COMPOUND_V3: "compound_v3",
  MORPHO_API: "morpho_api",
  UNI_V3_NFPM: "uni_v3_nfpm",
  BEEFY_ERC4626: "beefy_erc4626",
  YEARN: "yearn",
  FLUID: "fluid",
  GMX: "gmx",
  WALLET_LST: "wallet_lst",
  LLAMA_TOKEN_SCAN: "llama_token_scan",
  GAP: "gap",
};

const SLUG_ADAPTER = {
  "aave-v3": ADAPTER_TYPES.AAVE_V3,
  "aave-v2": ADAPTER_TYPES.AAVE_V3,
  spark: ADAPTER_TYPES.SPARK,
  sparklend: ADAPTER_TYPES.SPARK,
  "sky-lending": ADAPTER_TYPES.AAVE_V3,
  "compound-v3": ADAPTER_TYPES.COMPOUND_V3,
  "compound-v2": ADAPTER_TYPES.COMPOUND_V3,
  "morpho-blue": ADAPTER_TYPES.MORPHO_API,
  "morpho-aave": ADAPTER_TYPES.MORPHO_API,
  "morpho-compound": ADAPTER_TYPES.MORPHO_API,
  "uniswap-v3": ADAPTER_TYPES.UNI_V3_NFPM,
  "uniswap-v4": ADAPTER_TYPES.UNI_V3_NFPM,
  "pancakeswap-amm": ADAPTER_TYPES.UNI_V3_NFPM,
  "pancakeswap-amm-v3": ADAPTER_TYPES.UNI_V3_NFPM,
  "aerodrome-slipstream": ADAPTER_TYPES.UNI_V3_NFPM,
  aerodrome: ADAPTER_TYPES.UNI_V3_NFPM,
  beefy: ADAPTER_TYPES.BEEFY_ERC4626,
  "yearn-finance": ADAPTER_TYPES.YEARN,
  "gmx-v2": ADAPTER_TYPES.GMX,
  gmx: ADAPTER_TYPES.GMX,
  fluid: ADAPTER_TYPES.FLUID,
  "fluid-dex": ADAPTER_TYPES.FLUID,
  lido: ADAPTER_TYPES.LLAMA_TOKEN_SCAN,
  "rocket-pool": ADAPTER_TYPES.LLAMA_TOKEN_SCAN,
  "ether.fi-stake": ADAPTER_TYPES.LLAMA_TOKEN_SCAN,
  "binance-staked-eth": ADAPTER_TYPES.LLAMA_TOKEN_SCAN,
  "curve-dex": ADAPTER_TYPES.LLAMA_TOKEN_SCAN,
  pendle: ADAPTER_TYPES.LLAMA_TOKEN_SCAN,
  "convex-finance": ADAPTER_TYPES.LLAMA_TOKEN_SCAN,
  "balancer-v2": ADAPTER_TYPES.LLAMA_TOKEN_SCAN,
  "euler-v2": ADAPTER_TYPES.LLAMA_TOKEN_SCAN,
  "venus-core-pool": ADAPTER_TYPES.AAVE_V3,
};

let registryCache = null;

export function loadAdapterRegistry() {
  if (registryCache) return registryCache;
  if (!existsSync(REGISTRY_PATH)) return null;
  try {
    registryCache = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
    return registryCache;
  } catch {
    return null;
  }
}

/** Все slug из mass-index (500+). */
export function getLlamaMassSlugs() {
  const reg = loadAdapterRegistry();
  if (!reg?.adapters) return new Set();
  return new Set(reg.adapters.filter((a) => a.implemented).map((a) => a.slug));
}

export function getImplementedSlugs() {
  return new Set([...Object.keys(SLUG_ADAPTER), ...getLlamaMassSlugs()]);
}

export function adapterForSlug(slug) {
  const s = String(slug || "").toLowerCase();
  const reg = loadAdapterRegistry();
  const hit = reg?.adapters?.find((a) => a.slug === s);
  if (hit?.adapter) return hit.adapter;
  if (SLUG_ADAPTER[s]) return SLUG_ADAPTER[s];
  if (getLlamaMassSlugs().has(s)) return ADAPTER_TYPES.LLAMA_TOKEN_SCAN;
  if (/aave|spark|sky-lend/i.test(s)) return ADAPTER_TYPES.AAVE_V3;
  if (/morpho/i.test(s)) return ADAPTER_TYPES.MORPHO_API;
  if (/compound/i.test(s)) return ADAPTER_TYPES.COMPOUND_V3;
  if (/uniswap|pancake|aerodrome|velodrome|sushi|quickswap/i.test(s))
    return ADAPTER_TYPES.UNI_V3_NFPM;
  if (/beefy|yearn|convex/i.test(s)) return ADAPTER_TYPES.BEEFY_ERC4626;
  if (/lido|rocket|ether\.fi|stake|lst|restak/i.test(s)) return ADAPTER_TYPES.LLAMA_TOKEN_SCAN;
  return ADAPTER_TYPES.LLAMA_TOKEN_SCAN;
}

export function isImplementedSlug(slug) {
  const s = String(slug || "").toLowerCase();
  if (SLUG_ADAPTER[s]) return true;
  if (getLlamaMassSlugs().has(s)) return true;
  return adapterForSlug(s) !== ADAPTER_TYPES.GAP;
}
