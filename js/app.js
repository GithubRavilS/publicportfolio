import { chainBadgeHtml, chainColor, chainLabel, chainSlug } from "./chains.js";
import { LANG_KEY, t, translateKind } from "./i18n.js";
import { protocolLogoHtml, protocolMeta, compareLiquidityProtocols } from "./protocols.js";
import { setupHistoryChart } from "./history.js";
import { recalcLiquidityTotals } from "./revert-portfolio-merge.js";
import {
  aprToApy,
  fmtRangeDisplay,
  normPair,
  isDisplayRangeUsable,
  pairMeta,
  feeAprForDisplay,
} from "./revert-parse.js";
import { syncDisplayTotals } from "./portfolio-normalize.js";
import { applyPortfolioPipeline, PORTFOLIO_SCHEMA } from "./portfolio-pipeline.js";

const APP_VER = "67";
const FETCH_TIMEOUT_MS = 150000;
const PREVIEW_TIMEOUT_MS = 75000;
const CACHE_MS = 15 * 60 * 1000;

/** Базовый путь API: только если в URL есть /portfolio/ (combined WSGI). */
function getAppBase() {
  const m = location.pathname.match(/^(\/portfolio)(?:\/|$)/i);
  return m ? m[1] : "";
}

function isLocalDev() {
  return (
    (location.hostname === "127.0.0.1" || location.hostname === "localhost") &&
    location.port === "5500"
  );
}

function noApiMessage() {
  return t(lang, isLocalDev() ? "errNoApiLocal" : "errNoApi");
}

function apiUrl(path) {
  const base = getAppBase();
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

async function checkApiReady() {
  try {
    const r = await fetch(apiUrl("/api/health"), { cache: "no-store" });
    const d = await r.json();
    return r.ok && d.ok && d.app === "portfolio-tracker";
  } catch {
    return false;
  }
}

async function waitForApi(maxMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (await checkApiReady()) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function fetchWithTimeout(url, ms = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { cache: "no-store", signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPortfolio(
  wallet,
  { quick = false, refresh = false, source = "debank", refreshOnchain = false, timeoutMs } = {},
) {
  const q = new URLSearchParams({ wallet, _: String(Date.now()) });
  if (quick) q.set("quick", "1");
  if (refresh) q.set("refresh", "1");
  if (refreshOnchain) q.set("refreshOnchain", "1");
  if (source) q.set("source", source);
  const url = apiUrl(`/api/portfolio?${q}`);
  const ms = timeoutMs ?? (quick ? PREVIEW_TIMEOUT_MS : FETCH_TIMEOUT_MS);
  const r = await fetchWithTimeout(url, ms);
  let data = {};
  const raw = await r.text();
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(r.ok ? "FETCH_FAILED" : "NO_API");
  }
  if (!r.ok || !data.ok || !data.portfolio) {
    const err = data.error || `HTTP_${r.status}`;
    throw new Error(err);
  }
  return {
    ...data.portfolio,
    _cached: !!data.cached,
    _source: data.source || source,
  };
}

if (localStorage.getItem("pt-app-ver") !== APP_VER) {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith("pt:")) sessionStorage.removeItem(k);
    }
  } catch {
    /* */
  }
  localStorage.setItem("pt-app-ver", APP_VER);
}

const $ = (id) => document.getElementById(id);

let lang = localStorage.getItem(LANG_KEY) || "ru";
let state = {
  view: "all",
  chainFilter: null,
  protocolFilter: null,
  collapsed: new Set(),
  data: null,
  fetching: false,
  historySeries: null,
  historyLoading: false,
  historyChartCleanup: null,
  revertLoading: false,
  revertPositions: [],
  revertPositionsCount: 0,
  revertWallet: null,
  revertApiError: null,
  krystalPositions: [],
  krystalError: null,
  rangesEnriched: 0,
  rangesError: null,
  enriching: false,
  poolDetailKey: null,
  dataReadyFlash: false,
  introCollapsed: false,
  loadPct: 0,
  loadReady: true,
  loadSteps: {},
};

const LOAD_STEP_WEIGHTS = {
  connect: 8,
  debank: 38,
  positions: 14,
  ranges: 22,
  apy: 10,
  history: 8,
};

const LOAD_STEP_ORDER = ["connect", "debank", "positions", "ranges", "apy", "history"];

function resetLoadProgress() {
  state.loadPct = 0;
  state.loadReady = false;
  state.loadSteps = Object.fromEntries(LOAD_STEP_ORDER.map((id) => [id, "pending"]));
  renderLoadProgress();
}

function setLoadStep(stepId, status) {
  if (!state.loadSteps || !LOAD_STEP_WEIGHTS[stepId]) return;
  state.loadSteps[stepId] = status;
  let pct = 0;
  for (const id of LOAD_STEP_ORDER) {
    const w = LOAD_STEP_WEIGHTS[id];
    const st = state.loadSteps[id];
    if (st === "done") pct += w;
    else if (st === "active") pct += w * 0.5;
  }
  state.loadPct = Math.min(100, Math.round(pct));
  renderLoadProgress();
}

function finishLoadProgress() {
  for (const id of LOAD_STEP_ORDER) state.loadSteps[id] = "done";
  state.loadPct = 100;
  state.loadReady = true;
  renderLoadProgress();
}

function dismissBlockingLoader(minPct = 15) {
  setLoading(false);
  state.loadPct = Math.max(state.loadPct, minPct);
  renderLoadProgress();
  if (state.data) render();
}

async function backgroundFullDebank(wallet, { refresh = false } = {}) {
  if (state.data?.fromDebankApi) return;
  try {
    setLoadStep("debank", "active");
    const p = await fetchPortfolio(wallet, {
      source: "debank",
      quick: false,
      refresh,
    });
    p.partial = false;
    applyPortfolio(p, wallet);
    saveCache(wallet, state.data);
    setLoadStep("debank", "done");
    setLoadStep("positions", "done");
    render();
  } catch (e) {
    console.warn("full debank", e);
    if (state.data) state.data.partial = true;
  }
}

function hideLoadProgressSoon() {
  setTimeout(() => {
    if (state.loadReady && !state.enriching && !state.revertLoading && !state.fetching) {
      const dock = $("loadProgressDock");
      if (dock) dock.hidden = true;
      document.body.classList.remove("portfolio-incomplete");
      document.body.classList.add("portfolio-ready");
    }
  }, 3200);
}

function renderLoadProgress() {
  const dock = $("loadProgressDock");
  if (!dock) return;
  const onResults = $("results") && !$("results").hidden;
  const busy = !state.loadReady || state.fetching || state.enriching || state.revertLoading;
  dock.hidden = !onResults || (!busy && state.loadPct >= 100 && state.loadReady);
  dock.classList.toggle("is-ready", state.loadPct >= 100 && state.loadReady);

  const pctEl = $("loadProgressPct");
  const fill = $("loadProgressFill");
  const trust = $("loadProgressTrust");
  const label = $("loadProgressLabel");
  const stepsEl = $("loadProgressSteps");

  if (pctEl) pctEl.textContent = `${state.loadPct}%`;
  if (fill) fill.style.width = `${state.loadPct}%`;
  const track = dock.querySelector(".load-progress-track");
  if (track) {
    track.setAttribute("aria-valuenow", String(state.loadPct));
    track.setAttribute("aria-valuetext", `${state.loadPct}%`);
  }

  const activeStep = LOAD_STEP_ORDER.find((id) => state.loadSteps[id] === "active");
  if (label) {
    label.textContent = activeStep
      ? t(lang, `lpStep${activeStep[0].toUpperCase()}${activeStep.slice(1)}`)
      : "";
  }
  if (trust) {
    trust.textContent =
      state.loadPct >= 100 && state.loadReady ? t(lang, "loadTrustOk") : t(lang, "loadTrustWait");
  }

  if (stepsEl) {
    stepsEl.innerHTML = LOAD_STEP_ORDER.map((id) => {
      const st = state.loadSteps[id] || "pending";
      const cls = st === "done" ? "is-done" : st === "active" ? "is-active" : "";
      const key = `lpStep${id[0].toUpperCase()}${id.slice(1)}`;
      return `<li class="${cls}" data-step="${id}">${esc(t(lang, key))}</li>`;
    }).join("");
  }

  const hasData = !!(state.data?.protocolGroups?.length || state.data?.walletTokens?.length);
  document.body.classList.toggle(
    "portfolio-incomplete",
    onResults && state.loadPct < 100 && !hasData,
  );
  document.body.classList.toggle(
    "portfolio-ready",
    onResults && state.loadPct >= 100 && state.loadReady,
  );
}

function filterByChain(tokens) {
  if (!state.chainFilter) return tokens || [];
  const cf = chainSlug(state.chainFilter);
  return (tokens || []).filter((t) => chainSlug(t.chain) === cf);
}

function filterLiqByChain(list) {
  if (!state.chainFilter) return list || [];
  const cf = chainSlug(state.chainFilter);
  return (list || []).filter((p) => chainSlug(p.chain) === cf);
}

function filterLendByChain(list) {
  if (!state.chainFilter) return list || [];
  const cf = chainSlug(state.chainFilter);
  return (list || []).filter((p) => chainSlug(p.chain) === cf);
}

function computeFilteredTotals(d) {
  const base = {
    total: d.totalUsd,
    wallet: d.walletUsd,
    liq: d.liqUsd,
    lend: d.lendUsd,
  };
  if (!state.chainFilter) return base;
  const groups = getVisibleGroups();
  let wallet = 0;
  let liq = 0;
  let lend = 0;
  for (const g of groups) {
    if (g.protocol === "Wallet") {
      wallet += filterByChain(g.walletTokens).reduce((s, t) => s + (t.usd || 0), 0);
    }
    liq += filterLiqByChain(g.liquidity).reduce((s, p) => s + (p.positionUsd || 0), 0);
    lend += filterLendByChain(g.lending).reduce((s, p) => s + (p.netUsd || 0), 0);
  }
  return { total: wallet + liq + lend, wallet, liq, lend };
}

