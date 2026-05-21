(function () {
  const CHAIN_META = {
    eth: { label: "Ethereum", color: "#627eea", debank: "eth", tw: "ethereum" },
    ethereum: { label: "Ethereum", color: "#627eea", debank: "eth", tw: "ethereum" },
    op: { label: "Optimism", color: "#ff0420", debank: "op", tw: "optimism" },
    optimism: { label: "Optimism", color: "#ff0420", debank: "op", tw: "optimism" },
    arb: { label: "Arbitrum", color: "#28a0f0", debank: "arb", tw: "arbitrum" },
    arbitrum: { label: "Arbitrum", color: "#28a0f0", debank: "arb", tw: "arbitrum" },
    base: { label: "Base", color: "#0052ff", debank: "base", tw: "base" },
    matic: { label: "Polygon", color: "#8247e5", debank: "matic", tw: "polygon" },
    polygon: { label: "Polygon", color: "#8247e5", debank: "matic", tw: "polygon" },
    bsc: { label: "BNB Chain", color: "#f0b90b", debank: "bsc", tw: "smartchain" },
    hyperliquid: { label: "Hyperliquid", color: "#97fce4", debank: "hyperliquid", tw: "" },
    hype: { label: "Hyperliquid", color: "#97fce4", debank: "hyperliquid", tw: "" }
  };

  function chainSlug(raw) {
    const c = String(raw || "").trim().toLowerCase();
    if (c === "42161") return "arb";
    if (c === "10") return "op";
    if (c === "1") return "eth";
    if (CHAIN_META[c]) return c;
    return c || "unknown";
  }

  function chainLabelUi(raw, instrument) {
    if (instrument === "Hyperliquid") return "Hyperliquid";
    const slug = chainSlug(raw);
    return CHAIN_META[slug]?.label || (raw || "—");
  }

  window.ptChainImgFallback = function (img) {
    const list = (img.dataset.fallbacks || "").split("|").filter(Boolean);
    const idx = list.indexOf(img.src);
    const next = list[idx + 1];
    if (next) {
      img.src = next;
      return;
    }
    img.style.display = "none";
    img.nextElementSibling?.classList.add("show");
  };

  function chainBadgeHtml(raw, size, instrument) {
    if (instrument === "Hyperliquid") return chainBadgeHtml("hyperliquid", size);
    const slug = chainSlug(raw);
    const meta = CHAIN_META[slug] || { label: String(raw || "—"), color: "#6b7cff", debank: slug, tw: "" };
    const urls = [`https://static.debank.com/image/chain/chain_icon/${meta.debank}.png`];
    if (meta.tw) {
      urls.push(`https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${meta.tw}/info/logo.png`);
    }
    const letter = (meta.label || "?").slice(0, 1).toUpperCase();
    return `<span class="chain-icon-wrap" style="--sz:${size}px" title="${meta.label}">
      <img class="chain-icon" src="${urls[0]}" data-fallbacks="${urls.join("|")}" alt="" width="${size}" height="${size}" loading="lazy" onerror="ptChainImgFallback(this)" />
      <span class="chain-icon-fallback" style="background:${meta.color}">${letter}</span>
    </span>`;
  }

  function dexFromLink(link, platform) {
    const s = String(link || "").toLowerCase();
    if (s.includes("aerodrome")) return "Aerodrome V3";
    if (s.includes("pancake")) return "PancakeSwap V3";
    if (s.includes("velodrome")) return "Velodrome";
    if (s.includes("uniswap")) return "Uniswap V3";
    const p = String(platform || "").trim();
    if (p && p !== "Revert Finance" && p !== "DEX") return p;
    return "DEX";
  }

  const RANGE_FLIP_THRESHOLD = 0.5;

  function flipPoolPrice(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return null;
    if (v < RANGE_FLIP_THRESHOLD) return 1 / v;
    return v;
  }

  /** Если значение < 0.5 — это 1/цена пула; приводим к человекочитаемому виду. */
  function normalizeLpRangePrices(lower, upper, current) {
    const a = flipPoolPrice(lower);
    const b = flipPoolPrice(upper);
    const cRaw = current != null && current !== "" ? flipPoolPrice(current) : null;
    if (a == null || b == null) return null;
    const rangeMin = Math.min(a, b);
    const rangeMax = Math.max(a, b);
    const rangeCurrent = cRaw != null ? cRaw : (rangeMin + rangeMax) / 2;
    return { rangeMin, rangeMax, rangeCurrent };
  }

  function applyLpRangeToPosition(p) {
    if (!p) return p;
    const n = normalizeLpRangePrices(p.rangeMin, p.rangeMax, p.rangeCurrent);
    if (n) Object.assign(p, n);
    return p;
  }

  function fmtRangeNum(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
    if (v >= 1) return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
    return v.toLocaleString("en-US", { maximumFractionDigits: 6 });
  }

  function renderRangeBar(r, lang) {
    const pos = applyLpRangeToPosition({ ...r });
    if (pos?.rangeMin == null || pos?.rangeMax == null) return "";
    const min = Number(pos.rangeMin);
    const max = Number(pos.rangeMax);
    const cur = Number(pos.rangeCurrent ?? (min + max) / 2);
    const inRange = cur >= min && cur <= max;
    const span = max - min || Math.max(Math.abs(max), 1) * 0.01;
    const pad = Math.max(span * 0.12, Math.max(0, cur - max, min - cur) * 0.35);
    const trackMin = Math.min(min, cur) - pad;
    const trackMax = Math.max(max, cur) + pad;
    const trackSpan = trackMax - trackMin || 1;
    const segLeft = ((min - trackMin) / trackSpan) * 100;
    const segWidth = (span / trackSpan) * 100;
    const segRight = segLeft + segWidth;
    let markerPct = ((cur - trackMin) / trackSpan) * 100;
    markerPct = Math.max(0.5, Math.min(99.5, markerPct));
    const curLbl = lang === "ru" ? "Цена" : "Price";
    return `<div class="range-bar-wrap${inRange ? "" : " out-range"}">
      <div class="range-bar-head"><span class="range-lbl">${lang === "ru" ? "Диапазон цены" : "Price range"}</span></div>
      <div class="range-bar-stage">
        <div class="range-bar-labels-pos" aria-hidden="true">
          <span class="range-lbl-pos range-lbl-min" style="left:${segLeft.toFixed(2)}%">${fmtRangeNum(min)}</span>
          <span class="range-lbl-pos range-lbl-max" style="left:${segRight.toFixed(2)}%">${fmtRangeNum(max)}</span>
          <span class="range-lbl-pos range-lbl-cur${inRange ? "" : " out"}" style="left:${markerPct.toFixed(2)}%">${curLbl}: ${fmtRangeNum(cur)}</span>
        </div>
        <div class="range-bar">
          <div class="range-track"></div>
          <div class="range-active" style="left:${segLeft.toFixed(2)}%;width:${segWidth.toFixed(2)}%"></div>
          <div class="range-marker" style="left:${markerPct.toFixed(2)}%"></div>
        </div>
      </div>
    </div>`;
  }

  function poolOpenLink(p, ctx) {
    if (!p.link) return "";
    return `<a class="pool-open-link" href="${p.link}" target="_blank" rel="noreferrer">${ctx.t("open")} ↗</a>`;
  }

  function renderRewardsBlock(p, ctx) {
    const usd = Number(p.incentivesUsd || 0);
    const token = String(p.incentiveToken || "").trim();
    if (usd <= 0 || !token) return "";
    const lbl = ctx.lang === "ru" ? "Награды" : "Rewards";
    return `<div class="pool-rewards"><span class="lbl">${lbl}</span><span class="pool-reward-line">${token}: $${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>`;
  }

  function renderLpCard(p, ctx) {
    applyLpRangeToPosition(p);
    const dex =
      p.platform && String(p.platform).trim() && p.platform !== "DEX"
        ? p.platform
        : dexFromLink(p.link, p.platform);
    const aprShown = Number(p.apr || 0) > 0 ? `${Number(p.apr).toFixed(2)}%` : "—";
    const period = `${p.openedAt || "-"} → ${p.closedAt || (ctx.lang === "ru" ? "активна" : "active")}`;
    const statusRu = p.isActive ? "Активна" : "Закрыта";
    const statusEn = p.isActive ? "Active" : "Closed";
    const valBlock = Number(p.valueUsd) > 0 ? ctx.fmtUsdSmart(p.valueUsd) : "—";
    return `<div class="pool-card">
      <div class="pool-card-head">
        ${chainBadgeHtml(p.chain, 28)}
        <div class="pool-card-main">
          <div class="pool-pair-row">
            <span class="pool-pair">${p.pair || "Пул"}</span>
            <span class="pool-status-pill ${p.isActive ? "pool-status-pill--active" : "pool-status-pill--closed"}">${ctx.lang === "ru" ? statusRu : statusEn}</span>
            <span class="badge">${dex}</span>
          </div>
          ${renderRangeBar(p, ctx.lang)}
        </div>
        <div class="pool-card-side">
          <div class="pool-apr-hero">${aprShown}</div>
          ${poolOpenLink(p, ctx)}
        </div>
      </div>
      <div class="pool-meta-grid pool-meta-grid--4">
        <div><div class="lbl">${ctx.lang === "ru" ? "Объём (USD)" : "Value USD"}</div><div>${valBlock}</div></div>
        <div><div class="lbl">${ctx.t("feesTotal")}</div><div>$${Number(p.feesUsd || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></div>
        <div><div class="lbl">Fee Tier</div><div>${ctx.fmtFeeTier(p.feeTier)}</div></div>
        <div><div class="lbl">${ctx.lang === "ru" ? "Период" : "Period"}</div><div>${period}</div></div>
      </div>
      ${renderRewardsBlock(p, ctx)}
    </div>`;
  }

  function fmtUsdShort(n) {
    const v = Number(n || 0);
    if (Math.abs(v) < 0.01) return "$0.00";
    return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function renderLendAssetRows(items, variant, lang) {
    if (!items?.length) {
      const msg = variant === "sup"
        ? (lang === "ru" ? "Нет залога" : "No collateral")
        : (lang === "ru" ? "Нет долга" : "No debt");
      return `<p class="lend-empty">${msg}</p>`;
    }
    return items
      .map(
        (x) => `
    <div class="lend-asset-row lend-asset-row--${variant}">
      <span class="lend-asset-sym">${x.asset || "—"}</span>
      <span class="lend-asset-amt">${Number(x.amount || 0).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
      <span class="lend-asset-usd">${fmtUsdShort(x.usd)}</span>
    </div>`
      )
      .join("");
  }

  function renderLendingCard(p, ctx) {
    const hf = Number(p.healthFactor || 0);
    const hfClass = hf > 0 && hf < 1.2 ? " lend-hf--warn" : hf > 0 && hf < 1.5 ? " lend-hf--mid" : "";
    const supplied = p.supplied?.length
      ? p.supplied
      : [{ asset: p.collateralAsset, amount: p.collateralAmount, usd: p.collateralUsd }];
    const borrowed = p.borrowed?.length
      ? p.borrowed
      : [{ asset: p.borrowAsset, amount: p.borrowAmount, usd: p.borrowUsd || 0 }];
    const supUsd = supplied.reduce((s, x) => s + Number(x.usd || 0), 0);
    const borUsd = borrowed.reduce((s, x) => s + Number(x.usd || 0), 0);
    const netUsd = Number.isFinite(Number(p.netUsd)) ? Number(p.netUsd) : supUsd - borUsd;
    const liqLbl = ctx.lang === "ru" ? "Ликвидация" : "Liq. price";
    return `<article class="lend-card pool-card">
      <header class="lend-card-head">
        <div class="lend-card-title">
          ${chainBadgeHtml(p.chain, 24, "Lending")}
          <span class="lend-protocol">${p.protocol || "Protocol"}</span>
          <span class="badge">Lending</span>
        </div>
        <div class="lend-net">
          <span class="lend-net-lbl">${ctx.lang === "ru" ? "Нетто" : "Net"}</span>
          <strong>${fmtUsdShort(netUsd)}</strong>
        </div>
      </header>
      <div class="lend-metrics">
        <div class="lend-metric">
          <span>${ctx.lang === "ru" ? "Залог" : "Collateral"}</span>
          <strong>${fmtUsdShort(supUsd)}</strong>
        </div>
        <div class="lend-metric lend-metric--debt">
          <span>${ctx.lang === "ru" ? "Долг" : "Debt"}</span>
          <strong>${fmtUsdShort(borUsd)}</strong>
        </div>
        ${
          hf > 0
            ? `<div class="lend-metric${hfClass}"><span>HF</span><strong>${hf.toFixed(2)}</strong></div>`
            : ""
        }
        ${
          Number(p.liquidationPrice || 0) > 0
            ? `<div class="lend-metric"><span>${liqLbl}</span><strong>$${Number(p.liquidationPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></div>`
            : ""
        }
      </div>
      <div class="lend-columns">
        <section class="lend-col lend-col--sup">
          <h4>${ctx.lang === "ru" ? "Залог" : "Supplied"}</h4>
          ${renderLendAssetRows(supplied, "sup", ctx.lang)}
        </section>
        <section class="lend-col lend-col--bor">
          <h4>${ctx.lang === "ru" ? "Долг" : "Borrowed"}</h4>
          ${renderLendAssetRows(borrowed.filter((x) => x.asset || Number(x.amount)), "bor", ctx.lang)}
        </section>
      </div>
      ${p.link ? `<div class="lend-card-foot"><a class="link-btn" href="${p.link}" target="_blank" rel="noreferrer">${ctx.t("open")}</a></div>` : ""}
    </article>`;
  }

  function renderS1Card(p, ctx) {
    applyLpRangeToPosition(p);
    const apr = ctx.s1AprFromPosition(p);
    const fees = ctx.s1FeesFromPosition(p);
    const instrument = p.instrument === "LP" ? "Liquidity Pool" : (p.instrument || "");
    const platform = p.instrument === "LP" ? dexFromLink(p.link, p.platform) : (p.platform || "-");
    return `<div class="pool-card">
      <div class="pool-card-head">
        ${chainBadgeHtml(p.chain, 28, p.instrument)}
        <div class="pool-card-main">
          <div class="pool-pair-row">
            <span class="pool-pair">${p.pair || p.marketId || p.coin || "Position"}</span>
            <span class="badge">${instrument}</span>
          </div>
          ${p.instrument === "LP" ? `<div class="pool-pair-sub">${platform}</div>` : ""}
          ${renderRangeBar(p, ctx.lang)}
        </div>
        <div class="pool-card-side">
          <div class="pool-apr-hero">${apr.toFixed(2)}%</div>
          ${poolOpenLink(p, ctx)}
        </div>
      </div>
      <div class="pool-meta-grid pool-meta-grid--3">
        <div><div class="lbl">Value USD</div><div>${ctx.fmtUsdSmart(p.valueUsd || 0)}</div></div>
        <div><div class="lbl">${ctx.t("feesTotal")}</div><div>${ctx.fmtUsdSmart(fees)}</div></div>
        <div><div class="lbl">Fee Tier</div><div>${ctx.fmtFeeTier(p.feeTier)}</div></div>
      </div>
    </div>`;
  }

  function parseSheetFloat(s) {
    const raw = String(s || "")
      .trim()
      .replace(/\u00a0/g, "")
      .replace(/\u202f/g, "")
      .replace(/\s/g, "");
    if (!raw) return 0;
    let v = raw.replace(",", ".");
    if (v.includes(".") && v.includes(",")) {
      if (v.lastIndexOf(",") > v.lastIndexOf(".")) v = v.replace(/\./g, "").replace(",", ".");
      else v = v.replace(/,/g, "");
    }
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function revertPositionId(link) {
    const m = String(link || "").match(/\/(\d+)(?:\?.*)?$/);
    return m ? m[1] : "";
  }

  function pairKeyFromRow(token0, token1) {
    const a = String(token0 || "").trim();
    const b = String(token1 || "").trim();
    if (!a && !b) return "";
    return `${a} / ${b}`.replace(/\s+/g, " ").trim();
  }

  function normalizeClosedCell(s) {
    const t = String(s || "")
      .trim()
      .replace(/\u00a0/g, " ");
    if (!t) return "";
    const low = t.toLowerCase();
    if (["null", "none", "n/a", "-", "false", "no", "0"].includes(low)) return "";
    return t;
  }

  function parseAprPercentCell(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;
    const hasPct = s.includes("%");
    let t = s.replace(/%/g, "").replace(/\s/g, "");
    if (t.includes(".") && t.includes(",")) {
      if (t.lastIndexOf(",") > t.lastIndexOf(".")) t = t.replace(/\./g, "").replace(",", ".");
      else t = t.replace(/,/g, "");
    } else if (t.includes(",") && !t.includes(".")) {
      t = t.replace(",", ".");
    }
    const n = parseFloat(t);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (hasPct || n >= 3) return Math.min(n, 500);
    return Math.min(n * 100, 500);
  }

  function sheetColIndex(headers, ...names) {
    for (const n of names) {
      const i = headers.indexOf(n);
      if (i >= 0) return i;
    }
    for (const n of names) {
      const needle = String(n || "").trim().toLowerCase();
      if (!needle || needle.length < 2) continue;
      for (let i = 0; i < headers.length; i++) {
        const h = String(headers[i] || "").trim().toLowerCase();
        if (h === needle || h.startsWith(needle) || h.includes(needle)) return i;
      }
    }
    return -1;
  }

  function sanePositionUsd(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return 0;
    if (v > 5e7) return 0;
    return v;
  }

  function normalizePlatformLabel(raw) {
    const s = String(raw || "").trim().toLowerCase();
    if (!s) return "";
    if (s.includes("pancake")) return "PancakeSwap V3";
    if (s.includes("aerodrome")) return "Aerodrome V3";
    if (s.includes("velodrome")) return "Velodrome";
    if (s.includes("uni")) return "Uniswap V3";
    return raw.trim();
  }

  function buildRevertLink(chain, platform, tokenId) {
    const id = String(tokenId || "").replace(/\D/g, "");
    const net = String(chain || "").trim().toLowerCase();
    if (!id || !net) return "";
    const pl = String(platform || "").toLowerCase();
    let route = "uniswap-position";
    if (pl.includes("pancake")) route = "pancakeswap-position";
    else if (pl.includes("aerodrome")) route = "aerodrome-position";
    else if (pl.includes("velodrome")) route = "velodrome-position";
    return `https://revert.finance/#/${route}/${net}/${id}`;
  }

  function isEmptyMetric(raw) {
    const s = String(raw ?? "").trim();
    if (!s) return true;
    const low = s.toLowerCase();
    return low === "-" || low === "—" || low === "n/a" || low === "null";
  }

  function parseFeeTierCell(raw) {
    if (isEmptyMetric(raw)) return 0;
    const s = String(raw).trim();
    const hasPct = s.includes("%");
    let t = s.replace(/%/g, "").replace(/\s/g, "");
    if (t.includes(".") && t.includes(",")) {
      if (t.lastIndexOf(",") > t.lastIndexOf(".")) t = t.replace(/\./g, "").replace(",", ".");
      else t = t.replace(/,/g, "");
    } else if (t.includes(",") && !t.includes(".")) {
      t = t.replace(",", ".");
    }
    const n = parseFloat(t);
    if (!Number.isFinite(n) || n <= 0) return 0;
    if (hasPct) {
      if (n >= 1000) return n / 1000000;
      if (n >= 1) return n / 100;
      return n;
    }
    if (n >= 50) return n / 10000;
    if (n <= 1) return n;
    return n / 100;
  }

  function feeTierFromSheetRaw(raw) {
    return parseFeeTierCell(raw);
  }

  function rowIsActive(headers, row) {
    const cell = (i) => (i >= 0 ? String(row[i] ?? "").trim() : "");
    const oc = cell(sheetColIndex(headers, "Open/Closed", "J", "Open / Closed")).toUpperCase();
    if (oc === "OPEN") return true;
    if (oc === "CLOSED") return false;
    const ia = cell(sheetColIndex(headers, "is_active")).toLowerCase();
    if (["true", "yes", "1", "да"].includes(ia)) return true;
    if (["false", "no", "0", "нет"].includes(ia)) return false;
    const ex = cell(sheetColIndex(headers, "exited")).toLowerCase();
    if (ex === "false" || ex === "0") return true;
    if (ex === "true" || ex === "1") return false;
    const c1 = normalizeClosedCell(
      cell(sheetColIndex(headers, "closed_at", "Дата закрытия норм", "X", "Дата закрытия"))
    );
    return !c1;
  }

  function walletColIndex(headers) {
    return sheetColIndex(
      headers,
      "owner_wallet",
      "owner",
      "wallet",
      "owner_address",
      "Кошелёк",
      "Кошелек",
      "кошелек",
      "Кошелек"
    );
  }

  function rowMatchesWallet(headers, row, wallet) {
    const w = String(wallet || "").trim().toLowerCase();
    if (!w) return true;
    const wi = walletColIndex(headers);
    if (wi >= 0) {
      const v = String(row[wi] ?? "").trim().toLowerCase();
      if (v === w || v.includes(w)) return true;
    }
    return row.some((c) => String(c ?? "").trim().toLowerCase().includes(w));
  }

  function liveValueUsdFromSheetRow(headers, row) {
    const c = (...names) => sheetColIndex(headers, ...names);
    const cellFloat = (i) => (i >= 0 ? parseSheetFloat(row[i]) : 0);
    const keys = [
      "Стоимость позиции, USD",
      "К hold, USD",
      "Внесено, USD",
      "Инвестировано ВСЕГО (сейчас)",
      "underlying_value",
    ];
    for (const k of keys) {
      const v = sanePositionUsd(cellFloat(c(k)));
      if (v > 0) return v;
    }
    const t0usd = sanePositionUsd(cellFloat(c("Сейчас токен0, USD")));
    const t1usd = sanePositionUsd(cellFloat(c("Сейчас токен1, USD")));
    if (t0usd + t1usd > 0) return t0usd + t1usd;
    const withdrawn = sanePositionUsd(cellFloat(c("Выведено, USD")));
    if (withdrawn > 0) return withdrawn;
    return 0;
  }

  function feesUsdFromSheetRow(headers, row) {
    const c = (...names) => sheetColIndex(headers, ...names);
    const cellFloat = (i) => (i >= 0 ? parseSheetFloat(row[i]) : 0);
    const total = cellFloat(
      c("Заработано комиссий всего, USD", "Заработано комиссий итого", "fees_value", "AG")
    );
    if (total > 0) return total;
    const pending = cellFloat(c("Комиссии pending, USD", "Комиссии pendi", "Комиссии pending"));
    const claimed = cellFloat(c("Комиссии claimed, USD", "Комиссии claim", "Комиссии claimed"));
    return pending + claimed;
  }

  function incentivesFromSheetRow(headers, row) {
    const c = (...names) => sheetColIndex(headers, ...names);
    const cellFloat = (i) => (i >= 0 ? parseSheetFloat(row[i]) : 0);
    const pending = cellFloat(c("Инцентив: pending, USD"));
    const claimed = cellFloat(c("Инцентив: claimed, USD"));
    const usd = pending + claimed;
    if (usd <= 0) return { usd: 0, token: "" };
    let token = String(row[c("Инцентив: токен")] ?? "").trim();
    const low = token.toLowerCase();
    if (low.includes("cake")) token = "Cake";
    else if (low.includes("aira")) token = "Aira";
    else if (token) token = token.charAt(0).toUpperCase() + token.slice(1);
    return { usd, token };
  }

  function feeApyPercentFromSheetRow(headers, row) {
    const i = sheetColIndex(headers, "Fee APY", "fee apy", "Fee APY %");
    if (i < 0) return 0;
    const raw = String(row[i] ?? "").trim();
    if (isEmptyMetric(raw) || raw === "0") return 0;
    const v = parseAprPercentCell(raw);
    return v != null && v > 0 ? v : 0;
  }

  function parseSheetCsv(text) {
    return text.split(/\r?\n/).map((line) => {
      const out = [];
      let cur = "";
      let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          inQ = !inQ;
          continue;
        }
        if (ch === "," && !inQ) {
          out.push(cur);
          cur = "";
          continue;
        }
        cur += ch;
      }
      out.push(cur);
      return out;
    });
  }

  function buildLpPositionFromSheetRow(headers, row) {
    const col = (...names) => sheetColIndex(headers, ...names);
    const cell = (i) => (i >= 0 ? String(row[i] ?? "").trim() : "");
    const chain = cell(col("Сеть", "network", "BH", "chain", "blockchain"));
    const platformRaw = cell(col("Платформа (DEX)", "Платформа", "platform", "exchange", "BI"));
    const nftId = cell(col("NFT tokenId", "ID NFT tokenid", "nft_id", "position_id", "I"));
    let link = cell(col("Ссылка на позицию", "position_url", "position_link", "link", "url", "revert_link"));
    if (!link) link = buildRevertLink(chain, platformRaw, nftId);
    const posId = revertPositionId(link) || String(nftId || "").replace(/\D/g, "");
    const t0 = cell(col("Токен 0", "token0", "AK", "AM"));
    const t1 = cell(col("Токен 1", "token1", "AL", "AN"));
    if (!posId && !t0 && !t1) return null;
    const active = rowIsActive(headers, row);
    let closedDisp = cell(col("Дата закрытия", "Дата закрытия норм", "closed_at", "X", "D"));
    if (normalizeClosedCell(closedDisp) === "") closedDisp = "";
    const apr = feeApyPercentFromSheetRow(headers, row);
    const feesUsd = feesUsdFromSheetRow(headers, row);
    const inc = incentivesFromSheetRow(headers, row);
    const iFeeTier = col("Fee tier (%)", "Fee tier", "fee_tier", "BJ", "V");
    const platform = normalizePlatformLabel(platformRaw) || dexFromLink(link, "DEX");
    const pair = `${t0} / ${t1}`.replace(/\s*\/\s*$|^\s*\/\s*/g, "").trim();
    const item = {
      platform,
      dataSource: "Google Sheet",
      chain,
      pair: pair && pair.replace(/\s/g, "") !== "/" ? pair : "Pool",
      feesUsd,
      incentivesUsd: inc.usd > 0 ? Math.round(inc.usd * 10000) / 10000 : 0,
      incentiveToken: inc.token,
      apr,
      openedAt: cell(col("Дата открытия", "Дата открытия норм", "W", "first_mint_ts", "opened_at", "C")),
      closedAt: active ? "" : closedDisp,
      isActive: active,
      feeTier: feeTierFromSheetRaw(iFeeTier >= 0 ? row[iFeeTier] : ""),
      link,
      positionId: posId,
      valueUsd: Math.round(liveValueUsdFromSheetRow(headers, row) * 100) / 100,
    };
    const iLower = col(
      "Мин. цена диапазона",
      "Мин. цена для",
      "price_lower",
      "BE",
      "Истинный диапазон (мин)"
    );
    const iUpper = col(
      "Макс. цена диапазона",
      "Макс. цена для",
      "price_upper",
      "BD",
      "Истинный диапазон (макс)"
    );
    const iMkt = col(
      "Цена пула",
      "Текущая цена",
      "Asset market price",
      "BW",
      "Рыночная цена",
      "market_price"
    );
    if (iLower >= 0 && iUpper >= 0) {
      const lower = parseSheetFloat(row[iLower]);
      const upper = parseSheetFloat(row[iUpper]);
      let cur = iMkt >= 0 ? parseSheetFloat(row[iMkt]) : 0;
      if (!cur && lower > 0 && upper > 0) cur = (lower + upper) / 2;
      if (lower && upper) {
        const norm = normalizeLpRangePrices(lower, upper, cur > 0 ? cur : null);
        if (norm) Object.assign(item, norm);
      }
    }
    applyLpRangeToPosition(item);
    return item;
  }

  /** Полный список LP из листа Public Portfolio — при каждом открытии сайта. */
  async function fetchSheetCsv(sheetId, sheetName) {
    const names = [];
    if (sheetName) names.push(sheetName);
    if (!names.includes("Public portfolio")) names.push("Public portfolio");
    if (!names.includes("Public Portfolio")) names.push("Public Portfolio");
    for (const name of names) {
      const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const text = await res.text();
      if (text.startsWith("<!DOCTYPE") || text.startsWith("<html")) continue;
      const rows = parseSheetCsv(text);
      if (rows.length >= 2) return rows;
    }
    return null;
  }

  async function syncLiquidityPositionsFromSheet(opts) {
    const sheetId = opts?.sheetId;
    const sheetName = opts?.sheetName || "Public portfolio";
    const fallback = Array.isArray(opts?.fallback) ? opts.fallback : [];
    if (!sheetId) return fallback;
    try {
      const rows = await fetchSheetCsv(sheetId, sheetName);
      if (!rows) {
        console.warn("LP sheet sync: sheet not found or empty");
        return fallback;
      }
      if (rows.length < 2) return fallback;
      const headers = rows[0].map((h) => String(h || "").trim());
      const wallet = String(opts?.walletAddress || "").trim();
      const byKey = new Map();
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        if (!rowMatchesWallet(headers, row, wallet)) continue;
        const item = buildLpPositionFromSheetRow(headers, row);
        if (!item) continue;
        const key = item.positionId || item.link || `${item.chain}|${item.pair}|${r}`;
        byKey.set(key, item);
      }
      const list = [...byKey.values()];
      if (!list.length) return fallback;
      list.sort((a, b) => {
        const ra = a.isActive ? 0 : 1;
        const rb = b.isActive ? 0 : 1;
        if (ra !== rb) return ra - rb;
        return String(b.openedAt || "").localeCompare(String(a.openedAt || ""));
      });
      return list;
    } catch (e) {
      console.warn("LP sheet sync failed", e);
      return fallback;
    }
  }

  async function enrichLpRangesFromSheet(positions, opts) {
    const fresh = await syncLiquidityPositionsFromSheet({
      sheetId: opts?.sheetId,
      sheetName: opts?.sheetName,
      walletAddress: opts?.walletAddress,
      fallback: positions,
    });
    positions.splice(0, positions.length, ...fresh);
    return positions;
  }

  function dedupeLendingPositions(positions) {
    const out = [];
    for (const p of positions || []) {
      const protocol = String(p.protocol || "").trim().toLowerCase();
      const borrowUsd = Number(p.borrowUsd || 0);
      const collateralUsd = Number(p.collateralUsd || 0);
      if (borrowUsd <= 0) {
        if (collateralUsd < 5) continue;
        out.push(p);
        continue;
      }
      let merged = false;
      for (let i = 0; i < out.length; i++) {
        const ex = out[i];
        const exProto = String(ex.protocol || "").trim().toLowerCase();
        const exBorrow = Number(ex.borrowUsd || 0);
        if (exProto !== protocol) continue;
        if (Math.abs(borrowUsd - exBorrow) > Math.max(2, 0.02 * Math.max(borrowUsd, exBorrow, 1))) continue;
        if (collateralUsd > Number(ex.collateralUsd || 0)) out[i] = p;
        merged = true;
        break;
      }
      if (!merged) out.push(p);
    }
    return out;
  }

  function sumLendingTotals(positions) {
    const list = dedupeLendingPositions(positions);
    let collateral = 0;
    let debt = 0;
    for (const p of list) {
      const supplied = p.supplied?.length
        ? p.supplied
        : [{ usd: p.collateralUsd }];
      const borrowed = p.borrowed?.length
        ? p.borrowed
        : [{ usd: p.borrowUsd || 0 }];
      collateral += supplied.reduce((s, x) => s + Number(x.usd || 0), 0);
      debt += borrowed.reduce((s, x) => s + Number(x.usd || 0), 0);
    }
    return { collateral, debt, net: collateral - debt, positions: list };
  }

  function sumActiveLpValueUsd(positions) {
    return (positions || []).reduce((sum, p) => {
      const active = p.isActive !== false && !String(p.closedAt || "").trim();
      if (!active) return sum;
      const v = Number(p.valueUsd || 0);
      return sum + (Number.isFinite(v) && v > 0 ? v : 0);
    }, 0);
  }

  function calcLiveEquityUsd(collateralUsd, debtUsd, activeLpUsd) {
    return (
      Math.max(0, Number(collateralUsd || 0)) -
      Math.max(0, Number(debtUsd || 0)) +
      Math.max(0, Number(activeLpUsd || 0))
    );
  }

  window.PortfolioUI = {
    chainLabelUi,
    chainBadgeHtml,
    dexFromLink,
    normalizeLpRangePrices,
    applyLpRangeToPosition,
    renderLpCard,
    renderLendingCard,
    renderS1Card,
    dedupeLendingPositions,
    sumLendingTotals,
    sumActiveLpValueUsd,
    calcLiveEquityUsd,
    syncLiquidityPositionsFromSheet,
    enrichLpRangesFromSheet,
  };
})();
