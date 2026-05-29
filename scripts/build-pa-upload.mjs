#!/usr/bin/env node
/**
 * Build deploy/pa-upload.zip for PythonAnywhere (no versioned folder copies in git).
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "..");
const OUT = resolve(ROOT, "deploy/pa-upload");
const ZIP = resolve(ROOT, "deploy/pa-upload.zip");

const VER = (() => {
  const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
  const m = html.match(/styles\.css\?v=(\d+)/);
  return m?.[1] ?? "0";
})();

function run(cmd) {
  const r = spawnSync(cmd, { shell: true, cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.log(`== build-pa-upload v${VER} ==`);
run("npm run bundle");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const name of [
  "index.html",
  "server.py",
  "wsgi.py",
  "requirements.txt",
  "config.example.json",
]) {
  cpSync(resolve(ROOT, name), resolve(OUT, name));
}

for (const dir of ["css", "js", "scripts"]) {
  cpSync(resolve(ROOT, dir), resolve(OUT, dir), { recursive: true });
}

writeFileSync(
  resolve(OUT, "ЗАЛИВКА.txt"),
  `Portfolio Tracker v${VER}
==========================================
https://cry-maden008.pythonanywhere.com/portfolio/?v=${VER}

unzip -o pa-upload.zip && cp -rf pa-upload/* . && rm -rf pa-upload

ОБЯЗАТЕЛЬНО: config.json на PA (не перезаписывать при заливке):
  debank_scraperapi_key, rpc_urls (eth/arb/op)

Web → Reload. Cmd+Shift+R
`,
);

rmSync(ZIP, { force: true });
run(`cd deploy && zip -rq pa-upload.zip pa-upload`);

console.log(`OK: ${ZIP}`);