function renderFilterBanner() {
  if (!state.chainFilter && !state.protocolFilter) return "";
  const parts = [];
  if (state.chainFilter) {
    parts.push(
      `<span class="filter-chip">${chainBadgeHtml(state.chainFilter, 18)} ${esc(chainLabel(state.chainFilter, lang))}</span>`,
    );
  }
  if (state.protocolFilter) {
    const g = (state.data?.protocolGroups || []).find(
      (x) => (x.id || `${x.protocol}|${x.chain}`) === state.protocolFilter,
    );
    if (g)
      parts.push(
        `<span class="filter-chip">${esc(pillLabel(g, state.data?.protocolGroups || []))}</span>`,
      );
  }
  return `<div class="filter-banner">
    <span>${t(lang, "filterActive")}</span>
    ${parts.join("")}
    <button type="button" class="filter-clear" data-action="clear-filters">${t(lang, "clearFilters")}</button>
  </div>`;
}

function cacheKey(wallet) {
  return `pt:data:${wallet.toLowerCase()}`;
}

function loadCache(wallet) {
  try {
    const raw = sessionStorage.getItem(cacheKey(wallet));
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (Date.now() - o.savedAt > CACHE_MS) return null;
    const p = o.payload;
    if (!p || (p.schemaVersion || 0) < PORTFOLIO_SCHEMA) return null;
    return p;
  } catch {
    return null;
  }
}

function saveCache(wallet, payload) {
  try {
    sessionStorage.setItem(cacheKey(wallet), JSON.stringify({ savedAt: Date.now(), payload }));
  } catch {
    /* */
  }
}

function loadCollapsed() {
  try {
    const raw = sessionStorage.getItem("pt:collapsed");
    if (raw) state.collapsed = new Set(JSON.parse(raw));
  } catch {
    state.collapsed = new Set();
  }
}

function saveCollapsed() {
  try {
    sessionStorage.setItem("pt:collapsed", JSON.stringify([...state.collapsed]));
  } catch {
    /* */
  }
}

function isOpen(key) {
  return !state.collapsed.has(key);
}

const fmtUsd = (n, smart) => {
  const v = Number(n || 0);
  if (smart && v > 0 && v < 0.01) {
    return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  }
  const opts =
    v >= 1000
      ? { minimumFractionDigits: 0, maximumFractionDigits: 0 }
      : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return "$" + v.toLocaleString("en-US", opts);
};

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function chainPill(slug) {
  if (!slug || slug === "all" || slug === "unknown") return "";
  const c = chainColor(slug);
  const name = chainLabel(slug, lang);
  return `<span class="pill chain" style="color:${c};border-color:${c}55">${chainBadgeHtml(slug, 16)}${esc(name)}</span>`;
}

function pillLabel(g, groups) {
  if (g.protocol === "Wallet") return t(lang, "wallet");
  const dup = groups.filter((x) => x.protocol === g.protocol).length > 1;
  if (dup && g.chain && g.chain !== "all") {
    return `${g.protocol} · ${chainLabel(g.chain, lang)}`;
  }
  return g.protocol;
}

function groupMatchesChain(g, chain) {
  if (!chain) return true;
  const cf = chainSlug(chain);
  if (g.protocol === "Wallet") {
    return g.walletTokens?.some((t) => chainSlug(t.chain) === cf) ?? false;
  }
  if (chainSlug(g.chain) === cf) return true;
  if (g.liquidity?.some((p) => chainSlug(p.chain) === cf)) return true;
  if (g.lending?.some((p) => chainSlug(p.chain) === cf)) return true;
  return false;
}

function getVisibleGroups() {
  const all = state.data?.protocolGroups || [];
  let list = [...all];

  if (state.view === "wallet") {
    return list.filter((g) => g.protocol === "Wallet");
  }
  if (state.view === "liquidity") {
    list = list.filter((g) => g.liquidity?.length > 0);
  } else if (state.view === "lending") {
    list = list.filter((g) => g.lending?.length > 0);
  }

  if (state.chainFilter) {
    list = list.filter((g) => groupMatchesChain(g, state.chainFilter));
  }

  if (state.protocolFilter) {
    list = list.filter((g) => (g.id || `${g.protocol}|${g.chain}`) === state.protocolFilter);
  }

  return list;
}

/** Крупные DEX — всегда внешний блок протокола (как Uniswap), даже на одной сети. */
function prefersProtocolAccordion(proto) {
  return /uniswap|pancake|aerodrome|curve|balancer|sushi|velodrome|yearn|gmx|beefy|pendle/i.test(
    String(proto || ""),
  );
}

function clusterByProtocol(groups) {
  const map = new Map();
  for (const g of groups) {
    if (g.protocol === "Wallet") continue;
    if (!map.has(g.protocol)) map.set(g.protocol, []);
    map.get(g.protocol).push(g);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => (b.protocolUsd || 0) - (a.protocolUsd || 0));
  }
  return map;
}

function renderProtocolPills(groups) {
  const src = (groups || []).filter(
    (g) =>
      g.protocolUsd > 0.005 || g.walletTokens?.length || g.liquidity?.length || g.lending?.length,
  );
  if (!src.length) return "";

  const pills = src
    .map((g) => {
      const id = g.id || `${g.protocol}|${g.chain}`;
      const active = state.protocolFilter === id;
      const meta = protocolMeta(g.protocol);
      return `<button type="button" class="proto-pill${active ? " active" : ""}" data-proto-id="${esc(id)}" style="--proto-accent:${meta.color}">
        ${protocolLogoHtml(g.protocol, 22)}
        <span class="proto-pill-text">
          <span class="proto-pill-name">${esc(pillLabel(g, src))}</span>
          <span class="proto-pill-usd">${fmtUsd(g.protocolUsd)}</span>
        </span>
      </button>`;
    })
    .join("");

  const allActive = !state.protocolFilter && state.view === "all" && !state.chainFilter;
  return `<div class="proto-pills-wrap">
    <button type="button" class="proto-pill${allActive ? " active" : ""}" data-proto-id="">${esc(t(lang, "allPlatforms"))}</button>
    ${pills}
  </div>`;
}

function renderChainBreakdown(chains) {
  if (!chains?.length) return "";
  const total = chains.reduce((s, c) => s + (c.usd || 0), 0) || 1;
  return `
    <h3 class="section-title">${t(lang, "chains")}</h3>
    <div class="chain-grid">
      ${chains
        .filter((c) => (c.usd || 0) > 0.01)
        .map((c) => {
          const pct = c.pct || Math.round(((c.usd || 0) / total) * 100);
          const active = chainSlug(state.chainFilter) === chainSlug(c.slug);
          return `
          <button type="button" class="chain-card${active ? " active" : ""}" data-chain="${esc(chainSlug(c.slug))}">
            ${chainBadgeHtml(c.slug, 40)}
            <div class="chain-card-name">${esc(chainLabel(c.slug, lang))}</div>
            <div class="chain-card-usd">${fmtUsd(c.usd)}</div>
            <div class="chain-card-pct">${pct}%</div>
          </button>`;
        })
        .join("")}
    </div>`;
}

function renderWalletTokenRows(tokens) {
  const list = filterByChain(tokens);
  if (!list.length) return `<div class="empty">${t(lang, "empty")}</div>`;
  return `<div class="token-list">${list
    .map(
      (tok) => `
    <div class="token-row">
      <div class="token-icon-slot">${tok.chain ? chainBadgeHtml(tok.chain, 28) : ""}</div>
      <div class="sym-col">
        <div class="sym">${esc(tok.symbol)}${tok.chain ? ` <span class="chain-tag">${esc(chainLabel(tok.chain, lang))}</span>` : ""}</div>
        <div class="amt">${esc(tok.amount)} · ${esc(tok.price)}</div>
      </div>
      <div class="pos-usd">${fmtUsd(tok.usd, true)}</div>
    </div>`,
    )
    .join("")}</div>`;
}

function poolRowKey(p, protocol) {
  return `${protocol}|${p.chain}|${p.pair || p.poolId}|${p.positionUsd}`;
}

function fmtPct(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  const v = Number(n);
  if (Math.abs(v) > 500) return "—";
  return `${v >= 0 ? "" : "−"}${Math.abs(v).toFixed(2)}%`;
}

function displayApyValue(r) {
  if (!r) return null;
  const apy = r.apyRecent ?? r.apyAnnualized ?? r.displayApy ?? r.feeApy ?? r.apy ?? null;
  if (apy == null || !Number.isFinite(apy) || apy < 0) return null;
  return apy;
}

function fmtTokenAmount(n) {
  if (n == null || !Number.isFinite(n) || n <= 0) return "0";
  const v = Number(n);
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (v >= 1) return v.toFixed(4);
  if (v >= 0.0001) return v.toFixed(6);
  return v.toExponential(2);
}

function formatPositionAge(p) {
  if (!p.openedAt) return null;
  const ms = Date.now() - p.openedAt;
  const days = Math.max(0, Math.floor(ms / 86400000));
  const date = new Date(p.openedAt).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return { date, days };
}

function poolFeeSummary(p) {
  const unclaimed = p.feesEarned?.unclaimed || [];
  const collected = p.feesEarned?.collected || [];
  const byToken = [];
  const symFromPair = (poolPairKeyForFmt(p) || "").split("+").filter(Boolean);

  for (let i = 0; i < Math.max(unclaimed.length, collected.length, symFromPair.length); i++) {
    const uAmt = parseFloat(unclaimed[i]?.amount || 0);
    const cAmt = parseFloat(collected[i]?.amount || 0);
    const total = uAmt + cAmt;
    if (total <= 0) continue;
    byToken.push({
      symbol: unclaimed[i]?.symbol || collected[i]?.symbol || symFromPair[i] || `#${i + 1}`,
      total,
      unclaimed: uAmt,
      collected: cAmt,
    });
  }

  if (p.feesEarned && (byToken.length || p.totalFeesUsd != null || p.onchainMetrics)) {
    const unclaimedUsd = p.claimableUsd ?? 0;
    const collectedUsd = p.collectedFeesUsd ?? 0;
    const totalUsd = p.totalFeesUsd != null ? p.totalFeesUsd : unclaimedUsd + collectedUsd;
    return {
      totalUsd,
      unclaimedUsd,
      collectedUsd,
      byToken,
      complete: collectedUsd > 0.001 || byToken.some((x) => x.collected > 0),
    };
  }

  const claimUsd = p.claimableUsd ?? (p.claimable || []).reduce((s, x) => s + (x.usd || 0), 0);
  if (claimUsd > 0.001) {
    const byToken = (p.claimable || [])
      .filter((x) => (x.usd || 0) > 0.001)
      .map((x) => ({
        symbol: x.symbol || "?",
        total: parseFloat(String(x.amount || "0").replace(/,/g, "")) || 0,
        unclaimed: parseFloat(String(x.amount || "0").replace(/,/g, "")) || 0,
        collected: 0,
      }));
    return {
      totalUsd: claimUsd,
      unclaimedUsd: claimUsd,
      collectedUsd: 0,
      byToken,
      complete: false,
    };
  }

  const rev = p.revert;
  if (rev?.uncollectedUsd > 0.001) {
    return {
      totalUsd: rev.uncollectedUsd,
      unclaimedUsd: rev.uncollectedUsd,
      collectedUsd: 0,
      byToken: [],
      complete: false,
    };
  }
  return null;
}

