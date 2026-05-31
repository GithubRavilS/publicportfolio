#!/usr/bin/env node
/** Топ пробелов по TVL из data/llama-universe.json */
import { loadLlamaUniverse, gapProtocols } from "../js/llama-universe.js";

const u = loadLlamaUniverse();
if (!u) {
  console.error("Run: npm run build:llama");
  process.exit(1);
}
console.log("Stats:", u.stats);
console.log("\nTop 25 gaps (need adapter):\n");
for (const p of gapProtocols(25)) {
  console.log(
    `$${(p.tvlUsd / 1e6).toFixed(0)}M`.padStart(8),
    p.adapter.padEnd(14),
    p.slug.padEnd(28),
    p.name,
  );
}
