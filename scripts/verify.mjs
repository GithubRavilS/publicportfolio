#!/usr/bin/env node
/**
 * Локальная/CI проверка: lint (nano-staged), bundle app.js, smoke portfolio pipeline, ruff server.py.
 * PT_SKIP_NETWORK=1 — без compare-debank (для CI без API).
 */
import { execSync, spawnSync } from "child_process";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "..");

function run(cmd, opts = {}) {
  const r = spawnSync(cmd, {
    shell: true,
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...opts.env },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.log("== verify: oxlint (js) ==");
run("npx oxlint js/*.js js/**/*.js scripts/*.mjs --ignore-pattern js/app.bundle.js");

console.log("== verify: esbuild bundle ==");
run("npx --yes esbuild@0.25.5 js/app.js --bundle --format=esm --outfile=js/app.bundle.js");

console.log("== verify: portfolio pipeline smoke ==");
await import("../js/portfolio-pipeline.js");
await import("../js/portfolio-normalize.js");

console.log("== verify: ruff server.py ==");
if (spawnSync("command -v ruff", { shell: true }).status === 0) {
  run("ruff check server.py wsgi.py");
  run("ruff format --check server.py wsgi.py");
}

if (process.env.PT_SKIP_NETWORK !== "1") {
  console.log("== verify: compare-debank (optional, needs PT_BASE) ==");
  const base = process.env.PT_BASE || "http://127.0.0.1:5500";
  const probe = spawnSync(`curl -sf --max-time 8 "${base}/api/health" >/dev/null 2>&1`, {
    shell: true,
  });
  if (probe.status === 0) {
    run(`PT_BASE="${base}" PT_TIMEOUT_MS=120000 node scripts/compare-debank-10.mjs`, {
      env: { PT_BASE: base },
    });
  } else {
    console.warn(`skip compare-debank (no API at ${base}, set PT_BASE)`);
  }
}

console.log("verify OK");
