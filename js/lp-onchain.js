/**
 * Ончейн LP: диапазоны из NFT-позиций (tickLower/tickUpper) и текущая цена из slot0 пула.
 * Без Revert/DeBank — только JSON-RPC (публичные ноды + rpc_urls в config.json).
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { normPair, normToken, pairMeta, invertPoolPrice } from "./revert-parse.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "..");

const SEL = {
  balanceOf: "0x70a08231",
  tokenOfOwnerByIndex: "0x2f745c59",
  positions: "0x99fbab88",
  slot0: "0x3850c7bd",
  token0: "0x0dfe1681",
  token1: "0xd21220a7",
  fee: "0xddca3f43",
  getPool: "0x1698ee82",
  decimals: "0x313ce567",
  symbol: "0x95d89b41",
};

import { CHAINS as REGISTRY_CHAINS, SCAN_CHAINS as REGISTRY_SCAN } from "./onchain-registry.js";

/** @deprecated use onchain-registry CHAINS */
export const CHAIN_ONCHAIN = REGISTRY_CHAINS;

const ERC721_TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f55a4df523b3ef";

let rpcConfig = null;

export function loadRpcConfig() {
  if (rpcConfig) return rpcConfig;
  rpcConfig = { rpc_urls: {}, etherscan_keys: {} };
  const path = resolve(ROOT, "config.json");
  if (!existsSync(path)) return rpcConfig;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    rpcConfig.rpc_urls = raw.rpc_urls || {};
    rpcConfig.etherscan_keys = raw.etherscan_keys || raw.etherscan_api_keys || {};
  } catch {
    /* ignore */
  }
  return rpcConfig;
}

function padAddr(addr) {
  return addr.slice(2).toLowerCase().padStart(64, "0");
}

function encodeAddress(addr) {
  return padAddr(addr);
}

function encodeUint256(n) {
  return BigInt(n).toString(16).padStart(64, "0");
}

function decodeInt24(word) {
  let v = BigInt(word);
  if (v >= 2n ** 255n) v -= 2n ** 256n;
  const max = 2n ** 23n;
  if (v > max) v -= 2n ** 24n;
  if (v < -max) v += 2n ** 24n;
  return Number(v);
}

function decodeUint24(word) {
  return Number(BigInt(word) & 0xffffffn);
}

function decodeAddress(word) {
  return "0x" + BigInt(word).toString(16).padStart(40, "0").slice(-40);
}

export class RpcClient {
  constructor(urls) {
    this.urls = (urls || []).filter(Boolean);
    this.idx = 0;
  }

  async call(method, params) {
    let lastErr;
    for (let t = 0; t < this.urls.length; t++) {
      const url = this.urls[(this.idx + t) % this.urls.length];
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        });
        const j = await r.json();
        if (j.error) {
          lastErr = new Error(j.error.message || JSON.stringify(j.error));
          continue;
        }
        this.idx = (this.idx + t) % this.urls.length;
        return j.result;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("RPC_FAILED");
  }

  async ethCall(to, data) {
    return this.call("eth_call", [{ to, data }, "latest"]);
  }

  async getCode(addr) {
    const code = await this.call("eth_getCode", [addr, "latest"]);
    return code && code.length > 2;
  }

  async blockNumber() {
    return BigInt(await this.call("eth_blockNumber", []));
  }
}

function rpcForChain(chain) {
  const cfg = loadRpcConfig();
  const slug = String(chain || "").toLowerCase();
  const custom = cfg.rpc_urls?.[slug];
  const defaults = CHAIN_ONCHAIN[slug]?.rpc || [];
  const urls = [...(Array.isArray(custom) ? custom : custom ? [custom] : []), ...defaults];
  return new RpcClient(urls);
}

export function tickToPriceRatio(tick, decimals0, decimals1) {
  return Math.pow(1.0001, tick) * Math.pow(10, decimals0 - decimals1);
}

