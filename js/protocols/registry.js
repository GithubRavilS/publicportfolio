/**
 * Очередь обучения on-chain адаптеров (цель ~90% TVL DeFiLlama top-20).
 * Статус: trained = 10 кошельков прошли сверку с DeBank ±15%.
 */
export const PROTOCOL_STATUS = {
  TRAINED: "trained",
  LEARNING: "learning",
  PLANNED: "planned",
};

/** @typedef {{ id: string, name: string, type: "liquidity"|"lending"|"vault", debankPatterns: RegExp[], revertPatterns?: RegExp[], status: string, chains?: string[] }} ProtocolDef */

/** @type {ProtocolDef[]} */
export const TRAINING_QUEUE = [
  {
    id: "uniswap-v3",
    name: "Uniswap V3",
    type: "liquidity",
    debankPatterns: [/uniswap\s*v3/i],
    revertPatterns: [/uniswap/i],
    status: PROTOCOL_STATUS.PLANNED,
    chains: ["eth", "base", "arb", "op", "matic", "avax", "bsc"],
  },
  {
    id: "aerodrome-v3",
    name: "Aerodrome V3",
    type: "liquidity",
    debankPatterns: [/aerodrome/i],
    revertPatterns: [/aerodrome/i],
    status: PROTOCOL_STATUS.PLANNED,
    chains: ["base"],
  },
  {
    id: "pancakeswap-v3",
    name: "PancakeSwap V3",
    type: "liquidity",
    debankPatterns: [/pancake/i],
    revertPatterns: [/pancake/i],
    status: PROTOCOL_STATUS.LEARNING,
    chains: ["base", "arb", "bsc"],
  },
  {
    id: "aave-v3",
    name: "Aave V3",
    type: "lending",
    debankPatterns: [/aave\s*v3/i, /^aave$/i],
    status: PROTOCOL_STATUS.PLANNED,
    chains: ["eth", "base", "arb", "op", "matic", "avax"],
  },
  {
    id: "compound-v3",
    name: "Compound V3",
    type: "lending",
    debankPatterns: [/compound/i],
    status: PROTOCOL_STATUS.PLANNED,
    chains: ["eth", "base", "arb", "op", "matic"],
  },
  {
    id: "fluid",
    name: "Fluid",
    type: "lending",
    debankPatterns: [/fluid/i],
    status: PROTOCOL_STATUS.PLANNED,
    chains: ["eth", "base", "arb", "matic"],
  },
  {
    id: "curve",
    name: "Curve",
    type: "liquidity",
    debankPatterns: [/curve/i],
    status: PROTOCOL_STATUS.PLANNED,
    chains: ["eth", "arb", "op", "matic", "base"],
  },
  {
    id: "uniswap-v4",
    name: "Uniswap V4",
    type: "liquidity",
    debankPatterns: [/uniswap\s*v4/i],
    status: PROTOCOL_STATUS.PLANNED,
    chains: ["eth", "base", "arb"],
  },
  {
    id: "morpho",
    name: "Morpho",
    type: "lending",
    debankPatterns: [/morpho/i],
    status: PROTOCOL_STATUS.PLANNED,
    chains: ["eth", "base", "arb"],
  },
  {
    id: "gmx-v2",
    name: "GMX V2",
    type: "liquidity",
    debankPatterns: [/gmx/i],
    status: PROTOCOL_STATUS.PLANNED,
    chains: ["arb", "avax"],
  },
];

/** Кошельки для регрессии (добавляй свои). */
export const DEFAULT_TRAINING_WALLETS = [
  "0x6942F83A927154f1AAd2C9443061D1B88030e230",
];

export function getProtocol(id) {
  const p = TRAINING_QUEUE.find((x) => x.id === id);
  if (!p) throw new Error(`UNKNOWN_PROTOCOL:${id}`);
  return p;
}

export function listProtocols() {
  return TRAINING_QUEUE.map((p) => ({ id: p.id, name: p.name, status: p.status, type: p.type }));
}
