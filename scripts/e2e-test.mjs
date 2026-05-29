#!/usr/bin/env node
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.PT_BASE || "http://127.0.0.1:5500";
const WALLET = process.env.PT_WALLET || "0xE6C9B6407676432a95cE23fd414021ED31fC0566";

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

async function main() {
  const health = await fetch(`${BASE}/api/health`, { cache: "no-store" });
  if (!health.ok) fail(`health HTTP ${health.status}`);
  const hd = await health.json();
  if (!hd.ok || hd.app !== "portfolio-tracker") {
    fail("wrong server on port. Run Запуск.command");
  }

  const t0 = Date.now();
  const r = await fetch(
    `${BASE}/api/portfolio?wallet=${encodeURIComponent(WALLET)}&_=${Date.now()}`,
    { cache: "no-store" },
  );
  const data = await r.json().catch(() => fail("portfolio response is not JSON"));
  if (!r.ok || !data.ok || !data.portfolio) {
    fail(`portfolio failed: ${data.error || r.status}`);
  }
  const p = data.portfolio;
  const ms = Date.now() - t0;
  const n = (p.lending?.length || 0) + (p.liquidity?.length || 0) + (p.walletTokens?.length || 0);
  if (!n && !(p.totalUsd > 0)) fail("empty portfolio");

  console.log(
    JSON.stringify(
      {
        ok: true,
        ms,
        totalUsd: p.totalUsd,
        lending: p.lending?.length,
        liquidity: p.liquidity?.length,
        wallet: p.walletTokens?.length,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => fail(e.message));
