#!/usr/bin/env node
/**
 * Merge keys into PA config.json without wiping existing secrets.
 * Usage: node scripts/pa-patch-config.mjs
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadPaEnv, paFetch } from "./pa-env.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "..");

const PATCH = {
  etherscan_api_key: process.env.ETHERSCAN_API_KEY || "",
};

async function readRemoteConfig(cfg) {
  const path = `/files/path${cfg.projectDir}/config.json`;
  const url = `https://${cfg.host}/api/v0/user/${cfg.username}${path}`;
  const res = await fetch(url, { headers: { Authorization: `Token ${cfg.token}` } });
  if (!res.ok) throw new Error(`read config ${res.status}`);
  return JSON.parse(await res.text());
}

async function writeRemoteConfig(cfg, data) {
  const remote = `${cfg.projectDir}/config.json`;
  const apiPath = `/files/path${remote}`;
  const form = new FormData();
  form.append("content", new Blob([JSON.stringify(data, null, 2)]), "config.json");
  await paFetch(cfg, apiPath, { method: "POST", body: form });
}

async function main() {
  const cfg = loadPaEnv();
  const localPath = resolve(ROOT, "config.json");
  let local = {};
  try {
    local = JSON.parse(readFileSync(localPath, "utf8"));
  } catch {
    /* */
  }

  if (!PATCH.etherscan_api_key) {
    PATCH.etherscan_api_key = local.etherscan_api_key || "";
  }
  if (!PATCH.etherscan_api_key) {
    console.error("No etherscan_api_key in config.json or ETHERSCAN_API_KEY");
    process.exit(1);
  }

  const remote = await readRemoteConfig(cfg);
  const merged = { ...remote, ...PATCH };
  if (!merged.rpc_urls?.eth) {
    merged.rpc_urls = { ...local.rpc_urls, ...(remote.rpc_urls || {}) };
  }
  await writeRemoteConfig(cfg, merged);
  console.log("OK: config.json patched on PA (etherscan_api_key set, rpc preserved)");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
