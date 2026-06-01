/**
 * Точечный on-chain скан одного протокола (без DeBank scrape).
 */
import { scanLpPositions } from "../onchain-lp.js";
import { scanAaveLending } from "../onchain-lending.js";
import { scanCompoundV3 } from "../onchain-compound.js";
import { scanFluidLending } from "../onchain-fluid.js";
import { getProtocol } from "./registry.js";

function matchProtocolName(protocol, patterns) {
  const n = String(protocol || "");
  return patterns.some((re) => re.test(n));
}

/**
 * @param {string} protocolId
 * @param {string} wallet
 * @param {{ chains?: string[] }} [opts]
 */
export async function scanProtocolPositions(protocolId, wallet, opts = {}) {
  const def = getProtocol(protocolId);
  const chains = opts.chains || def.chains || ["eth", "base", "arb", "op", "matic"];

  switch (protocolId) {
    case "uniswap-v3":
    case "aerodrome-v3":
    case "pancakeswap-v3": {
      const all = await scanLpPositions(wallet, chains, { fast: true });
      return all.filter((p) => matchProtocolName(p.protocol, def.debankPatterns));
    }
    case "aave-v3": {
      const all = await scanAaveLending(wallet, chains);
      return all.filter((p) => matchProtocolName(p.protocol, def.debankPatterns));
    }
    case "compound-v3":
      return scanCompoundV3(wallet, chains);
    case "fluid":
      return scanFluidLending(wallet, chains);
    default:
      throw new Error(`SCAN_NOT_IMPLEMENTED:${protocolId}`);
  }
}
