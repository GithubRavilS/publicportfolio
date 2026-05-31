/**
 * Батч balanceOf — параллельные eth_call (стабильно на публичных RPC).
 */
import { rpcForChain, padAddr } from "./onchain-rpc.js";

const SEL_BALANCE_OF = "0x70a08231";

/**
 * @param {string} chain
 * @param {string} wallet
 * @param {string[]} tokenAddresses
 * @param {number} batchSize
 * @returns {Promise<Map<string, bigint>>}
 */
export async function multicallBalances(chain, wallet, tokenAddresses, batchSize = 48) {
  if (!tokenAddresses.length) return new Map();

  const rpc = rpcForChain(chain);
  const w = padAddr(wallet);
  const uniq = [...new Set(tokenAddresses.map((a) => a.toLowerCase()))];
  const balances = new Map();

  for (let i = 0; i < uniq.length; i += batchSize) {
    const chunk = uniq.slice(i, i + batchSize);
    await Promise.all(
      chunk.map(async (token) => {
        try {
          const raw = await rpc.ethCall(token, SEL_BALANCE_OF + w);
          const val = BigInt(raw || 0);
          if (val > 0n) balances.set(token, val);
        } catch {
          /* */
        }
      }),
    );
  }
  return balances;
}