/** Цены для UI: token1 per token0; для BTC-пар — USD за 1 BTC. */
export function displayRangeFromTicks(
  tickLower,
  tickUpper,
  tickCurrent,
  decimals0,
  decimals1,
  pairKey,
) {
  const meta = pairMeta(pairKey);
  const pLo = tickToPriceRatio(tickLower, decimals0, decimals1);
  const pHi = tickToPriceRatio(tickUpper, decimals0, decimals1);
  const pCur = tickToPriceRatio(tickCurrent, decimals0, decimals1);

  if (meta.hasBtc || meta.hasGold) {
    const inv = (p) => invertPoolPrice(p);
    const a = inv(pLo);
    const b = inv(pHi);
    const c = inv(pCur);
    return {
      rangeMin: Math.min(a, b),
      rangeMax: Math.max(a, b),
      rangeCurrent: c,
    };
  }

  return {
    rangeMin: Math.min(pLo, pHi),
    rangeMax: Math.max(pLo, pHi),
    rangeCurrent: Math.max(Math.min(pCur, Math.max(pLo, pHi)), Math.min(pLo, pHi)),
  };
}

export async function readTokenMeta(rpc, address) {
  const decHex = await rpc.ethCall(address, SEL.decimals);
  const decimals = decHex && decHex !== "0x" ? parseInt(decHex, 16) : 18;
  let symbol = normToken(address.slice(0, 6));
  try {
    const symHex = await rpc.ethCall(address, SEL.symbol);
    if (symHex && symHex.length > 130) {
      const len = parseInt(symHex.slice(66, 130), 16);
      const raw = Buffer.from(symHex.slice(130, 130 + len * 2), "hex").toString("utf8");
      symbol = normToken(raw.replace(/\0/g, ""));
    } else if (symHex && symHex.length === 66) {
      symbol = normToken(Buffer.from(symHex.slice(2), "hex").toString("utf8").replace(/\0/g, ""));
    }
  } catch {
    /* optional */
  }
  return { address: address.toLowerCase(), decimals, symbol };
}

export async function readPoolSlot0(rpc, poolAddress) {
  const raw = await rpc.ethCall(poolAddress, SEL.slot0);
  if (!raw || raw === "0x" || raw.length < 130) return null;
  const hex = raw.slice(2);
  const sqrtX96 = BigInt("0x" + hex.slice(0, 64));
  const tick = decodeInt24("0x" + hex.slice(64, 128));
  return { sqrtX96, tick };
}

export async function readPosition(rpc, nfpm, tokenId) {
  const data = SEL.positions + encodeUint256(tokenId);
  const raw = await rpc.ethCall(nfpm, data);
  if (!raw || raw.length < 64 * 8) return null;
  const hex = raw.slice(2);
  const word = (i) => "0x" + hex.slice(i * 64, (i + 1) * 64);
  const token0 = decodeAddress(word(2));
  const token1 = decodeAddress(word(3));
  const fee = decodeUint24(word(4));
  const tickLower = decodeInt24(word(5));
  const tickUpper = decodeInt24(word(6));
  const liquidity = BigInt(word(7));
  return { token0, token1, fee, tickLower, tickUpper, liquidity };
}

async function nfpmHasCode(rpc, address) {
  try {
    return await rpc.getCode(address);
  } catch {
    return false;
  }
}

async function balanceOfNft(rpc, nfpm, wallet) {
  const raw = await rpc.ethCall(nfpm, SEL.balanceOf + encodeAddress(wallet));
  if (!raw || raw === "0x") return 0;
  return Number(BigInt(raw));
}

async function tokenOfOwnerByIndex(rpc, nfpm, wallet, index) {
  const data = SEL.tokenOfOwnerByIndex + encodeAddress(wallet) + encodeUint256(index);
  const raw = await rpc.ethCall(nfpm, data);
  return BigInt(raw || 0);
}

