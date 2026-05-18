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

  function fmtRangeNum(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
    if (v >= 1) return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
    return v.toLocaleString("en-US", { maximumFractionDigits: 6 });
  }

  function renderRangeBar(r, lang, fmtFeeTier) {
    if (r?.rangeMin == null || r?.rangeMax == null) return "";
    const min = Number(r.rangeMin);
    const max = Number(r.rangeMax);
    const cur = Number(r.rangeCurrent ?? (min + max) / 2);
    const span = max - min || 1;
    const pad = span * 0.15;
    const trackMin = min - pad;
    const trackMax = max + pad;
    const trackSpan = trackMax - trackMin || 1;
    const segLeft = ((min - trackMin) / trackSpan) * 100;
    const segWidth = (span / trackSpan) * 100;
    let markerPct = ((cur - trackMin) / trackSpan) * 100;
    markerPct = Math.max(1, Math.min(99, markerPct));
    const inRange = cur >= min && cur <= max;
    return `<div class="range-bar-wrap${inRange ? "" : " out-range"}">
      <div class="range-bar-head"><span class="range-lbl">${lang === "ru" ? "Диапазон цены" : "Price range"}</span><span class="range-fee">${fmtFeeTier(r.feeTier)}</span></div>
      <div class="range-bar-labels"><span>${fmtRangeNum(min)}</span><span class="range-cur${inRange ? "" : " out"}">${fmtRangeNum(cur)}</span><span>${fmtRangeNum(max)}</span></div>
      <div class="range-bar"><div class="range-track"></div><div class="range-active" style="left:${segLeft.toFixed(2)}%;width:${segWidth.toFixed(2)}%"></div><div class="range-marker" style="left:${markerPct.toFixed(2)}%"></div></div>
    </div>`;
  }

  function renderLpCard(p, ctx) {
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
          <div class="pool-dex">${chainLabelUi(p.chain)}${p.dataSource ? ` · ${p.dataSource}` : ""}</div>
          ${renderRangeBar(p, ctx.lang, ctx.fmtFeeTier)}
        </div>
        <div class="pool-apr-hero">${aprShown}</div>
      </div>
      <div class="pool-meta-grid">
        <div><div class="lbl">Fee Tier</div><div>${ctx.fmtFeeTier(p.feeTier)}</div></div>
        <div><div class="lbl">${ctx.t("feesTotal")}</div><div>$${Number(p.feesUsd || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></div>
        <div><div class="lbl">${ctx.lang === "ru" ? "Период" : "Period"}</div><div>${period}</div></div>
        <div class="pos-actions" style="align-self:end">${p.link ? `<a class="link-btn" href="${p.link}" target="_blank" rel="noreferrer">${ctx.t("open")}</a>` : ""}</div>
      </div>
    </div>`;
  }

  function renderLendingCard(p, ctx) {
    const hf = Number(p.healthFactor || 0);
    const hfColor = hf >= 1.5 ? "var(--green)" : hf >= 1.2 ? "var(--blue)" : "var(--red)";
    return `<div class="pool-card lend-card">
      <div class="pool-card-head">
        ${chainBadgeHtml(p.chain, 28, "Lending")}
        <div class="pool-card-main">
          <div class="pool-pair-row">
            <span class="pool-pair">${p.protocol || "Protocol"}</span>
            <span class="badge">Lending</span>
          </div>
          <div class="pool-dex">${chainLabelUi(p.chain, "Lending")}</div>
        </div>
        <div class="pool-apr-hero" style="color:${hfColor};font-size:18px">HF ${hf.toFixed(2)}</div>
      </div>
      <div class="pool-meta-grid">
        <div><div class="lbl">Collateral</div><div>${p.collateralAsset || "-"} ${Number(p.collateralAmount || 0).toLocaleString()}</div></div>
        <div><div class="lbl">Collateral USD</div><div>$${Number(p.collateralUsd || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div></div>
        <div><div class="lbl">Borrow</div><div>${p.borrowAsset || "-"} ${Number(p.borrowAmount || 0).toLocaleString()}</div></div>
        <div><div class="lbl">${ctx.lang === "ru" ? "Рынок" : "Market"}</div><div>$${Number(p.marketPrice || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div></div>
        <div><div class="lbl">${ctx.lang === "ru" ? "Ликвидация" : "Liq. price"}</div><div>$${Number(p.liquidationPrice || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div></div>
        <div class="pos-actions" style="grid-column:1/-1">${p.link ? `<a class="link-btn" href="${p.link}" target="_blank" rel="noreferrer">${ctx.t("open")}</a>` : ""}</div>
      </div>
    </div>`;
  }

  function renderS1Card(p, ctx) {
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
          <div class="pool-dex">${platform} · ${ctx.chainName(p.chain, p.instrument)}</div>
          ${renderRangeBar(p, ctx.lang, ctx.fmtFeeTier)}
        </div>
        <div class="pool-apr-hero">${apr.toFixed(2)}%</div>
      </div>
      <div class="pool-meta-grid">
        <div><div class="lbl">Value USD</div><div>${ctx.fmtUsdSmart(p.valueUsd || 0)}</div></div>
        <div><div class="lbl">${ctx.t("feesTotal")}</div><div>${ctx.fmtUsdSmart(fees)}</div></div>
        <div><div class="lbl">Fee Tier</div><div>${ctx.fmtFeeTier(p.feeTier)}</div></div>
        <div class="pos-actions" style="align-self:end">${p.link ? `<a class="link-btn" href="${p.link}" target="_blank" rel="noreferrer">${ctx.t("open")}</a>` : ""}</div>
      </div>
    </div>`;
  }

  window.PortfolioUI = {
    chainLabelUi,
    chainBadgeHtml,
    dexFromLink,
    renderLpCard,
    renderLendingCard,
    renderS1Card
  };
})();
