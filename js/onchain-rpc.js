import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { CHAINS } from "./onchain-registry.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "..");

let rpcConfig = null;

export function loadConfig() {
  if (rpcConfig) return rpcConfig;
  rpcConfig = { rpc_urls: {}, etherscan_keys: {}, alchemy_api_key: "" };
  const path = resolve(ROOT, "config.json");
  if (!existsSync(path)) return rpcConfig;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    rpcConfig.rpc_urls = raw.rpc_urls || {};
    rpcConfig.alchemy_api_key = raw.alchemy_api_key || "";
    const defaultKey = raw.etherscan_api_key || raw.etherscan_api_keys || "";
    rpcConfig.etherscan_api_key = defaultKey;
    rpcConfig.etherscan_keys = defaultKey
      ? { default: defaultKey, ...(raw.etherscan_keys || {}) }
      : { ...(raw.etherscan_keys || {}) };
  } catch {
    /* */
  }
  return rpcConfig;
}

export function normalizeAddress(addr) {
  const s = String(addr || "").toLowerCase();
  const m = s.match(/^(0x)?([a-f0-9]{40})$/);
  if (!m) return null;
  return `0x${m[2]}`;
}

export function padAddr(addr) {
  const a = normalizeAddress(addr);
  if (!a) throw new Error("INVALID_ADDRESS");
  return a.slice(2).padStart(64, "0");
}

export function encodeAddress(addr) {
  return padAddr(addr);
}

export function encodeUint256(n) {
  return BigInt(n).toString(16).padStart(64, "0");
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
    const a = normalizeAddress(addr);
    if (!a) return false;
    try {
      const code = await this.call("eth_getCode", [a, "latest"]);
      return code && code.length > 2;
    } catch {
      return false;
    }
  }

  async blockNumber() {
    return BigInt(await this.call("eth_blockNumber", []));
  }

  async nativeBalance(wallet) {
    const raw = await this.call("eth_getBalance", [wallet, "latest"]);
    return BigInt(raw || 0);
  }
}

export function rpcUrlsForChain(chain) {
  const cfg = loadConfig();
  const slug = String(chain || "").toLowerCase();
  const custom = cfg.rpc_urls?.[slug];
  const defaults = CHAINS[slug]?.rpc || [];
  const urls = [...(Array.isArray(custom) ? custom : custom ? [custom] : []), ...defaults];
  return [...new Set(urls.filter(Boolean))];
}

export function rpcForChain(chain) {
  return new RpcClient(rpcUrlsForChain(chain));
}

const LOG_CHUNK_BLOCKS = 9_999n;

function blockHex(n) {
  if (n == null || n < 0n) return "0x0";
  return `0x${n.toString(16)}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** eth_getLogs с перебором RPC; чанки ≤10k (лимит publicnode/drpc/base.org). */
export async function getLogsRotate(chain, filter) {
  const urls = rpcUrlsForChain(chain);
  let lastErr;
  for (const url of urls) {
    const rpc = new RpcClient([url]);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return (await rpc.call("eth_getLogs", [filter])) || [];
      } catch (e) {
        lastErr = e;
        if (attempt === 0) await sleep(120);
      }
    }
  }
  throw lastErr || new Error("GET_LOGS_FAILED");
}

/**
 * @param {string} chain
 * @param {{ address: string, topics: (string|null)[] }} spec
 * @param {bigint} lookback blocks from head
 */
export async function scanLogsBack(chain, spec, lookback) {
  const rpc = rpcForChain(chain);
  let latest;
  try {
    latest = await rpc.blockNumber();
  } catch {
    return [];
  }
  const minBlock = latest > lookback ? latest - lookback : 0n;
  const chunkSizes = [LOG_CHUNK_BLOCKS, 4_999n, 2_000n];
  const logs = [];
  let to = latest;
  while (to > minBlock) {
    let from = to > LOG_CHUNK_BLOCKS ? to - LOG_CHUNK_BLOCKS : minBlock;
    if (from < minBlock) from = minBlock;
    if (from >= to) break;
    let part = null;
    for (const chunk of chunkSizes) {
      let f = to > chunk ? to - chunk : minBlock;
      if (f < minBlock) f = minBlock;
      if (f >= to) continue;
      try {
        part = await getLogsRotate(chain, {
          fromBlock: blockHex(f),
          toBlock: blockHex(to),
          address: spec.address,
          topics: spec.topics,
        });
        from = f;
        break;
      } catch {
        /* try smaller chunk */
      }
    }
    if (part?.length) logs.push(...part);
    if (from <= minBlock) break;
    to = from - 1n;
  }
  return logs;
}

/** eth_call с перебором публичных RPC (без API-ключей). */
export async function ethCallRotate(chain, to, data) {
  const urls = rpcUrlsForChain(chain);
  let last;
  for (const url of urls) {
    const rpc = new RpcClient([url]);
    try {
      const raw = await rpc.ethCall(to, data);
      if (raw && raw !== "0x") return raw;
      last = raw;
    } catch (e) {
      last = e;
    }
  }
  if (last instanceof Error) throw last;
  return last || "0x";
}

export function etherscanKey(chain) {
  const cfg = loadConfig();
  return cfg.etherscan_api_key || cfg.etherscan_keys?.[chain] || cfg.etherscan_keys?.default || "";
}
