#!/usr/bin/env node
/** Удалить устаревший onchain-portfolio cache на PA (после llama/etherscan фиксов). */
import { loadPaEnv, paFetch } from "./pa-env.mjs";

const cfg = loadPaEnv();
const dir = `${cfg.projectDir}/.cache/onchain-portfolio`;
const listing = await paFetch(cfg, `/files/path${dir}/`);
const files = Object.keys(listing || {}).filter((f) => f.endsWith(".json"));
for (const name of files) {
  await paFetch(cfg, `/files/path${dir}/${name}`, { method: "DELETE" });
  console.log("deleted", name);
}
console.log(`OK: ${files.length} onchain cache files removed`);