function estimatePoolApy(p) {
  const posUsd = p.positionUsd || 0;
  if (posUsd < 1) return null;
  const hours = p.hoursOpen ?? p.revert?.hoursOpen;
  if (!hours || hours < 48) return null;
  const fees = poolFeeSummary(p);
  const feeUsd = fees?.totalUsd ?? 0;
  if (feeUsd < 0.001) return null;
  const years = hours / (365 * 24);
  const apr = (feeUsd / posUsd / years) * 100;
  if (!Number.isFinite(apr) || apr <= 0 || apr > 500) return null;
  return apr;
}

function displayApyForPool(p) {
  return displayApyValue(p) ?? displayApyValue(p.revert) ?? estimatePoolApy(p);
}

function renderRangeStats(rs, pk) {
  if (rs?.rangeMin == null || rs?.rangeMax == null) return "";
  const cur = rs.rangeCurrent ?? (rs.rangeMin + rs.rangeMax) / 2;
  const inRange = cur >= rs.rangeMin && cur <= rs.rangeMax;
  return `
    <section class="pd-section">
      <h4 class="pd-section-title">${t(lang, "pdRangeSection")}
        <span class="pd-range-badge${inRange ? "" : " out"}">${t(lang, inRange ? "pdInRange" : "pdOutRange")}</span>
      </h4>
      <div class="pd-stat-grid pd-stat-grid--4">
        <div class="pd-stat">
          <span class="pd-lbl">${t(lang, "pdRangeMin")}</span>
          <strong class="pd-val">${fmtRangeDisplay(rs.rangeMin, pk)}</strong>
        </div>
        <div class="pd-stat pd-stat--accent">
          <span class="pd-lbl">${t(lang, "pdRangeCur")}</span>
          <strong class="pd-val">${fmtRangeDisplay(cur, pk)}</strong>
        </div>
        <div class="pd-stat">
          <span class="pd-lbl">${t(lang, "pdRangeMax")}</span>
          <strong class="pd-val">${fmtRangeDisplay(rs.rangeMax, pk)}</strong>
        </div>
        <div class="pd-stat">
          <span class="pd-lbl">${t(lang, "pdPoolFeeTier")}</span>
          <strong class="pd-val">${esc(rs.feeTier || "—")}</strong>
        </div>
      </div>
    </section>`;
}

function renderFeeBreakdown(fees) {
  if (!fees) return "";
  const hasTokens = fees.byToken.length > 0;
  const tokenRows = fees.byToken
    .map(
      (x) => `
      <div class="pd-fee-token">
        <span class="pd-fee-sym">${esc(x.symbol)}</span>
        <span class="pd-fee-amt">${esc(fmtTokenAmount(x.total))}</span>
        ${
          x.unclaimed > 0
            ? `<span class="pd-fee-sub">${t(lang, "pdFeesUnclaimed")}: ${esc(fmtTokenAmount(x.unclaimed))}</span>`
            : ""
        }
        ${
          x.collected > 0
            ? `<span class="pd-fee-sub">${t(lang, "pdFeesCollected")}: ${esc(fmtTokenAmount(x.collected))}</span>`
            : ""
        }
      </div>`,
    )
    .join("");

  return `
    <section class="pd-section">
      <h4 class="pd-section-title">${t(lang, "pdFeesSection")}</h4>
      <div class="pd-fees-hero">
        <span class="pd-lbl">${t(lang, fees.complete ? "pdFeesTotal" : "pdFeesUnclaimedHero")}</span>
        <strong class="pd-fees-total">${fmtUsd(fees.totalUsd, true)}</strong>
      </div>
      ${
        fees.complete
          ? `<div class="pd-fee-split">
              <span>${t(lang, "pdFeesUnclaimed")}: <strong>${fmtUsd(fees.unclaimedUsd, true)}</strong></span>
              <span>${t(lang, "pdFeesCollected")}: <strong>${fmtUsd(fees.collectedUsd, true)}</strong></span>
            </div>`
          : `<p class="pd-note">${t(lang, "pdFeesPartialNote")}</p>`
      }
      ${
        hasTokens
          ? `<div class="pd-fee-tokens"><span class="pd-lbl">${t(lang, "pdFeesByToken")}</span>${tokenRows}</div>`
          : ""
      }
    </section>`;
}

function renderPoolExpandedDetail(p, detailId = "") {
  const pk = poolPairKeyForFmt(p);
  const rs = poolRangeSource(p);
  const r = p.revert;
  const fees = poolFeeSummary(p);
  const age = formatPositionAge(p);
  const apy = displayApyForPool(p);
  const apr = feeAprForDisplay(r?.feeApr ?? p.feeApr);
  const inPool = (p.inPool || [])
    .map((x) => `<span>${esc(x.symbol)} ${esc(x.amount)}</span>`)
    .join(" · ");

  const parts = ['<div class="pool-drawer-inner">'];

  if (rs) parts.push(renderRangeStats(rs, pk));
  if (fees && fees.totalUsd > 0.0001) parts.push(renderFeeBreakdown(fees));

  parts.push(`<section class="pd-section">
    <h4 class="pd-section-title">${t(lang, "pdYieldSection")}</h4>
    <div class="pd-stat-grid">
      ${
        apr != null
          ? `<div class="pd-stat"><span class="pd-lbl">${t(lang, "revertApr")}</span><strong class="pd-val">${fmtPct(apr)}</strong></div>`
          : ""
      }
      ${
        apy != null
          ? `<div class="pd-stat"><span class="pd-lbl">${t(lang, "revertApy")}</span><strong class="pd-val pd-val--green">${fmtPct(apy)}</strong></div>`
          : ""
      }
      ${
        r?.totalPnlUsd != null && Math.abs(r.totalPnlUsd) > 0.001
          ? `<div class="pd-stat"><span class="pd-lbl">${t(lang, "revertPnl")}</span><strong class="pd-val">${fmtUsd(r.totalPnlUsd, true)}</strong></div>`
          : ""
      }
      <div class="pd-stat"><span class="pd-lbl">${t(lang, "value")}</span><strong class="pd-val">${fmtUsd(p.positionUsd, true)}</strong></div>
    </div>
  </section>`);

  if (age || inPool) {
    parts.push(`<section class="pd-section pd-section--last">
      <h4 class="pd-section-title">${t(lang, "pdPositionSection")}</h4>
      <div class="pd-stat-grid">
        ${
          age
            ? `<div class="pd-stat"><span class="pd-lbl">${t(lang, "pdOpened")}</span><strong class="pd-val">${esc(age.date)}</strong></div>
               <div class="pd-stat"><span class="pd-lbl">${t(lang, "pdAge")}</span><strong class="pd-val">${age.days} ${t(lang, "pdDays")}</strong></div>`
            : ""
        }
        ${
          inPool
            ? `<div class="pd-stat pd-stat--wide"><span class="pd-lbl">${t(lang, "inPoolLbl")}</span><strong class="pd-val pd-val--wrap">${inPool}</strong></div>`
            : ""
        }
      </div>
    </section>`);
  }

  if (r?.detailUrl) {
    parts.push(
      `<a class="pool-revert-link" href="${esc(r.detailUrl)}" target="_blank" rel="noopener">${t(lang, "revertOpen")} ↗</a>`,
    );
  }

  parts.push("</div>");
  const idAttr = detailId ? ` id="${esc(detailId)}"` : "";
  return `<div class="pool-drawer"${idAttr}>${parts.join("")}</div>`;
}

function poolPairKeyForFmt(p) {
  return p.revert?.pairKey || normPair(p.pair || p.poolId || "");
}

/** Лучший источник диапазона: Revert > валидный on-chain > что есть. */
function poolRangeSource(p) {
  const pk = poolPairKeyForFmt(p);
  const meta = pairMeta(pk);
  const r = p.revert;
  const ocOk = isDisplayRangeUsable(p.rangeMin, p.rangeMax, p.rangeCurrent, pk);
  const revOk = r && isDisplayRangeUsable(r.rangeMin, r.rangeMax, r.rangeCurrent, pk);

  if (meta.allStable) {
    if (revOk) {
      return {
        rangeMin: r.rangeMin,
        rangeMax: r.rangeMax,
        rangeCurrent: r.rangeCurrent,
        feeTier: r.feeTier || p.feeTier,
        pairKey: r.pairKey || pk,
      };
    }
    if (ocOk) {
      return {
        rangeMin: p.rangeMin,
        rangeMax: p.rangeMax,
        rangeCurrent: p.rangeCurrent,
        feeTier: p.feeTier,
        pairKey: pk,
        onchain: !!p.onchainMetrics,
      };
    }
    return null;
  }

  if (revOk) {
    return {
      rangeMin: r.rangeMin,
      rangeMax: r.rangeMax,
      rangeCurrent: r.rangeCurrent,
      feeTier: r.feeTier || p.feeTier,
      pairKey: r.pairKey || pk,
    };
  }
  if (ocOk) {
    return {
      rangeMin: p.rangeMin,
      rangeMax: p.rangeMax,
      rangeCurrent: p.rangeCurrent,
      feeTier: p.feeTier,
      pairKey: pk,
      onchain: !!p.onchainMetrics,
    };
  }
  if (p.revert && !revOk) {
    const r0 = p.revert;
    if (isDisplayRangeUsable(r0.rangeMin, r0.rangeMax, r0.rangeCurrent, pk)) {
      return {
        rangeMin: r0.rangeMin,
        rangeMax: r0.rangeMax,
        rangeCurrent: r0.rangeCurrent,
        feeTier: r0.feeTier || p.feeTier,
        pairKey: r0.pairKey || pk,
      };
    }
  }
  if (r && isDisplayRangeUsable(r.rangeMin, r.rangeMax, r.rangeCurrent, pk)) {
    return { ...r, pairKey: r.pairKey || pk };
  }
  return null;
}