/** Fallback: NFT, полученные через Transfer (если balanceOf недоступен). */
async function discoverTokenIdsViaLogs(rpc, nfpm, wallet, maxBlocks = 120000n) {
  const ids = new Set();
  let latest;
  try {
    latest = await rpc.blockNumber();
  } catch {
    return ids;
  }
  const walletTopic = "0x" + padAddr(wallet);
  const chunk = 50000n;
  let to = latest;
  while (to > latest - maxBlocks && to > 0n) {
    const from = to > chunk ? to - chunk : 0n;
    try {
      const logs = await rpc.call("eth_getLogs", [
        {
          fromBlock: "0x" + from.toString(16),
          toBlock: "0x" + to.toString(16),
          address: nfpm,
          topics: [ERC721_TRANSFER, null, walletTopic],
        },
      ]);
      for (const log of logs || []) {
        if (log.topics?.[3]) ids.add(BigInt(log.topics[3]).toString());
      }
    } catch {
      /* chunk too large — skip */
    }
    to = from > 0n ? from - 1n : 0n;
  }
  return ids;
}

async function enumerateTokenIds(rpc, nfpm, wallet) {
  const ids = new Set();
  try {
    const n = await balanceOfNft(rpc, nfpm, wallet);
    for (let i = 0; i < n; i++) {
      ids.add((await tokenOfOwnerByIndex(rpc, nfpm, wallet, i)).toString());
    }
  } catch {
    /* enumerable not supported */
  }
  if (!ids.size) {
    const fromLogs = await discoverTokenIdsViaLogs(rpc, nfpm, wallet);
    for (const id of fromLogs) ids.add(id);
  }
  return [...ids];
}

async function resolvePoolAddress(rpc, factory, token0, token1, fee) {
  if (!factory) return null;
  const [a, b] = token0.toLowerCase() < token1.toLowerCase() ? [token0, token1] : [token1, token0];
  const data =
    SEL.getPool + encodeAddress(a) + encodeAddress(b) + fee.toString(16).padStart(64, "0");
  try {
    const raw = await rpc.ethCall(factory, data);
    const pool = decodeAddress(raw);
    if (pool === "0x0000000000000000000000000000000000000000") return null;
    return pool;
  } catch {
    return null;
  }
}

export async function scanWalletLpOnchain(wallet, chains = ["eth", "base", "arb", "op"]) {
  const w = wallet.toLowerCase();
  const out = [];

  for (const chain of chains) {
    const chainCfg = CHAIN_ONCHAIN[chain];
    if (!chainCfg) continue;
    const rpc = rpcForChain(chain);

    for (const nf of chainCfg.nfpm) {
      if (!(await nfpmHasCode(rpc, nf.address))) continue;

      const tokenIds = await enumerateTokenIds(rpc, nf.address, w);
      for (const tokenIdStr of tokenIds) {
        const tokenId = BigInt(tokenIdStr);
        let pos;
        try {
          pos = await readPosition(rpc, nf.address, tokenId);
        } catch {
          continue;
        }
        if (!pos) continue;

        let t0;
        let t1;
        try {
          t0 = await readTokenMeta(rpc, pos.token0);
          t1 = await readTokenMeta(rpc, pos.token1);
        } catch {
          continue;
        }

        const pairKey = normPair(`${t0.symbol}+${t1.symbol}`);
        let poolAddress = await resolvePoolAddress(
          rpc,
          nf.factory,
          pos.token0,
          pos.token1,
          pos.fee,
        );
        if (!poolAddress) poolAddress = null;

        let tickCurrent = Math.round((pos.tickLower + pos.tickUpper) / 2);
        if (poolAddress) {
          try {
            const slot = await readPoolSlot0(rpc, poolAddress);
            if (slot) tickCurrent = slot.tick;
          } catch {
            /* pool read failed */
          }
        }

        const range = displayRangeFromTicks(
          pos.tickLower,
          pos.tickUpper,
          tickCurrent,
          t0.decimals,
          t1.decimals,
          pairKey,
        );

        const feeTierPct = nf.protocol.includes("Aerodrome") ? pos.fee / 2000 : pos.fee / 10000;

        out.push({
          source: "onchain",
          chain,
          protocol: nf.protocol,
          tokenId: tokenIdStr,
          poolAddress,
          nfpm: nf.address,
          token0: t0,
          token1: t1,
          fee: pos.fee,
          feeTierPct,
          pair: `${t0.symbol}/${t1.symbol}`,
          pairKey,
          liquidity: pos.liquidity.toString(),
          tickLower: pos.tickLower,
          tickUpper: pos.tickUpper,
          tickCurrent,
          ...range,
        });
      }
    }
  }

  return out;
}

