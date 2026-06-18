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

  const LP_POSITION_MANAGERS = {
    "0x7c5f5a4bbd8fd63184577525326123b519429bdc": "Uniswap V4",
    "0x46a15b0b27311cedf172ab29e4f4766fbe7f4364": "PancakeSwap V3",
    "0x03a520b32c04bf3bbeefbde7c3d8d4fdeb6952ce": "Uniswap V3",
    "0x827922686190790b372ae4b3259e3468713b62e9": "Aerodrome Slipstream",
  };

  const LP_SHEET_FALLBACK_NAMES = [
    "Public portfolio",
    "Public Portfolio",
    "Revert pools",
    "Revert Pools",
    "Pools",
    "pools",
    "LP",
    "liquidity",
  ];

  function parsePositionManagerFromLink(link) {
    const m = String(link || "").match(/positions\/\d+\/(0x[a-fA-F0-9]{40})-/i);
    return m ? m[1].toLowerCase() : "";
  }

  function resolveLpPlatform(platform, link) {
    const label = normalizePlatformLabel(platform);
    if (label) return label;
    const mgr = parsePositionManagerFromLink(link);
    if (mgr && LP_POSITION_MANAGERS[mgr]) return LP_POSITION_MANAGERS[mgr];
    return dexFromLink(link, platform);
  }

  function dexFromLink(link, platform) {
    const s = String(link || "").toLowerCase();
    if (s.includes("aerodrome") || s.includes("slipstream")) return "Aerodrome Slipstream";
    if (s.includes("pancake")) return "PancakeSwap V3";
    if (s.includes("velodrome")) return "Velodrome";
    if (s.includes("uniswap")) return "Uniswap V3";
    const mgr = parsePositionManagerFromLink(link);
    if (mgr && LP_POSITION_MANAGERS[mgr]) return LP_POSITION_MANAGERS[mgr];
    const p = String(platform || "").trim();
    if (p && p !== "Revert Finance" && p !== "DEX" && p !== "Google Sheet") return p;
    return "DEX";
  }

  function displayPlatform(platform) {
    return normalizePlatformLabel(platform) || String(platform || "").trim() || "DEX";
  }

  function sheetHeadersLookLikeLp(headers) {
    const joined = (headers || []).map((h) => String(h || "").trim().toLowerCase()).join(" ");
    return [
      "токен 0",
      "token0",
      "nft_id",
      "nft token",
      "exchange",
      "платформа",
      "platform",
      "fee tier",
      "fee_tier",
      "min price",
      "ком. доход",
      "ссылка на позицию",
    ].some((m) => joined.includes(m));
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

  /** Rough label width as % of track (for overlap detection without DOM). */
  function rangeLabelWidthPct(text, tight) {
    const len = String(text).length;
    const perChar = tight ? 2.15 : 1.35;
    return Math.min(46, Math.max(9, len * perChar));
  }

  function rangeCurLabelPlacement(markerPct, segLeft, segRight, curText, minText, maxText, tight) {
    const minW = rangeLabelWidthPct(minText, tight);
    const maxW = rangeLabelWidthPct(maxText, tight);
    const curW = rangeLabelWidthPct(curText, tight);
    const gap = tight ? 4 : 2;
    const collideMin = markerPct - curW / 2 < segLeft + minW + gap;
    const collideMax = markerPct + curW / 2 > segRight - maxW - gap;
    return { below: collideMin || collideMax };
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
    const minText = fmtRangeNum(min);
    const maxText = fmtRangeNum(max);
    const curText = `${curLbl}: ${fmtRangeNum(cur)}`;
    const curPlace = rangeCurLabelPlacement(
      markerPct,
      segLeft,
      segRight,
      curText,
      minText,
      maxText,
      true
    );
    const curBelow = curPlace.below;
    return `<div class="range-bar-wrap${inRange ? "" : " out-range"}">
      <div class="range-bar-head"><span class="range-lbl">${lang === "ru" ? "Диапазон цены" : "Price range"}</span></div>
      <div class="range-bar-stage${curBelow ? " range-bar-stage--cur-below" : " range-bar-stage--cur-above"}">
        <div class="range-band range-band-top">
          <div class="range-bar-labels-top" aria-hidden="true">
            <span class="range-lbl-pos range-lbl-min" style="left:${segLeft.toFixed(2)}%">${minText}</span>
            <span class="range-lbl-pos range-lbl-max" style="left:${segRight.toFixed(2)}%">${maxText}</span>
          </div>
          ${curBelow ? "" : `<span class="range-lbl-pos range-lbl-cur range-lbl-cur--above${inRange ? "" : " out"}" style="left:${markerPct.toFixed(2)}%">${curText}</span>`}
        </div>
        <div class="range-bar">
          <div class="range-track"></div>
          <div class="range-active" style="left:${segLeft.toFixed(2)}%;width:${segWidth.toFixed(2)}%"></div>
          <div class="range-marker" style="left:${markerPct.toFixed(2)}%"></div>
        </div>
        <div class="range-band range-band-bottom">${curBelow ? `<span class="range-lbl-pos range-lbl-cur range-lbl-cur--below${inRange ? "" : " out"}" style="left:${markerPct.toFixed(2)}%">${curText}</span>` : ""}</div>
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

  function parseOpenedIso(openedAt) {
    const s = String(openedAt || "").trim();
    const dmy = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return "";
  }

  function daysHeldSinceOpen(openedAt) {
    const opened = parseOpenedIso(openedAt);
    if (!opened) return 1;
    const t0 = new Date(`${opened}T00:00:00Z`).getTime();
    const t1 = new Date().setUTCHours(0, 0, 0, 0);
    const days = Math.round((t1 - t0) / (24 * 60 * 60 * 1000));
    return Math.max(1, days);
  }

  /** APR с учётом комиссий + инсентивов и дней в позиции (если Fee APY в таблице пустой). */
  function computeLpDisplayApr(p) {
    const fromSheet = Number(p.displayApr || p.apr || 0);
    if (fromSheet > 0) return Math.min(fromSheet, 500);
    const income = Number(p.feesUsd || 0) + Number(p.incentivesUsd || 0);
    const value = Number(p.valueUsd || 0);
    if (value <= 0 || income <= 0) return 0;
    const days = daysHeldSinceOpen(p.openedAt);
    return Math.min((income / value) * (365 / days) * 100, 500);
  }

  function renderLpCard(p, ctx) {
    applyLpRangeToPosition(p);
    const dex = displayPlatform(p.platform);
    const aprVal = Number(p.displayApr || p.apr || 0);
    const aprShown = aprVal > 0 ? `${aprVal.toFixed(2)}%` : "—";
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

  function estimateLendingHealthFactor(collateralUsd, borrowUsd) {
    const coll = Number(collateralUsd || 0);
    const debt = Number(borrowUsd || 0);
    if (debt <= 0 || coll <= 0) return 0;
    return (coll / debt) * 0.93;
  }

  function displayLendingHealthFactor(p) {
    const coll = Number(p.collateralUsd || 0);
    const debt = Number(p.borrowUsd || 0);
    let hf = Number(p.healthFactor || 0);
    const est = estimateLendingHealthFactor(coll, debt);
    if (debt >= 50 && est >= 1.05 && est <= 5 && (hf <= 0 || hf >= 9.5)) return est;
    return hf;
  }

  function renderLendingCard(p, ctx) {
    const hf = displayLendingHealthFactor(p);
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
    const utilPct = supUsd > 0 ? Math.min(100, (borUsd / supUsd) * 100) : 0;
    const utilLbl = ctx.lang === "ru" ? "Использование залога" : "Collateral use";
    const freeUsd = Math.max(0, supUsd - borUsd);
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
      <div class="lend-util-block">
        <div class="lend-util-head">
          <span>${utilLbl}</span>
          <span class="lend-util-pct">${utilPct.toFixed(1)}%</span>
        </div>
        <div class="lend-util-track" aria-hidden="true">
          <div class="lend-util-collateral" style="width:100%"></div>
          <div class="lend-util-debt" style="width:${utilPct.toFixed(2)}%"></div>
        </div>
        <div class="lend-util-legend">
          <span><i class="lend-dot lend-dot--sup"></i>${ctx.lang === "ru" ? "Залог" : "Collateral"} <strong>${fmtUsdShort(supUsd)}</strong></span>
          <span><i class="lend-dot lend-dot--bor"></i>${ctx.lang === "ru" ? "Долг" : "Debt"} <strong>${fmtUsdShort(borUsd)}</strong></span>
          <span><i class="lend-dot lend-dot--free"></i>${ctx.lang === "ru" ? "Свободно" : "Free"} <strong>${fmtUsdShort(freeUsd)}</strong></span>
        </div>
      </div>
      <div class="lend-metrics lend-metrics--compact">
        ${
          hf > 0
            ? `<div class="lend-metric lend-metric--hf${hfClass}"><span>Health factor</span><strong>${hf.toFixed(2)}</strong></div>`
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

  function parseMoneyCell(raw) {
    if (typeof raw === "number" && Number.isFinite(raw)) return raw >= 0 ? raw : 0;
    let s = String(raw ?? "")
      .trim()
      .replace(/\$/g, "")
      .replace(/\u00a0/g, "")
      .replace(/\u202f/g, "")
      .replace(/\s/g, "");
    if (!s || s === "-" || s === "—") return 0;
    if (s.includes(".") && s.includes(",")) {
      if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
      else s = s.replace(/,/g, "");
    } else if (s.includes(",") && !s.includes(".")) {
      const parts = s.split(",");
      if (parts.length === 2 && parts[1].length === 3 && /^\d+$/.test(parts[1]) && parts[0].length <= 4) {
        s = parts[0] + parts[1];
      } else {
        s = s.replace(",", ".");
      }
    }
    const n = parseFloat(s);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  function parseSheetFloat(s) {
    const n = parseMoneyCell(s);
    return n > 0 ? n : 0;
  }

  function lpFingerprint(p) {
    const id = String(p?.positionId || "").trim();
    if (id) return `id:${id}`;
    const link = String(p?.link || "").trim();
    if (link) return `link:${link}`;
    const chain = String(p?.chain || "").trim().toLowerCase();
    const platform = String(p?.platform || "").trim().toLowerCase();
    const rmin = Math.round(Number(p?.rangeMin || 0) * 100) / 100;
    const rmax = Math.round(Number(p?.rangeMax || 0) * 100) / 100;
    return `rng:${chain}|${platform}|${rmin}|${rmax}`;
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

  function sheetCol(headers, ...namesAndFallback) {
    const fallback = typeof namesAndFallback[namesAndFallback.length - 1] === "number"
      ? namesAndFallback.pop()
      : -1;
    const idx = sheetColIndex(headers, ...namesAndFallback);
    return idx >= 0 ? idx : fallback;
  }

  async function fetchSheetViaApi(sheetId, sheetName) {
    const params = new URLSearchParams({
      sheetId: String(sheetId || ""),
      sheetName: String(sheetName || "Public portfolio"),
    });
    const res = await fetch(`/api/lp-sheet?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `lp-sheet HTTP ${res.status}`);
    }
    const payload = await res.json();
    const headers = (payload.headers || []).map((h) => String(h || "").trim());
    const rawRows = payload.rows || [];
    if (!headers.length || !rawRows.length) return null;
    return [headers, ...rawRows.map((r) => (r.cells || []).map((v) => (v == null ? "" : v)))];
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
    if (typeof raw === "number" && Number.isFinite(raw)) {
      if (raw > 0 && raw < 2) return Math.min(raw * 100, 500);
      if (raw >= 2) return Math.min(raw, 500);
      return null;
    }
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

  function sanePositionUsd(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return 0;
    if (v > 5e7) return 0;
    return v;
  }

  function normalizePlatformLabel(raw) {
    const s = String(raw || "").trim().toLowerCase();
    if (!s || s === "dex" || s === "revert finance" || s === "google sheet" || s === "krystal") return "";
    if (s.includes("pancake")) return "PancakeSwap V3";
    if (s.includes("aerodrome") || s.includes("slipstream")) return "Aerodrome Slipstream";
    if (s.includes("velodrome")) return "Velodrome";
    if (s.includes("uniswap") && s.includes("v4")) return "Uniswap V4";
    if (s.includes("uniswap") && s.includes("v3")) return "Uniswap V3";
    if (s === "uniswapv3" || s === "uniswap_v3") return "Uniswap V3";
    if (s === "uniswapv4" || s === "uniswap_v4") return "Uniswap V4";
    if (s.includes("uni")) return "Uniswap V3";
    return raw.trim();
  }

  function incentiveTokenForPlatform(platform) {
    const low = String(platform || "").toLowerCase();
    if (low.includes("pancake")) return "Cake";
    if (low.includes("aerodrome") || low.includes("aero") || low.includes("slipstream")) return "Aero";
    return "";
  }

  function defaultLpPair(headers, row, minPrice) {
    const col = (...names) => sheetColIndex(headers, ...names);
    const cell = (i) => (i >= 0 ? String(row[i] ?? "").trim() : "");
    const pair = pairKeyFromRow(cell(col("Токен 0", "token0", "AK")), cell(col("Токен 1", "token1", "AL")));
    if (pair) return pair;
    if (Number(minPrice) > 50) return "ETH / USDC";
    return "Pool";
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
      cell(sheetColIndex(headers, "closed_at", "Дата закрытия норм", "Дата закрытия", "J", "X", 9))
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
      "H",
      7
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
    const idx = sheetCol(headers, "Стоимость позиции, USD", "O", 14);
    return idx >= 0 ? sanePositionUsd(parseMoneyCell(row[idx])) : 0;
  }

  function feesUsdFromSheetRow(headers, row) {
    const idx = sheetCol(headers, "Ком. доход (ИТОГО $)", "Ком. доход", "G", 6);
    return idx >= 0 ? parseMoneyCell(row[idx]) : 0;
  }

  function incentivesFromSheetRow(headers, row, platform) {
    const idx = sheetCol(headers, "Incentives, $", "Incentives, USD", "Q", 16);
    const usd = idx >= 0 ? parseMoneyCell(row[idx]) : 0;
    if (usd <= 0) return { usd: 0, token: "" };
    const token = incentiveTokenForPlatform(platform);
    return { usd, token };
  }

  function feeApyPercentFromSheetRow(headers, row) {
    const i = sheetCol(headers, "Fee APY", "fee apy", "Fee APY %", "A", 0);
    if (i < 0) return 0;
    const raw = row[i];
    if (isEmptyMetric(raw) || raw === 0) return 0;
    const v = parseAprPercentCell(raw);
    return v != null && v > 0 ? v : 0;
  }

  function buildLpPositionFromSheetRow(headers, row) {
    const col = (...args) => sheetCol(headers, ...args);
    const cell = (i) => (i >= 0 ? String(row[i] ?? "").trim() : "");
    const chain = cell(col("network", "Сеть", "M", "chain", "blockchain", 12));
    const platformRaw = cell(col("Exchange", "Платформа (DEX)", "Платформа", "platform", "exchange", "F", 5));
    const nftId = cell(col("NFT_ID", "NFT tokenId", "ID NFT tokenid", "nft_id", "position_id", "C", "I", 2));
    let link = cell(col("Ссылка на позицию", "position_url", "position_link", "link", "url", "revert_link"));
    if (!link) link = buildRevertLink(chain, platformRaw, nftId);
    const posId = revertPositionId(link) || String(nftId || "").replace(/\D/g, "");
    const t0 = cell(col("Токен 0", "token0", "AK", "AM"));
    const t1 = cell(col("Токен 1", "token1", "AL", "AN"));
    const iLowerProbe = col("Min price", "Мин. цена диапазона", "price_lower", "D", "BE", 3);
    const minProbe = iLowerProbe >= 0 ? parseMoneyCell(row[iLowerProbe]) : 0;
    if (!posId && !t0 && !t1 && !minProbe && !platformRaw) return null;
    const active = rowIsActive(headers, row);
    let closedDisp = cell(col("Дата закрытия", "Дата закрытия норм", "closed_at", "J", "X", "D", 9));
    if (normalizeClosedCell(closedDisp) === "") closedDisp = "";
    const feesUsd = feesUsdFromSheetRow(headers, row);
    const aprSheet = feeApyPercentFromSheetRow(headers, row);
    const iFeeTier = col("fee_tier", "Fee tier (%)", "Fee tier", "N", "BJ", "V", 13);
    const platform = displayPlatform(platformRaw);
    const inc = incentivesFromSheetRow(headers, row, platform);
    const pair = defaultLpPair(headers, row, minProbe);
    const item = {
      platform,
      dataSource: "Google Sheet",
      chain,
      pair,
      feesUsd,
      incentivesUsd: inc.usd > 0 ? Math.round(inc.usd * 10000) / 10000 : 0,
      incentiveToken: inc.token,
      apr: 0,
      displayApr: 0,
      openedAt: cell(col("Дата открытия", "Дата открытия норм", "W", "first_mint_ts", "opened_at", "C", "I", 8)),
      closedAt: active ? "" : closedDisp,
      isActive: active,
      feeTier: feeTierFromSheetRaw(iFeeTier >= 0 ? row[iFeeTier] : ""),
      link,
      positionId: posId,
      valueUsd: Math.round(liveValueUsdFromSheetRow(headers, row) * 100) / 100,
    };
    const iLower = col(
      "Min price",
      "Мин. цена диапазона",
      "Мин. цена для",
      "price_lower",
      "D",
      "BE",
      "Истинный диапазон (мин)",
      3
    );
    const iUpper = col(
      "Max price",
      "Макс. цена диапазона",
      "Макс. цена для",
      "price_upper",
      "E",
      "BD",
      "Истинный диапазон (макс)",
      4
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
      const lower = parseMoneyCell(row[iLower]);
      const upper = parseMoneyCell(row[iUpper]);
      let cur = iMkt >= 0 ? parseMoneyCell(row[iMkt]) : 0;
      if (!cur && lower > 0 && upper > 0) cur = (lower + upper) / 2;
      if (lower && upper) {
        const norm = normalizeLpRangePrices(lower, upper, cur > 0 ? cur : null);
        if (norm) Object.assign(item, norm);
      }
    }
    applyLpRangeToPosition(item);
    const aprVal = aprSheet > 0 ? Math.round(aprSheet * 100) / 100 : 0;
    item.apr = aprVal;
    item.displayApr = aprVal;
    return item;
  }

  /** LP-лист только через Google Sheets API (вычисленные значения формул). */
  async function fetchSheetRows(sheetId, sheetName) {
    const names = [];
    if (sheetName) names.push(sheetName);
    for (const n of LP_SHEET_FALLBACK_NAMES) {
      if (!names.includes(n)) names.push(n);
    }
    for (const name of names) {
      const apiRows = await fetchSheetViaApi(sheetId, name);
      if (apiRows && sheetHeadersLookLikeLp(apiRows[0])) return apiRows;
    }
    return null;
  }

  async function syncLiquidityPositionsFromSheet(opts) {
    const sheetId = opts?.sheetId;
    const sheetName = opts?.sheetName || "Public portfolio";
    if (!sheetId) return [];
    const rows = await fetchSheetRows(sheetId, sheetName);
    if (!rows || rows.length < 2) {
      throw new Error("LP sheet not found or empty");
    }
    const headers = rows[0].map((h) => String(h || "").trim());
    const wallet = String(opts?.walletAddress || "").trim();
    const byKey = new Map();
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!rowMatchesWallet(headers, row, wallet)) continue;
      const item = buildLpPositionFromSheetRow(headers, row);
      if (!item) continue;
      const key = `${item.chain}|${item.platform}|${item.rangeMin}|${item.rangeMax}|${item.positionId || r}`;
      byKey.set(key, item);
    }
    const list = [...byKey.values()];
    list.sort((a, b) => {
      const ra = a.isActive ? 0 : 1;
      const rb = b.isActive ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return String(b.openedAt || "").localeCompare(String(a.openedAt || ""));
    });
    return list;
  }

  async function enrichLpRangesFromSheet(positions, opts) {
    const fresh = await syncLiquidityPositionsFromSheet({
      sheetId: opts?.sheetId,
      sheetName: opts?.sheetName,
      walletAddress: opts?.walletAddress,
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
    displayPlatform,
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