function renderRangeBar(r, pairKey = "") {
  if (r?.rangeMin == null || r?.rangeMax == null) return "";
  const pk = pairKey || r.pairKey || "";
  const min = r.rangeMin;
  const max = r.rangeMax;
  const cur = r.rangeCurrent ?? (min + max) / 2;
  const inRange = cur >= min && cur <= max;
  const span = max - min || Math.max(Math.abs(max), 1) * 0.01;
  const pad = Math.max(span * 0.12, Math.max(0, cur - max, min - cur) * 0.35);
  const trackMin = Math.min(min, cur) - pad;
  const trackMax = Math.max(max, cur) + pad;
  const trackSpan = trackMax - trackMin || 1;
  const segLeft = ((min - trackMin) / trackSpan) * 100;
  const segWidth = (span / trackSpan) * 100;
  let markerPct = ((cur - trackMin) / trackSpan) * 100;
  markerPct = Math.max(0.5, Math.min(99.5, markerPct));
  const curLabel = `${t(lang, "rangePrice")}: ${fmtRangeDisplay(cur, pk)}`;
  let curPos = "center";
  if (markerPct < 18) curPos = "left";
  else if (markerPct > 82) curPos = "right";
  else if (markerPct < 28 || markerPct > 72) curPos = "below";
  return `
    <div class="range-bar-wrap${inRange ? "" : " out-range"}">
      <div class="range-bar-head">
        <span class="range-lbl">${t(lang, "rangeLbl")}</span>
        ${r.onchain ? `<span class="onchain-tag" title="${t(lang, "onchainRange")}">RPC</span>` : ""}
        <span class="range-fee">${esc(r.feeTier || "")}</span>
      </div>
      <div class="range-bar-labels range-bar-labels--ends">
        <span>${fmtRangeDisplay(min, pk)}</span>
        <span>${fmtRangeDisplay(max, pk)}</span>
      </div>
      <div class="range-bar">
        <div class="range-track"></div>
        <div class="range-active" style="left:${segLeft.toFixed(2)}%;width:${segWidth.toFixed(2)}%"></div>
        <div class="range-marker" style="left:${markerPct.toFixed(2)}%">
          <span class="range-cur range-cur--on-marker range-cur--${curPos}${inRange ? "" : " out"}">${esc(curLabel)}</span>
        </div>
      </div>
    </div>`;
}

function countRevertLpStats() {
  let total = 0;
  let fromRevert = 0;
  const seen = new Set();
  for (const g of state.data?.protocolGroups || []) {
    for (const p of g.liquidity || []) {
      const k = `${g.protocol}|${p.chain}|${p.poolId || p.pair}`;
      if (seen.has(k)) continue;
      seen.add(k);
      total++;
      if (p.revert) fromRevert++;
    }
  }
  const m = state.data?._revertMerge;
  const debankOnly = Math.max(0, total - fromRevert);
  return {
    total,
    fromRevert,
    debankOnly,
    revertCount: m?.revertPositionsLoaded ?? state.revertPositionsCount ?? 0,
    mergeMode: m?.mode,
    sumMatched: m?.sumMatched,
    debankDexUsd: m?.debankDexUsd ?? 0,
    revertDexUsd: m?.revertDexUsd ?? 0,
    debankDexCount: m?.debankDexCount ?? 0,
    revertDexCount: m?.revertDexCount ?? 0,
  };
}

function ensureIntroCollapsed() {
  if (state.introCollapsed || !state.data?.protocolGroups) return;
  try {
    if (sessionStorage.getItem("pt:intro-collapsed")) {
      state.introCollapsed = true;
      return;
    }
  } catch {
    /* */
  }
  const rest = state.data.protocolGroups
    .filter((g) => g.protocol !== "Wallet")
    .sort((a, b) => (b.protocolUsd || 0) - (a.protocolUsd || 0));
  for (let i = 2; i < rest.length; i++) {
    const g = rest[i];
    state.collapsed.add(`proto:${g.protocol}|${g.chain || "all"}`);
    state.collapsed.add(`p:${g.protocol}`);
  }
  saveCollapsed();
  state.introCollapsed = true;
  try {
    sessionStorage.setItem("pt:intro-collapsed", "1");
  } catch {
    /* */
  }
}