async function buildOnchainLpRecord(rpc, chain, nf, tokenIdStr, pos) {
  let t0;
  let t1;
  try {
    t0 = await readTokenMeta(rpc, pos.token0);
    t1 = await readTokenMeta(rpc, pos.token1);
  } catch {
    return null;
  }

  const pairKey = normPair(`${t0.symbol}+${t1.symbol}`);
  let poolAddress = await resolvePoolAddress(rpc, nf.factory, pos.token0, pos.token1, pos.fee);
  let tickCurrent = Math.round((pos.tickLower + pos.tickUpper) / 2);
  if (poolAddress) {
    try {
      const slot = await readPoolSlot0(rpc, poolAddress);
      if (slot) tickCurrent = slot.tick;
    } catch {
      /* */
    }
  }

  const range = displayRangeFromTicks(
    pos.tickLower,
    pos.tickUpper,
    tickCurrent,
    t0.decimals,
    t1.decimals,
    pairKey,
  );

  const feeTierPct = nf.protocol.includes("Aerodrome") ? pos.fee / 2000 : pos.fee / 10000;

  return {
    source: "onchain",
    chain,
    protocol: nf.protocol,
    tokenId: tokenIdStr,
    poolAddress,
    nfpm: nf.address,
    token0: t0,
    token1: t1,
    fee: pos.fee,
    feeTierPct,
    pair: `${t0.symbol}/${t1.symbol}`,
    pairKey,
    liquidity: pos.liquidity.toString(),
    tickLower: pos.tickLower,
    tickUpper: pos.tickUpper,
    tickCurrent,
    ...range,
  };
}

/** DeBank даёт #NFT — читаем позицию напрямую (в т.ч. если NFT не в wallet scan). */
export async function enrichPositionsByDebankTokenIds(positions) {
  const chainTry = ["arb", "eth", "op", "base", "matic", "bsc"];
  return Promise.all(
    (positions || []).map(async (p) => {
      if (p.rangeMin != null && p.rangeMax != null) return p;
      const tid = extractLpTokenId(p);
      if (!tid) return p;

      const order = [
        ...new Set(
          [String(p.chain || "").toLowerCase(), ...chainTry].filter((c) => CHAIN_ONCHAIN[c]),
        ),
      ];

      for (const chain of order) {
        const chainCfg = CHAIN_ONCHAIN[chain];
        const rpc = rpcForChain(chain);
        for (const nf of chainCfg.nfpm) {
          if (!(await nfpmHasCode(rpc, nf.address))) continue;
          let pos;
          try {
            pos = await readPosition(rpc, nf.address, BigInt(tid));
          } catch {
            continue;
          }
          if (!pos || pos.liquidity === 0n) continue;
          const record = await buildOnchainLpRecord(rpc, chain, nf, tid, pos);
          if (record?.rangeMin == null) continue;
          return {
            ...p,
            chain,
            poolAddress: p.poolAddress || record.poolAddress,
            rangeMin: record.rangeMin,
            rangeMax: record.rangeMax,
            rangeCurrent: record.rangeCurrent,
            rangeNums: [record.rangeMin, record.rangeCurrent, record.rangeMax],
            feeTier: p.feeTier || (record.feeTierPct != null ? `${record.feeTierPct}%` : ""),
            onchain: true,
            onchainTokenId: tid,
            tickLower: record.tickLower,
            tickUpper: record.tickUpper,
          };
        }
      }
      return p;
    }),
  );
}

