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

  function renderLpCard(p, ctx) {
    applyLpRangeToPosition(p);
    const dex = dexFromLink(p.link, p.platform);
    const aprShown = (!p.isActive && Number(p.apr || 0) === 0) ? "—" : `${Number(p.apr || 0).toFixed(2)}%`;
    const period = `${p.openedAt || "-"} → ${p.closedAt || (ctx.lang === "ru" ? "активна" : "active")}`;
    return `<div class="pool-card">
      <div class="pool-card-head">
        ${chainBadgeHtml(p.chain, 28)}
        <div class="pool-card-main">
          <div class="pool-pair-row">
            <span class="pool-pair">${p.pair || "Пул"}</span>
            <span class="badge">${dex}</span>
          </div>
          ${renderRangeBar(p, ctx.lang)}
        </div>
        <div class="pool-card-side">
          <div class="pool-apr-hero">${aprShown}</div>
          ${poolOpenLink(p, ctx)}
        </div>
      </div>
      <div class="pool-meta-grid pool-meta-grid--3">
        <div><div class="lbl">Fee Tier</div><div>${ctx.fmtFeeTier(p.feeTier)}</div></div>
        <div><div class="lbl">${ctx.t("feesTotal")}</div><div>$${Number(p.feesUsd || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></div>
        <div><div class="lbl">${ctx.lang === "ru" ? "Период" : "Period"}</div><div>${period}</div></div>
      </div>
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
    const raw = String(s || "").trim().replace(/\s/g, "");
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

  async function enrichLpRangesFromSheet(positions, opts) {
    const sheetId = opts?.sheetId;
    const sheetName = opts?.sheetName || "Public Portfolio";
    if (!sheetId || !positions?.length) return positions;
    try {
      const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
      const res = await fetch(url);
      if (!res.ok) return positions;
      const text = await res.text();
      const rows = text.split(/\r?\n/).map((line) => {
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
      if (rows.length < 2) return positions;
      const headers = rows[0];
      const idx = (name) => headers.indexOf(name);
      const pickCol = (...names) => {
        for (const n of names) {
          const i = idx(n);
          if (i >= 0) return i;
        }
        return -1;
      };
      const iLink = pickCol("Ссылка на позицию", "I");
      const iLower = pickCol("price_lower", "BE");
      const iUpper = pickCol("price_upper", "BD");
      const iMkt = pickCol("Asset market price", "BW");
      const iClosed = pickCol("X", "closed_at");
      if (iLower < 0 || iUpper < 0) return positions;
      const byPositionId = new Map();
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const link = iLink >= 0 ? String(row[iLink] || "").trim() : "";
        const posId = revertPositionId(link);
        const lower = parseSheetFloat(row[iLower]);
        const upper = parseSheetFloat(row[iUpper]);
        const cur = iMkt >= 0 ? parseSheetFloat(row[iMkt]) : 0;
        if (!lower || !upper) continue;
        const norm = normalizeLpRangePrices(lower, upper, cur > 0 ? cur : null);
        if (!norm) continue;
        if (posId) byPositionId.set(posId, norm);
      }
      for (const p of positions) {
        const posId = revertPositionId(p.link) || String(p.positionId || "").trim();
        const hit = posId ? byPositionId.get(posId) : null;
        if (hit) Object.assign(p, hit);
        applyLpRangeToPosition(p);
      }
    } catch (e) {
      console.warn("LP range enrich failed", e);
    }
    for (const p of positions) applyLpRangeToPosition(p);
    return positions;
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
    enrichLpRangesFromSheet
  };
})();
