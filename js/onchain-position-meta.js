/**
 * Время открытия позиции и собранные комиссии (Collect) — только RPC.
 */
import { padAddr, encodeUint256 } from "./onchain-rpc.js";
import { loadPositionStore, savePositionStore, positionStoreKey } from "./lp-position-store.js";

const ERC721_TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f55a4df523b3ef";
const COLLECT_TOPIC = "0xd8c680f16c3c58610b082450f53fcafa5cc6c333dc61b0bce4ec151aa744e7fe";

const mintCache = new Map();
const FAST = process.env.PT_FAST === "1";
const LOG_CHUNK = 120000n;
const LOG_MAX_BACK = 600000n;

function tokenIdTopic(tokenId) {
  return encodeUint256(tokenId);
}

export async function getPositionMintBlock(rpc, nfpm, tokenId, wallet, protocol, chain) {
  const key = `${nfpm}:${tokenId}`;
  if (mintCache.has(key)) return mintCache.get(key);
  if (FAST) return null;

  if (wallet && protocol && chain) {
    const store = loadPositionStore(wallet);
    const sk = positionStoreKey(protocol, chain, tokenId);
    if (store.positions[sk]?.mintBlock != null) {
      mintCache.set(key, BigInt(store.positions[sk].mintBlock));
      return mintCache.get(key);
    }
  }

  let latest;
  try {
    latest = await rpc.blockNumber();
  } catch {
    return null;
  }

  const tidTopic = tokenIdTopic(tokenId);
  const zero = "0x" + "0".repeat(64);
  let mintBlock = null;
  const chunk = LOG_CHUNK;
  let to = latest;
  const maxBack = LOG_MAX_BACK;

  while (to > 0n && latest - to < maxBack) {
    const from = to > chunk ? to - chunk : 0n;
    try {
      const logs = await rpc.call("eth_getLogs", [
        {
          fromBlock: "0x" + from.toString(16),
          toBlock: "0x" + to.toString(16),
          address: nfpm,
          topics: [ERC721_TRANSFER, zero, null, tidTopic],
        },
      ]);
      for (const log of logs || []) {
        const bn = BigInt(log.blockNumber);
        if (mintBlock === null || bn < mintBlock) mintBlock = bn;
      }
    } catch {
      /* */
    }
    if (mintBlock != null) break;
    to = from > 0n ? from - 1n : 0n;
  }

  mintCache.set(key, mintBlock);
  if (wallet && protocol && chain && mintBlock != null) {
    const store = loadPositionStore(wallet);
    const sk = positionStoreKey(protocol, chain, tokenId);
    store.positions[sk] = { ...(store.positions[sk] || {}), mintBlock: mintBlock.toString() };
    savePositionStore(wallet, store);
  }
  return mintBlock;
}

export async function getBlockTimestamp(rpc, blockNum) {
  try {
    const b = await rpc.call("eth_getBlockByNumber", ["0x" + BigInt(blockNum).toString(16), false]);
    return b?.timestamp ? Number.parseInt(b.timestamp, 16) * 1000 : null;
  } catch {
    return null;
  }
}

export async function sumCollectedFees(
  rpc,
  nfpm,
  tokenId,
  decimals0,
  decimals1,
  wallet,
  protocol,
  chain,
) {
  if (FAST) return { amount0: 0, amount1: 0 };

  if (wallet && protocol && chain) {
    const store = loadPositionStore(wallet);
    const sk = positionStoreKey(protocol, chain, tokenId);
    const c = store.positions[sk]?.collected;
    if (c) return { amount0: c.amount0 || 0, amount1: c.amount1 || 0 };
  }

  let latest;
  try {
    latest = await rpc.blockNumber();
  } catch {
    return { amount0: 0, amount1: 0 };
  }

  const tidTopic = tokenIdTopic(tokenId);
  let total0 = 0n;
  let total1 = 0n;
  const chunk = LOG_CHUNK;
  let to = latest;
  const maxBack = LOG_MAX_BACK;

  while (to > 0n && latest - to < maxBack) {
    const from = to > chunk ? to - chunk : 0n;
    try {
      const logs = await rpc.call("eth_getLogs", [
        {
          fromBlock: "0x" + from.toString(16),
          toBlock: "0x" + to.toString(16),
          address: nfpm,
          topics: [COLLECT_TOPIC, tidTopic],
        },
      ]);
      for (const log of logs || []) {
        const data = log.data?.replace(/^0x/, "") || "";
        if (data.length < 128) continue;
        total0 += BigInt("0x" + data.slice(0, 64));
        total1 += BigInt("0x" + data.slice(64, 128));
      }
    } catch {
      /* */
    }
    to = from > 0n ? from - 1n : 0n;
  }

  const out = {
    amount0: Number(total0) / 10 ** decimals0,
    amount1: Number(total1) / 10 ** decimals1,
  };
  if (wallet && protocol && chain) {
    const store = loadPositionStore(wallet);
    const sk = positionStoreKey(protocol, chain, tokenId);
    store.positions[sk] = { ...(store.positions[sk] || {}), collected: out };
    savePositionStore(wallet, store);
  }
  return out;
}
