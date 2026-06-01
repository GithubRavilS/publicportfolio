#!/usr/bin/env node
/** stdout: { ok, portfolio } — только RPC, fast LP по умолчанию */
import { buildRpcPortfolio } from "../js/rpc-portfolio.js";

const wallet = (process.argv[2] || "").trim();
if (!/^0x[a-fA-F0-9]{40}$/i.test(wallet)) {
  process.stderr.write("Usage: node scripts/run-rpc-portfolio.mjs 0xWallet\n");
  process.exit(1);
}

const pancakeOnly = process.env.PT_PANCAKE_ONLY !== "0";
const lpOnly = process.env.PT_RPC_LP_ONLY === "1";
const portfolio = await buildRpcPortfolio(wallet, {
  pancakeOnly,
  lpOnly,
  fastLp: process.env.PT_FAST_LP !== "0",
  rpcOnlyWallet: process.env.PT_RPC_ONLY_WALLET !== "0",
});
process.stdout.write(JSON.stringify({ ok: true, portfolio }));
