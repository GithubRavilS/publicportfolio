/** Загрузка через локальный прокси (server.py) */

import { indexProtocolsOnChainPage } from "./debank-parse.js?v=8";
import { slugFromHeaderName } from "./chains.js?v=8";

const CACHE_VER = "v3";
const CACHE_TTL_MS = 120_000;

function cacheKey(wallet, chain) {
  return `pt:${CACHE_VER}:${wallet.toLowerCase()}:${chain || "all"}`;
}

function isValidProfileText(text) {
  if (!text || text.length < 400) return false;
  if (text.includes("Markdown Content:") || text.startsWith("Title: DeBank")) return false;
  return /lending|liquidity pool|wallet/i.test(text);
}

export function clearPortfolioCache(wallet) {
  try {
    const w = wallet?.toLowerCase();
    const keys = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith("pt:") && (!w || k.includes(w))) keys.push(k);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* */
  }
}

function readCache(wallet, chain) {
  try {
    const raw = sessionStorage.getItem(cacheKey(wallet, chain));
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (Date.now() - o.t > CACHE_TTL_MS) return null;
    if (!isValidProfileText(o.text)) {
      sessionStorage.removeItem(cacheKey(wallet, chain));
      return null;
    }
    return o.text;
  } catch {
    return null;
  }
}

function writeCache(wallet, chain, text) {
  if (!isValidProfileText(text)) return;
  try {
    sessionStorage.setItem(cacheKey(wallet, chain), JSON.stringify({ t: Date.now(), text }));
  } catch {
    /* */
  }
}

export async function checkApiReady() {
  try {
    const r = await fetch("/api/health", { cache: "no-store" });
    if (!r.ok) return false;
    const d = await r.json().catch(() => ({}));
    return d.ok === true && d.app === "portfolio-tracker";
  } catch {
    return false;
  }
}

export async function waitForApi(maxMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (await checkApiReady()) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/** Если открыли не тот порт — перейти на 5500 */
export function redirectToAppPort() {
  const port = String(window.location.port || "");
  if (port === "5500" || window.location.protocol === "file:") return false;
  if (window.location.hostname !== "127.0.0.1" && window.location.hostname !== "localhost") {
    return false;
  }
  const u = new URL(window.location.href);
  u.port = "5500";
  if (!u.pathname.endsWith("index.html")) u.pathname = "/index.html";
  window.location.replace(u.toString());
  return true;
}

async function fetchProfilePage(wallet, chain, signal) {
  const cached = readCache(wallet, chain);
  if (cached) return cached;

  let lastErr = "FETCH_FAILED";
  for (let attempt = 0; attempt < 3; attempt++) {
    const q = new URLSearchParams({ wallet });
    if (chain) q.set("chain", chain);
    q.set("_", String(Date.now()) + attempt);
    let r;
    try {
      r = await fetch(`/api/profile?${q.toString()}`, { signal, cache: "no-store" });
    } catch (e) {
      if (e?.name === "AbortError") throw e;
      lastErr = "FETCH_FAILED";
      await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
      continue;
    }
    let data = {};
    try {
      data = await r.json();
    } catch {
      lastErr = "NO_API";
      break;
    }
    if (r.ok && data.ok && data.text) {
      writeCache(wallet, chain, data.text);
      return data.text;
    }
    lastErr = data.error || "FETCH_FAILED";
    if (lastErr === "INVALID_WALLET") throw new Error("INVALID_WALLET");
    if (attempt < 2) await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)));
  }
  throw new Error(lastErr === "NO_API" ? "NO_API" : "FETCH_FAILED");
}

function activeChainsFromText(text) {
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length - 2; i++) {
    const l = lines[i].trim();
    const combined = lines[i + 1]?.trim() || "";
    const m = combined.match(/^\$([\d,]+\.?\d*)\s+(\d+)%$/);
    if (m && l && !l.startsWith("$")) {
      const slug = slugFromHeaderName(l);
      if (parseFloat(m[1].replace(/,/g, "")) > 1) out.push(slug);
      continue;
    }
    const usd = lines[i + 1]?.trim() || "";
    const pct = lines[i + 2]?.trim() || "";
    if (usd.match(/^\$[\d,]/) && pct.match(/^\d+%$/)) {
      const slug = slugFromHeaderName(l);
      if (parseFloat(usd.replace(/[$,]/g, "")) > 1) out.push(slug);
    }
  }
  return [...new Set(out)].slice(0, 2);
}

export async function loadConfig() {
  try {
    const r = await fetch("./config.json", { cache: "no-store" });
    if (r.ok) return r.json();
  } catch {
    /* */
  }
  return {};
}

export async function fetchPortfolioData(wallet, _config, opts = {}) {
  if (redirectToAppPort()) {
    throw new Error("REDIRECTING");
  }
  const ready = await checkApiReady();
  if (!ready) {
    if (redirectToAppPort()) throw new Error("REDIRECTING");
    throw new Error("NO_API");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const mainText = await fetchProfilePage(wallet, null, controller.signal);
    return {
      mainText,
      chainTexts: {},
      chainProtocolIndex: {},
      enrich: opts.enrich === false ? null : () => enrichChains(wallet),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function enrichChains(wallet) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 45000);
  try {
    const mainText =
      readCache(wallet, null) || (await fetchProfilePage(wallet, null, controller.signal));
    const slugs = activeChainsFromText(mainText);
    const chainTexts = {};
    const chainProtocolIndex = {};
    await Promise.all(
      slugs.map(async (slug) => {
        try {
          const text = await fetchProfilePage(wallet, slug, controller.signal);
          chainTexts[slug] = text;
          Object.assign(chainProtocolIndex, indexProtocolsOnChainPage(text, slug));
        } catch {
          /* */
        }
      }),
    );
    return { chainTexts, chainProtocolIndex, mainText };
  } finally {
    clearTimeout(t);
  }
}