function renderLiquidityCompact(list, protocol) {
  return `<div class="pool-list">${(list || [])
    .map((p) => {
      const key = poolRowKey(p, protocol);
      const open = state.poolDetailKey === key;
      const inPool = (p.inPool || [])
        .map((x) => `<span>${esc(x.symbol)} ${esc(x.amount)}</span>`)
        .join(" · ");
      const r = p.revert;
      const fees = poolFeeSummary(p);
      const feesUsd =
        fees?.complete && fees.totalUsd > 0.001
          ? fees.totalUsd
          : fees?.unclaimedUsd > 0.001
            ? fees.unclaimedUsd
            : r?.uncollectedUsd;
      const apy = displayApyForPool(p);
      const rangeSrc = poolRangeSource(p);
      const rangeHtml = !open && rangeSrc ? renderRangeBar(rangeSrc, poolPairKeyForFmt(p)) : "";
      const detailId = `pd-${key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
      return `
      <div class="pool-block${open ? " is-expanded" : ""}">
        <button type="button" class="pool-row${open ? " open" : ""}${r ? " has-revert" : ""}${p.onchainMetrics ? " has-onchain" : ""}" data-pool-detail="${esc(key)}" aria-expanded="${open ? "true" : "false"}" aria-controls="${esc(detailId)}">
          <div class="token-icon-slot">${chainBadgeHtml(p.chain, 26)}</div>
          <div class="pool-row-main">
            <div class="pool-top"><span class="pool-pair">${esc(p.pair || p.poolId)}</span>${p.onchainMetrics ? `<span class="onchain-tag">OC</span>` : ""}</div>
            ${rangeHtml}
            ${!open && inPool ? `<div class="pool-meta"><span class="pool-meta-lbl">${t(lang, "inPoolLbl")}:</span> ${inPool}</div>` : ""}
          </div>
          <div class="pool-yield-col">
            ${
              apy != null
                ? `<div class="pool-apy-hero">${fmtPct(apy)}</div><div class="pool-apy-lbl">${t(lang, "poolApyLbl")}</div>`
                : feesUsd > 0.001
                  ? `<div class="pool-apy-hero fees-only">+${fmtUsd(feesUsd, true)}</div><div class="pool-apy-lbl">${t(lang, "pdFeesUnclaimed")}</div>`
                  : `<div class="pool-apy-hero muted">—</div>`
            }
            <div class="pool-usd-sm">${fmtUsd(p.positionUsd, true)}</div>
            ${!open && feesUsd > 0.001 ? `<div class="pool-fees-sm">+${fmtUsd(feesUsd, true)} ${t(lang, fees?.complete ? "feesShort" : "pdFeesUnclaimed")}</div>` : ""}
            <span class="pool-chev" aria-hidden="true"></span>
          </div>
        </button>
        ${open ? renderPoolExpandedDetail(p, detailId) : ""}
      </div>`;
    })
    .join("")}</div>`;
}

function renderAccHead(title, sum, key, sub, extraHtml = "") {
  const open = isOpen(key);
  return `<button type="button" class="acc-head${sub ? " acc-head--sub" : ""}" data-acc="${esc(key)}" aria-expanded="${open}">
    ${extraHtml}
    <span class="acc-title">${esc(title)}</span>
    <span class="acc-sum">${fmtUsd(sum)}</span>
    <span class="acc-chev" aria-hidden="true"></span>
  </button>`;
}

function renderProtocolAccordion(protocol, chainGroups) {
  const pKey = `p:${protocol}`;
  const open = isOpen(pKey);
  const total = chainGroups.reduce((s, g) => s + (g.protocolUsd || 0), 0);

  const inner = chainGroups
    .map((g) => {
      const cKey = `${pKey}|${g.chain}`;
      const cOpen = isOpen(cKey);
      const head = renderAccHead(
        chainLabel(g.chain, lang),
        g.protocolUsd,
        cKey,
        true,
        chainBadgeHtml(g.chain, 24),
      );
      return `
      <div class="acc acc--nested ${cOpen ? "open" : ""}">
        ${head}
        <div class="acc-panel">${renderLiquidityCompact(filterLiqByChain(g.liquidity), protocol)}${filterLendByChain(g.lending).length ? renderLending(filterLendByChain(g.lending)) : ""}</div>
      </div>`;
    })
    .join("");

  return `
    <section class="acc ${open ? "open" : ""}">
      ${renderAccHead(protocol, total, pKey, false)}
      <div class="acc-panel acc-panel--stack">${inner}</div>
    </section>`;
}

function renderWalletAccordion(g) {
  const tokens = filterByChain(g.walletTokens);
  const sum = tokens.reduce((s, t) => s + (t.usd || 0), 0);
  if (state.chainFilter && !tokens.length) return "";
  const key = "p:Wallet";
  const open = isOpen(key);
  return `
    <section class="acc ${open ? "open" : ""}">
      ${renderAccHead(t(lang, "wallet"), state.chainFilter ? sum : g.protocolUsd, key, false, protocolLogoHtml("Wallet", 28))}
      <div class="acc-panel">${renderWalletTokenRows(g.walletTokens)}</div>
    </section>`;
}

function renderProtocolGroupAccordion(g) {
  const key = `proto:${g.protocol}|${g.chain || "all"}`;
  const open = isOpen(key);
  const kinds = (g.kinds || [])
    .map((k) => `<span class="pill kind">${esc(translateKind(lang, k))}</span>`)
    .join("");
  let body = "";
  const liqRows = filterLiqByChain(g.liquidity);
  const lendRows = filterLendByChain(g.lending);
  if (state.chainFilter && !liqRows.length && !lendRows.length && g.protocol !== "Wallet")
    return "";
  if (liqRows.length) {
    body += `<div class="proto-block">${renderLiquidityCompact(liqRows, g.protocol)}</div>`;
  }
  if (lendRows.length) {
    body += `<div class="proto-block">${renderLending(lendRows)}</div>`;
  }
  const extra = `${g.chain && g.chain !== "all" ? chainBadgeHtml(g.chain, 24) : ""}<span class="pills-inline">${chainPill(g.chain)}${kinds}</span>`;
  return `
    <section class="acc ${open ? "open" : ""}">
      ${renderAccHead(g.protocol, g.protocolUsd, key, false, extra)}
      <div class="acc-panel">${body || `<div class="empty">${t(lang, "empty")}</div>`}</div>
    </section>`;
}

function renderPositionsLayout(groups) {
  if (!groups.length) return `<div class="empty">${t(lang, "empty")}</div>`;

  const showWallet = state.view === "all" || state.view === "wallet";
  const wallet = showWallet ? groups.filter((g) => g.protocol === "Wallet") : [];
  const rest = groups.filter((g) => g.protocol !== "Wallet");
  const useAccordion = state.view === "liquidity" || state.view === "all";
  const clustered = clusterByProtocol(rest);

  let html = wallet.map(renderWalletAccordion).join("");

  if (useAccordion) {
    const entries = [...clustered.entries()].sort((a, b) => {
      const usdA = a[1].reduce((s, g) => s + (g.protocolUsd || 0), 0);
      const usdB = b[1].reduce((s, g) => s + (g.protocolUsd || 0), 0);
      return compareLiquidityProtocols(a[0], b[0], usdA, usdB);
    });
    for (const [proto, chainGroups] of entries) {
      if (chainGroups.length > 1 || prefersProtocolAccordion(proto)) {
        html += renderProtocolAccordion(proto, chainGroups);
      } else {
        html += renderProtocolGroupAccordion(chainGroups[0]);
      }
    }
  } else {
    html += rest.map(renderProtocolGroupAccordion).join("");
  }

  return html;
}

function renderAnalytics(d) {
  const groups = d.protocolGroups || [];
  const segments = groups
    .filter((g) => g.protocolUsd > 0.5)
    .map((g, i) => ({
      label: pillLabel(g, groups),
      value: g.protocolUsd || 0,
      color: ["#22d3ee", "#a78bfa", "#4ade80", "#f472b6", "#fbbf24", "#fb7185"][i % 6],
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const chainSeg = (d.chains || [])
    .filter((c) => c.usd > 0.5)
    .map((c, i) => ({
      label: chainLabel(c.slug, lang),
      value: c.usd,
      color: chainColor(c.slug) || "#6b7cff",
    }));

  const total = d.totalUsd || 1;
  const walletPct = Math.round(((d.walletUsd || 0) / total) * 100);
  const liqPct = Math.round(((d.liqUsd || 0) / total) * 100);
  const lendPct = Math.round(((d.lendUsd || 0) / total) * 100);

  return `
    <section class="analytics">
      <h3 class="section-title">${t(lang, "analytics")}</h3>
      <div class="analytics-grid">
        <div class="an-card">
          <div class="an-lbl">${t(lang, "allocPlatforms")}</div>
          ${renderConicDonut(segments)}
          <ul class="an-legend">${segments.map((s) => `<li><span style="background:${s.color}"></span>${esc(s.label)} <b>${fmtUsd(s.value)}</b></li>`).join("")}</ul>
        </div>
        <div class="an-card">
          <div class="an-lbl">${t(lang, "allocChains")}</div>
          ${renderConicDonut(chainSeg)}
          <ul class="an-legend">${chainSeg.map((s) => `<li><span style="background:${s.color}"></span>${esc(s.label)} <b>${fmtUsd(s.value)}</b></li>`).join("")}</ul>
        </div>
        <div class="an-card an-bars">
          <div class="an-lbl">${t(lang, "structure")}</div>
          <div class="bar-row"><span>${t(lang, "wallet")}</span><div class="bar-track"><div class="bar-fill wallet" style="width:${walletPct}%"></div></div><b>${walletPct}%</b></div>
          <div class="bar-row"><span>${t(lang, "liquidity")}</span><div class="bar-track"><div class="bar-fill liq" style="width:${liqPct}%"></div></div><b>${liqPct}%</b></div>
          <div class="bar-row"><span>${t(lang, "lending")}</span><div class="bar-track"><div class="bar-fill lend" style="width:${lendPct}%"></div></div><b>${lendPct}%</b></div>
          <p class="an-note">${t(lang, "chartNote")}${(d.coverageGapUsd ?? 0) > 0.5 ? ` · ${t(lang, "coverageGapNote", { gap: fmtUsd(d.coverageGapUsd) })}` : ""}</p>
        </div>
      </div>
    </section>`;
}

function renderConicDonut(segments) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let pct = 0;
  const stops = segments.map((seg) => {
    const start = pct;
    pct += (seg.value / total) * 100;
    return `${seg.color} ${start}% ${pct}%`;
  });
  const bg = stops.length ? `conic-gradient(${stops.join(", ")})` : "conic-gradient(#333 0% 100%)";
  return `<div class="donut" style="background:${bg}"><div class="donut-hole"></div></div>`;
}

function renderLendAssetRows(items, variant) {
  if (!items?.length) {
    return `<p class="lend-empty">${t(lang, variant === "sup" ? "lendNoCollateral" : "lendNoDebt")}</p>`;
  }
  return items
    .map(
      (x) => `
    <div class="lend-asset-row lend-asset-row--${variant}">
      <span class="lend-asset-sym">${esc(x.asset)}</span>
      <span class="lend-asset-amt">${esc(x.amount)}</span>
      <span class="lend-asset-usd">${fmtUsd(x.usd, true)}</span>
    </div>`,
    )
    .join("");
}

function formatLiqPrice(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  const v = Number(n);
  if (v >= 1000) return `$${Math.round(v).toLocaleString("en-US")}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

function renderLending(list) {
  return `<div class="lend-list">${(list || [])
    .map((p) => {
      const hf = p.healthFactor;
      const hfClass =
        hf != null && hf < 1.2 ? " lend-hf--warn" : hf != null && hf < 1.5 ? " lend-hf--mid" : "";
      const supUsd = (p.supplied || []).reduce((s, x) => s + (x.usd || 0), 0);
      const borUsd = (p.borrowed || []).reduce((s, x) => s + (x.usd || 0), 0);
      const rewUsd = p.rewardsUsd || 0;
      return `
      <article class="lend-card">
        <header class="lend-card-head">
          <div class="lend-card-title">
            <span class="lend-protocol">${esc(p.protocol)}</span>
            ${chainPill(p.chain)}
          </div>
          <div class="lend-net">
            <span class="lend-net-lbl">${t(lang, "netPosition")}</span>
            <strong>${fmtUsd(p.netUsd, true)}</strong>
          </div>
        </header>
        <div class="lend-metrics">
          <div class="lend-metric">
            <span>${t(lang, "collateralLbl")}</span>
            <strong>${fmtUsd(supUsd, true)}</strong>
          </div>
          <div class="lend-metric lend-metric--debt">
            <span>${t(lang, "debtLbl")}</span>
            <strong>${fmtUsd(borUsd, true)}</strong>
          </div>
          ${
            hf != null
              ? `<div class="lend-metric${hfClass}"><span>${t(lang, "healthFactor")}</span><strong>${esc(String(hf))}</strong></div>`
              : ""
          }
          ${
            p.liquidationPrice != null
              ? `<div class="lend-metric"><span>${t(lang, "liquidationLbl")}</span><strong>${esc(formatLiqPrice(p.liquidationPrice))}</strong></div>`
              : ""
          }
        </div>
        <div class="lend-columns">
          <section class="lend-col lend-col--sup">
            <h4>${t(lang, "suppliedLbl")}</h4>
            ${renderLendAssetRows(p.supplied, "sup")}
          </section>
          <section class="lend-col lend-col--bor">
            <h4>${t(lang, "borrowedLbl")}</h4>
            ${renderLendAssetRows(p.borrowed, "bor")}
          </section>
        </div>
        ${
          rewUsd > 0.001
            ? `<p class="lend-rewards">${t(lang, "rewardsLbl")}: ${fmtUsd(rewUsd, true)}</p>`
            : ""
        }
      </article>`;
    })
    .join("")}</div>`;
}

function reattachRevert() {
  if (!state.data?.protocolGroups?.length) return;
  const w = state.data.wallet?.toLowerCase();
  if (state.revertWallet && w && state.revertWallet !== w) return;
  applyPortfolioPipeline(state.data, {
    revertPositions: state.revertPositions,
    krystalPositions: state.krystalPositions,
  });
  syncDisplayTotals(state.data);
}

