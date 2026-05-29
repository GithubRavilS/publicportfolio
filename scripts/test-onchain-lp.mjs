#!/usr/bin/env node
/** node scripts/test-onchain-lp.mjs 0xWallet */
import { readFileSync, existsSync } from "fs";
import { spawnSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const wallet = (process.argv[2] || "").trim();
if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
  console.error("Usage: node scripts/test-onchain-lp.mjs 0xWallet");
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cache = resolve(root, ".cache/revert", `${wallet.toLowerCase()}.json`);
const positions = existsSync(cache) ? JSON.parse(readFileSync(cache, "utf8")).positions : [];

const r = spawnSync("node", ["scripts/run-lp-onchain.mjs", wallet], {
  input: JSON.stringify({ positions }),
  cwd: root,
  encoding: "utf8",
  maxBuffer: 20e6,
});
if (r.status !== 0) {
  console.error(r.stderr || r.stdout);
  process.exit(1);
}
const out = JSON.parse(r.stdout);
console.log("On-chain LP positions:", out.count);
for (const p of out.onchain || []) {
  console.log(
    `  ${p.protocol} ${p.chain} ${p.pairKey} #${p.tokenId}`,
    Math.round(p.rangeMin),
    Math.round(p.rangeCurrent),
    Math.round(p.rangeMax),
  );
}
const enriched = (out.positions || []).filter((p) => p.onchain);
console.log("Enriched revert rows:", enriched.length);
