import { fetchDebankBundle } from "./debank.js";
import { fetchKrystalPositions } from "./krystal.js";
import { fetchJupiterHoldings } from "./jupiter.js";
import { buildAggregatePayload, isEvmAddress, isLikelySolana } from "./normalize.js";

export async function aggregateWallet(wallet, keys) {
  const w = wallet.trim();
  const evm = isEvmAddress(w);
  const sol = isLikelySolana(w);

  const parts = {};

  if (evm && keys.debank) {
    const b = await fetchDebankBundle(w, keys.debank);
    parts.debank = {
      totalBalance: b.totalBalance,
      complexList: b.complexList,
      tokenList: b.tokenList,
      netCurve: b.netCurve,
    };
  }

  if (evm && keys.krystal) {
    const [open, closed] = await Promise.all([
      fetchKrystalPositions(keys.krystal, w, "OPEN").catch(() => []),
      fetchKrystalPositions(keys.krystal, w, "CLOSED").catch(() => []),
    ]);
    parts.krystalOpen = open;
    parts.krystalClosed = closed;
  }

  if (sol && keys.jupiter) {
    parts.jupiter = await fetchJupiterHoldings(w, keys.jupiter);
  }

  return buildAggregatePayload(w, parts);
}