function mergeRangeFields(fromPortfolio) {
  if (!state.data?.protocolGroups?.length || !fromPortfolio?.protocolGroups) return false;
  const idx = new Map();
  for (const g of fromPortfolio.protocolGroups) {
    for (const p of g.liquidity || []) {
      const tid = String(p.poolId || "").match(/#(\d+)/)?.[1];
      const key = tid
        ? `tid:${tid}`
        : `${g.protocol}|${chainSlug(p.chain)}|${String(p.poolId || p.pair || "").toLowerCase()}`;
      idx.set(key, p);
    }
  }
  let n = 0;
  for (const g of state.data.protocolGroups) {
    for (const p of g.liquidity || []) {
      const tid = String(p.poolId || "").match(/#(\d+)/)?.[1];
      const key = tid
        ? `tid:${tid}`
        : `${g.protocol}|${chainSlug(p.chain)}|${String(p.poolId || p.pair || "").toLowerCase()}`;
      const src = idx.get(key);
      if (!src) continue;
      if (src.rangeMin != null && src.rangeMax != null) {
        p.rangeMin = src.rangeMin;
        p.rangeMax = src.rangeMax;
        p.rangeCurrent = src.rangeCurrent;
        p.feeTier = src.feeTier || p.feeTier;
        p.onchainMetrics = src.onchainMetrics ?? p.onchainMetrics;
        n++;
      }
      if (src.revert && !p.revert) p.revert = src.revert;
    }
  }
  return n > 0;
}

async function fetchLpRanges(wallet) {
  const q = new URLSearchParams({ wallet, _: String(Date.now()) });
  const r = await fetchWithTimeout(apiUrl(`/api/enrich-ranges?${q}`), 120000);
  const j = await r.json();
  if (!r.ok || !j.ok || !j.portfolio) throw new Error(j.error || "RANGES_FAILED");
  return j.portfolio;
}

function applyPortfolio(p, wallet) {
  applyPortfolioPipeline(p, {
    revertPositions: state.revertPositions,
    krystalPositions: state.krystalPositions,
  });
  const walletUsd = p.walletUsd;
  const liqUsd = p.liqUsd;
  const lendUsd = p.lendUsd;
  state.data = {
    wallet,
    fetchedAt: Date.now(),
    partial: !!p.partial,
    fromCache: !!p._cached || !!p.fromCache,
    fromDebankApi: !!p.fromDebankApi,
    source: p.source,
    totalUsd: p.totalUsd,
    computedTotalUsd: p.computedTotalUsd,
    debankTotalUsd: p.debankTotalUsd,
    coverageGapUsd: p.coverageGapUsd,
    chains: p.chains || [],
    protocolGroups: p.protocolGroups || [],
    walletTokens: p.walletTokens || [],
    lending: p.lending || [],
    liquidity: p.liquidity || [],
    walletUsd,
    liqUsd,
    lendUsd,
    schemaVersion: PORTFOLIO_SCHEMA,
  };
  reattachRevert();
}

function accKeyFromEl(el) {
  return el?.getAttribute?.("data-acc") || el?.dataset?.acc || "";
}

function toggleAccordionKey(key) {
  if (!key) return;
  if (state.collapsed.has(key)) state.collapsed.delete(key);
  else state.collapsed.add(key);
  saveCollapsed();
}

/** Раскрытие секций без полного render() — иначе клики «не работают» при тяжёлом DOM. */
function toggleAccordionDom(accBtn) {
  const key = accKeyFromEl(accBtn);
  if (!key) return;
  toggleAccordionKey(key);
  const open = isOpen(key);
  const acc = accBtn.closest(".acc");
  if (acc) acc.classList.toggle("open", open);
  accBtn.setAttribute("aria-expanded", open ? "true" : "false");
  const panel = acc?.querySelector(":scope > .acc-panel");
  if (panel) panel.setAttribute("aria-hidden", open ? "false" : "true");
}

function updateLoadPreview(p) {
  const el = $("loadPreview");
  if (!el || !p) return;
  const groups = (p.protocolGroups || []).slice(0, 8);
  const chains = (p.chains || []).slice(0, 5);
  el.innerHTML = `
    <div class="lp-total">${fmtUsd(p.totalUsd)}</div>
    <div class="lp-row">${chains.map((c) => `<span class="lp-chip">${chainBadgeHtml(c.slug, 18)} ${fmtUsd(c.usd)}</span>`).join("")}</div>
    <div class="lp-row">${groups.map((g) => `<span class="lp-chip">${esc(pillLabel(g, groups))} ${fmtUsd(g.protocolUsd)}</span>`).join("")}</div>`;
  el.hidden = false;
}

function updateNavActive() {
  $("balanceHero")?.classList.toggle(
    "active",
    state.view === "all" && !state.chainFilter && !state.protocolFilter,
  );
  $("kpiWallet")?.classList.toggle("active", state.view === "wallet");
  $("kpiLiq")?.classList.toggle("active", state.view === "liquidity");
  $("kpiLend")?.classList.toggle("active", state.view === "lending");
}

function render() {
  const d = state.data;
  if (!d) return;

  $("walletAddr").textContent = d.wallet;
  $("walletAddr").title = d.wallet;
  const ft = computeFilteredTotals(d);
  $("totalUsd").textContent = fmtUsd(ft.total);
  $("walletSum").textContent = fmtUsd(ft.wallet);
  $("liqSum").textContent = fmtUsd(ft.liq);
  $("lendSum").textContent = fmtUsd(ft.lend);
  const src = d.fromCache ? t(lang, "fromCache") : "";
  $("updatedAt").textContent =
    `${t(lang, "updated")}: ${new Date(d.fetchedAt).toLocaleString(lang === "ru" ? "ru-RU" : "en-US")}${src ? ` · ${src}` : ""}`;

  const banner = $("partialBanner");
  if (banner) {
    const show = d.partial || state.revertLoading || state.enriching || state.dataReadyFlash;
    banner.hidden = !show;
    if (state.dataReadyFlash) banner.textContent = t(lang, "partialReady");
    else if (d.partial) banner.textContent = t(lang, "partialBanner");
    else if (state.revertLoading) banner.textContent = t(lang, "revertLoading");
    else if (state.enriching) banner.textContent = t(lang, "enrichingBanner");
    else banner.textContent = "";
  }

  ensureIntroCollapsed();

  $("chainBreakdown").innerHTML = renderChainBreakdown(d.chains || []);
  const analyticsReady =
    state.view === "all" &&
    !state.protocolFilter &&
    !state.chainFilter &&
    !d.partial &&
    !state.enriching;
  $("analytics").innerHTML = analyticsReady ? renderAnalytics(d) : "";
  renderHistorySection();

  updateNavActive();

  const groups = getVisibleGroups();
  const pillSource =
    state.view === "liquidity"
      ? (d.protocolGroups || []).filter((g) => g.liquidity?.length)
      : state.view === "lending"
        ? (d.protocolGroups || []).filter((g) => g.lending?.length)
        : d.protocolGroups || [];

  const rev = countRevertLpStats();
  let revertHdr = "";
  const hm = d.hybridMeta || {};
  if (d.source === "hybrid" || d.hybrid) {
    revertHdr = `<p class="revert-stats">${t(lang, "portfolioHybrid", {
      onchainUsd: fmtUsd(hm.onchainUsd ?? 0),
      totalUsd: fmtUsd(d.totalUsd ?? 0),
      fill: hm.fillCount ?? d.stats?.debankFillCount ?? 0,
    })}</p><p class="revert-stats sub">${t(lang, "portfolioHybridHint")}</p>`;
    if (hm.computedUsd != null && Math.abs((hm.gapUsd ?? 0) / (d.totalUsd || 1)) > 0.03) {
      revertHdr += `<p class="revert-stats sub">${t(lang, "portfolioHybridGap", {
        computed: fmtUsd(hm.computedUsd),
        gap: fmtUsd(Math.abs(hm.gapUsd ?? 0)),
      })}</p>`;
    }
  } else if (d.onchain || d.source === "onchain") {
    const st = d.stats || {};
    revertHdr = `<p class="revert-stats">${t(lang, "portfolioOnchain", {
      lp: st.lpCount ?? rev.total,
      lend: st.lendCount ?? 0,
      chains: st.chains ?? (d.chains || []).length,
    })}</p><p class="revert-stats sub">${t(lang, "portfolioOnchainHint")}</p>`;
  }

  if (
    (state.view === "all" || state.view === "liquidity") &&
    (rev.total > 0 || rev.revertCount > 0)
  ) {
    revertHdr += `<p class="revert-stats">${t(lang, "revertLpStats", rev)}</p>`;
    const sumVars = {
      ...rev,
      debankDexUsd: (rev.debankDexUsd ?? 0).toFixed(2),
      revertDexUsd: (rev.revertDexUsd ?? 0).toFixed(2),
    };
    if (rev.sumMatched) {
      revertHdr += `<p class="revert-stats sub">${t(lang, "revertSumOk", sumVars)}</p>`;
    } else if (rev.revertCount > 0) {
      revertHdr += `<p class="revert-stats sub">${t(lang, "revertSumDiff", sumVars)}</p>`;
    }
    if (state.revertLoading) {
      revertHdr += `<p class="revert-stats sub">${t(lang, "rangesLoading")}</p>`;
    } else if (state.rangesEnriched > 0) {
      revertHdr += `<p class="revert-stats sub">${t(lang, "rangesOk", { n: state.rangesEnriched, total: rev.total })}</p>`;
    } else if (state.rangesError && state.rangesError !== "NO_RANGES") {
      revertHdr += `<p class="revert-stats warn">${t(lang, "rangesMissing")}</p>`;
    } else if (!state.revertLoading && rev.total > 0 && state.rangesEnriched === 0) {
      revertHdr += `<p class="revert-stats warn">${t(lang, "rangesMissing")}</p>`;
    }
    if (state.revertApiError) {
      revertHdr += `<p class="revert-stats warn">${t(lang, "revertFailed")} (${esc(state.revertApiError)})</p>`;
    } else if (rev.revertCount === 0) {
      revertHdr += `<p class="revert-stats sub">${t(lang, "revertEmpty")}</p>`;
    } else if (rev.fromRevert === 0 && rev.debankDexCount > 0) {
      revertHdr += `<p class="revert-stats warn">${t(lang, "revertNoReplace")}</p>`;
    }
    if (state.revertOnchainEnriched > 0) {
      revertHdr += `<p class="revert-stats sub">${t(lang, "revertOnchainLine", { n: state.revertOnchainEnriched })}</p>`;
    }
  }

  $("positions").innerHTML =
    renderFilterBanner() +
    (state.view === "all" ? renderProtocolPills(pillSource) : renderProtocolPills(groups)) +
    revertHdr +
    `<div class="proto-cards">${renderPositionsLayout(groups)}</div>`;

  renderLoadProgress();
}

function hideHistoryChart() {
  const wrap = $("historyChartWrap");
  if (!wrap) return;
  wrap.hidden = true;
  wrap.classList.remove("is-ready");
  if (state.historyChartCleanup) {
    state.historyChartCleanup();
    state.historyChartCleanup = null;
  }
}

function renderHistorySection() {
  const wrap = $("historyChartWrap");
  const canvas = $("historyCanvas");
  if (!wrap || !canvas) return;

  const canShow =
    state.data &&
    state.view === "all" &&
    !state.chainFilter &&
    !state.protocolFilter &&
    !state.historyLoading &&
    state.historySeries?.length > 0;

  if (!canShow) {
    hideHistoryChart();
    return;
  }

  wrap.hidden = false;
  const status = $("historyStatus");
  if (status) status.textContent = `${t(lang, "historyNote")} · ${t(lang, "historyChartHint")}`;
  if (state.historyChartCleanup) state.historyChartCleanup();
  state.historyChartCleanup = setupHistoryChart(canvas, state.historySeries, lang);
  requestAnimationFrame(() => wrap.classList.add("is-ready"));
}

async function fetchHistory(wallet) {
  state.historyLoading = true;
  setLoadStep("history", "active");
  renderHistorySection();
  try {
    const r = await fetchWithTimeout(
      apiUrl(`/api/history?wallet=${encodeURIComponent(wallet)}&_=${Date.now()}`),
      60000,
    );
    const data = await r.json();
    state.historySeries = data.ok && data.series?.length ? data.series : null;
  } catch {
    state.historySeries = null;
  } finally {
    state.historyLoading = false;
    setLoadStep("history", "done");
    renderHistorySection();
    renderLoadProgress();
  }
}

function applyI18n() {
  document.documentElement.lang = lang;
  $("logo").textContent = t(lang, "brand");
  $("heroTitle").textContent = t(lang, "brand");
  $("heroTag").textContent = t(lang, "tagline");
  $("walletInput").placeholder = t(lang, "placeholder");
  $("goBtn").textContent = t(lang, "go");
  $("backBtn").textContent = t(lang, "back");
  $("kpiTotalLbl").textContent = t(lang, "total");
  $("kpiWalletLbl").textContent = t(lang, "wallet");
  $("kpiLiqLbl").textContent = t(lang, "liquidity");
  $("kpiLendLbl").textContent = t(lang, "lending");
  $("walletLbl").textContent = t(lang, "walletAddress");
  $("refreshBtn").textContent = t(lang, "refresh");
  const ht = $("historyTitle");
  if (ht) ht.textContent = t(lang, "historyTitle");
  const hs = $("historyStatus");
  if (hs && state.historySeries?.length && !state.historyLoading) {
    hs.textContent = `${t(lang, "historyNote")} · ${t(lang, "historyChartHint")}`;
  }
  document.querySelectorAll(".lang-switch button").forEach((b) => {
    b.classList.toggle("active", b.dataset.lang === lang);
  });
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    if (key) el.textContent = t(lang, key);
  });
  if (state.data) render();

  const lw = $("lastWalletHint");
  if (lw) {
    try {
      const last = localStorage.getItem("pt-last-wallet");
      if (last && !state.data) {
        lw.innerHTML = `<button type="button" class="last-wallet-btn" data-wallet="${esc(last)}">${t(lang, "lastWallet")}: ${esc(last.slice(0, 6))}…${esc(last.slice(-4))}</button>`;
        lw.hidden = false;
      } else lw.hidden = true;
    } catch {
      lw.hidden = true;
    }
  }
}