/** NFT id из DeBank poolId (#5020570), positionId или hex token id. */
export function extractLpTokenId(p) {
  const raw = String(p?.positionId || p?.poolId || p?.onchainTokenId || "").trim();
  const hash = raw.match(/#(\d{4,})/);
  if (hash) return hash[1];
  const plain = raw.match(/^(\d{4,})$/);
  if (plain) return plain[1];
  if (/^0x[0-9a-f]+$/i.test(raw) && raw.length <= 18) {
    try {
      return BigInt(raw).toString();
    } catch {
      /* */
    }
  }
  return "";
}

function extractFeeKeyFromPool(p) {
  if (p.feeTierPct != null) return Math.round(Number(p.feeTierPct) * 2000);
  const src = `${p.poolId || ""} ${p.pair || ""}`;
  const m = src.match(/(\d+(?:\.\d+)?)\s*%/);
  if (m) return Math.round(parseFloat(m[1]) * 2000);
  return null;
}

function pickOnchainCandidate(cands, p, feeKey) {
  const live = cands.filter((c) => {
    try {
      return BigInt(c.liquidity || 0) > 0n;
    } catch {
      return false;
    }
  });
  const pool = live.length ? live : cands;
  if (feeKey != null) {
    const byFee = pool.find(
      (c) =>
        c.fee === feeKey ||
        (c.feeTierPct != null && Math.round(Number(c.feeTierPct) * 2000) === feeKey),
    );
    if (byFee) return byFee;
  }
  return pool[0] || null;
}

/** Обогащение позиций Revert/DeBank точными тиками. */
export function enrichPositionsWithOnchain(positions, onchainList) {
  if (!onchainList?.length) return positions || [];

  const byTokenId = new Map();
  const byPool = new Map();
  const byPairFee = new Map();
  const byPair = new Map();
  const walletTokenIds = new Set();

  for (const o of onchainList) {
    walletTokenIds.add(`${o.chain}|${o.tokenId}`);
    byTokenId.set(`${o.chain}|${o.tokenId}`, o);
    if (o.poolAddress) byPool.set(`${o.chain}|${o.poolAddress.toLowerCase()}`, o);
    byPairFee.set(`${o.chain}|${o.pairKey}|${o.fee}`, o);
    if (o.feeTierPct != null) {
      byPairFee.set(`${o.chain}|${o.pairKey}|${Math.round(o.feeTierPct * 2000)}`, o);
    }
    const pk = `${o.chain}|${o.pairKey}`;
    if (!byPair.has(pk)) byPair.set(pk, []);
    byPair.get(pk).push(o);
  }

  const used = new Set();

  return (positions || []).map((p) => {
    const chain = String(p.chain || "").toLowerCase();
    const guessId = extractLpTokenId(p);
    let poolAddr = String(p.poolAddress || "").toLowerCase();
    if (!poolAddr && /^0x[a-f0-9]{40}$/i.test(String(p.poolId || ""))) {
      poolAddr = String(p.poolId).toLowerCase();
    }
    const pairKey = p.pairKey || normPair(p.pair);
    const feeKey = extractFeeKeyFromPool(p);
    const usedKey = (o) => `${o.chain}|${o.tokenId}`;

    let hit = null;
    if (guessId && walletTokenIds.has(`${chain}|${guessId}`) && !used.has(`${chain}|${guessId}`)) {
      hit = byTokenId.get(`${chain}|${guessId}`);
    }
    if (!hit && poolAddr) hit = byPool.get(`${chain}|${poolAddr}`);
    if (!hit && feeKey != null) hit = byPairFee.get(`${chain}|${pairKey}|${feeKey}`);
    if (!hit) {
      const cands = (byPair.get(`${chain}|${pairKey}`) || []).filter((o) => !used.has(usedKey(o)));
      if (cands.length) hit = pickOnchainCandidate(cands, p, feeKey);
    }
    if (!hit && p.poolAddress) {
      const addr = String(p.poolAddress).toLowerCase();
      hit = byPool.get(`${chain}|${addr}`);
    }

    if (!hit) return p;
    used.add(usedKey(hit));

    return {
      ...p,
      rangeMin: hit.rangeMin,
      rangeMax: hit.rangeMax,
      rangeCurrent: hit.rangeCurrent,
      rangeNums: [hit.rangeMin, hit.rangeCurrent, hit.rangeMax],
      onchain: true,
      onchainTokenId: hit.tokenId,
      tickLower: hit.tickLower,
      tickUpper: hit.tickUpper,
      poolAddress: p.poolAddress || hit.poolAddress,
    };
  });
}

/** Только slot0 для пула (текущая цена), если NFT не найден. */
function isEvmAddress(addr) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(addr || ""));
}

