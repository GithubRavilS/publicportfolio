#!/usr/bin/env node
/**
 * Deploy to PythonAnywhere via Files API + webapp reload.
 * Requires .env.pa with PA_API_TOKEN (see .env.pa.example).
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { spawnSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadPaEnv, paFetch, reloadWebapp } from "./pa-env.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "..");
const UPLOAD = resolve(ROOT, "deploy/pa-upload");

function walk(dir, base = dir) {
  /** @type {{ rel: string, abs: string }[]} */
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...walk(abs, base));
    else out.push({ rel: relative(base, abs).replace(/\\/g, "/"), abs });
  }
  return out;
}

async function uploadFile(cfg, relPath, absPath) {
  const remote = `${cfg.projectDir}/${relPath}`;
  const apiPath = `/files/path${remote}`;
  const form = new FormData();
  form.append("content", new Blob([readFileSync(absPath)]), relPath);
  await paFetch(cfg, apiPath, { method: "POST", body: form });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const cfg = loadPaEnv();

  console.log("== build pa-upload ==");
  const build = spawnSync("npm run deploy:pa", { shell: true, cwd: ROOT, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);

  const files = walk(UPLOAD);
  console.log(`== upload ${files.length} files → ${cfg.projectDir} ==`);

  let n = 0;
  for (const { rel, abs } of files) {
    n += 1;
    process.stdout.write(`  [${n}/${files.length}] ${rel}\n`);
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        await uploadFile(cfg, rel, abs);
        break;
      } catch (err) {
        if (attempt === 5 || !String(err.message).includes("429")) throw err;
        const wait = 5000 * attempt;
        process.stdout.write(`    throttled, wait ${wait / 1000}s…\n`);
        await sleep(wait);
      }
    }
    await sleep(1600);
  }

  console.log("== reload webapp ==");
  await reloadWebapp(cfg);

  const health = await fetch(`https://${cfg.domain}/portfolio/api/diag`);
  const diag = await health.json();
  console.log("== done ==", diag);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