function setLoading(on, msg, phase, preview) {
  const el = $("loading");
  if (!el) return;
  el.hidden = !on;
  if (on) el.removeAttribute("aria-hidden");
  else el.setAttribute("aria-hidden", "true");
  $("loadingMsg").textContent = msg || t(lang, "loadingConnect");
  if (preview) updateLoadPreview(preview);
  const steps = $("loadSteps");
  if (steps) {
    steps.querySelectorAll("li").forEach((li) => {
      const p = li.dataset.phase;
      li.classList.remove("done", "active");
      if (phase === p) li.classList.add("active");
      else if (
        (phase === "chains" && p === "connect") ||
        (phase === "merge" && (p === "connect" || p === "chains")) ||
        (phase === "done" && p !== "merge")
      ) {
        li.classList.add("done");
      }
    });
  }
  $("goBtn").disabled = on;
  if (on) $("refreshBtn")?.setAttribute("disabled", "");
  else $("refreshBtn")?.removeAttribute("disabled");
}

function showResults() {
  $("home").hidden = true;
  $("results").hidden = false;
  $("refreshBtn").hidden = false;
}

async function fetchRevert(wallet, { force = false, keepStale = false } = {}) {
  const prevPositions =
    keepStale && state.revertWallet === wallet.toLowerCase() && state.revertPositions?.length
      ? [...state.revertPositions]
      : [];
  state.revertLoading = true;
  setLoadStep("ranges", "active");
  setLoadStep("apy", "pending");
  const banner = $("partialBanner");
  if (banner && state.data) {
    banner.hidden = false;
    banner.textContent = t(lang, "revertLoading");
  }

  const applyRevertResponse = (data) => {
    if (!data?.ok) return false;
    state.revertApiError = null;
    state.revertPositionsCount = data.count ?? data.positions?.length ?? 0;
    state.revertPositions = data.positions || [];
    state.revertWallet = wallet.toLowerCase();
    state.revertOnchainEnriched = data.onchainEnriched || 0;
    state.revertDataSource = data.source || "revert";
    if (state.data) reattachRevert();
    return (state.revertPositions || []).length > 0;
  };

  const requestRevert = async (refresh) => {
    const q = new URLSearchParams({ wallet, _: String(Date.now()) });
    if (refresh) q.set("refresh", "1");
    const r = await fetchWithTimeout(apiUrl(`/api/revert?${q}`), 120000);
    return r.json();
  };

  try {
    let data = await requestRevert(force);
    if (!data.ok && !force) {
      data = await requestRevert(true);
    }
    if (applyRevertResponse(data)) {
      if (state.data) render();
    } else if (!data.ok) {
      state.revertPositionsCount = 0;
      state.revertApiError = data.error || data.warning || "REVERT_FAILED";
      if (prevPositions.length) {
        state.revertPositions = prevPositions;
        state.revertPositionsCount = prevPositions.length;
        if (state.data) reattachRevert();
      }
    } else if (!state.revertPositions.length && prevPositions.length) {
      state.revertPositions = prevPositions;
      state.revertPositionsCount = prevPositions.length;
      if (state.data) reattachRevert();
    }

    if (!force && data.ok && (data.cached || data.stale)) {
      requestRevert(true)
        .then((fresh) => {
          if (applyRevertResponse(fresh) && state.data) render();
        })
        .catch((e) => console.warn("revert refresh", e));
    }
  } catch (e) {
    console.warn("revert", e);
    state.revertApiError = "NETWORK";
    state.revertPositionsCount = 0;
    if (!keepStale) {
      state.revertPositions = [];
    } else if (prevPositions.length) {
      state.revertPositions = prevPositions;
      state.revertPositionsCount = prevPositions.length;
      if (state.data) reattachRevert();
    }
  } finally {
    state.revertLoading = false;
    setLoadStep("apy", "done");
    if (state.data) render();
    renderLoadProgress();
  }
}

async function fetchKrystalEnrich(wallet) {
  state.krystalError = null;
  setLoadStep("merge", "active");
  try {
    const q = new URLSearchParams({ wallet, _: String(Date.now()) });
    const r = await fetchWithTimeout(apiUrl(`/api/enrich-krystal?${q}`), 120000);
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || "KRYSTAL_FAILED");
    state.krystalPositions = j.positions || [];
    if (j.portfolio && state.data) {
      applyPortfolio(j.portfolio, wallet);
    } else if (state.data) {
      applyPortfolio(state.data, wallet);
    }
    render();
    return true;
  } catch (e) {
    console.warn("krystal", e);
    state.krystalError = e.message || "KRYSTAL_FAILED";
    return false;
  } finally {
    setLoadStep("merge", "done");
    renderLoadProgress();
  }
}

async function runEnrichmentPipeline(wallet, { refresh = false } = {}) {
  if (state.enriching) return;
  state.enriching = true;
  state.krystalPositions = [];
  state.krystalError = null;
  render();

  try {
    // 1) Revert — Uni V3/V4, Aerodrome, Pancake (ranges, APY)
    await fetchRevert(wallet, { force: refresh, keepStale: true });

    // 2) Krystal — прочие DEX LP
    await fetchKrystalEnrich(wallet);

    // 3) On-chain LP ranges (RPC fallback)
    setLoadStep("ranges", "active");
    state.rangesError = null;
    state.rangesEnriched = 0;
    try {
      const enriched = await fetchLpRanges(wallet);
      if (mergeRangeFields(enriched)) {
        state.rangesEnriched = (state.data?.protocolGroups || []).reduce(
          (n, g) =>
            n + (g.liquidity || []).filter((p) => p.rangeMin != null && p.rangeMax != null).length,
          0,
        );
      } else {
        state.rangesError = "NO_RANGES";
      }
      render();
    } catch (e) {
      console.warn("lp ranges", e);
      state.rangesError = e.message || "RANGES_FAILED";
    } finally {
      setLoadStep("ranges", "done");
      renderLoadProgress();
    }

    // 4) History chart (parallel-safe, lightweight)
    await fetchHistory(wallet);
  } finally {
    state.enriching = false;
    if (state.data) {
      state.data.partial = false;
      applyPortfolio(state.data, wallet);
      saveCache(wallet, state.data);
      finishLoadProgress();
      state.dataReadyFlash = true;
      render();
      hideLoadProgressSoon();
      setTimeout(() => {
        state.dataReadyFlash = false;
        render();
      }, 2800);
    }
    setLoading(false);
  }
}

async function backgroundEnrich(wallet, opts) {
  return runEnrichmentPipeline(wallet, opts);
}

function resetDeferredSections() {
  state.historySeries = null;
  state.historyLoading = false;
  hideHistoryChart();
}

