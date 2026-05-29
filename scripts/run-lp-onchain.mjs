#!/usr/bin/env node
/**
 * Ончейн LP: stdin — JSON { positions?: [] }, argv[2] — wallet.
 * stdout: { ok, positions, onchain, count }
 */
import { scanAndEnrich } from "../js/lp-onchain.js";

const wallet = (process.argv[2] || "").trim();
if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
  process.stderr.write("INVALID_WALLET\n");
  process.exit(1);
}

let input = { positions: [] };
try {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw) input = JSON.parse(raw);
} catch {
  /* empty stdin ok */
}

const chains = process.argv[3] ? process.argv[3].split(",") : undefined;
const result = await scanAndEnrich(wallet, input.positions || [], chains);
process.stdout.write(
  JSON.stringify({
    ok: true,
    wallet: wallet.toLowerCase(),
    positions: result.positions,
    onchain: result.onchain,
    count: result.count,
  }),
);
