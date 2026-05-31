#!/usr/bin/env node
/**
 * Собирает топ-100 lending / dex / other с DeFiLlama и помечает покрытие нашими адаптерами.
 * node scripts/build-llama-universe.mjs
 */
import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  adapterForSlug,
  loadAdapterRegistry,
  getLlamaMassSlugs,
  getImplementedSlugs,
} from "../js/protocol-adapters.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, "../data/llama-universe.json");

const LENDING_RE = /lend|borrow|cdp|liquid staking|staking|restaking|bridge/i;
const DEX_RE = /dex|amm|swap|perp|orderbook/i;
const SKIP_RE = /CEX|Bridge Aggregator|Chain\b|Canonical Bridge/i;

function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function pickTop(list, n = 100) {
  return list
    .filter((x) => (x.tvl || 0) > 0 && !SKIP_RE.test(x.category || ""))
    .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
    .slice(0, n)
    .map((x) => ({
      name: x.name,
      slug: x.slug || slugify(x.name),
      tvlUsd: Math.round(x.tvl || 0),
      category: x.category || "",
      chains: x.chains || [],
      adapter: adapterForSlug(x.slug || slugify(x.name)),
      implemented:
        getLlamaMassSlugs().has(x.slug || slugify(x.name)) ||
        adapterForSlug(x.slug || slugify(x.name)) !== "gap",
    }));
}

async function fetchJson(url, ms = 120000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
    return r.json();
  } finally {
    clearTimeout(t);
  }
}

const protocols = await fetchJson("https://api.llama.fi/protocols");
const all = protocols.filter((p) => (p.tvl || 0) > 0);

const lending = pickTop(all.filter((p) => LENDING_RE.test(`${p.category} ${p.name}`)));
const dex = pickTop(all.filter((p) => DEX_RE.test(`${p.category} ${p.name}`)));

const used = new Set([...lending, ...dex].map((x) => x.slug));
const other = pickTop(
  all.filter((p) => {
    const s = p.slug || slugify(p.name);
    return !used.has(s);
  }),
);

const implementedTvl = all
  .filter((p) => getImplementedSlugs().has(p.slug || slugify(p.name)))
  .reduce((s, p) => s + (p.tvl || 0), 0);
const top300Tvl = [...lending, ...dex, ...other].reduce((s, p) => s + p.tvlUsd, 0);
const coveredInTop = [...lending, ...dex, ...other].filter((p) => p.implemented).reduce((s, p) => s + p.tvlUsd, 0);

const out = {
  builtAt: new Date().toISOString(),
  stats: {
    totalProtocols: all.length,
    lending: lending.length,
    dex: dex.length,
    other: other.length,
    implementedSlugs: getLlamaMassSlugs().size,
    massAdapters: loadAdapterRegistry()?.adapterCount || 0,
    top300TvlUsd: top300Tvl,
    coveredTvlInTop300Usd: coveredInTop,
    coveragePctTop300: top300Tvl > 0 ? Math.round((coveredInTop / top300Tvl) * 1000) / 10 : 0,
    globalImplementedTvlUsd: Math.round(implementedTvl),
  },
  lending,
  dex,
  other,
  gaps: {
    lending: lending.filter((x) => !x.implemented && x.adapter === "gap"),
    dex: dex.filter((x) => !x.implemented && x.adapter === "gap"),
    other: other.filter((x) => !x.implemented && x.adapter === "gap"),
  },
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`Wrote ${OUT}`);
console.log(JSON.stringify(out.stats, null, 2));