async function loadPortfolio(wallet, { refresh = false, silent = false } = {}) {
  if (state.fetching) return;
  state.fetching = true;
  state.enriching = false;
  state.revertApiError = null;
  state.krystalError = null;
  if (!silent) {
    state.revertPositions = [];
    state.krystalPositions = [];
    state.revertPositionsCount = 0;
    state.revertWallet = null;
  }
  resetDeferredSections();

  if (!silent) {
    resetLoadProgress();
    showResults();
    setLoadStep("connect", "active");
    setLoading(true, t(lang, "loadingQuick"), "connect");
  } else {
    $("refreshBtn")?.classList.add("spinning");
  }

  try {
    if (!(await checkApiReady())) {
      if (!(await waitForApi(15000))) throw new Error("NO_API");
    }

    if (!silent) {
      setLoadStep("connect", "done");
      setLoadStep("debank", "active");
      dismissBlockingLoader(12);
    }

    const cached = !refresh && !silent && loadCache(wallet);
    if (cached) {
      applyPortfolio({ ...cached, partial: !!cached.partial }, wallet);
      setLoadStep("debank", "done");
      setLoadStep("positions", "done");
      state.loadPct = cached.partial ? 55 : 72;
      renderLoadProgress();
      render();
      if (!cached.partial) saveCache(wallet, state.data);
      void runEnrichmentPipeline(wallet, { refresh: false });
      if (cached.partial && !cached.fromDebankApi) void backgroundFullDebank(wallet, { refresh });
    } else {
      let gotFullDebank = false;
      if (!refresh && !silent) {
        try {
          const preview = await fetchPortfolio(wallet, {
            source: "debank",
            quick: true,
            refresh: false,
          });
          const isApi = !!preview.fromDebankApi;
          applyPortfolio({ ...preview, partial: isApi ? !!preview.partial : true }, wallet);
          setLoadStep("debank", "done");
          setLoadStep("positions", "done");
          state.loadPct = isApi && !preview.partial ? 72 : 58;
          renderLoadProgress();
          render();
          if (isApi && !preview.partial) {
            saveCache(wallet, state.data);
            gotFullDebank = true;
          }
        } catch (e) {
          console.warn("debank preview", e);
          if (!state.data) throw e;
        }
      } else if (!silent && refresh) {
        try {
          const p = await fetchPortfolio(wallet, {
            source: "debank",
            quick: false,
            refresh,
          });
          p.partial = false;
          applyPortfolio(p, wallet);
          saveCache(wallet, state.data);
          setLoadStep("debank", "done");
          setLoadStep("positions", "done");
          state.loadPct = 72;
          renderLoadProgress();
          render();
          gotFullDebank = true;
        } catch (e) {
          console.warn("full debank", e);
          if (!state.data) throw e;
        }
      }

      if (!gotFullDebank && !state.data?.fromDebankApi)
        void backgroundFullDebank(wallet, { refresh });
      void runEnrichmentPipeline(wallet, { refresh });
    }

    try {
      localStorage.setItem("pt-last-wallet", wallet);
    } catch {
      /* */
    }
    const q = new URLSearchParams(window.location.search);
    q.set("wallet", wallet);
    const base = getAppBase();
    const path = base ? `${base}/` : location.pathname.replace(/\/[^/]*$/, "/") || "/";
    window.history.replaceState({}, "", `${path}?${q.toString()}`);

    if (!silent && (state.data?.totalUsd ?? 0) < 0.001 && !state.data?.protocolGroups?.length) {
      $("error").textContent = t(lang, "errEmptyPortfolio");
      $("error").hidden = false;
    }
  } catch (e) {
    console.error(e);
    if (!silent) {
      state.data = null;
      $("results").hidden = true;
      $("home").hidden = false;
      $("refreshBtn").hidden = true;
      const aborted = e.name === "AbortError" || /aborted/i.test(String(e.message || ""));
      const msg =
        e.message === "NO_API"
          ? noApiMessage()
          : aborted
            ? t(lang, "errFetch")
            : e.message === "FETCH_FAILED" || e.message.startsWith("HTTP_")
              ? `${t(lang, "errFetch")} (${e.message})`
              : e.message === "PARSE_FAILED" || e.message.includes("PARSE_FAILED")
                ? t(lang, "errParse")
                : `${t(lang, "errFetch")} (${e.message})`;
      $("error").textContent = msg;
      $("error").hidden = false;
    }
    setLoading(false);
    if (!silent) hideLoadProgressSoon();
  } finally {
    state.fetching = false;
    $("refreshBtn")?.classList.remove("spinning");
    $("loadPreview").hidden = true;
    if (!state.enriching) renderLoadProgress();
  }
}

function extractWalletFromClipboard(text) {
  const raw = String(text || "").trim();
  const m = raw.match(/0x[a-fA-F0-9]{40}/i);
  if (m) return m[0];
  if (/^[a-fA-F0-9]{40}$/i.test(raw)) return `0x${raw}`;
  return null;
}

function focusWalletInput() {
  const input = $("walletInput");
  if (!input || $("home")?.hidden) return;
  try {
    input.focus({ preventScroll: true });
  } catch {
    input.focus();
  }
}

function setupWalletPasteAutoScan() {
  const input = $("walletInput");
  if (!input) return;

  focusWalletInput();
  requestAnimationFrame(focusWalletInput);
  window.addEventListener("focus", () => {
    if (!$("home")?.hidden) focusWalletInput();
  });

  document.addEventListener(
    "paste",
    (e) => {
      const target = e.target;
      if (
        target &&
        target !== input &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }

      const wallet = extractWalletFromClipboard(e.clipboardData?.getData("text/plain") || "");
      if (!wallet) return;

      e.preventDefault();
      input.value = wallet;
      $("error").hidden = true;
      focusWalletInput();

      if (state.fetching) return;
      void (async () => {
        if (!(await checkApiReady()) && !(await waitForApi(12000))) {
          $("error").textContent = noApiMessage();
          $("error").hidden = false;
          return;
        }
        await scanWallet();
      })();
    },
    true,
  );
}

async function scanWallet() {
  let wallet = $("walletInput").value.trim();
  if (!wallet) {
    $("error").textContent = t(lang, "errEmpty");
    $("error").hidden = false;
    return;
  }
  if (!wallet.startsWith("0x")) wallet = "0x" + wallet;
  if (!/^0x[a-fA-F0-9]{40}$/i.test(wallet)) {
    $("error").textContent = t(lang, "errEvm");
    $("error").hidden = false;
    return;
  }

  $("error").hidden = true;
  state.view = "all";
  state.chainFilter = null;
  state.protocolFilter = null;

  await loadPortfolio(wallet, { refresh: false, silent: false });
}

function resetToAll() {
  state.view = "all";
  state.chainFilter = null;
  state.protocolFilter = null;
  state.poolDetailKey = null;
  render();
}

function setPortfolioView(view) {
  state.view = view;
  state.protocolFilter = null;
  state.chainFilter = null;
  state.poolDetailKey = null;
  render();
}

function handleUiClick(e) {
  if ($("loading") && !$("loading").hidden) return;
  if ($("results")?.hidden) return;

  const chainCard = e.target.closest(".chain-card");
  if (chainCard && $("chainBreakdown")?.contains(chainCard)) {
    e.preventDefault();
    const ch = chainSlug(chainCard.getAttribute("data-chain") || chainCard.dataset.chain);
    state.chainFilter = chainSlug(state.chainFilter) === ch ? null : ch;
    render();
    return;
  }

  const root = $("positions");
  if (!root) return;

  const poolBtn = e.target.closest("[data-pool-detail]");
  if (poolBtn && root.contains(poolBtn)) {
    const key = poolBtn.dataset.poolDetail;
    state.poolDetailKey = state.poolDetailKey === key ? null : key;
    render();
    return;
  }
  if (e.target.closest("[data-action=clear-filters]")) {
    state.chainFilter = null;
    state.protocolFilter = null;
    render();
    return;
  }
  const pill = e.target.closest(".proto-pill");
  if (pill && root.contains(pill)) {
    const id = pill.dataset.protoId || null;
    state.protocolFilter = id || null;
    if (!id) state.chainFilter = null;
    state.view = "all";
    render();
    return;
  }
  const acc = e.target.closest("[data-acc]");
  if (acc && root.contains(acc)) {
    e.preventDefault();
    e.stopPropagation();
    toggleAccordionDom(acc);
    return;
  }
}

async function ensureServerOnLoad() {
  if (
    location.protocol.startsWith("http") &&
    (location.hostname === "127.0.0.1" || location.hostname === "localhost") &&
    location.port !== "5500"
  ) {
    location.replace(
      "http://127.0.0.1:5500/index.html" + (location.search || "") + (location.hash || ""),
    );
    return;
  }
  const ok = await waitForApi(15000);
  if (!ok) {
    $("error").textContent = noApiMessage();
    $("error").hidden = false;
    $("goBtn").disabled = true;
  }
}

function ensureHostedBasePath() {
  if (!/\.pythonanywhere\.com$/i.test(location.hostname)) return;
  if (location.pathname.match(/^\/portfolio(?:\/|$)/i)) return;
  location.replace(`/portfolio/${location.search}${location.hash}`);
}

function init() {
  ensureHostedBasePath();
  loadCollapsed();
  applyI18n();
  setupWalletPasteAutoScan();
  ensureServerOnLoad();

  document.querySelectorAll(".lang-switch button").forEach((btn) => {
    btn.addEventListener("click", () => {
      lang = btn.dataset.lang;
      localStorage.setItem(LANG_KEY, lang);
      applyI18n();
    });
  });

  $("scanForm").addEventListener("submit", (e) => {
    e.preventDefault();
    scanWallet();
  });

  $("lastWalletHint")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-wallet]");
    if (!btn) return;
    $("walletInput").value = btn.dataset.wallet;
    scanWallet();
  });

  $("balanceHero")?.addEventListener("click", resetToAll);
  $("kpiWallet")?.addEventListener("click", () => setPortfolioView("wallet"));
  $("kpiLiq")?.addEventListener("click", () => setPortfolioView("liquidity"));
  $("kpiLend")?.addEventListener("click", () => setPortfolioView("lending"));

  document.addEventListener("click", handleUiClick, true);

  $("refreshBtn")?.addEventListener("click", () => {
    if (state.data?.wallet) loadPortfolio(state.data.wallet, { refresh: true, silent: true });
  });

  $("backBtn").addEventListener("click", () => {
    state.data = null;
    $("results").hidden = true;
    $("home").hidden = false;
    window.history.replaceState({}, "", window.location.pathname);
    focusWalletInput();
  });

  const w = new URLSearchParams(window.location.search).get("wallet");
  if (w) {
    $("walletInput").value = w;
    void (async () => {
      if (!(await checkApiReady()) && !(await waitForApi(15000))) return;
      const cached = loadCache(w);
      if (cached) {
        applyPortfolio({ ...cached, _cached: true, partial: !!cached.partial }, w);
        showResults();
        dismissBlockingLoader(cached.partial ? 58 : 72);
        render();
        void runEnrichmentPipeline(w, { refresh: false });
        if (cached.partial && !cached.fromDebankApi)
          void backgroundFullDebank(w, { refresh: false });
        return;
      }
      await scanWallet();
    })();
  }
}

init();