export async function enrichPoolCurrentFromSlot0(position, rpc) {
  if (position.onchain || !isEvmAddress(position.poolAddress)) return position;
  const pool = position.poolAddress;
  try {
    const slot = await readPoolSlot0(rpc, pool);
    if (!slot) return position;
    const pairKey = position.pairKey || normPair(position.pair);
    const meta = pairMeta(pairKey);
    const d0 = meta.allStable ? 6 : 6;
    const d1 = meta.allStable ? 6 : 8;
    const p = tickToPriceRatio(slot.tick, d0, d1);
    const cur = meta.allStable ? p : invertPoolPrice(p);
    return {
      ...position,
      rangeCurrent: cur,
      onchainSlot0: true,
    };
  } catch {
    return position;
  }
}

function protocolToRevertExchange(protocol) {
  const p = String(protocol || "").toLowerCase();
  if (p.includes("uniswap v4")) return "uniswapv4";
  if (p.includes("uniswap")) return "uniswapv3";
  if (p.includes("aerodrome")) return "aerodrome";
  if (p.includes("pancake")) return "pancakeswapv3";
  return p.replace(/\s+/g, "") || "uniswapv3";
}

/** Если Revert пуст — отдаём хотя бы ончейн-диапазоны для UI. */
function onchainRowsAsRevertPositions(onchainList) {
  return (onchainList || []).map((o) => ({
    pair: o.pair,
    pairKey: o.pairKey,
    chain: o.chain,
    network: o.chain,
    exchange: protocolToRevertExchange(o.protocol),
    poolAddress: o.poolAddress,
    positionId: o.tokenId || o.poolAddress,
    feeTierPct: o.feeTierPct,
    feeTier: o.feeTierPct != null ? `${o.feeTierPct}%` : "",
    pooledUsd: 0,
    totalPnlUsd: 0,
    uncollectedUsd: 0,
    rangeMin: o.rangeMin,
    rangeMax: o.rangeMax,
    rangeCurrent: o.rangeCurrent,
    rangeNums: [o.rangeMin, o.rangeCurrent, o.rangeMax].filter((x) => x != null),
    onchainOnly: true,
    detailUrl: o.poolAddress
      ? `https://revert.finance/#/account/${o.chain || "base"}/${o.poolAddress}`
      : "",
  }));
}

export async function scanAndEnrich(wallet, positions, chains) {
  const scanChains = chains?.length ? chains : REGISTRY_SCAN;
  const onchain = await scanWalletLpOnchain(wallet, scanChains);
  let enriched = enrichPositionsWithOnchain(positions, onchain);
  enriched = await enrichPositionsByDebankTokenIds(enriched);
  if (!enriched.length && onchain.length) {
    enriched = onchainRowsAsRevertPositions(onchain);
  }

  enriched = await Promise.all(
    enriched.map(async (p) => {
      if (p.onchain) return p;
      if (!p.poolAddress) return p;
      const rpc = rpcForChain(p.chain);
      return enrichPoolCurrentFromSlot0(p, rpc);
    }),
  );

  return { positions: enriched, onchain, count: onchain.length };
}
