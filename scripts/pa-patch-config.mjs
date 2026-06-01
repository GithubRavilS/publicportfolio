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

function alchemyUrls(key) {
  const k = String(key || "").trim();
  if (!k) return null;
  return {
    eth: `https://eth-mainnet.g.alchemy.com/v2/${k}`,
    arb: `https://arb-mainnet.g.alchemy.com/v2/${k}`,
    op: `https://opt-mainnet.g.alchemy.com/v2/${k}`,
    matic: `https://polygon-mainnet.g.alchemy.com/v2/${k}`,
    // Base RPC getLogs: publicnode (Alchemy Portfolio API uses api.g.alchemy.com separately)
    base: "https://base-rpc.publicnode.com",
  };
}

const PATCH = {
  etherscan_api_key: process.env.ETHERSCAN_API_KEY || "",
  alchemy_api_key: process.env.ALCHEMY_API_KEY || "",
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
  if (!PATCH.alchemy_api_key) {
    PATCH.alchemy_api_key = local.alchemy_api_key || "";
  }
  if (!PATCH.etherscan_api_key && !PATCH.alchemy_api_key) {
    console.error(
      "Need at least one: etherscan_api_key or alchemy_api_key in config.json / env",
    );
    process.exit(1);
  }

  const remote = await readRemoteConfig(cfg);
  const merged = { ...remote };
  if (PATCH.etherscan_api_key) merged.etherscan_api_key = PATCH.etherscan_api_key;
  if (PATCH.alchemy_api_key) {
    merged.alchemy_api_key = PATCH.alchemy_api_key;
    const urls = alchemyUrls(PATCH.alchemy_api_key);
    merged.rpc_urls = { ...(remote.rpc_urls || {}), ...(local.rpc_urls || {}), ...urls };
  } else if (!merged.rpc_urls?.eth) {
    merged.rpc_urls = { ...local.rpc_urls, ...(remote.rpc_urls || {}) };
  }
  await writeRemoteConfig(cfg, merged);
  const parts = [];
  if (PATCH.etherscan_api_key) parts.push("etherscan");
  if (PATCH.alchemy_api_key) parts.push("alchemy");
  console.log(`OK: PA config.json patched (${parts.join(" + ")})`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
