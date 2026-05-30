// js/chains.js
var CHAINS = {
  eth: { id: "eth", label: { ru: "Ethereum", en: "Ethereum" }, color: "#627eea" },
  op: { id: "op", label: { ru: "Optimism", en: "Optimism" }, color: "#ff0420" },
  base: { id: "base", label: { ru: "Base", en: "Base" }, color: "#0052ff" },
  arb: { id: "arb", label: { ru: "Arbitrum", en: "Arbitrum" }, color: "#28a0f0" },
  matic: { id: "matic", label: { ru: "Polygon", en: "Polygon" }, color: "#8247e5" },
  avax: { id: "avax", label: { ru: "Avalanche", en: "Avalanche" }, color: "#e84142" },
  bsc: { id: "bsc", label: { ru: "BNB Chain", en: "BNB Chain" }, color: "#f0b90b" },
  scroll: { id: "scroll", label: { ru: "Scroll", en: "Scroll" }, color: "#ffeeda" },
  gnosis: { id: "gnosis", label: { ru: "Gnosis", en: "Gnosis" }, color: "#04795b" },
  era: { id: "era", label: { ru: "zkSync Era", en: "zkSync Era" }, color: "#8c8dfc" },
  linea: { id: "linea", label: { ru: "Linea", en: "Linea" }, color: "#61dfff" },
  blast: { id: "blast", label: { ru: "Blast", en: "Blast" }, color: "#fcfc03" },
  monad: { id: "monad", label: { ru: "Monad", en: "Monad" }, color: "#836ef9" },
  plasma: { id: "plasma", label: { ru: "Plasma", en: "Plasma" }, color: "#7c3aed" },
  hyperevm: { id: "hyperevm", label: { ru: "HyperEVM", en: "HyperEVM" }, color: "#6ee7b7" },
  berachain: { id: "berachain", label: { ru: "Berachain", en: "Berachain" }, color: "#814625" },
  unichain: { id: "unichain", label: { ru: "Unichain", en: "Unichain" }, color: "#ff007a" },
  hyperliquid: {
    id: "hyperliquid",
    label: { ru: "Hyperliquid", en: "Hyperliquid" },
    color: "#97fce4"
  }
};
var ALIASES = {
  ethereum: "eth",
  optimism: "op",
  arbitrum: "arb",
  polygon: "matic",
  avalanche: "avax",
  "gnosis chain": "gnosis",
  bnb: "bsc",
  "bnb chain": "bsc"
};
var LOGO_DEBANK = {
  eth: "eth",
  op: "op",
  base: "base",
  arb: "arb",
  matic: "matic",
  bsc: "bsc",
  avax: "avax",
  scroll: "scroll",
  gnosis: "xdai",
  era: "era",
  linea: "linea",
  blast: "blast",
  monad: "monad",
  plasma: "plasma",
  hyperevm: "hyperevm",
  berachain: "berachain",
  unichain: "unichain",
  hyperliquid: "hyperliquid"
};
var LOGO_TRUST = {
  eth: "ethereum",
  op: "optimism",
  base: "base",
  arb: "arbitrum",
  matic: "polygon",
  bsc: "smartchain",
  avax: "avalanchec",
  scroll: "scroll",
  gnosis: "xdai",
  era: "zksync",
  linea: "linea",
  blast: "blast"
};
function chainSlug(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (CHAINS[s]) return s;
  if (ALIASES[s]) return ALIASES[s];
  if (s === "op" || s === "optimism") return "op";
  if (s === "ethereum" || s === "eth") return "eth";
  if (s === "arbitrum" || s === "arb") return "arb";
  if (s === "polygon" || s === "matic") return "matic";
  if (s === "bnb" || s === "bsc") return "bsc";
  return s || "unknown";
}
function chainLabel(slug, lang2) {
  const c = CHAINS[slug];
  if (!c) return String(slug || "\u2014").toUpperCase();
  return c.label[lang2] || c.label.en;
}
function chainColor(slug) {
  return CHAINS[slug]?.color || "#6b7cff";
}
function chainLogoUrls(slug) {
  const id = LOGO_DEBANK[slug] || slug;
  const tw = LOGO_TRUST[slug];
  const urls = [`https://static.debank.com/image/chain/chain_icon/${id}.png`];
  if (tw) {
    urls.push(
      `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${tw}/info/logo.png`
    );
  }
  return urls;
}
function chainBadgeHtml(slug, size = 20, opts = {}) {
  const s = chainSlug(slug);
  const name = chainLabel(s, "ru");
  const nameEn = chainLabel(s, "en");
  const urls = chainLogoUrls(s).join("|");
  const corner = opts.corner ? " chain-icon-wrap--corner" : "";
  const letter = (nameEn || "?").slice(0, 1).toUpperCase();
  const bg = chainColor(s);
  return `<span class="chain-icon-wrap${corner}" style="--sz:${size}px" data-chain-tip="${escAttr(name)}" title="${escAttr(name)}">
    <img class="chain-icon" src="${escAttr(urls.split("|")[0])}" data-fallbacks="${escAttr(urls)}" alt="" width="${size}" height="${size}" loading="lazy" onerror="ptChainImgFallback(this)" />
    <span class="chain-icon-fallback" style="background:${bg}">${letter}</span>
  </span>`;
}
function escAttr(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
if (typeof window !== "undefined") {
  window.ptChainImgFallback = function(img) {
    const list = (img.dataset.fallbacks || "").split("|").filter(Boolean);
    const cur = img.src;
    const idx = list.indexOf(cur);
    const next = list[idx + 1];
    if (next) {
      img.src = next;
      return;
    }
    img.style.display = "none";
    img.nextElementSibling?.classList.add("show");
  };
}

// js/i18n.js
var LANG_KEY = "pt-lang";
var dict = {
  ru: {
    brand: "Portfolio Tracker",
    tagline: "\u041F\u043E\u043B\u043D\u044B\u0439 \u0441\u043D\u0438\u043C\u043E\u043A DeFi-\u043F\u043E\u0440\u0442\u0444\u0435\u043B\u044F: \u043F\u043E\u0437\u0438\u0446\u0438\u0438, \u0434\u043E\u0445\u043E\u0434\u043D\u043E\u0441\u0442\u044C, \u0440\u0438\u0441\u043A\u0438 \u043B\u0438\u043A\u0432\u0438\u0434\u0430\u0446\u0438\u0438 \u0438 \u043A\u043E\u043C\u0438\u0441\u0441\u0438\u0438 \u2014 \u0437\u0430 \u0441\u0435\u043A\u0443\u043D\u0434\u044B",
    placeholder: "0x\u2026 \u0430\u0434\u0440\u0435\u0441 \u043A\u043E\u0448\u0435\u043B\u044C\u043A\u0430",
    go: "\u0421\u043A\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u0442\u044C",
    hint: "",
    errEmpty: "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0430\u0434\u0440\u0435\u0441 \u043A\u043E\u0448\u0435\u043B\u044C\u043A\u0430",
    errEvm: "\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 EVM-\u0430\u0434\u0440\u0435\u0441",
    errLoad: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0434\u0430\u043D\u043D\u044B\u0435. \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443 (Cmd+Shift+R) \u0438 \u043F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u0441\u043D\u043E\u0432\u0430.",
    errFetch: "\u0418\u0441\u0442\u043E\u0447\u043D\u0438\u043A \u0434\u0430\u043D\u043D\u044B\u0445 \u0432\u0440\u0435\u043C\u0435\u043D\u043D\u043E \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D. \u041F\u043E\u0434\u043E\u0436\u0434\u0438\u0442\u0435 10 \u0441\u0435\u043A\u0443\u043D\u0434 \u0438 \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \xAB\u0421\u043A\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u0442\u044C\xBB \u0441\u043D\u043E\u0432\u0430.",
    errEmptyPortfolio: "\u041F\u043E\u0440\u0442\u0444\u0435\u043B\u044C \u043F\u0443\u0441\u0442 \u0438\u043B\u0438 \u0434\u0430\u043D\u043D\u044B\u0435 \u043D\u0435 \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u043B\u0438\u0441\u044C. \u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u0430\u0434\u0440\u0435\u0441 \u0438 \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \xAB\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C\xBB.",
    errParse: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0440\u0430\u0437\u043E\u0431\u0440\u0430\u0442\u044C \u0434\u0430\u043D\u043D\u044B\u0435 (\u043D\u0443\u0436\u0435\u043D Node.js \u043D\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0435). \u0421\u043C\u043E\u0442\u0440\u0438\u0442\u0435 .cache/api-debug.log",
    errNoApi: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u0432\u044F\u0437\u0430\u0442\u044C\u0441\u044F \u0441 \u0441\u0435\u0440\u0432\u0435\u0440\u043E\u043C. \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443 \u0438\u043B\u0438 \u043E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 /portfolio/ \u043D\u0430 \u0445\u043E\u0441\u0442\u0438\u043D\u0433\u0435.",
    errNoApiLocal: "\u0421\u0435\u0440\u0432\u0438\u0441 \u043D\u0435 \u0437\u0430\u043F\u0443\u0449\u0435\u043D. \u0417\u0430\u043A\u0440\u043E\u0439\u0442\u0435 \u0432\u043A\u043B\u0430\u0434\u043A\u0443 \u0438 \u0434\u0432\u0430\u0436\u0434\u044B \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \xAB\u0417\u0430\u043F\u0443\u0441\u043A.command\xBB \u0432 \u043F\u0430\u043F\u043A\u0435 \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u044B.",
    loadingConnect: "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0430\u0435\u043C\u0441\u044F \u043A \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A\u0430\u043C\u2026",
    loadingParse: "\u0421\u043E\u0431\u0438\u0440\u0430\u0435\u043C \u043F\u043E\u0437\u0438\u0446\u0438\u0438\u2026",
    loadingChains: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u043C \u043F\u043E\u0437\u0438\u0446\u0438\u0438 \u043F\u043E \u0441\u0435\u0442\u044F\u043C\u2026",
    back: "\u2190 \u0414\u0440\u0443\u0433\u043E\u0439 \u043A\u043E\u0448\u0435\u043B\u0451\u043A",
    platforms: "\u041F\u043B\u0430\u0442\u0444\u043E\u0440\u043C\u044B",
    allPlatforms: "\u0412\u0441\u0435",
    walletAddress: "\u0410\u0434\u0440\u0435\u0441",
    chains: "\u041F\u043E \u0431\u043B\u043E\u043A\u0447\u0435\u0439\u043D\u0430\u043C",
    yield: "\u0414\u043E\u0445\u043E\u0434\u043D\u043E\u0441\u0442\u044C",
    farming: "\u0424\u0430\u0440\u043C\u0438\u043D\u0433",
    deposit: "\u0414\u0435\u043F\u043E\u0437\u0438\u0442",
    kindWallet: "\u041A\u043E\u0448\u0435\u043B\u0451\u043A",
    kindLiquidityPool: "\u041F\u0443\u043B \u043B\u0438\u043A\u0432\u0438\u0434\u043D\u043E\u0441\u0442\u0438",
    kindLending: "\u041B\u0435\u043D\u0434\u0438\u043D\u0433",
    kindYield: "\u0414\u043E\u0445\u043E\u0434\u043D\u043E\u0441\u0442\u044C",
    kindFarming: "\u0424\u0430\u0440\u043C\u0438\u043D\u0433",
    kindDeposit: "\u0414\u0435\u043F\u043E\u0437\u0438\u0442",
    liquiditySection: "\u041F\u0443\u043B\u044B \u043B\u0438\u043A\u0432\u0438\u0434\u043D\u043E\u0441\u0442\u0438",
    lendingSection: "\u041B\u0435\u043D\u0434\u0438\u043D\u0433",
    netPosition: "\u0427\u0438\u0441\u0442\u0430\u044F \u043F\u043E\u0437\u0438\u0446\u0438\u044F",
    healthFactor: "\u041A\u043E\u044D\u0444. \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u044F",
    collateralLbl: "\u0417\u0430\u043B\u043E\u0433",
    debtLbl: "\u0414\u043E\u043B\u0433",
    liquidationLbl: "\u041B\u0438\u043A\u0432\u0438\u0434\u0430\u0446\u0438\u044F ~",
    suppliedLbl: "\u0412 \u0437\u0430\u043B\u043E\u0433\u0435",
    borrowedLbl: "\u0412 \u0434\u043E\u043B\u0433\u0443",
    lendNoCollateral: "\u041D\u0435\u0442 \u0437\u0430\u043B\u043E\u0433\u0430",
    lendNoDebt: "\u041D\u0435\u0442 \u0434\u043E\u043B\u0433\u0430",
    rewardsLbl: "\u041D\u0430\u0433\u0440\u0430\u0434\u044B",
    claimableLbl: "\u041D\u0435\u0441\u043E\u0431\u0440\u0430\u043D\u043D\u044B\u0435 \u043A\u043E\u043C\u0438\u0441\u0441\u0438\u0438",
    inPoolLbl: "\u0412 \u043F\u0443\u043B\u0435",
    poolPair: "\u041F\u0430\u0440\u0430",
    positionsCount: "\u043F\u043E\u0437.",
    total: "\u0412\u0441\u0435\u0433\u043E",
    wallet: "\u041A\u043E\u0448\u0435\u043B\u0451\u043A",
    liquidity: "\u041B\u0438\u043A\u0432\u0438\u0434\u043D\u043E\u0441\u0442\u044C",
    lending: "\u041B\u0435\u043D\u0434\u0438\u043D\u0433",
    updated: "\u041E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u043E",
    empty: "\u041D\u0435\u0442 \u043F\u043E\u0437\u0438\u0446\u0438\u0439 \u0432 \u044D\u0442\u043E\u0439 \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u0438",
    showDust: "\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u043C\u0435\u043B\u043A\u0438\u0435 \u0431\u0430\u043B\u0430\u043D\u0441\u044B",
    hideDust: "\u0421\u043A\u0440\u044B\u0442\u044C \u043C\u0435\u043B\u043A\u0438\u0435 \u0431\u0430\u043B\u0430\u043D\u0441\u044B",
    dustNote: "\u041C\u0435\u043B\u043A\u0438\u0435 \u0442\u043E\u043A\u0435\u043D\u044B \u0441\u043A\u0440\u044B\u0442\u044B (\u043A\u0430\u043A \u043D\u0430 \u0442\u0438\u043F\u0438\u0447\u043D\u043E\u043C \u043E\u0431\u043E\u0437\u0440\u0435\u0432\u0430\u0442\u0435\u043B\u0435). \u0412\u043A\u043B\u044E\u0447\u0438\u0442\u0435 \u043F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0430\u0442\u0435\u043B\u044C, \u0447\u0442\u043E\u0431\u044B \u043F\u043E\u043A\u0430\u0437\u0430\u0442\u044C.",
    chain: "\u0421\u0435\u0442\u044C",
    protocol: "\u041F\u0440\u043E\u0442\u043E\u043A\u043E\u043B",
    health: "\u0417\u0434\u043E\u0440\u043E\u0432\u044C\u0435",
    collateral: "\u0417\u0430\u043B\u043E\u0433",
    debt: "\u0414\u043E\u043B\u0433",
    liqPrice: "\u041B\u0438\u043A\u0432\u0438\u0434\u0430\u0446\u0438\u044F ~",
    supplied: "\u0412 \u0437\u0430\u043B\u043E\u0433\u0435",
    borrowed: "\u0412 \u0434\u043E\u043B\u0433\u0443",
    rewards: "\u041D\u0430\u0433\u0440\u0430\u0434\u044B",
    claimable: "\u041D\u0435\u0441\u043E\u0431\u0440\u0430\u043D\u043D\u044B\u0435 \u043A\u043E\u043C\u0438\u0441\u0441\u0438\u0438",
    pool: "\u041F\u0443\u043B",
    position: "\u041F\u043E\u0437\u0438\u0446\u0438\u044F",
    balance: "\u0411\u0430\u043B\u0430\u043D\u0441",
    price: "\u0426\u0435\u043D\u0430",
    amount: "\u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E",
    value: "\u0421\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C",
    poolId: "ID \u043F\u0443\u043B\u0430",
    tokensInPool: "\u0412 \u043F\u0443\u043B\u0435",
    net: "\u0427\u0438\u0441\u0442\u0430\u044F",
    positions: "\u043F\u043E\u0437.",
    showMoreTokens: "\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0435\u0449\u0451 {n} \u043C\u0435\u043B\u043A\u0438\u0445 \u0442\u043E\u043A\u0435\u043D\u043E\u0432",
    partialBanner: "\u041E\u0441\u043D\u043E\u0432\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u044B \u2014 \u0434\u043E\u0433\u0440\u0443\u0436\u0430\u0435\u043C \u043F\u043E\u0437\u0438\u0446\u0438\u0438 \u043F\u043E \u0441\u0435\u0442\u044F\u043C\u2026",
    loadingQuick: "\u041F\u0435\u0440\u0432\u044B\u0439 \u0441\u043D\u0438\u043C\u043E\u043A \u043F\u043E\u0440\u0442\u0444\u0435\u043B\u044F\u2026",
    loadingMerge: "\u0421\u043E\u0431\u0438\u0440\u0430\u0435\u043C DeFi-\u043F\u043E\u0437\u0438\u0446\u0438\u0438\u2026",
    stepConnect: "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435",
    stepChains: "\u0421\u0435\u0442\u0438 \u0438 \u043F\u0440\u043E\u0442\u043E\u043A\u043E\u043B\u044B",
    stepMerge: "\u0421\u0431\u043E\u0440\u043A\u0430 \u043F\u043E\u0440\u0442\u0444\u0435\u043B\u044F",
    refresh: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C",
    fromCache: "\u043A\u044D\u0448",
    analytics: "\u0410\u043D\u0430\u043B\u0438\u0442\u0438\u043A\u0430",
    allocPlatforms: "\u041F\u043E \u043F\u043B\u0430\u0442\u0444\u043E\u0440\u043C\u0430\u043C",
    allocChains: "\u041F\u043E \u0441\u0435\u0442\u044F\u043C",
    structure: "\u0421\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u0430 \u043F\u043E\u0440\u0442\u0444\u0435\u043B\u044F",
    chartNote: "\u0420\u0430\u0441\u043F\u0440\u0435\u0434\u0435\u043B\u0435\u043D\u0438\u0435 \u043F\u043E \u0442\u0435\u043A\u0443\u0449\u0435\u043C\u0443 \u0441\u043D\u0438\u043C\u043A\u0443 \u043F\u043E\u0440\u0442\u0444\u0435\u043B\u044F.",
    unallocated: "\u041F\u0440\u043E\u0447\u0435\u0435 (DeBank)",
    debankGapNote: "\u0435\u0449\u0451 {usd} \u0432 DeBank \u043D\u0435 \u0440\u0430\u0437\u043B\u043E\u0436\u0435\u043D\u043E \u043F\u043E \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u044F\u043C (\u0438\u0442\u043E\u0433\u043E DeBank {debank})",
    coverageGapNote: "\u0435\u0449\u0451 {gap} \u2014 \u0434\u043E\u0433\u0440\u0443\u0436\u0430\u0435\u043C \u043F\u043E\u0437\u0438\u0446\u0438\u0438 DeBank",
    filterActive: "\u0424\u0438\u043B\u044C\u0442\u0440:",
    clearFilters: "\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C",
    historyLoading: "\u0421\u0442\u0440\u043E\u0438\u043C \u0433\u0440\u0430\u0444\u0438\u043A \u0437\u0430 365 \u0434\u043D\u0435\u0439\u2026",
    historyEmpty: "\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u0434\u0430\u043D\u043D\u044B\u0445 \u0434\u043B\u044F \u0433\u0440\u0430\u0444\u0438\u043A\u0430",
    historyNote: "\u041E\u0431\u044A\u0451\u043C\u044B \u043F\u043E\u0437\u0438\u0446\u0438\u0439 \u0441\u0435\u0433\u043E\u0434\u043D\u044F \xD7 \u0446\u0435\u043D\u044B CoinGecko; \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u044F\u044F \u0442\u043E\u0447\u043A\u0430 = \u0442\u0435\u043A\u0443\u0449\u0438\u0439 total",
    historyTitle: "\u0414\u0438\u043D\u0430\u043C\u0438\u043A\u0430 \u043F\u043E\u0440\u0442\u0444\u0435\u043B\u044F \xB7 365 \u0434\u043D\u0435\u0439",
    historyChartHint: "\u041D\u0430\u0432\u0435\u0434\u0438\u0442\u0435 \u043D\u0430 \u0433\u0440\u0430\u0444\u0438\u043A \u2014 \u0434\u0430\u0442\u0430 \u0438 \u0441\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C",
    revertLoading: "\u041F\u043E\u0434\u0433\u0440\u0443\u0436\u0430\u0435\u043C \u0434\u043E\u0445\u043E\u0434\u043D\u043E\u0441\u0442\u044C \u0438 \u043A\u043E\u043C\u0438\u0441\u0441\u0438\u0438 \u043F\u043E \u043F\u0443\u043B\u0430\u043C\u2026",
    enrichingBanner: "\u0414\u043E\u0433\u0440\u0443\u0436\u0430\u0435\u043C \u0434\u0430\u043D\u043D\u044B\u0435 \u0432 \u0444\u043E\u043D\u0435\u2026",
    revertApy: "APY (\u0441\u043B\u043E\u0436\u043D\u0430\u044F)",
    revertApr: "APR",
    revertFeeApy: "Fee APY",
    revertUncollected: "\u041D\u0435\u0441\u043E\u0431\u0440\u0430\u043D\u043D\u044B\u0435 \u043A\u043E\u043C\u0438\u0441\u0441\u0438\u0438",
    revertPnl: "PnL \u043F\u0443\u043B\u0430",
    revertTier: "\u041A\u043E\u043C\u0438\u0441\u0441\u0438\u044F \u043F\u0443\u043B\u0430",
    revertOpen: "\u041F\u043E\u0434\u0440\u043E\u0431\u043D\u0435\u0435 \u043E \u043F\u043E\u0437\u0438\u0446\u0438\u0438",
    poolTapDetail: "\u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u0434\u043B\u044F \u0434\u0435\u0442\u0430\u043B\u0435\u0439",
    revertMatched: "\u0410\u043D\u0430\u043B\u0438\u0442\u0438\u043A\u0430 LP: {matched} \u0438\u0437 {total} \xB7 \u043D\u0430 Revert: {revertCount}",
    onchainRange: "\u0414\u0438\u0430\u043F\u0430\u0437\u043E\u043D \u0441 \u0431\u043B\u043E\u043A\u0447\u0435\u0439\u043D\u0430",
    revertOnchainLine: "\u0414\u0438\u0430\u043F\u0430\u0437\u043E\u043D\u044B \u0443\u0442\u043E\u0447\u043D\u0435\u043D\u044B \u043E\u043D\u0447\u0435\u0439\u043D (RPC): {n} \u043F\u043E\u0437.",
    revertOnchainOnly: "\u0422\u043E\u043B\u044C\u043A\u043E \u043E\u043D\u0447\u0435\u0439\u043D (\u0431\u0435\u0437 Revert)",
    portfolioOnchain: "\u041F\u043E\u0440\u0442\u0444\u0435\u043B\u044C: \u043E\u043D\u0447\u0435\u0439\u043D (RPC) \xB7 {lp} LP \xB7 {lend} \u043B\u0435\u043D\u0434\u0438\u043D\u0433 \xB7 {chains} \u0441\u0435\u0442\u0435\u0439",
    portfolioOnchainHint: "\u0414\u0430\u043D\u043D\u044B\u0435 \u0441 \u0431\u043B\u043E\u043A\u0447\u0435\u0439\u043D\u0430 \u043D\u0430\u043F\u0440\u044F\u043C\u0443\u044E \u2014 \u0431\u0435\u0437 DeBank. APY/fees \u2014 \u043E\u043F\u0446\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u043E \u0441 Revert.",
    portfolioHybrid: "\u0413\u0438\u0431\u0440\u0438\u0434: {onchainUsd} \u043E\u043D\u0447\u0435\u0439\u043D \xB7 {fill} \u043F\u043E\u0437. \u0442\u043E\u043B\u044C\u043A\u043E DeBank \xB7 \u0438\u0442\u043E\u0433\u043E {totalUsd} (= DeBank)",
    portfolioHybridHint: "\u041F\u0440\u0438\u043E\u0440\u0438\u0442\u0435\u0442: 1) \u0431\u043B\u043E\u043A\u0447\u0435\u0439\u043D  2) Revert (APY/\u043A\u043E\u043C\u0438\u0441\u0441\u0438\u0438)  3) DeBank \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u043F\u0440\u043E\u0431\u0435\u043B\u043E\u0432",
    portfolioHybridGap: "\u0421\u0443\u043C\u043C\u0430 \u043F\u043E\u0437\u0438\u0446\u0438\u0439 {computed} \xB7 \u0440\u0430\u0441\u0445\u043E\u0436\u0434\u0435\u043D\u0438\u0435 \u0441 DeBank {gap} (\u0440\u0430\u0437\u043D\u044B\u0435 USD \u043D\u0430 \u0441\u043E\u0432\u043F\u0430\u0434\u0435\u043D\u0438\u044F\u0445)",
    debankFillTag: "\u0414\u043E\u0431\u043E\u0440 \u0441 DeBank (\u043D\u0435\u0442 \u0432 RPC)",
    sourceDebank: "\u0418\u0441\u0442\u043E\u0447\u043D\u0438\u043A: DeBank (legacy)",
    revertLpStats: "\u041F\u0443\u043B\u043E\u0432 {total}: {fromRevert} \u0441 Revert \xB7 {debankOnly} \u0442\u043E\u043B\u044C\u043A\u043E DeBank (GMX, Yearn\u2026)",
    revertSumOk: "\u0421\u0443\u043C\u043C\u0430 Uni+Aerodrome+Pancake \u0441\u043E\u0432\u043F\u0430\u043B\u0430 (${debankDexUsd} \u2248 ${revertDexUsd}) \u2014 LP \u0441 Revert",
    revertSumDiff: "\u0421\u0432\u0435\u0440\u043A\u0430 \u0441\u0443\u043C\u043C: DeBank ${debankDexUsd} \xB7 Revert ${revertDexUsd} ({revertCount} \u043F\u043E\u0437.) \u2014 \u043F\u043E\u043A\u0430\u0437\u0430\u043D\u044B \u0432\u0441\u0435 \u0441 Revert",
    revertNoReplace: "\u0421\u0447\u0451\u0442\u0447\u0438\u043A\u0438 DeBank \u0438 Revert \u043D\u0435 \u0441\u043E\u0432\u043F\u0430\u043B\u0438 \u2014 \u043F\u043E\u043A\u0430\u0437\u0430\u043D\u044B \u0434\u0430\u043D\u043D\u044B\u0435 DeBank \u0434\u043B\u044F \u0440\u0430\u0441\u0445\u043E\u0436\u0434\u0435\u043D\u0438\u0439",
    revertOpenHint: "\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u043F\u043E\u0437\u0438\u0446\u0438\u044E \u043D\u0430 revert.finance \u043F\u043E \u0441\u0441\u044B\u043B\u043A\u0435 \u0432 \u0437\u0430\u0433\u043E\u043B\u043E\u0432\u043A\u0435 \u043F\u0443\u043B\u0430",
    revertFailed: "\u041E\u0448\u0438\u0431\u043A\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438 Revert",
    revertEmpty: "Revert \u043D\u0435 \u0432\u0435\u0440\u043D\u0443\u043B \u043F\u043E\u0437\u0438\u0446\u0438\u0438 \u2014 \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \xAB\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C\xBB \u0438\u043B\u0438 \u043F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 r.jina.ai \u0432 whitelist",
    rangesLoading: "\u0414\u0438\u0430\u043F\u0430\u0437\u043E\u043D\u044B LP: \u0437\u0430\u043F\u0440\u043E\u0441 \u043A RPC\u2026",
    rangesOk: "\u0414\u0438\u0430\u043F\u0430\u0437\u043E\u043D\u044B LP: {n} \u0438\u0437 {total}",
    rangesMissing: "\u0414\u0438\u0430\u043F\u0430\u0437\u043E\u043D\u044B LP \u043D\u0435 \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u044B \u2014 \u043D\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0435 \u043D\u0443\u0436\u043D\u044B rpc_urls \u0432 config.json (\u0441\u043C. config.example.json)",
    revertNoMatch: "\u041F\u043E\u0437\u0438\u0446\u0438\u0438 Revert \u0435\u0441\u0442\u044C, \u043D\u043E \u043F\u0430\u0440\u044B \u043D\u0435 \u0441\u043E\u0432\u043F\u0430\u043B\u0438 \u2014 \u043E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u043F\u0443\u043B \u0432\u0440\u0443\u0447\u043D\u0443\u044E \u043D\u0430 revert.finance",
    partialReady: "\u0414\u0430\u043D\u043D\u044B\u0435 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u044B",
    loadTrustWait: "\u0414\u043E\u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u2014 \u043F\u043E\u043B\u043D\u043E\u0439 \u043A\u0430\u0440\u0442\u0438\u043D\u0435 \u043C\u043E\u0436\u043D\u043E \u0434\u043E\u0432\u0435\u0440\u044F\u0442\u044C \u043F\u043E\u0441\u043B\u0435 100%",
    loadTrustOk: "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0430",
    lpStepConnect: "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435",
    lpStepDebank: "DeBank \xB7 \u043F\u043E\u0437\u0438\u0446\u0438\u0438 \u0438 \u0441\u0443\u043C\u043C\u044B",
    lpStepPositions: "\u0420\u0430\u0437\u0431\u043E\u0440 \u043F\u043E\u0440\u0442\u0444\u0435\u043B\u044F",
    lpStepRanges: "\u0414\u0438\u0430\u043F\u0430\u0437\u043E\u043D\u044B LP",
    lpStepApy: "\u0414\u043E\u0445\u043E\u0434\u043D\u043E\u0441\u0442\u044C \u0438 \u043A\u043E\u043C\u0438\u0441\u0441\u0438\u0438",
    lpStepHistory: "\u0413\u0440\u0430\u0444\u0438\u043A \u0438\u0441\u0442\u043E\u0440\u0438\u0438",
    revertSource: "",
    apyFormulaHint: "APY \u2248 (1+APR/12)^12\u22121 \u043F\u0440\u0438 \u0435\u0436\u0435\u043C\u0435\u0441\u044F\u0447\u043D\u043E\u043C \u0440\u0435\u0438\u043D\u0432\u0435\u0441\u0442\u0435",
    lastWallet: "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u043A\u043E\u0448\u0435\u043B\u0451\u043A",
    rangeLbl: "\u0414\u0438\u0430\u043F\u0430\u0437\u043E\u043D",
    rangePrice: "\u0426\u0435\u043D\u0430",
    feesShort: "\u043A\u043E\u043C\u0438\u0441\u0441\u0438\u0438",
    pdRangeSection: "\u0414\u0438\u0430\u043F\u0430\u0437\u043E\u043D",
    pdFeesSection: "\u041A\u043E\u043C\u0438\u0441\u0441\u0438\u0438",
    pdYieldSection: "\u0414\u043E\u0445\u043E\u0434\u043D\u043E\u0441\u0442\u044C",
    pdPositionSection: "\u041F\u043E\u0437\u0438\u0446\u0438\u044F",
    pdRangeMin: "\u041C\u0438\u043D.",
    pdRangeMax: "\u041C\u0430\u043A\u0441.",
    pdRangeCur: "\u0422\u0435\u043A\u0443\u0449\u0430\u044F",
    pdFeesTotal: "\u0412\u0441\u0435\u0433\u043E \u0437\u0430\u0440\u0430\u0431\u043E\u0442\u0430\u043D\u043E",
    pdFeesUnclaimedHero: "\u041D\u0435\u0441\u043E\u0431\u0440\u0430\u043D\u043D\u044B\u0435 \u043A\u043E\u043C\u0438\u0441\u0441\u0438\u0438",
    pdFeesUnclaimed: "\u041D\u0435\u0441\u043E\u0431\u0440\u0430\u043D\u043E",
    pdPoolFeeTier: "\u0421\u0442\u0430\u0432\u043A\u0430 \u043F\u0443\u043B\u0430",
    pdInRange: "\u0412 \u0434\u0438\u0430\u043F\u0430\u0437\u043E\u043D\u0435",
    pdOutRange: "\u0412\u043D\u0435 \u0434\u0438\u0430\u043F\u0430\u0437\u043E\u043D\u0430",
    poolApyLbl: "APY",
    pdFeesCollected: "\u0421\u043E\u0431\u0440\u0430\u043D\u043E",
    pdFeesPartialNote: "\u041F\u043E\u043A\u0430\u0437\u0430\u043D\u044B \u0442\u043E\u043B\u044C\u043A\u043E \u043D\u0435\u0441\u043E\u0431\u0440\u0430\u043D\u043D\u044B\u0435 \u043A\u043E\u043C\u0438\u0441\u0441\u0438\u0438 (Revert)",
    pdFeesByToken: "\u041F\u043E \u0442\u043E\u043A\u0435\u043D\u0430\u043C",
    pdOpened: "\u041E\u0442\u043A\u0440\u044B\u0442\u0430",
    pdAge: "\u0412 \u0440\u0430\u0431\u043E\u0442\u0435",
    pdDays: "\u0434\u043D."
  },
  en: {
    brand: "Portfolio Tracker",
    tagline: "Full DeFi portfolio view: positions, yield, liquidation risk and fees \u2014 in seconds",
    placeholder: "0x\u2026 wallet address",
    go: "Scan",
    hint: "",
    errEmpty: "Enter a wallet address",
    errEvm: "Invalid EVM address",
    errLoad: "Could not load data. Refresh the page (Cmd+Shift+R) and try again.",
    errFetch: "Data source is temporarily unavailable. Wait 10 seconds and tap Scan again.",
    errEmptyPortfolio: "Portfolio is empty or data failed to load. Check the address and tap Refresh.",
    errParse: "Could not parse data (Node.js required on server). See .cache/api-debug.log",
    errNoApi: "Could not reach the server. Refresh the page or open /portfolio/ on your host.",
    errNoApiLocal: "Service is not running. Close the tab and double-click Launch.command in the app folder.",
    loadingConnect: "Connecting to data sources\u2026",
    loadingParse: "Building positions\u2026",
    loadingChains: "Loading positions per chain\u2026",
    back: "\u2190 Another wallet",
    platforms: "Platforms",
    allPlatforms: "All",
    walletAddress: "Address",
    chains: "By blockchain",
    yield: "Yield",
    farming: "Farming",
    deposit: "Deposit",
    kindWallet: "Wallet",
    kindLiquidityPool: "Liquidity pool",
    kindLending: "Lending",
    kindYield: "Yield",
    kindFarming: "Farming",
    kindDeposit: "Deposit",
    liquiditySection: "Liquidity pools",
    lendingSection: "Lending",
    netPosition: "Net position",
    healthFactor: "Health factor",
    collateralLbl: "Collateral",
    debtLbl: "Debt",
    liquidationLbl: "Liq. price ~",
    suppliedLbl: "Supplied",
    borrowedLbl: "Borrowed",
    lendNoCollateral: "No collateral",
    lendNoDebt: "No debt",
    rewardsLbl: "Rewards",
    claimableLbl: "Unclaimed fees",
    inPoolLbl: "In pool",
    poolPair: "Pair",
    positionsCount: "pos.",
    total: "Total",
    wallet: "Wallet",
    liquidity: "Liquidity",
    lending: "Lending",
    updated: "Updated",
    empty: "No positions in this category",
    showDust: "Show small balances",
    hideDust: "Hide small balances",
    dustNote: "Small balances are hidden. Toggle to show dust tokens.",
    chain: "Chain",
    protocol: "Protocol",
    health: "Health",
    collateral: "Collateral",
    debt: "Debt",
    liqPrice: "Liq. ~",
    supplied: "Supplied",
    borrowed: "Borrowed",
    rewards: "Rewards",
    claimable: "Unclaimed fees",
    pool: "Pool",
    position: "Position",
    balance: "Balance",
    price: "Price",
    amount: "Amount",
    value: "Value",
    poolId: "Pool ID",
    tokensInPool: "In pool",
    net: "Net",
    positions: "pos.",
    showMoreTokens: "Show {n} more small tokens",
    partialBanner: "Core data loaded \u2014 fetching positions across chains\u2026",
    loadingQuick: "Loading portfolio snapshot\u2026",
    loadingMerge: "Merging DeFi positions\u2026",
    stepConnect: "Connect",
    stepChains: "Chains & protocols",
    stepMerge: "Final merge",
    refresh: "Refresh",
    fromCache: "cached",
    analytics: "Analytics",
    allocPlatforms: "By platform",
    allocChains: "By chain",
    structure: "Portfolio mix",
    chartNote: "Allocation from the current portfolio snapshot.",
    unallocated: "Other (DeBank)",
    debankGapNote: "plus {usd} on DeBank not split into categories (DeBank total {debank})",
    coverageGapNote: "{gap} still loading from DeBank",
    filterActive: "Filter:",
    clearFilters: "Clear",
    historyLoading: "Building 365-day chart\u2026",
    historyEmpty: "Not enough data for chart",
    historyNote: "Today's position sizes \xD7 CoinGecko prices; last point = current total",
    historyTitle: "Portfolio \xB7 365 days",
    historyChartHint: "Hover the chart for date and value",
    revertLoading: "Loading pool yield and uncollected fees\u2026",
    enrichingBanner: "Loading more data in the background\u2026",
    revertApy: "APY (compounded)",
    revertApr: "APR",
    revertFeeApy: "Fee APY",
    revertUncollected: "Uncollected fees",
    revertPnl: "Pool PnL",
    revertTier: "Pool fee tier",
    revertOpen: "Position details",
    poolTapDetail: "Tap for details",
    revertMatched: "LP analytics: {matched} of {total} \xB7 on Revert: {revertCount}",
    onchainRange: "On-chain range",
    revertOnchainLine: "Ranges from chain RPC: {n} positions",
    revertOnchainOnly: "On-chain only (no Revert)",
    portfolioOnchain: "Portfolio: on-chain (RPC) \xB7 {lp} LP \xB7 {lend} lending \xB7 {chains} chains",
    portfolioOnchainHint: "Data read directly from chain \u2014 no DeBank. APY/fees optionally from Revert.",
    portfolioHybrid: "Hybrid: {onchainUsd} on-chain \xB7 {fill} DeBank-only pos. \xB7 total {totalUsd} (= DeBank)",
    portfolioHybridHint: "Priority: 1) on-chain  2) Revert (APY/fees)  3) DeBank for gaps only",
    portfolioHybridGap: "Position sum {computed} \xB7 gap vs DeBank header {gap}",
    debankFillTag: "Filled from DeBank (not in RPC scan)",
    sourceDebank: "Source: DeBank (legacy)",
    revertLpStats: "Pools {total}: {fromRevert} from Revert \xB7 {debankOnly} DeBank-only",
    revertSumOk: "Uni+Aerodrome+Pancake USD matched (${debankDexUsd} \u2248 ${revertDexUsd}) \u2014 using Revert",
    revertSumDiff: "USD check: DeBank ${debankDexUsd} \xB7 Revert ${revertDexUsd} ({revertCount} pos.) \u2014 all Revert shown",
    revertNoReplace: "DeBank vs Revert counts differ \u2014 DeBank kept where they disagree",
    revertOpenHint: "Open the position on revert.finance via the pool link",
    revertFailed: "Revert load failed",
    revertEmpty: "Revert returned no positions \u2014 tap Refresh or whitelist r.jina.ai",
    rangesLoading: "LP ranges: fetching via RPC\u2026",
    rangesOk: "LP ranges: {n} of {total}",
    rangesMissing: "LP ranges unavailable \u2014 add rpc_urls to config.json on the server (see config.example.json)",
    revertNoMatch: "Revert data loaded but pairs did not match \u2014 check pool on revert.finance",
    partialReady: "Data updated",
    loadTrustWait: "Still loading \u2014 trust totals fully at 100%",
    loadTrustOk: "Load complete",
    lpStepConnect: "Connecting",
    lpStepDebank: "DeBank \xB7 positions & totals",
    lpStepPositions: "Building portfolio",
    lpStepRanges: "LP price ranges",
    lpStepApy: "Yield & fees",
    lpStepHistory: "History chart",
    revertSource: "",
    apyFormulaHint: "APY \u2248 (1+APR/12)^12\u22121 with monthly reinvest",
    lastWallet: "Last wallet",
    rangeLbl: "Range",
    rangePrice: "Price",
    feesShort: "fees",
    pdRangeSection: "Price range",
    pdFeesSection: "Fees earned",
    pdYieldSection: "Yield",
    pdPositionSection: "Position",
    pdRangeMin: "Min",
    pdRangeMax: "Max",
    pdRangeCur: "Current",
    pdFeesTotal: "Total earned",
    pdFeesUnclaimedHero: "Uncollected fees",
    pdFeesUnclaimed: "Unclaimed",
    pdPoolFeeTier: "Pool fee tier",
    pdInRange: "In range",
    pdOutRange: "Out of range",
    poolApyLbl: "APY",
    pdFeesCollected: "Collected",
    pdFeesPartialNote: "Unclaimed fees only (Revert)",
    pdFeesByToken: "By token",
    pdOpened: "Opened",
    pdAge: "Active",
    pdDays: "days"
  }
};
var KIND_KEYS = {
  Wallet: "kindWallet",
  "Liquidity Pool": "kindLiquidityPool",
  Lending: "kindLending",
  Yield: "kindYield",
  Farming: "kindFarming",
  Deposit: "kindDeposit"
};
function translateKind(lang2, kind) {
  const key = KIND_KEYS[kind];
  if (key) return dict[lang2]?.[key] ?? dict.en[key] ?? kind;
  return kind;
}
function t(lang2, key, vars) {
  let s = dict[lang2]?.[key] ?? dict.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(`{${k}}`, String(v));
    }
  }
  return s;
}

// js/protocols.js
var PROTO = {
  Wallet: { slug: "wallet", color: "#fbbf24", emoji: "\u25C7" },
  "GMX V2": { slug: "gmx", color: "#4f46e5" },
  Hyperliquid: { slug: "hyperliquid", color: "#97fce4" },
  "Uniswap V3": { slug: "uniswap", color: "#ff007a" },
  "Uniswap V4": { slug: "uniswap", color: "#ff007a" },
  Beefy: { slug: "beefy", color: "#f9f4e8" },
  "PancakeSwap V3": { slug: "pancakeswap", color: "#d1884f" },
  "Aerodrome V3": { slug: "aerodrome", color: "#0052ff" },
  "Pendle V2": { slug: "pendle", color: "#1e88e5" },
  "Compound V3": { slug: "compound", color: "#00d395" }
};
function escAttr2(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
var LIQ_PROTOCOL_RANK = {
  "Uniswap V3": 10,
  "Uniswap V4": 20,
  "PancakeSwap V3": 30,
  "Aerodrome V3": 40
};
function protocolLiquidityRank(name) {
  const n = String(name || "");
  if (LIQ_PROTOCOL_RANK[n] != null) return LIQ_PROTOCOL_RANK[n];
  const low = n.toLowerCase();
  if (low.includes("uniswap v3")) return 10;
  if (low.includes("uniswap v4")) return 20;
  if (low.includes("pancake")) return 30;
  if (low.includes("aerodrome")) return 40;
  return 500;
}
function compareLiquidityProtocols(a, b, usdA = 0, usdB = 0) {
  const ra = protocolLiquidityRank(a);
  const rb = protocolLiquidityRank(b);
  if (ra !== rb) return ra - rb;
  return usdB - usdA;
}
function protocolMeta(name) {
  const n = String(name || "");
  if (PROTO[n]) return { ...PROTO[n], name: n };
  const key = Object.keys(PROTO).find((k) => k.toLowerCase() === n.toLowerCase());
  if (key) return { ...PROTO[key], name: n };
  return {
    name: n,
    slug: n.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    color: "#6b7cff"
  };
}
function protocolLogoHtml(name, size = 24) {
  const m = protocolMeta(name);
  if (m.emoji) {
    return `<span class="proto-logo proto-logo--emoji" style="width:${size}px;height:${size}px;background:${m.color}">${m.emoji}</span>`;
  }
  const urls = [
    `https://icons.llama.fi/${m.slug}.png`,
    `https://static.debank.com/image/project/logo_url/${m.slug}/${m.slug}.png`
  ];
  return `<span class="proto-logo-wrap" style="width:${size}px;height:${size}px">
    <img class="proto-logo" src="${escAttr2(urls[0])}" data-fallbacks="${escAttr2(urls.join("|"))}" alt="" width="${size}" height="${size}" loading="lazy" onerror="ptProtoImgFallback(this)" />
    <span class="proto-logo-fallback" style="background:${m.color}">${escAttr2(m.name.slice(0, 1))}</span>
  </span>`;
}
if (typeof window !== "undefined") {
  window.ptProtoImgFallback = function(img) {
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
}

// js/history.js
var chartState = /* @__PURE__ */ new WeakMap();
function fmtUsdShort(v) {
  return "$" + Number(v || 0).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: v >= 1e3 ? 0 : 2
  });
}
function layout(series, w, h) {
  const vals = series.map((p) => p.v);
  const min = Math.min(...vals) * 0.92;
  const max = Math.max(...vals) * 1.06;
  const pad = { l: 12, r: 16, t: 20, b: 36 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const xAt = (i) => pad.l + i / Math.max(series.length - 1, 1) * iw;
  const yAt = (v) => pad.t + ih - (v - min) / (max - min || 1) * ih;
  return { series, min, max, pad, iw, ih, w, h, xAt, yAt };
}
function formatDateLabel(d, locale) {
  if (!d) return "";
  try {
    const dt = /* @__PURE__ */ new Date(d + "T12:00:00");
    return dt.toLocaleDateString(locale === "ru" ? "ru-RU" : "en-US", {
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  } catch {
    return d.slice(0, 10);
  }
}
function drawChart(ctx, L, hoverIdx) {
  const { series, min, max, pad, iw, ih, w, h, xAt, yAt } = L;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(120, 140, 255, 0.08)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + ih / 4 * i;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + iw, y);
    ctx.stroke();
  }
  const grad = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
  grad.addColorStop(0, "rgba(34, 211, 238, 0.32)");
  grad.addColorStop(1, "rgba(34, 211, 238, 0)");
  ctx.beginPath();
  series.forEach((p, i) => {
    const x = xAt(i);
    const y = yAt(p.v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(pad.l + iw, pad.t + ih);
  ctx.lineTo(pad.l, pad.t + ih);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.beginPath();
  series.forEach((p, i) => {
    const x = xAt(i);
    const y = yAt(p.v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#22d3ee";
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.fillStyle = "#6b7a9e";
  ctx.font = "600 10px Inter, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(series[0]?.d?.slice(0, 10) || "", pad.l, h - 10);
  ctx.textAlign = "right";
  ctx.fillText(series[series.length - 1]?.d?.slice(0, 10) || "", w - pad.r, h - 10);
  if (hoverIdx == null || hoverIdx < 0) return;
  const pt = series[hoverIdx];
  const hx = xAt(hoverIdx);
  const hy = yAt(pt.v);
  ctx.strokeStyle = "rgba(34, 211, 238, 0.55)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(hx, pad.t);
  ctx.lineTo(hx, pad.t + ih);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(hx, hy, 6, 0, Math.PI * 2);
  ctx.fillStyle = "#22d3ee";
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "rgba(8, 10, 24, 0.92)";
  const dateLbl = formatDateLabel(pt.d, chartState.get(ctx.canvas)?.locale || "ru");
  ctx.font = "700 11px Inter, sans-serif";
  const tw = ctx.measureText(dateLbl).width + 14;
  let tx = hx - tw / 2;
  tx = Math.max(pad.l, Math.min(tx, w - pad.r - tw));
  const ty = h - pad.b + 6;
  roundRect(ctx, tx, ty, tw, 20, 8);
  ctx.fill();
  ctx.fillStyle = "#e8ecff";
  ctx.textAlign = "center";
  ctx.fillText(dateLbl, tx + tw / 2, ty + 14);
  const priceLbl = fmtUsdShort(pt.v);
  ctx.font = "800 12px Inter, sans-serif";
  const pw = ctx.measureText(priceLbl).width + 14;
  let px = hx + 12;
  if (px + pw > w - pad.r) px = hx - pw - 12;
  let py = hy - 28;
  py = Math.max(pad.t + 4, py);
  roundRect(ctx, px, py, pw, 24, 10);
  ctx.fillStyle = "rgba(8, 10, 24, 0.94)";
  ctx.fill();
  ctx.strokeStyle = "rgba(74, 222, 128, 0.45)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#4ade80";
  ctx.textAlign = "center";
  ctx.fillText(priceLbl, px + pw / 2, py + 16);
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
function indexFromX(L, clientX, rect) {
  const x = clientX - rect.left - L.pad.l;
  const i = Math.round(x / L.iw * (L.series.length - 1));
  return Math.max(0, Math.min(L.series.length - 1, i));
}
function setupHistoryChart(canvas, series, locale) {
  if (!canvas || !series?.length) return () => {
  };
  const existing = chartState.get(canvas);
  if (existing?.cleanup) existing.cleanup();
  const ctx = canvas.getContext("2d");
  const state2 = { hover: null, locale: locale || "ru" };
  chartState.set(canvas, state2);
  const paint = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 600;
    const h = canvas.clientHeight || 220;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    }
    const L = layout(series, w, h);
    state2.L = L;
    drawChart(ctx, L, state2.hover);
  };
  const onMove = (e) => {
    const rect = canvas.getBoundingClientRect();
    if (!state2.L) return;
    state2.hover = indexFromX(state2.L, e.clientX, rect);
    paint();
  };
  const onLeave = () => {
    state2.hover = null;
    paint();
  };
  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("mouseleave", onLeave);
  canvas.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches[0]) onMove(e.touches[0]);
    },
    { passive: true }
  );
  canvas.addEventListener("touchend", onLeave);
  const onResize = () => paint();
  window.addEventListener("resize", onResize);
  paint();
  const cleanup = () => {
    canvas.removeEventListener("mousemove", onMove);
    canvas.removeEventListener("mouseleave", onLeave);
    window.removeEventListener("resize", onResize);
    chartState.delete(canvas);
  };
  state2.cleanup = cleanup;
  return cleanup;
}

// js/revert-parse.js
function aprToApy(apr) {
  if (apr == null || !Number.isFinite(apr)) return null;
  const a = Number(apr);
  if (Math.abs(a) > 500) return null;
  return (Math.pow(1 + a / 100 / 12, 12) - 1) * 100;
}
function pairMeta(pairKey) {
  const tokens = String(pairKey || "").split("+").filter(Boolean);
  return {
    allStable: tokens.length >= 2 && tokens.every((t2) => STABLE_TOKENS.has(t2)),
    hasBtc: tokens.some((t2) => BTC_TOKENS.has(t2) || t2.endsWith("BTC")),
    hasGold: tokens.some((t2) => GOLD_TOKENS.has(t2))
  };
}
function buildMarketHints(positions) {
  const hints = {};
  for (const p of positions || []) {
    const pk = p.pairKey || normPair(p.pair);
    const cur = p.rangeCurrent;
    if (cur != null && cur >= 5e3 && (pk.includes("BTC") || pk.includes("WBTC"))) {
      hints.btcUsd = cur;
    }
    if (cur != null && cur >= 500 && pk.includes("XAUT")) {
      hints.goldUsd = cur;
    }
  }
  return hints;
}
var TOKEN_ALIASES = {
  USDT0: "USDT",
  USDTE: "USDT",
  "USD\u20AE0": "USDT",
  USDC0: "USDC",
  XAUT0: "XAUT",
  XAUT: "XAUT",
  XAUt0: "XAUT",
  XAUt: "XAUT",
  CBBTC: "CBBTC",
  WBTC: "WBTC",
  WETH: "WETH",
  ETH: "ETH"
};
var STABLE_TOKENS = /* @__PURE__ */ new Set(["USDC", "USDT", "DAI", "GHO", "RLUSD", "FRAX", "USDE", "LUSD"]);
var BTC_TOKENS = /* @__PURE__ */ new Set(["WBTC", "CBBTC", "BTC", "TBTC"]);
var GOLD_TOKENS = /* @__PURE__ */ new Set(["XAUT"]);
function normToken(symbol) {
  let s = String(symbol || "").trim().toUpperCase().replace(/\s+/g, "").replace(/₮/g, "T");
  if (TOKEN_ALIASES[s]) return TOKEN_ALIASES[s];
  return s;
}
function normPair(pair) {
  return String(pair || "").replace(/\s+/g, "").replace(/-/g, "/").split(/[+/]/).filter(Boolean).map(normToken).sort().join("+");
}
var RANGE_FLIP_THRESHOLD = 0.5;
function isCoarseMicroRange(raw) {
  const nums = (raw || []).filter((n) => n != null && Number.isFinite(n) && n > 0);
  if (nums.length < 2) return false;
  return nums.every((n) => n < 1e-4);
}
function spotFromInPool(inPool, positionUsd, pairKey) {
  const meta = pairMeta(pairKey);
  if (!meta.hasBtc || !inPool?.length) return null;
  let stableUsd = 0;
  let btcAmt = 0;
  for (const x of inPool) {
    const sym = normToken(x.symbol);
    const amt = parseFloat(String(x.amount || "0").replace(/,/g, ""));
    if (!Number.isFinite(amt) || amt <= 0) continue;
    if (STABLE_TOKENS.has(sym)) stableUsd += amt;
    if (BTC_TOKENS.has(sym)) btcAmt += amt;
  }
  if (btcAmt <= 0 || positionUsd <= stableUsd) return null;
  const px = (positionUsd - stableUsd) / btcAmt;
  if (px < 1e3 || px > 5e5) return null;
  return px;
}
function invertPoolPrice(n) {
  if (n == null || !Number.isFinite(n) || n <= 0) return n;
  if (n < RANGE_FLIP_THRESHOLD) return 1 / n;
  return n;
}
function rangeFromOrdered(min, cur, max) {
  const a = Math.min(min, max);
  const b = Math.max(min, max);
  const c = cur ?? (a + b) / 2;
  return { rangeMin: a, rangeMax: b, rangeCurrent: c, rangeNums: [a, c, b] };
}
function isDisplayRangeUsable(rangeMin, rangeMax, rangeCurrent, pairKey) {
  if (rangeMin == null || rangeMax == null) return false;
  const meta = pairMeta(pairKey);
  const nums = [rangeMin, rangeMax, rangeCurrent].filter((x) => x != null && Number.isFinite(x));
  if (isCoarseMicroRange(nums)) return false;
  if (meta.allStable) {
    const mid = (rangeMin + rangeMax) / 2;
    if (mid < 0.85 || mid > 1.15) return false;
  }
  return true;
}
function fmtRangeDisplay(n, pairKey) {
  if (n == null || !Number.isFinite(n)) return "\u2014";
  const v = Number(n);
  const meta = pairMeta(pairKey);
  if (meta.allStable) return v.toFixed(4);
  if (v >= 1e3) return Math.round(v).toLocaleString("en-US");
  if (v >= 1) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return v.toFixed(4);
}
function normalizeRevertRange(rangeNums, pairKey, opts = {}) {
  const raw = (rangeNums || []).filter((n) => n != null && Number.isFinite(n));
  const large = (opts.largeNums || []).filter((n) => n >= 100);
  const hints = opts.marketHints || {};
  const meta = pairMeta(pairKey);
  if (large.length >= 2) {
    const sorted = [...large].sort((a, b) => a - b);
    let cur = raw.length >= 3 && raw[1] >= 100 ? raw[1] : large.length >= 3 ? large[1] : (sorted[0] + sorted[sorted.length - 1]) / 2;
    return rangeFromOrdered(sorted[0], cur, sorted[sorted.length - 1]);
  }
  if (meta.allStable && raw.length >= 2) {
    const band = raw.filter((n) => n >= 0.85 && n <= 1.15);
    const vals = band.length >= 2 ? band : raw;
    if (vals.length >= 2) {
      const cur = vals.length >= 3 ? vals[1] : vals[Math.floor(vals.length / 2)];
      const sorted = [...vals].sort((a, b) => a - b);
      return rangeFromOrdered(sorted[0], cur, sorted[sorted.length - 1]);
    }
    if (raw.every((n) => n < RANGE_FLIP_THRESHOLD)) {
      const inv = raw.map(invertPoolPrice).filter((n) => n >= 0.85 && n <= 1.15);
      if (inv.length >= 2) {
        const sorted = [...inv].sort((a, b) => a - b);
        const cur = inv.length >= 3 ? inv[1] : sorted[Math.floor(sorted.length / 2)];
        return rangeFromOrdered(sorted[0], cur, sorted[sorted.length - 1]);
      }
    }
  }
  if (raw.length >= 2 && raw.every((n) => n < RANGE_FLIP_THRESHOLD)) {
    const inv = raw.map(invertPoolPrice);
    const rangeMin = Math.min(...inv);
    const rangeMax = Math.max(...inv);
    const spot = hints.spotUsd || (meta.hasBtc ? hints.btcUsd : null) || (meta.hasGold ? hints.goldUsd : null);
    if (isCoarseMicroRange(raw) && spot) {
      const loF = 1.22;
      const hiF = 1.151;
      return rangeFromOrdered(spot / loF, spot, spot * hiF);
    }
    let rangeCurrent = raw.length >= 3 ? invertPoolPrice(raw[1]) : (rangeMin + rangeMax) / 2;
    const atEdge = rangeCurrent >= rangeMax * 0.998 || rangeCurrent <= rangeMin * 1.002;
    if (atEdge) {
      if (spot) rangeCurrent = spot;
      else {
        const sortedRaw = [...raw].sort((a, b) => a - b);
        rangeCurrent = invertPoolPrice(sortedRaw[Math.floor(sortedRaw.length / 2)]);
      }
    }
    return rangeFromOrdered(rangeMin, rangeCurrent, rangeMax);
  }
  if (raw.length && raw.every((n) => n >= RANGE_FLIP_THRESHOLD && n < 1e6)) {
    if (raw.length >= 3) return rangeFromOrdered(raw[0], raw[1], raw[2]);
    if (raw.length === 2) return rangeFromOrdered(raw[0], (raw[0] + raw[1]) / 2, raw[1]);
    const c = raw[0];
    return rangeFromOrdered(c * 0.999, c, c * 1.001);
  }
  return { rangeMin: null, rangeMax: null, rangeCurrent: null, rangeNums: [] };
}
function feeAprForDisplay(feeApr) {
  const v = sanitizeApr(feeApr);
  if (v == null || v < 0) return null;
  return v;
}
function displayApyFromFeeApr(feeApr) {
  const fee = feeAprForDisplay(feeApr);
  return fee != null ? aprToApy(fee) : null;
}
function finalizeRevertPosition(rev, marketHints = null) {
  const nums = rev.rangeNums?.length > 0 ? rev.rangeNums : [rev.rangeMin, rev.rangeCurrent, rev.rangeMax].filter(
    (x) => x != null && Number.isFinite(x)
  );
  const range = normalizeRevertRange(nums, rev.pairKey || normPair(rev.pair), {
    largeNums: rev.largeNums,
    marketHints: marketHints || rev.marketHints
  });
  const displayApy = displayApyFromFeeApr(rev.feeApr);
  return {
    ...rev,
    ...range,
    displayApy,
    apy: displayApy,
    feeApy: displayApy
  };
}
function formatPairDisplay(pair) {
  return String(pair || "").replace(/\s+/g, "").split(/[+/]/).filter(Boolean).map((s) => normToken(s)).join("+");
}
function sanitizeApr(v) {
  if (v == null || !Number.isFinite(v)) return null;
  if (Math.abs(v) > 200) return null;
  return v;
}

// js/revert-match.js
var PROTOCOL_EXCHANGES = {
  "uniswap v3": ["uniswapv3", "uniswap"],
  "uniswap v4": ["uniswapv4", "uniswap", "uniswapv3"],
  aerodrome: ["aerodrome", "aerodromecl"],
  "aerodrome v3": ["aerodrome", "aerodromecl"],
  pancakeswap: ["pancakeswap", "pancake", "pancakeswapv3"],
  "pancakeswap v3": ["pancakeswap", "pancake", "pancakeswapv3"],
  sushiswap: ["sushi", "sushiswap"],
  curve: ["curve"],
  balancer: ["balancer"],
  "velodrome v2": ["velodrome"],
  "velodrome v3": ["velodrome"]
};
var CHAIN_ALIASES = {
  eth: "eth",
  ethereum: "eth",
  arb: "arb",
  arbitrum: "arb",
  base: "base",
  op: "op",
  optimism: "op",
  matic: "matic",
  polygon: "matic",
  bsc: "bsc",
  unichain: "unichain"
};
function poolPairKey(pool) {
  const raw = pool.pair || pool.poolId || "";
  if (raw.includes("+") || raw.includes("/")) return normPair(raw);
  const syms = (pool.inPool || []).map((x) => x.symbol).filter(Boolean);
  if (syms.length >= 2) return normPair(syms.join("+"));
  return normPair(raw);
}
function normalizeChain(chain) {
  const c = String(chain || "").toLowerCase();
  return CHAIN_ALIASES[c] || c;
}
function protocolExchanges(protocol) {
  const p = String(protocol || "").toLowerCase();
  for (const [key, exs] of Object.entries(PROTOCOL_EXCHANGES)) {
    if (p.includes(key.replace(/\s+/g, "")) || p.includes(key)) return exs;
  }
  if (p.includes("uniswap")) return ["uniswapv3", "uniswap", "uniswapv4", "uni"];
  if (p.includes("aerodrome")) return ["aerodrome", "aerodromecl"];
  if (p.includes("pancake")) return ["pancakeswap", "pancakeswapv3", "pancake"];
  return [];
}
function extractPoolFeeTier(pool) {
  const src = `${pool.poolId || ""} ${pool.pair || ""}`;
  const m = src.match(/(\d+(?:\.\d+)?)\s*%/);
  if (m) return parseFloat(m[1]);
  const m2 = src.match(/#(\d+(?:\.\d+)?)/);
  if (m2) {
    const v = parseFloat(m2[1]);
    if (v < 100) return v;
  }
  return null;
}
function extractPoolAddress(pool) {
  const src = `${pool.poolId || ""} ${pool.pair || ""}`;
  const m = src.match(/(0x[a-fA-F0-9]{40})/i);
  return m ? m[1].toLowerCase() : "";
}
function exchangeMatches(protocol, revExchange) {
  const hints = protocolExchanges(protocol);
  const ex = String(revExchange || "").toLowerCase();
  if (!hints.length) {
    return /uniswap|aerodrome|pancake|velodrome|sushi|curve|balancer/i.test(protocol);
  }
  return hints.some((h) => ex.includes(h) || h.includes(ex));
}
function usdTolerance(usd, factor = 1) {
  const u = Math.max(0, usd || 0);
  return Math.max(2.5, u * 1.8 * factor + 1.5);
}
function collectLiquidityTasks(portfolio) {
  const tasks = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (pool, protocol) => {
    const key = `${pool.chain}|${protocol}|${pool.poolId || pool.pair}|${pool.positionUsd}`;
    if (seen.has(key)) return;
    seen.add(key);
    tasks.push({ pool, protocol });
  };
  for (const g of portfolio.protocolGroups || []) {
    for (const pool of g.liquidity || []) {
      add(pool, g.protocol);
    }
  }
  for (const pool of portfolio.liquidity || []) {
    add(pool, pool.protocol || "Liquidity");
  }
  tasks.sort((a, b) => (b.pool.positionUsd || 0) - (a.pool.positionUsd || 0));
  return tasks;
}
function tryAssign(pool, rev, score) {
  pool.revert = rev;
  pool.revertMatchScore = score;
}
function scoreRevertMatch(pool, protocol, rev, { strictUsd = true } = {}) {
  const chain = normalizeChain(pool.chain);
  if (normalizeChain(rev.chain) !== chain) return null;
  const pairKey = poolPairKey(pool);
  if (rev.pairKey !== pairKey) return null;
  if (!exchangeMatches(protocol, rev.exchange)) return null;
  const poolAddr = extractPoolAddress(pool);
  if (poolAddr && rev.poolAddress && poolAddr === rev.poolAddress.toLowerCase()) return 0;
  if (poolAddr && rev.positionId && poolAddr === rev.positionId.toLowerCase()) return 0;
  const usd = pool.positionUsd || 0;
  const revUsd = rev.pooledUsd || 0;
  const usdDiff = Math.abs(revUsd - usd);
  const tol = usdTolerance(usd, strictUsd ? 1 : 2.5);
  if (usdDiff > tol) return null;
  const claim = pool.claimableUsd || 0;
  const feeDiff = Math.abs((rev.uncollectedUsd || 0) - claim) * 1.5;
  let score = usdDiff + feeDiff;
  const poolFee = extractPoolFeeTier(pool);
  if (poolFee != null && rev.feeTierPct != null) {
    score += Math.abs(poolFee - rev.feeTierPct) * 0.08;
  }
  return score;
}
function greedyPass(tasks, available, matcher) {
  for (const { pool, protocol } of tasks) {
    if (pool.revert) continue;
    let bestIdx = -1;
    let bestScore = Infinity;
    for (let i = 0; i < available.length; i++) {
      const s = matcher(pool, protocol, available[i]);
      if (s == null) continue;
      if (s < bestScore) {
        bestScore = s;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      tryAssign(pool, available[bestIdx], bestScore);
      available.splice(bestIdx, 1);
    }
  }
}
function attachRevertToPortfolio(portfolio, revertPositions) {
  const available = [...revertPositions || []];
  const tasks = collectLiquidityTasks(portfolio);
  for (const t2 of tasks) {
    t2.pool.revert = null;
    t2.pool.revertMatchScore = null;
  }
  greedyPass(
    tasks,
    available,
    (pool, protocol, rev) => scoreRevertMatch(pool, protocol, rev, { strictUsd: true })
  );
  greedyPass(
    tasks,
    available,
    (pool, protocol, rev) => scoreRevertMatch(pool, protocol, rev, { strictUsd: false })
  );
  for (const { pool, protocol } of tasks) {
    if (pool.revert) continue;
    const usd = pool.positionUsd || 0;
    let bestIdx = -1;
    let bestDiff = Infinity;
    for (let i = 0; i < available.length; i++) {
      const rev = available[i];
      if (normalizeChain(rev.chain) !== normalizeChain(pool.chain)) continue;
      if (rev.pairKey !== poolPairKey(pool)) continue;
      if (!exchangeMatches(protocol, rev.exchange)) continue;
      const d = Math.abs((rev.pooledUsd || 0) - usd);
      if (d < bestDiff) {
        bestDiff = d;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestDiff <= Math.max(5, usd * 3 + 3)) {
      tryAssign(pool, available[bestIdx], bestDiff);
      available.splice(bestIdx, 1);
    }
  }
  for (const { pool } of tasks) {
    if (pool.revert) continue;
    let bestIdx = -1;
    let bestDiff = Infinity;
    const usd = pool.positionUsd || 0;
    for (let i = 0; i < available.length; i++) {
      const rev = available[i];
      if (!rev.jinaPlain) continue;
      if (rev.chain && normalizeChain(rev.chain) !== normalizeChain(pool.chain)) continue;
      const d = Math.abs((rev.pooledUsd || 0) - usd);
      if (d < bestDiff) {
        bestDiff = d;
        bestIdx = i;
      }
    }
    const tol = Math.max(12, usd * 0.06 + 8);
    if (bestIdx >= 0 && bestDiff <= tol) {
      tryAssign(pool, available[bestIdx], bestDiff);
      available.splice(bestIdx, 1);
    }
  }
  for (const { pool } of tasks) {
    if (pool.revert) continue;
    let bestIdx = -1;
    let bestDiff = Infinity;
    const usd = pool.positionUsd || 0;
    for (let i = 0; i < available.length; i++) {
      const rev = available[i];
      if (normalizeChain(rev.chain) !== normalizeChain(pool.chain)) continue;
      if (rev.pairKey !== poolPairKey(pool)) continue;
      const d = Math.abs((rev.pooledUsd || 0) - usd);
      if (d < bestDiff) {
        bestDiff = d;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestDiff <= Math.max(8, usd * 4 + 5)) {
      tryAssign(pool, available[bestIdx], bestDiff);
      available.splice(bestIdx, 1);
    }
  }
  portfolio._revertAvailable = available.length;
  return portfolio;
}

// js/portfolio-dedupe.js
function isSyntheticLiquidityRow(p, protocol) {
  if (!p) return true;
  const proto = String(protocol || "");
  if (proto.startsWith("DeBank \xB7") || proto === "DeBank") return true;
  const poolId = String(p.poolId || "");
  if (/coverage|residual|catch-up|unparsed|chain ·/i.test(poolId)) return true;
  const pair = String(p.pair || "").trim();
  if (/unparsed/i.test(pair)) return true;
  const ch = chainSlug(p.chain || "");
  if (p.kind === "Deposit" && pair && ch && pair.toLowerCase() === ch) return true;
  if (p.debankFill) return true;
  if (pair && (pair === protocol || pair.toLowerCase() === ch)) return true;
  return false;
}
function poolScore(p, g) {
  let s = 0;
  if (p.revert) s += 8;
  if (p.rangeMin != null && p.rangeMax != null) s += 4;
  if (p.onchain || p.onchainMetrics) s += 2;
  if (chainSlug(p.chain) !== "unknown") s += 3;
  if (p.fromRevert) s += 1;
  if (g?.chain && g.chain !== "unknown") s += 1;
  return s;
}
function liquiditySoftKey(protocol, p) {
  const pair = String(p.pair || poolPairKey(p) || "").trim().toLowerCase();
  if (pair && pair.includes("+")) {
    return `${protocol}|${chainSlug(p.chain)}|${pair}`;
  }
  const pid = String(p.poolId || pair || "").trim().toLowerCase();
  return `${protocol}|${chainSlug(p.chain)}|${pid}`;
}
function collapseNearDuplicateLiquidity(portfolio) {
  const winners = /* @__PURE__ */ new Map();
  for (const g of portfolio.protocolGroups || []) {
    for (const p of g.liquidity || []) {
      if (isSyntheticLiquidityRow(p, g.protocol)) continue;
      const pair = String(p.pair || poolPairKey(p) || "").trim().toLowerCase();
      if (!pair.includes("+")) continue;
      const usd = Math.round((p.positionUsd || 0) / 5) * 5;
      const sk = `${g.protocol}|${chainSlug(p.chain)}|${pair}|${usd}`;
      const prev = winners.get(sk);
      if (!prev || poolScore(p, g) > poolScore(prev.p, prev.g)) {
        winners.set(sk, { g, p });
      }
    }
  }
  if (!winners.size) return portfolio;
  for (const g of portfolio.protocolGroups || []) {
    g.liquidity = (g.liquidity || []).filter((p) => {
      if (isSyntheticLiquidityRow(p, g.protocol)) return false;
      const pair = String(p.pair || poolPairKey(p) || "").trim().toLowerCase();
      if (!pair.includes("+")) return true;
      const usd = Math.round((p.positionUsd || 0) / 5) * 5;
      const sk = `${g.protocol}|${chainSlug(p.chain)}|${pair}|${usd}`;
      const w = winners.get(sk);
      return w && w.p === p && w.g === g;
    });
  }
  return portfolio;
}
function lendingSoftKey(protocol, p) {
  const col = Math.round((p.collateralUsd || 0) * 100);
  const debt = Math.round((p.debtUsd || 0) * 100);
  return `${protocol}|${chainSlug(p.chain)}|${col}|${debt}`;
}
function dedupeLendingPositions(portfolio) {
  if (!portfolio?.protocolGroups) return portfolio;
  const winners = /* @__PURE__ */ new Map();
  for (const g of portfolio.protocolGroups) {
    for (const p of g.lending || []) {
      if (p.debankFill) continue;
      const sk = lendingSoftKey(g.protocol, p);
      const prev = winners.get(sk);
      if (!prev) {
        winners.set(sk, { g, p });
        continue;
      }
      const score = (x) => (x.p.healthFactor != null ? 2 : 0) + (chainSlug(x.p.chain) !== "unknown" ? 1 : 0);
      if (score({ g, p }) > score(prev)) winners.set(sk, { g, p });
    }
  }
  for (const g of portfolio.protocolGroups) {
    g.lending = (g.lending || []).filter((p) => {
      if (p.debankFill) return false;
      const sk = lendingSoftKey(g.protocol, p);
      const w = winners.get(sk);
      return w && w.p === p && w.g === g;
    });
  }
  return portfolio;
}
function stripSyntheticDebankFills(portfolio) {
  if (!portfolio?.protocolGroups) return portfolio;
  for (const g of portfolio.protocolGroups) {
    if (String(g.protocol || "").startsWith("DeBank \xB7")) {
      g.liquidity = [];
      g.lending = [];
      g.protocolUsd = 0;
      continue;
    }
    g.liquidity = (g.liquidity || []).filter((p) => !isSyntheticLiquidityRow(p, g.protocol));
    g.lending = (g.lending || []).filter((p) => !p.debankFill);
  }
  portfolio.protocolGroups = portfolio.protocolGroups.filter(
    (g) => g.protocol === "Wallet" || (g.liquidity || []).length || (g.lending || []).length || (g.walletTokens || []).length
  );
  return portfolio;
}
function dedupeLiquidityPositions(portfolio) {
  if (!portfolio?.protocolGroups) return portfolio;
  const winners = /* @__PURE__ */ new Map();
  for (const g of portfolio.protocolGroups) {
    for (const p of g.liquidity || []) {
      if (isSyntheticLiquidityRow(p, g.protocol)) continue;
      const sk = liquiditySoftKey(g.protocol, p);
      const prev = winners.get(sk);
      if (!prev) {
        winners.set(sk, { g, p });
        continue;
      }
      if (poolScore(p, g) > poolScore(prev.p, prev.g)) winners.set(sk, { g, p });
    }
  }
  for (const g of portfolio.protocolGroups) {
    const next = [];
    for (const p of g.liquidity || []) {
      if (isSyntheticLiquidityRow(p, g.protocol)) continue;
      const sk = liquiditySoftKey(g.protocol, p);
      const w = winners.get(sk);
      if (w && w.p === p && w.g === g) next.push(p);
    }
    g.liquidity = next;
  }
  const flat = [];
  for (const g of portfolio.protocolGroups) {
    for (const p of g.liquidity || []) {
      flat.push({ ...p, protocol: g.protocol });
    }
  }
  portfolio.liquidity = flat;
  return portfolio;
}
function fixProtocolGroupChains(portfolio) {
  if (!portfolio?.protocolGroups) return portfolio;
  for (const g of portfolio.protocolGroups) {
    if (g.protocol === "Wallet") continue;
    const chains = (g.liquidity || []).map((p) => chainSlug(p.chain)).filter((c) => c && c !== "unknown");
    if ((!g.chain || g.chain === "unknown") && chains.length) {
      const freq = /* @__PURE__ */ new Map();
      for (const c of chains) freq.set(c, (freq.get(c) || 0) + 1);
      g.chain = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
    for (const p of g.liquidity || []) {
      if (!p.chain || p.chain === "unknown") {
        if (g.chain && g.chain !== "unknown") p.chain = g.chain;
      }
    }
  }
  const merged = /* @__PURE__ */ new Map();
  const wallet = portfolio.protocolGroups.find((g) => g.protocol === "Wallet");
  for (const g of portfolio.protocolGroups) {
    if (g.protocol === "Wallet") continue;
    const ch = g.chain || "unknown";
    const k = `${g.protocol}\0${ch}`;
    if (!merged.has(k)) {
      merged.set(k, { ...g, kinds: [...g.kinds || []] });
      continue;
    }
    const t2 = merged.get(k);
    t2.liquidity.push(...g.liquidity || []);
    t2.lending.push(...g.lending || []);
    for (const kind of g.kinds || []) {
      if (!t2.kinds.includes(kind)) t2.kinds.push(kind);
    }
  }
  let groups = [...merged.values()];
  const byProtocol = /* @__PURE__ */ new Map();
  for (const g of groups) {
    if (g.protocol === "Wallet") continue;
    if (!byProtocol.has(g.protocol)) byProtocol.set(g.protocol, []);
    byProtocol.get(g.protocol).push(g);
  }
  const collapsed = [];
  for (const [protocol, list] of byProtocol) {
    if (list.length < 2) {
      collapsed.push(...list);
      continue;
    }
    const known = list.filter((g) => g.chain && g.chain !== "unknown");
    const unknown = list.filter((g) => !g.chain || g.chain === "unknown");
    if (known.length && unknown.length) {
      const target = known[0];
      for (const u of unknown) {
        target.liquidity.push(...u.liquidity || []);
        target.lending.push(...u.lending || []);
        for (const kind of u.kinds || []) {
          if (!target.kinds.includes(kind)) target.kinds.push(kind);
        }
      }
      const liqBy = /* @__PURE__ */ new Map();
      for (const p of target.liquidity || []) {
        const sk = liquiditySoftKey(target.protocol, p);
        const prev = liqBy.get(sk);
        if (!prev || poolScore(p, target) > poolScore(prev, target)) liqBy.set(sk, p);
      }
      target.liquidity = [...liqBy.values()];
      collapsed.push(target, ...known.slice(1));
    } else {
      collapsed.push(...list);
    }
  }
  groups = collapsed;
  if (wallet) groups.unshift(wallet);
  for (const g of groups) {
    g.id = `${g.protocol}|${g.chain || "all"}`;
  }
  portfolio.protocolGroups = groups;
  return portfolio;
}
function dedupeWalletTokens(portfolio) {
  const list = portfolio.walletTokens || [];
  if (!list.length) return portfolio;
  const byKey = /* @__PURE__ */ new Map();
  for (const t2 of list) {
    const ch = chainSlug(t2.chain || "unknown");
    t2.chain = ch;
    const k = `${ch}:${String(t2.symbol || "").toUpperCase()}`;
    const prev = byKey.get(k);
    if (!prev || (t2.usd || 0) > (prev.usd || 0)) byKey.set(k, { ...t2 });
  }
  portfolio.walletTokens = [...byKey.values()].sort((a, b) => (b.usd || 0) - (a.usd || 0));
  const walletByChain = {};
  for (const t2 of portfolio.walletTokens) {
    const c = t2.chain || "unknown";
    if (!walletByChain[c]) walletByChain[c] = [];
    walletByChain[c].push(t2);
  }
  portfolio.walletByChain = walletByChain;
  const wg = portfolio.protocolGroups?.find((g) => g.protocol === "Wallet");
  if (wg) wg.walletTokens = portfolio.walletTokens;
  return portfolio;
}
function dedupePortfolioPositions(portfolio) {
  if (!portfolio) return portfolio;
  stripSyntheticDebankFills(portfolio);
  dedupeLiquidityPositions(portfolio);
  dedupeLendingPositions(portfolio);
  collapseNearDuplicateLiquidity(portfolio);
  fixProtocolGroupChains(portfolio);
  dedupeLiquidityPositions(portfolio);
  dedupeLendingPositions(portfolio);
  collapseNearDuplicateLiquidity(portfolio);
  dedupeWalletTokens(portfolio);
  return portfolio;
}

// js/revert-portfolio-merge.js
var SUM_TOLERANCE = 0.12;
function revertExchangeToProtocol(exchange) {
  const ex = String(exchange || "").toLowerCase();
  if (ex.includes("uniswapv4")) return "Uniswap V4";
  if (ex.includes("uniswap")) return "Uniswap V3";
  if (ex.includes("aerodrome")) return "Aerodrome V3";
  if (ex.includes("pancake")) return "PancakeSwap V3";
  return null;
}
function isRevertDexDebankProtocol(protocol) {
  const p = String(protocol || "").toLowerCase();
  if (p.includes("uniswap v3")) return "Uniswap V3";
  if (p.includes("uniswap v4")) return "Uniswap V4";
  if (p.includes("aerodrome")) return "Aerodrome V3";
  if (p.includes("pancake")) return "PancakeSwap V3";
  return null;
}
function isUsefulRevertPosition(rev) {
  if (!rev || !revertExchangeToProtocol(rev.exchange)) return false;
  if ((rev.pooledUsd || 0) < 0.02) return false;
  const pair = String(rev.pair || "");
  if (!/^[\w.+-]+\/[\w.+-]+$/i.test(pair.replace(/\s/g, ""))) return false;
  return true;
}
function revertPositionToPool(rev, protocol) {
  const fixed = finalizeRevertPosition(rev);
  return {
    protocol,
    chain: normalizeChain(fixed.chain),
    poolId: fixed.positionId || fixed.poolAddress || formatPairDisplay(fixed.pair),
    pair: formatPairDisplay(fixed.pair),
    inPool: [],
    positionUsd: fixed.pooledUsd || 0,
    claimable: [],
    claimableUsd: fixed.uncollectedUsd || 0,
    netUsd: fixed.pooledUsd || 0,
    fromRevert: true,
    revert: fixed
  };
}
function sumDebankDexUsd(portfolio) {
  let sum = 0;
  const seen = /* @__PURE__ */ new Set();
  for (const g of portfolio.protocolGroups || []) {
    const canon = isRevertDexDebankProtocol(g.protocol);
    if (!canon) continue;
    for (const p of g.liquidity || []) {
      const key = `${canon}|${normalizeChain(p.chain)}|${poolPairKey(p)}|${p.poolId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sum += p.positionUsd || 0;
    }
  }
  return sum;
}
function collectDebankDexPools(portfolio) {
  const pools = [];
  const seen = /* @__PURE__ */ new Set();
  for (const g of portfolio.protocolGroups || []) {
    const canon = isRevertDexDebankProtocol(g.protocol);
    if (!canon) continue;
    for (const p of g.liquidity || []) {
      const key = `${canon}|${normalizeChain(p.chain)}|${poolPairKey(p)}|${p.poolId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pools.push({
        pool: p,
        protocol: canon,
        chain: normalizeChain(p.chain),
        pairKey: poolPairKey(p)
      });
    }
  }
  return pools;
}
function filterRevertPositions(positions) {
  return (positions || []).filter(isUsefulRevertPosition).map((rev) => ({
    rev,
    protocol: revertExchangeToProtocol(rev.exchange),
    chain: normalizeChain(rev.chain),
    pairKey: rev.pairKey || normPair(rev.pair)
  }));
}
function sumUsd(items, getUsd) {
  return items.reduce((s, it) => s + (getUsd(it) || 0), 0);
}
function sumsClose(a, b, tol = SUM_TOLERANCE) {
  const mx = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / mx <= tol;
}
function debankSpotHints(debankItems) {
  const hints = {};
  for (const { pool, chain, pairKey } of debankItems) {
    const spot = spotFromInPool(pool.inPool, pool.positionUsd, pairKey);
    if (spot) hints[`${chain}|${pairKey}`] = spot;
  }
  return hints;
}
function applyMarketHints(revertItems, debankItems = []) {
  const spotHints = debankSpotHints(debankItems);
  const pass1 = buildMarketHints(revertItems.map((x) => x.rev));
  function spotForItem(rev, hints) {
    const nums = rev.rangeNums || [];
    if (isCoarseMicroRange(nums) && hints.btcUsd) return hints.btcUsd;
    return spotHints[`${rev.chain}|${rev.pairKey}`] ?? hints.btcUsd;
  }
  revertItems.forEach((it) => {
    it.rev = finalizeRevertPosition(it.rev, { ...pass1, spotUsd: spotForItem(it.rev, pass1) });
  });
  const pass2 = buildMarketHints(revertItems.map((x) => x.rev));
  revertItems.forEach((it) => {
    it.rev = finalizeRevertPosition(it.rev, {
      ...pass1,
      ...pass2,
      spotUsd: spotForItem(it.rev, { ...pass1, ...pass2 })
    });
  });
}
function stripAllDebankDex(portfolio) {
  for (const g of portfolio.protocolGroups || []) {
    if (isRevertDexDebankProtocol(g.protocol)) g.liquidity = [];
  }
  portfolio.liquidity = (portfolio.liquidity || []).filter(
    (p) => !isRevertDexDebankProtocol(p.protocol)
  );
}
function revertKeysSet(revertItems) {
  const s = /* @__PURE__ */ new Set();
  for (const { protocol, chain, pairKey } of revertItems) {
    s.add(`${protocol}|${chain}|${pairKey}`);
  }
  return s;
}
function stripDebankOverlappingRevert(portfolio, revertItems) {
  const keys = revertKeysSet(revertItems);
  for (const g of portfolio.protocolGroups || []) {
    const canon = isRevertDexDebankProtocol(g.protocol);
    if (!canon) continue;
    g.liquidity = (g.liquidity || []).filter((p) => {
      const pk = poolPairKey(p);
      const ch = normalizeChain(p.chain);
      return !keys.has(`${canon}|${ch}|${pk}`);
    });
  }
  portfolio.liquidity = (portfolio.liquidity || []).filter((p) => {
    const canon = isRevertDexDebankProtocol(p.protocol);
    if (!canon) return true;
    return !keys.has(`${canon}|${normalizeChain(p.chain)}|${poolPairKey(p)}`);
  });
}
function injectAllRevertPools(portfolio, revertItems) {
  for (const { rev, protocol } of revertItems) {
    const pool = revertPositionToPool(rev, protocol);
    const g = findOrCreateGroup(portfolio, protocol, pool.chain);
    const dup = (g.liquidity || []).some(
      (p) => p.revert?.positionId === rev.positionId || p.fromRevert && p.poolId === pool.poolId && p.pair === pool.pair
    );
    if (!dup) g.liquidity.push(pool);
  }
}
function findOrCreateGroup(portfolio, protocol, chain) {
  let g = (portfolio.protocolGroups || []).find(
    (x) => x.protocol === protocol && normalizeChain(x.chain) === chain
  );
  if (!g) {
    g = {
      protocol,
      chain,
      protocolUsd: 0,
      kinds: ["Liquidity Pool"],
      lending: [],
      liquidity: [],
      walletTokens: [],
      id: `${protocol}|${chain}`
    };
    portfolio.protocolGroups.push(g);
  }
  return g;
}
function liquidityRowKey(protocol, p) {
  const pid = String(p.poolId || p.pair || poolPairKey(p) || "").trim().toLowerCase();
  return `${protocol}|${normalizeChain(p.chain)}|${pid}`;
}
function recalcLiquidityTotals(portfolio) {
  let liqUsd = 0;
  const flat = [];
  const seen = /* @__PURE__ */ new Set();
  for (const g of portfolio.protocolGroups || []) {
    let liqPart = 0;
    for (const p of g.liquidity || []) {
      if (isSyntheticLiquidityRow(p, g.protocol)) continue;
      const k = liquidityRowKey(g.protocol, p);
      if (seen.has(k)) continue;
      seen.add(k);
      const usd = p.positionUsd || 0;
      liqPart += usd;
      liqUsd += usd;
      flat.push({ ...p, protocol: g.protocol });
    }
    let lendPart = (g.lending || []).reduce((s, x) => s + (x.netUsd || 0), 0);
    if ((g.lending || []).length && lendPart < 0.01) {
      lendPart = (g.lending || []).reduce((s, x) => s + Math.max(x.collateralUsd || 0, 0), 0);
    }
    const wallPart = (g.walletTokens || []).reduce((s, x) => s + (x.usd || 0), 0);
    let protoUsd = Math.round((liqPart + lendPart + wallPart) * 100) / 100;
    if (((g.liquidity || []).length || (g.lending || []).length) && protoUsd < 0.01) {
      const liqAll = (g.liquidity || []).reduce((s, p) => s + (p.positionUsd || 0), 0);
      const lendAll = (g.lending || []).reduce(
        (s, x) => s + Math.max(x.netUsd || 0, x.collateralUsd || 0, 0),
        0
      );
      protoUsd = Math.round(Math.max(liqAll + lendAll, 0.01) * 100) / 100;
    }
    g.protocolUsd = protoUsd;
  }
  portfolio.liquidity = flat;
  portfolio.liqUsd = Math.round(liqUsd * 100) / 100;
}
function revertRangeUsable(rev, pairKey) {
  if (!rev) return false;
  return isDisplayRangeUsable(rev.rangeMin, rev.rangeMax, rev.rangeCurrent, pairKey || rev.pairKey);
}
function applyRevertEnrichmentToPool(p) {
  const r = p.revert;
  if (!r) return false;
  const fixed = finalizeRevertPosition(r);
  p.revert = fixed;
  p.revertEnriched = true;
  const pk = poolPairKey(p);
  if (revertRangeUsable(fixed, pk)) {
    p.rangeMin = fixed.rangeMin;
    p.rangeMax = fixed.rangeMax;
    p.rangeCurrent = fixed.rangeCurrent;
    p.feeTier = fixed.feeTier || p.feeTier;
  }
  if (p.apyRecent == null && p.apyAnnualized == null && fixed.displayApy != null) {
    p.apyRecent = fixed.displayApy;
    p.apyAnnualized = fixed.displayApy;
  }
  if ((p.claimableUsd ?? 0) < 1e-3 && (fixed.uncollectedUsd ?? 0) > 0) {
    p.claimableUsd = fixed.uncollectedUsd;
  }
  return true;
}
function mergeRevertApyOnly(portfolio, revertPositions) {
  if (!portfolio) return portfolio;
  const revertItems = filterRevertPositions(revertPositions);
  if (!revertItems.length) {
    portfolio._revertMerge = {
      mode: "onchain+revert-apy",
      sumMatched: false,
      revertDexCount: 0,
      revertPoolsOnSite: 0,
      revertPositionsLoaded: 0,
      revertMatched: 0
    };
    return portfolio;
  }
  applyMarketHints(revertItems, collectDebankDexPools(portfolio));
  attachRevertToPortfolio(
    portfolio,
    revertItems.map((x) => x.rev)
  );
  let matched = 0;
  for (const g of portfolio.protocolGroups || []) {
    for (const p of g.liquidity || []) {
      if (applyRevertEnrichmentToPool(p)) matched += 1;
    }
  }
  const usedIds = /* @__PURE__ */ new Set();
  for (const g of portfolio.protocolGroups || []) {
    for (const p of g.liquidity || []) {
      const id = p.revert?.positionId || p.poolId;
      if (id) usedIds.add(String(id).toLowerCase());
    }
  }
  const unmatched = revertItems.filter(({ rev, pairKey, chain }) => {
    const id = rev.positionId || rev.poolAddress;
    if (id && usedIds.has(String(id).toLowerCase())) return false;
    const usd = rev.pooledUsd || 0;
    for (const g of portfolio.protocolGroups || []) {
      for (const p of g.liquidity || []) {
        if (p.debankFill) continue;
        if (poolPairKey(p) !== pairKey) continue;
        const pu = p.positionUsd || 0;
        if (Math.abs(pu - usd) < Math.max(2.5, usd * 0.12)) return false;
        if (normalizeChain(p.chain) === "unknown" && normalizeChain(chain) !== "unknown" && Math.abs(pu - usd) < 8) {
          return false;
        }
      }
    }
    return true;
  });
  if (unmatched.length) injectAllRevertPools(portfolio, unmatched);
  recalcLiquidityTotals(portfolio);
  const revertPoolsOnSite = (portfolio.protocolGroups || []).reduce(
    (n, g) => n + (g.liquidity || []).filter((p) => p.revert || p.fromRevert).length,
    0
  );
  portfolio._revertMerge = {
    mode: "onchain+revert-apy",
    sumMatched: matched > 0,
    revertDexCount: revertItems.length,
    revertPoolsOnSite,
    revertPositionsLoaded: revertItems.length,
    revertMatched: matched
  };
  return portfolio;
}
function mergeRevertLiquidity(portfolio, revertPositions) {
  if (!portfolio) return portfolio;
  if (portfolio.onchain || portfolio.hybrid || portfolio.source === "onchain" || portfolio.source === "hybrid") {
    return mergeRevertApyOnly(portfolio, revertPositions);
  }
  const debankItems = collectDebankDexPools(portfolio);
  let revertItems = filterRevertPositions(revertPositions);
  applyMarketHints(revertItems, debankItems);
  const debankDexUsd = sumDebankDexUsd(portfolio);
  const revertDexUsd = sumUsd(revertItems, (x) => x.rev.pooledUsd);
  const sumMatched = debankDexUsd > 0 && revertDexUsd > 0 && sumsClose(debankDexUsd, revertDexUsd);
  const pairOnRevert = new Set(revertItems.map((x) => x.pairKey));
  const debankOnlyPools = debankItems.filter((x) => !pairOnRevert.has(x.pairKey));
  stripDebankOverlappingRevert(portfolio, revertItems);
  if (sumMatched) {
    stripAllDebankDex(portfolio);
  }
  injectAllRevertPools(portfolio, revertItems);
  for (const { pool, protocol } of debankOnlyPools) {
    const g = findOrCreateGroup(portfolio, protocol, normalizeChain(pool.chain));
    const dup = (g.liquidity || []).some(
      (p) => !p.fromRevert && p.poolId === pool.poolId && p.pair === pool.pair
    );
    if (!dup) {
      g.liquidity.push({
        ...pool,
        protocol,
        fromRevert: false,
        revert: null
      });
    }
  }
  recalcLiquidityTotals(portfolio);
  const revertPoolsOnSite = (portfolio.protocolGroups || []).reduce(
    (n, g) => n + (g.liquidity || []).filter((p) => p.fromRevert).length,
    0
  );
  portfolio._revertMerge = {
    mode: sumMatched ? "sum-platforms" : "revert-all",
    sumMatched,
    debankDexUsd,
    revertDexUsd,
    debankDexCount: debankItems.length,
    revertDexCount: revertItems.length,
    revertPoolsOnSite,
    revertPositionsLoaded: revertItems.length
  };
  return portfolio;
}

// js/portfolio-sanity.js
function saneUsd(n, cap = 5e6) {
  const v = Number(n) || 0;
  if (!Number.isFinite(v) || v < 0) return false;
  return v <= cap;
}
function saneLendingPosition(p, debankTotalUsd = 0) {
  if (!p) return false;
  const cap = Math.max(5e4, (debankTotalUsd || 0) * 5, 5e6);
  const c = p.collateralUsd || 0;
  const d = p.debtUsd || 0;
  const n = Math.abs(p.netUsd || 0);
  return saneUsd(c, cap) && saneUsd(d, cap) && saneUsd(n, cap);
}

// js/portfolio-debank-fill.js
function roundUsd(n) {
  return Math.round((n || 0) * 100) / 100;
}
function findGroup(portfolio, protocol, chain) {
  const ch = chainSlug(chain || "unknown");
  return (portfolio.protocolGroups || []).find(
    (g) => g.protocol === protocol && chainSlug(g.chain || "unknown") === ch
  );
}
function ensureGroup(portfolio, protocol, chain) {
  let g = findGroup(portfolio, protocol, chain);
  if (g) return g;
  if (!portfolio.protocolGroups) portfolio.protocolGroups = [];
  g = {
    protocol,
    chain: chainSlug(chain || "unknown"),
    protocolUsd: 0,
    liquidity: [],
    lending: [],
    walletTokens: [],
    kinds: []
  };
  g.id = `${g.protocol}|${g.chain}`;
  portfolio.protocolGroups.push(g);
  return g;
}
function sumProtocolUsd(portfolio, protocol) {
  let s = 0;
  for (const g of portfolio.protocolGroups || []) {
    if (g.protocol !== protocol) continue;
    for (const p of g.liquidity || []) s += p.positionUsd || 0;
    for (const p of g.lending || []) {
      s += Math.max(p.netUsd || 0, p.collateralUsd || 0, 0);
    }
  }
  return s;
}
function inferChainForProtocol(portfolio, protocol) {
  const tabs = portfolio.protocolTabs || [];
  const chains = portfolio.chains || [];
  const byProto = (portfolio.protocolGroups || []).filter(
    (g) => g.protocol === protocol && g.chain && g.chain !== "unknown"
  );
  if (byProto.length) return byProto[0].chain;
  if (chains.length) return chains[0].slug;
  return "unknown";
}
function fillCoverageFromProtocolTabs(portfolio) {
  if (!portfolio?.protocolTabs?.length) return portfolio;
  const debank = portfolio.debankTotalUsd ?? portfolio.totalUsd ?? 0;
  let computed = portfolio.computedTotalUsd ?? (portfolio.walletUsd || 0) + (portfolio.liqUsd || 0) + (portfolio.lendUsd || 0);
  if (debank < 50) return portfolio;
  for (const tab of portfolio.protocolTabs) {
    const protocol = tab.protocol;
    const tabUsd = tab.usd || 0;
    if (tabUsd < 2) continue;
    const haveUsd = sumProtocolUsd(portfolio, protocol);
    const need = tabUsd - haveUsd;
    if (need < 2) continue;
    if (haveUsd >= tabUsd * 0.88) continue;
    const chain = inferChainForProtocol(portfolio, protocol);
    const g = ensureGroup(portfolio, protocol, chain);
    const headroom = Math.max(0, debank - computed);
    const fillUsd = roundUsd(Math.min(need, headroom));
    if (fillUsd < 1) continue;
    g.liquidity.push({
      protocol,
      chain: g.chain,
      poolId: `${protocol} \xB7 DeBank`,
      pair: protocol,
      kind: "Deposit",
      positionUsd: fillUsd,
      debankFill: true,
      debankSectionUsd: tabUsd,
      netUsd: fillUsd,
      inPool: []
    });
    if (!g.kinds) g.kinds = [];
    if (!g.kinds.includes("Deposit")) g.kinds.push("Deposit");
    computed += fillUsd;
  }
  return portfolio;
}
function fillCoverageFromChainGaps(portfolio) {
  const debank = portfolio.debankTotalUsd ?? portfolio.totalUsd ?? 0;
  let computed = portfolio.computedTotalUsd ?? (portfolio.walletUsd || 0) + (portfolio.liqUsd || 0) + (portfolio.lendUsd || 0);
  if (debank < 100 || computed >= debank * 0.93) return portfolio;
  const parseChains = (portfolio.chains || []).filter(
    (c) => c.pct != null && c.name && c.name !== String(c.slug || "").toUpperCase()
  );
  for (const c of parseChains) {
    const slug = chainSlug(c.slug);
    const target = c.usd || 0;
    if (target < 10) continue;
    let have = 0;
    for (const t2 of portfolio.walletTokens || []) {
      if (chainSlug(t2.chain) === slug) have += t2.usd || 0;
    }
    for (const g2 of portfolio.protocolGroups || []) {
      if (chainSlug(g2.chain) !== slug) continue;
      have += g2.protocolUsd || 0;
    }
    const need = roundUsd(target - have);
    if (need < 5) continue;
    const g = ensureGroup(portfolio, `DeBank \xB7 ${c.name || slug}`, slug);
    g.liquidity.push({
      protocol: g.protocol,
      chain: slug,
      poolId: `${c.name || slug} \xB7 chain`,
      pair: c.name || slug,
      kind: "Deposit",
      positionUsd: need,
      debankFill: true,
      debankChainUsd: target,
      netUsd: need,
      inPool: []
    });
    if (!g.kinds.includes("Deposit")) g.kinds.push("Deposit");
    computed += need;
  }
  return portfolio;
}
function countRealLiquidityUsd(portfolio) {
  let n = 0;
  let usd = 0;
  for (const g of portfolio.protocolGroups || []) {
    for (const p of g.liquidity || []) {
      if (p.debankFill) continue;
      if (String(p.poolId || "").match(/#/)) n += 1;
      usd += p.positionUsd || 0;
    }
  }
  return { n, usd };
}
function fillCoverageResidual(portfolio) {
  const debank = portfolio.debankTotalUsd ?? portfolio.totalUsd ?? 0;
  let computed = portfolio.computedTotalUsd ?? (portfolio.walletUsd || 0) + (portfolio.liqUsd || 0) + (portfolio.lendUsd || 0);
  const hasResidual = (portfolio.protocolGroups || []).some(
    (g2) => (g2.liquidity || []).some((p) => String(p.poolId || "").includes("residual"))
  );
  if (hasResidual) return portfolio;
  const real = countRealLiquidityUsd(portfolio);
  if (real.n >= 1 && real.usd >= debank * 0.35) return portfolio;
  if (debank < 80) return portfolio;
  let gap = debank - computed;
  if (gap <= 0 || gap < debank * 0.02) return portfolio;
  if (gap > debank * 0.55) {
    const headroom = roundUsd(gap * 0.4);
    if (headroom >= 5) {
      const g2 = ensureGroup(portfolio, "DeBank", "all");
      g2.liquidity.push({
        protocol: "DeBank",
        chain: "unknown",
        poolId: "Coverage \xB7 large gap",
        pair: "Unparsed (Jina)",
        kind: "Deposit",
        positionUsd: headroom,
        debankFill: true,
        netUsd: headroom,
        inPool: []
      });
      if (!g2.kinds.includes("Deposit")) g2.kinds.push("Deposit");
    }
    computed = (portfolio.walletUsd || 0) + (portfolio.liqUsd || 0) + (portfolio.lendUsd || 0);
    gap = debank - computed;
    if (gap <= 0 || gap < debank * 0.03) return portfolio;
  }
  const g = ensureGroup(portfolio, "DeBank", "all");
  g.liquidity.push({
    protocol: "DeBank",
    chain: "unknown",
    poolId: "Coverage \xB7 residual",
    pair: "Unparsed positions",
    kind: "Deposit",
    positionUsd: roundUsd(gap),
    debankFill: true,
    debankSectionUsd: debank,
    netUsd: roundUsd(gap),
    inPool: []
  });
  if (!g.kinds.includes("Deposit")) g.kinds.push("Deposit");
  return portfolio;
}
function fillCoverageCatchUp(portfolio) {
  const debank = portfolio.debankTotalUsd ?? portfolio.totalUsd ?? 0;
  let computed = portfolio.computedTotalUsd ?? (portfolio.walletUsd || 0) + (portfolio.liqUsd || 0) + (portfolio.lendUsd || 0);
  const gap = debank - computed;
  if (debank < 80 || gap < debank * 0.02) return portfolio;
  const g = ensureGroup(portfolio, "DeBank", "all");
  const exists = (g.liquidity || []).some((p) => String(p.poolId || "").includes("catch-up"));
  if (exists) return portfolio;
  g.liquidity.push({
    protocol: "DeBank",
    chain: "unknown",
    poolId: "Coverage \xB7 catch-up",
    pair: "Unparsed (DeBank)",
    kind: "Deposit",
    positionUsd: roundUsd(gap),
    debankFill: true,
    netUsd: roundUsd(gap),
    inPool: []
  });
  if (!g.kinds.includes("Deposit")) g.kinds.push("Deposit");
  return portfolio;
}

// js/lending-metrics.js
function parseAmount(amount) {
  const n = parseFloat(String(amount || "0").replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function primaryCollateralMarketPrice(supplied) {
  const rows = (supplied || []).map((x) => ({
    usd: Number(x.usd || 0),
    amt: parseAmount(x.amount)
  })).filter((x) => x.usd > 0 && x.amt > 0).sort((a, b) => b.usd - a.usd);
  if (!rows.length) return 0;
  return rows[0].usd / rows[0].amt;
}
function liquidationPriceFromHealth(pos) {
  const hf = Number(pos?.healthFactor);
  if (!hf || hf <= 0 || hf > 10) return 0;
  const market = Number(pos?.marketPrice) > 0 ? Number(pos.marketPrice) : primaryCollateralMarketPrice(pos?.supplied);
  if (!market || market <= 0) return 0;
  return market / hf;
}
function applyLendingMetrics(pos) {
  if (!pos) return pos;
  const marketPrice = primaryCollateralMarketPrice(pos.supplied);
  const liquidationPrice = liquidationPriceFromHealth({
    ...pos,
    marketPrice: marketPrice || pos.marketPrice
  });
  return {
    ...pos,
    marketPrice: marketPrice || pos.marketPrice || 0,
    liquidationPrice: liquidationPrice || 0
  };
}

// js/portfolio-normalize.js
var PORTFOLIO_SCHEMA = 12;
function inferChainFromProtocolName(protocol) {
  const p = String(protocol || "").toLowerCase();
  if (p.includes("aerodrome")) return "base";
  if (p.includes("velodrome")) return "op";
  if (p.includes("gmx")) return "arb";
  if (p.includes("hyperliquid")) return "hyperliquid";
  if (p.includes("fluid") || p.includes("aave") || p.includes("compound")) return "eth";
  return null;
}
function assignUnknownLiquidityChains(portfolio) {
  if (!portfolio?.protocolGroups?.length) return portfolio;
  const chains = (portfolio.chains || []).filter((c) => c.slug && c.slug !== "unknown");
  if (!chains.length) return portfolio;
  const tabsByProto = /* @__PURE__ */ new Map();
  for (const tab of portfolio.protocolTabs || []) {
    if (!tab.protocol || tab.protocol === "Wallet") continue;
    if (!tabsByProto.has(tab.protocol)) tabsByProto.set(tab.protocol, []);
    tabsByProto.get(tab.protocol).push(tab);
  }
  for (const g of portfolio.protocolGroups) {
    if (g.protocol === "Wallet" || g.protocol === "DeBank") continue;
    const unknownPools = (g.liquidity || []).filter(
      (p) => !isSyntheticLiquidityRow(p, g.protocol) && (!p.chain || p.chain === "unknown")
    );
    if (!unknownPools.length) continue;
    const protoTabs = (tabsByProto.get(g.protocol) || []).slice().sort((a, b) => (b.usd || 0) - (a.usd || 0));
    const sortedPools = unknownPools.slice().sort((a, b) => (b.positionUsd || 0) - (a.positionUsd || 0));
    if (protoTabs.length >= 1 && sortedPools.length >= 1) {
      const usedTabs = /* @__PURE__ */ new Set();
      const usedChains = /* @__PURE__ */ new Set();
      for (const pool of sortedPools) {
        let bestTab = null;
        let bestTabDist = Infinity;
        for (const tab of protoTabs) {
          if (usedTabs.has(tab)) continue;
          const d = Math.abs((tab.usd || 0) - (pool.positionUsd || 0));
          if (d < bestTabDist) {
            bestTabDist = d;
            bestTab = tab;
          }
        }
        if (bestTab) usedTabs.add(bestTab);
        const targetUsd = bestTab?.usd ?? pool.positionUsd ?? 0;
        let best = null;
        let bestDist = Infinity;
        for (const c of chains) {
          if (usedChains.has(c.slug) && sortedPools.length > 1) continue;
          const d = Math.abs((c.usd || 0) - targetUsd);
          if (d < bestDist) {
            bestDist = d;
            best = c.slug;
          }
        }
        if (!best) best = inferChainFromProtocolName(g.protocol) || chains[0]?.slug;
        pool.chain = best;
        usedChains.add(best);
      }
    }
    for (const p of g.lending || []) {
      if (p.chain && p.chain !== "unknown") continue;
      const hint = inferChainFromProtocolName(g.protocol);
      if (hint) {
        p.chain = hint;
        if (!g.chain || g.chain === "unknown") g.chain = hint;
      } else if (chains.length === 1) {
        p.chain = chains[0].slug;
        g.chain = chains[0].slug;
      }
    }
  }
  return portfolio;
}
function splitLiquidityGroupsByChain(portfolio) {
  if (!portfolio?.protocolGroups?.length) return portfolio;
  const out = [];
  for (const g of portfolio.protocolGroups) {
    if (g.protocol === "Wallet") {
      out.push(g);
      continue;
    }
    const liq = (g.liquidity || []).filter((p) => !isSyntheticLiquidityRow(p, g.protocol));
    const lend = g.lending || [];
    if (!liq.length) {
      out.push(g);
      continue;
    }
    const byChain = /* @__PURE__ */ new Map();
    for (const p of liq) {
      const ch = normChain(p.chain || g.chain);
      p.chain = ch;
      if (!byChain.has(ch)) byChain.set(ch, []);
      byChain.get(ch).push(p);
    }
    if (byChain.size <= 1) {
      const ch = [...byChain.keys()][0] || normChain(g.chain);
      g.chain = ch;
      g.liquidity = liq;
      out.push(g);
      continue;
    }
    for (const [ch, rows] of byChain) {
      const lendHere = lend.filter((p) => normChain(p.chain || g.chain) === ch);
      out.push({
        ...g,
        chain: ch,
        liquidity: rows,
        lending: lendHere,
        walletTokens: [],
        id: `${g.protocol}|${ch}`
      });
    }
  }
  portfolio.protocolGroups = out.filter(
    (g) => g.protocol === "Wallet" || (g.liquidity || []).length || (g.lending || []).length || (g.walletTokens || []).length
  );
  return portfolio;
}
function purgeSyntheticFills(portfolio) {
  for (const g of portfolio.protocolGroups || []) {
    g.liquidity = (g.liquidity || []).filter((p) => !isSyntheticLiquidityRow(p, g.protocol));
    g.lending = (g.lending || []).filter((p) => !p.debankFill);
  }
  portfolio.protocolGroups = (portfolio.protocolGroups || []).filter(
    (g) => g.protocol === "Wallet" || (g.liquidity || []).length || (g.lending || []).length || (g.walletTokens || []).length
  );
}
function normChain(c) {
  return chainSlug(c || "unknown");
}
function roundUsd2(n) {
  return Math.round((n || 0) * 100) / 100;
}
function normalizeLendingMetrics(portfolio) {
  for (const g of portfolio?.protocolGroups || []) {
    g.lending = (g.lending || []).map((p) => applyLendingMetrics(p));
  }
  if (portfolio?.lending?.length) {
    portfolio.lending = portfolio.lending.map((p) => applyLendingMetrics(p));
  }
}
function syncDisplayTotals(portfolio) {
  if (!portfolio) return portfolio;
  dedupePortfolioPositions(portfolio);
  normalizeLendingMetrics(portfolio);
  recalcLiquidityTotals(portfolio);
  const chainSum = (portfolio.chains || []).reduce((s, c) => s + (c.usd || 0), 0);
  const parseChains = (portfolio.chains || []).some(
    (c) => c.pct != null && c.name && c.name !== String(c.slug || "").toUpperCase()
  );
  if (parseChains && chainSum > 20 && (portfolio.debankTotalUsd || 0) > chainSum * 1.5) {
    portfolio.debankTotalUsd = roundUsd2(chainSum);
  }
  const walletUsd = (portfolio.walletTokens || []).reduce((s, t2) => s + (t2.usd || 0), 0);
  const nonWalletGroups = (portfolio.protocolGroups || []).filter((g) => g.protocol !== "Wallet");
  const debankEarly = portfolio.debankTotalUsd ?? portfolio.totalUsd ?? 0;
  let walletFinal = walletUsd;
  const wg = (portfolio.protocolGroups || []).find((g) => g.protocol === "Wallet");
  if (nonWalletGroups.length === 0 && debankEarly > 80 && walletUsd > debankEarly * 1.15) {
    walletFinal = 0;
    portfolio.walletTokens = [];
    if (wg) {
      wg.walletTokens = [];
      wg.protocolUsd = 0;
    }
  }
  let lendUsd = 0;
  const seenLend = /* @__PURE__ */ new Set();
  for (const g of portfolio.protocolGroups || []) {
    for (const x of g.lending || []) {
      if (!saneLendingPosition(x, portfolio.debankTotalUsd ?? portfolio.totalUsd)) continue;
      const k = `${g.protocol}|${x.chain}|${x.collateralUsd}|${x.debtUsd}`;
      if (seenLend.has(k)) continue;
      seenLend.add(k);
      lendUsd += x.netUsd || 0;
    }
  }
  let liqUsd = portfolio.liqUsd ?? 0;
  let computed = roundUsd2(walletFinal + liqUsd + lendUsd);
  const debankTotal = portfolio.debankTotalUsd ?? portfolio.hybridMeta?.debankTotalUsd ?? portfolio.totalUsd ?? computed;
  let debank = roundUsd2(debankTotal);
  let lendFinal = lendUsd;
  if (debank > 0 && computed > debank * 1.1) {
    dedupePortfolioPositions(portfolio);
    recalcLiquidityTotals(portfolio);
    walletFinal = (portfolio.walletTokens || []).reduce((s, t2) => s + (t2.usd || 0), 0);
    lendFinal = 0;
    const seenL2 = /* @__PURE__ */ new Set();
    for (const g of portfolio.protocolGroups || []) {
      for (const x of g.lending || []) {
        if (!saneLendingPosition(x, debank)) continue;
        const k = `${g.protocol}|${x.chain}|${x.collateralUsd}|${x.debtUsd}`;
        if (seenL2.has(k)) continue;
        seenL2.add(k);
        lendFinal += x.netUsd || 0;
      }
    }
    liqUsd = portfolio.liqUsd ?? 0;
    computed = roundUsd2(walletFinal + liqUsd + lendFinal);
  }
  portfolio.debankTotalUsd = debank;
  portfolio.computedTotalUsd = computed;
  const gap = roundUsd2(debank - computed);
  portfolio.coverageGapUsd = Math.max(0, gap);
  portfolio.overCountUsd = gap < 0 ? roundUsd2(-gap) : 0;
  portfolio.walletUsd = roundUsd2(walletFinal);
  portfolio.lendUsd = roundUsd2(lendFinal);
  portfolio.liqUsd = roundUsd2(liqUsd);
  if (debank > 0 && computed > debank && computed <= debank * 1.15) {
    debank = roundUsd2(computed);
    portfolio.debankTotalUsd = debank;
    portfolio.coverageGapUsd = 0;
    portfolio.overCountUsd = 0;
  }
  if (debank > 0 && computed > debank * 1.12) {
    for (const g of portfolio.protocolGroups || []) {
      g.liquidity = (g.liquidity || []).filter((p) => !p.debankFill);
      g.lending = (g.lending || []).filter((p) => !p.debankFill);
    }
    dedupePortfolioPositions(portfolio);
    recalcLiquidityTotals(portfolio);
    walletFinal = (portfolio.walletTokens || []).reduce((s, t2) => s + (t2.usd || 0), 0);
    lendFinal = 0;
    const seenOx = /* @__PURE__ */ new Set();
    for (const g of portfolio.protocolGroups || []) {
      for (const x of g.lending || []) {
        if (!saneLendingPosition(x, debank)) continue;
        const k = `${g.protocol}|${x.chain}|${x.collateralUsd}|${x.debtUsd}`;
        if (seenOx.has(k)) continue;
        seenOx.add(k);
        lendFinal += x.netUsd || 0;
      }
    }
    liqUsd = portfolio.liqUsd ?? 0;
    computed = roundUsd2(walletFinal + liqUsd + lendFinal);
    portfolio.walletUsd = roundUsd2(walletFinal);
    portfolio.lendUsd = roundUsd2(lendFinal);
    portfolio.liqUsd = roundUsd2(liqUsd);
    portfolio.computedTotalUsd = computed;
    portfolio.coverageGapUsd = Math.max(0, roundUsd2(debank - computed));
    portfolio.overCountUsd = computed > debank ? roundUsd2(computed - debank) : 0;
  }
  let gapBeforeFill = debank - computed;
  if (debank >= 80 && gapBeforeFill > debank * 0.05 && computed < debank * 0.995) {
    fillCoverageFromProtocolTabs(portfolio);
    fillCoverageFromChainGaps(portfolio);
    dedupePortfolioPositions(portfolio);
    recalcLiquidityTotals(portfolio);
    walletFinal = (portfolio.walletTokens || []).reduce((s, t2) => s + (t2.usd || 0), 0);
    lendFinal = 0;
    const seenFill = /* @__PURE__ */ new Set();
    for (const g of portfolio.protocolGroups || []) {
      for (const x of g.lending || []) {
        if (!saneLendingPosition(x, debank)) continue;
        const k = `${g.protocol}|${x.chain}|${x.collateralUsd}|${x.debtUsd}`;
        if (seenFill.has(k)) continue;
        seenFill.add(k);
        lendFinal += x.netUsd || 0;
      }
    }
    liqUsd = portfolio.liqUsd ?? 0;
    computed = roundUsd2(walletFinal + liqUsd + lendFinal);
    gapBeforeFill = debank - computed;
  }
  if (debank >= 80 && gapBeforeFill > debank * 0.03 && gapBeforeFill <= debank * 0.55) {
    fillCoverageResidual(portfolio);
    dedupePortfolioPositions(portfolio);
    recalcLiquidityTotals(portfolio);
    walletFinal = (portfolio.walletTokens || []).reduce((s, t2) => s + (t2.usd || 0), 0);
    lendFinal = 0;
    const seenL3 = /* @__PURE__ */ new Set();
    for (const g of portfolio.protocolGroups || []) {
      for (const x of g.lending || []) {
        if (!saneLendingPosition(x, debank)) continue;
        const k = `${g.protocol}|${x.chain}|${x.collateralUsd}|${x.debtUsd}`;
        if (seenL3.has(k)) continue;
        seenL3.add(k);
        lendFinal += x.netUsd || 0;
      }
    }
    liqUsd = portfolio.liqUsd ?? 0;
    computed = roundUsd2(walletFinal + liqUsd + lendFinal);
    portfolio.walletUsd = roundUsd2(walletFinal);
    portfolio.lendUsd = roundUsd2(lendFinal);
    portfolio.liqUsd = roundUsd2(liqUsd);
    portfolio.computedTotalUsd = computed;
    portfolio.coverageGapUsd = Math.max(0, roundUsd2(debank - computed));
    portfolio.overCountUsd = computed > debank ? roundUsd2(computed - debank) : 0;
  }
  if (debank > 0 && computed > debank * 1.12) {
    portfolio.walletTokens = [];
    const wg2 = (portfolio.protocolGroups || []).find((g) => g.protocol === "Wallet");
    if (wg2) {
      wg2.walletTokens = [];
      wg2.protocolUsd = 0;
    }
    dedupePortfolioPositions(portfolio);
    recalcLiquidityTotals(portfolio);
    walletFinal = 0;
    lendFinal = 0;
    const seenEnd = /* @__PURE__ */ new Set();
    for (const g of portfolio.protocolGroups || []) {
      for (const x of g.lending || []) {
        if (!saneLendingPosition(x, debank)) continue;
        const k = `${g.protocol}|${x.chain}|${x.collateralUsd}|${x.debtUsd}`;
        if (seenEnd.has(k)) continue;
        seenEnd.add(k);
        lendFinal += x.netUsd || 0;
      }
    }
    liqUsd = portfolio.liqUsd ?? 0;
    computed = roundUsd2(walletFinal + liqUsd + lendFinal);
    portfolio.walletUsd = 0;
    portfolio.lendUsd = roundUsd2(lendFinal);
    portfolio.liqUsd = roundUsd2(liqUsd);
    portfolio.computedTotalUsd = computed;
    portfolio.overCountUsd = computed > debank ? roundUsd2(computed - debank) : 0;
    portfolio.coverageGapUsd = Math.max(0, roundUsd2(debank - computed));
  }
  if (debank > 0 && computed < debank * 0.98) {
    fillCoverageCatchUp(portfolio);
    dedupePortfolioPositions(portfolio);
    recalcLiquidityTotals(portfolio);
    walletFinal = (portfolio.walletTokens || []).reduce((s, t2) => s + (t2.usd || 0), 0);
    lendFinal = 0;
    const seenCu = /* @__PURE__ */ new Set();
    for (const g of portfolio.protocolGroups || []) {
      for (const x of g.lending || []) {
        if (!saneLendingPosition(x, debank)) continue;
        const k = `${g.protocol}|${x.chain}|${x.collateralUsd}|${x.debtUsd}`;
        if (seenCu.has(k)) continue;
        seenCu.add(k);
        lendFinal += x.netUsd || 0;
      }
    }
    liqUsd = portfolio.liqUsd ?? 0;
    computed = roundUsd2(walletFinal + liqUsd + lendFinal);
    portfolio.walletUsd = roundUsd2(walletFinal);
    portfolio.lendUsd = roundUsd2(lendFinal);
    portfolio.liqUsd = roundUsd2(liqUsd);
    portfolio.computedTotalUsd = computed;
    portfolio.coverageGapUsd = Math.max(0, roundUsd2(debank - computed));
    portfolio.overCountUsd = 0;
  }
  portfolio.totalUsd = roundUsd2(debank > 0 ? debank : computed);
  portfolio.partial = portfolio.coverageGapUsd > Math.max(0.5, debank * 0.08) || portfolio.overCountUsd > Math.max(0.5, debank * 0.08);
  if (portfolio.coverageGapUsd <= Math.max(1, debank * 0.03)) {
    purgeSyntheticFills(portfolio);
    dedupePortfolioPositions(portfolio);
    recalcLiquidityTotals(portfolio);
    walletFinal = (portfolio.walletTokens || []).reduce((s, t2) => s + (t2.usd || 0), 0);
    lendFinal = 0;
    const seenFin = /* @__PURE__ */ new Set();
    for (const g of portfolio.protocolGroups || []) {
      for (const x of g.lending || []) {
        if (!saneLendingPosition(x, debank)) continue;
        const k = `${g.protocol}|${x.chain}|${x.collateralUsd}|${x.debtUsd}`;
        if (seenFin.has(k)) continue;
        seenFin.add(k);
        lendFinal += x.netUsd || 0;
      }
    }
    liqUsd = portfolio.liqUsd ?? 0;
    computed = roundUsd2(walletFinal + liqUsd + lendFinal);
    portfolio.walletUsd = roundUsd2(walletFinal);
    portfolio.lendUsd = roundUsd2(lendFinal);
    portfolio.liqUsd = roundUsd2(liqUsd);
    portfolio.computedTotalUsd = computed;
    portfolio.coverageGapUsd = Math.max(0, roundUsd2(debank - computed));
    portfolio.overCountUsd = computed > debank ? roundUsd2(computed - debank) : 0;
    portfolio.partial = portfolio.coverageGapUsd > Math.max(0.5, debank * 0.08) || portfolio.overCountUsd > Math.max(0.5, debank * 0.08);
  }
  return portfolio;
}
function normalizePortfolioChains(portfolio) {
  if (!portfolio) return portfolio;
  const p = portfolio;
  assignUnknownLiquidityChains(p);
  splitLiquidityGroupsByChain(p);
  for (const t2 of p.walletTokens || []) {
    t2.chain = normChain(t2.chain);
  }
  if (p.walletByChain) {
    const next = {};
    for (const [ch, list] of Object.entries(p.walletByChain)) {
      const slug = normChain(ch);
      if (!next[slug]) next[slug] = [];
      next[slug].push(...list);
    }
    p.walletByChain = next;
  }
  for (const row of p.liquidity || []) {
    row.chain = normChain(row.chain);
  }
  for (const row of p.lending || []) {
    row.chain = normChain(row.chain);
  }
  for (const g of p.protocolGroups || []) {
    if (g.chain && g.chain !== "all") g.chain = normChain(g.chain);
    for (const t2 of g.walletTokens || []) {
      t2.chain = normChain(t2.chain);
    }
    for (const x of g.liquidity || []) {
      x.chain = normChain(x.chain);
    }
    for (const x of g.lending || []) {
      x.chain = normChain(x.chain);
    }
  }
  for (const c of p.chains || []) {
    c.slug = normChain(c.slug);
  }
  p.schemaVersion = PORTFOLIO_SCHEMA;
  dedupePortfolioPositions(p);
  return syncDisplayTotals(p);
}

// js/krystal-portfolio-merge.js
var CHAIN_ID = {
  1: "eth",
  10: "op",
  56: "bsc",
  137: "matic",
  8453: "base",
  42161: "arb",
  324: "era",
  59144: "linea",
  534352: "scroll",
  81457: "blast"
};
var KRYSTAL_DEX = /aerodrome|pancake|velodrome|sushi|curve|balancer|quickswap|trader.?joe/i;
function chainFromKrystal(p) {
  const id = p?.chainId ?? p?.chain_id;
  if (id != null && CHAIN_ID[id]) return CHAIN_ID[id];
  const name = String(p?.chain || p?.chainName || "").toLowerCase();
  return chainSlug(name || "unknown");
}
function protocolFromKrystal(p) {
  const raw = String(p?.protocol || p?.dexId || p?.dex || "Krystal");
  if (/aerodrome/i.test(raw)) return "Aerodrome V3";
  if (/pancake/i.test(raw)) return "PancakeSwap V3";
  if (/uniswap.*v4/i.test(raw)) return "Uniswap V4";
  if (/uniswap/i.test(raw)) return "Uniswap V3";
  return raw;
}
function pairFromKrystal(p) {
  const pool = p?.pool || {};
  const t0 = pool?.token0?.symbol || "?";
  const t1 = pool?.token1?.symbol || "?";
  return `${t0}/${t1}`;
}
function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function apyFromKrystal(p) {
  let apy = num(p?.apr) || num(p?.farmApr) || num(p?.apy);
  if (apy > 0 && apy < 1) apy *= 100;
  return apy || null;
}
function poolKey(protocol, chain, pair) {
  return `${protocol}|${chainSlug(chain)}|${normPair(pair)}`;
}
function findGroup2(portfolio, protocol, chain) {
  const ch = chainSlug(chain);
  return (portfolio.protocolGroups || []).find(
    (g) => g.protocol === protocol && chainSlug(g.chain) === ch
  );
}
function ensureGroup2(portfolio, protocol, chain) {
  let g = findGroup2(portfolio, protocol, chain);
  if (g) return g;
  if (!portfolio.protocolGroups) portfolio.protocolGroups = [];
  g = {
    protocol,
    chain: chainSlug(chain),
    protocolUsd: 0,
    liquidity: [],
    lending: [],
    walletTokens: [],
    kinds: []
  };
  g.id = `${g.protocol}|${g.chain}`;
  portfolio.protocolGroups.push(g);
  return g;
}
function krystalToPool(p, protocol, chain) {
  const pair = pairFromKrystal(p);
  const current = num(p?.currentUSD) || num(p?.liquidityUSD);
  const invested = num(p?.initialUSD) || num(p?.depositedUSD);
  const apy = apyFromKrystal(p);
  const id = p?.id || p?.positionId || "";
  return {
    protocol,
    chain: chainSlug(chain),
    poolId: id ? `${pair} #${id}` : pair,
    pair,
    inPool: [],
    positionUsd: current,
    netUsd: current,
    investedUsd: invested || null,
    apyPercent: apy,
    fromKrystal: true,
    krystal: p,
    kind: "Liquidity Pool"
  };
}
function enrichPoolRow(row, kPool) {
  const apy = apyFromKrystal(kPool.krystal || kPool);
  if (apy != null && !row.apyPercent) row.apyPercent = apy;
  if (kPool.investedUsd && !row.investedUsd) row.investedUsd = kPool.investedUsd;
  const kr = kPool.krystal || kPool;
  const min = num(kr?.minPrice) || num(kr?.priceRangeMin);
  const max = num(kr?.maxPrice) || num(kr?.priceRangeMax);
  if (min && max && row.rangeMin == null) {
    row.rangeMin = min;
    row.rangeMax = max;
  }
  row.fromKrystal = true;
  return row;
}
function mergeKrystalLiquidity(portfolio, krystalPositions) {
  if (!portfolio || !krystalPositions?.length) return portfolio;
  const p = portfolio;
  const index = /* @__PURE__ */ new Map();
  for (const g of p.protocolGroups || []) {
    for (const row of g.liquidity || []) {
      if (row.debankFill) continue;
      index.set(poolKey(g.protocol, row.chain, row.pair || row.poolId), { g, row });
      index.set(
        `${chainSlug(row.chain)}|${normPair(row.pair || row.poolId)}`,
        { g, row }
      );
    }
  }
  for (const kr of krystalPositions) {
    const protocol = protocolFromKrystal(kr);
    const chain = chainFromKrystal(kr);
    const pair = pairFromKrystal(kr);
    const isUni = !!isRevertDexDebankProtocol(protocol);
    if (isUni) continue;
    if (!KRYSTAL_DEX.test(protocol) && !KRYSTAL_DEX.test(String(kr?.dexId || ""))) continue;
    const key = poolKey(protocol, chain, pair);
    const alt = `${chainSlug(chain)}|${normPair(pair)}`;
    const hit = index.get(key) || index.get(alt);
    if (hit) {
      enrichPoolRow(hit.row, krystalToPool(kr, protocol, chain));
      continue;
    }
    const usd = num(kr?.currentUSD) || num(kr?.liquidityUSD);
    if (usd < 2) continue;
    const g = ensureGroup2(p, protocol, chain);
    const pool = krystalToPool(kr, protocol, chain);
    g.liquidity.push(pool);
    index.set(key, { g, row: pool });
    index.set(alt, { g, row: pool });
  }
  return p;
}

// js/portfolio-pipeline.js
function finalizeDebankPortfolioClone(raw) {
  if (!raw) return raw;
  const p = { ...raw, schemaVersion: PORTFOLIO_SCHEMA, source: "debank" };
  dedupePortfolioPositions(p);
  return syncDisplayTotals(normalizePortfolioChains(p));
}
function applyLendingEnrichment(portfolio) {
  if (!portfolio?.protocolGroups) return portfolio;
  for (const g of portfolio.protocolGroups) {
    g.lending = (g.lending || []).map((row) => applyLendingMetrics(row));
  }
  if (portfolio.lending?.length) {
    portfolio.lending = portfolio.lending.map((row) => applyLendingMetrics(row));
  }
  return portfolio;
}
function enrichPortfolio(portfolio, { revertPositions = null, krystalPositions = null } = {}) {
  if (!portfolio) return portfolio;
  let p = { ...portfolio };
  if (revertPositions?.length) {
    p = mergeRevertLiquidity(p, revertPositions);
  }
  if (krystalPositions?.length) {
    p = mergeKrystalLiquidity(p, krystalPositions);
  }
  p = applyLendingEnrichment(p);
  return syncDisplayTotals(p);
}
function applyPortfolioPipeline(portfolio, enrich = {}) {
  let p = finalizeDebankPortfolioClone(portfolio);
  return enrichPortfolio(p, enrich);
}

// js/app.js
var APP_VER = "63";
var FETCH_TIMEOUT_MS = 15e4;
var CACHE_MS = 15 * 60 * 1e3;
function getAppBase() {
  const m = location.pathname.match(/^(\/portfolio)(?:\/|$)/i);
  return m ? m[1] : "";
}
function isLocalDev() {
  return (location.hostname === "127.0.0.1" || location.hostname === "localhost") && location.port === "5500";
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
async function waitForApi(maxMs = 2e4) {
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
async function fetchPortfolio(wallet, { quick = false, refresh = false, source = "debank", refreshOnchain = false } = {}) {
  const q = new URLSearchParams({ wallet, _: String(Date.now()) });
  if (quick) q.set("quick", "1");
  if (refresh) q.set("refresh", "1");
  if (refreshOnchain) q.set("refreshOnchain", "1");
  if (source) q.set("source", source);
  const url = apiUrl(`/api/portfolio?${q}`);
  const r = await fetchWithTimeout(url);
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
    _source: data.source || source
  };
}
if (localStorage.getItem("pt-app-ver") !== APP_VER) {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith("pt:")) sessionStorage.removeItem(k);
    }
  } catch {
  }
  localStorage.setItem("pt-app-ver", APP_VER);
}
var $ = (id) => document.getElementById(id);
var lang = localStorage.getItem(LANG_KEY) || "ru";
var state = {
  view: "all",
  chainFilter: null,
  protocolFilter: null,
  collapsed: /* @__PURE__ */ new Set(),
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
  loadSteps: {}
};
var LOAD_STEP_WEIGHTS = {
  connect: 8,
  debank: 38,
  positions: 14,
  ranges: 22,
  apy: 10,
  history: 8
};
var LOAD_STEP_ORDER = ["connect", "debank", "positions", "ranges", "apy", "history"];
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
  dock.hidden = !onResults || !busy && state.loadPct >= 100;
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
    label.textContent = activeStep ? t(lang, `lpStep${activeStep[0].toUpperCase()}${activeStep.slice(1)}`) : "";
  }
  if (trust) {
    trust.textContent = state.loadPct >= 100 && state.loadReady ? t(lang, "loadTrustOk") : t(lang, "loadTrustWait");
  }
  if (stepsEl) {
    stepsEl.innerHTML = LOAD_STEP_ORDER.map((id) => {
      const st = state.loadSteps[id] || "pending";
      const cls = st === "done" ? "is-done" : st === "active" ? "is-active" : "";
      const key = `lpStep${id[0].toUpperCase()}${id.slice(1)}`;
      return `<li class="${cls}" data-step="${id}">${esc(t(lang, key))}</li>`;
    }).join("");
  }
  document.body.classList.toggle("portfolio-incomplete", onResults && state.loadPct < 100);
  document.body.classList.toggle(
    "portfolio-ready",
    onResults && state.loadPct >= 100 && state.loadReady
  );
}
function filterByChain(tokens) {
  if (!state.chainFilter) return tokens || [];
  const cf = chainSlug(state.chainFilter);
  return (tokens || []).filter((t2) => chainSlug(t2.chain) === cf);
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
    lend: d.lendUsd
  };
  if (!state.chainFilter) return base;
  const groups = getVisibleGroups();
  let wallet = 0;
  let liq = 0;
  let lend = 0;
  for (const g of groups) {
    if (g.protocol === "Wallet") {
      wallet += filterByChain(g.walletTokens).reduce((s, t2) => s + (t2.usd || 0), 0);
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
      `<span class="filter-chip">${chainBadgeHtml(state.chainFilter, 18)} ${esc(chainLabel(state.chainFilter, lang))}</span>`
    );
  }
  if (state.protocolFilter) {
    const g = (state.data?.protocolGroups || []).find(
      (x) => (x.id || `${x.protocol}|${x.chain}`) === state.protocolFilter
    );
    if (g)
      parts.push(
        `<span class="filter-chip">${esc(pillLabel(g, state.data?.protocolGroups || []))}</span>`
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
  }
}
function loadCollapsed() {
  try {
    const raw = sessionStorage.getItem("pt:collapsed");
    if (raw) state.collapsed = new Set(JSON.parse(raw));
  } catch {
    state.collapsed = /* @__PURE__ */ new Set();
  }
}
function saveCollapsed() {
  try {
    sessionStorage.setItem("pt:collapsed", JSON.stringify([...state.collapsed]));
  } catch {
  }
}
function isOpen(key) {
  return !state.collapsed.has(key);
}
var fmtUsd = (n, smart) => {
  const v = Number(n || 0);
  if (smart && v > 0 && v < 0.01) {
    return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  }
  const opts = v >= 1e3 ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return "$" + v.toLocaleString("en-US", opts);
};
function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
    return `${g.protocol} \xB7 ${chainLabel(g.chain, lang)}`;
  }
  return g.protocol;
}
function groupMatchesChain(g, chain) {
  if (!chain) return true;
  const cf = chainSlug(chain);
  if (g.protocol === "Wallet") {
    return g.walletTokens?.some((t2) => chainSlug(t2.chain) === cf) ?? false;
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
function prefersProtocolAccordion(proto) {
  return /uniswap|pancake|aerodrome|curve|balancer|sushi|velodrome|yearn|gmx|beefy|pendle/i.test(
    String(proto || "")
  );
}
function clusterByProtocol(groups) {
  const map = /* @__PURE__ */ new Map();
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
    (g) => g.protocolUsd > 5e-3 || g.walletTokens?.length || g.liquidity?.length || g.lending?.length
  );
  if (!src.length) return "";
  const pills = src.map((g) => {
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
  }).join("");
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
      ${chains.filter((c) => (c.usd || 0) > 0.01).map((c) => {
    const pct = c.pct || Math.round((c.usd || 0) / total * 100);
    const active = chainSlug(state.chainFilter) === chainSlug(c.slug);
    return `
          <button type="button" class="chain-card${active ? " active" : ""}" data-chain="${esc(chainSlug(c.slug))}">
            ${chainBadgeHtml(c.slug, 40)}
            <div class="chain-card-name">${esc(chainLabel(c.slug, lang))}</div>
            <div class="chain-card-usd">${fmtUsd(c.usd)}</div>
            <div class="chain-card-pct">${pct}%</div>
          </button>`;
  }).join("")}
    </div>`;
}
function renderWalletTokenRows(tokens) {
  const list = filterByChain(tokens);
  if (!list.length) return `<div class="empty">${t(lang, "empty")}</div>`;
  return `<div class="token-list">${list.map(
    (tok) => `
    <div class="token-row">
      <div class="token-icon-slot">${tok.chain ? chainBadgeHtml(tok.chain, 28) : ""}</div>
      <div class="sym-col">
        <div class="sym">${esc(tok.symbol)}${tok.chain ? ` <span class="chain-tag">${esc(chainLabel(tok.chain, lang))}</span>` : ""}</div>
        <div class="amt">${esc(tok.amount)} \xB7 ${esc(tok.price)}</div>
      </div>
      <div class="pos-usd">${fmtUsd(tok.usd, true)}</div>
    </div>`
  ).join("")}</div>`;
}
function poolRowKey(p, protocol) {
  return `${protocol}|${p.chain}|${p.pair || p.poolId}|${p.positionUsd}`;
}
function fmtPct(n) {
  if (n == null || !Number.isFinite(n)) return "\u2014";
  const v = Number(n);
  if (Math.abs(v) > 500) return "\u2014";
  return `${v >= 0 ? "" : "\u2212"}${Math.abs(v).toFixed(2)}%`;
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
  if (v >= 1e3) return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (v >= 1) return v.toFixed(4);
  if (v >= 1e-4) return v.toFixed(6);
  return v.toExponential(2);
}
function formatPositionAge(p) {
  if (!p.openedAt) return null;
  const ms = Date.now() - p.openedAt;
  const days = Math.max(0, Math.floor(ms / 864e5));
  const date = new Date(p.openedAt).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric"
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
      collected: cAmt
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
      complete: collectedUsd > 1e-3 || byToken.some((x) => x.collected > 0)
    };
  }
  const claimUsd = p.claimableUsd ?? (p.claimable || []).reduce((s, x) => s + (x.usd || 0), 0);
  if (claimUsd > 1e-3) {
    const byToken2 = (p.claimable || []).filter((x) => (x.usd || 0) > 1e-3).map((x) => ({
      symbol: x.symbol || "?",
      total: parseFloat(String(x.amount || "0").replace(/,/g, "")) || 0,
      unclaimed: parseFloat(String(x.amount || "0").replace(/,/g, "")) || 0,
      collected: 0
    }));
    return {
      totalUsd: claimUsd,
      unclaimedUsd: claimUsd,
      collectedUsd: 0,
      byToken: byToken2,
      complete: false
    };
  }
  const rev = p.revert;
  if (rev?.uncollectedUsd > 1e-3) {
    return {
      totalUsd: rev.uncollectedUsd,
      unclaimedUsd: rev.uncollectedUsd,
      collectedUsd: 0,
      byToken: [],
      complete: false
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
  if (feeUsd < 1e-3) return null;
  const years = hours / (365 * 24);
  const apr = feeUsd / posUsd / years * 100;
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
          <strong class="pd-val">${esc(rs.feeTier || "\u2014")}</strong>
        </div>
      </div>
    </section>`;
}
function renderFeeBreakdown(fees) {
  if (!fees) return "";
  const hasTokens = fees.byToken.length > 0;
  const tokenRows = fees.byToken.map(
    (x) => `
      <div class="pd-fee-token">
        <span class="pd-fee-sym">${esc(x.symbol)}</span>
        <span class="pd-fee-amt">${esc(fmtTokenAmount(x.total))}</span>
        ${x.unclaimed > 0 ? `<span class="pd-fee-sub">${t(lang, "pdFeesUnclaimed")}: ${esc(fmtTokenAmount(x.unclaimed))}</span>` : ""}
        ${x.collected > 0 ? `<span class="pd-fee-sub">${t(lang, "pdFeesCollected")}: ${esc(fmtTokenAmount(x.collected))}</span>` : ""}
      </div>`
  ).join("");
  return `
    <section class="pd-section">
      <h4 class="pd-section-title">${t(lang, "pdFeesSection")}</h4>
      <div class="pd-fees-hero">
        <span class="pd-lbl">${t(lang, fees.complete ? "pdFeesTotal" : "pdFeesUnclaimedHero")}</span>
        <strong class="pd-fees-total">${fmtUsd(fees.totalUsd, true)}</strong>
      </div>
      ${fees.complete ? `<div class="pd-fee-split">
              <span>${t(lang, "pdFeesUnclaimed")}: <strong>${fmtUsd(fees.unclaimedUsd, true)}</strong></span>
              <span>${t(lang, "pdFeesCollected")}: <strong>${fmtUsd(fees.collectedUsd, true)}</strong></span>
            </div>` : `<p class="pd-note">${t(lang, "pdFeesPartialNote")}</p>`}
      ${hasTokens ? `<div class="pd-fee-tokens"><span class="pd-lbl">${t(lang, "pdFeesByToken")}</span>${tokenRows}</div>` : ""}
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
  const inPool = (p.inPool || []).map((x) => `<span>${esc(x.symbol)} ${esc(x.amount)}</span>`).join(" \xB7 ");
  const parts = ['<div class="pool-drawer-inner">'];
  if (rs) parts.push(renderRangeStats(rs, pk));
  if (fees && fees.totalUsd > 1e-4) parts.push(renderFeeBreakdown(fees));
  parts.push(`<section class="pd-section">
    <h4 class="pd-section-title">${t(lang, "pdYieldSection")}</h4>
    <div class="pd-stat-grid">
      ${apr != null ? `<div class="pd-stat"><span class="pd-lbl">${t(lang, "revertApr")}</span><strong class="pd-val">${fmtPct(apr)}</strong></div>` : ""}
      ${apy != null ? `<div class="pd-stat"><span class="pd-lbl">${t(lang, "revertApy")}</span><strong class="pd-val pd-val--green">${fmtPct(apy)}</strong></div>` : ""}
      ${r?.totalPnlUsd != null && Math.abs(r.totalPnlUsd) > 1e-3 ? `<div class="pd-stat"><span class="pd-lbl">${t(lang, "revertPnl")}</span><strong class="pd-val">${fmtUsd(r.totalPnlUsd, true)}</strong></div>` : ""}
      <div class="pd-stat"><span class="pd-lbl">${t(lang, "value")}</span><strong class="pd-val">${fmtUsd(p.positionUsd, true)}</strong></div>
    </div>
  </section>`);
  if (age || inPool) {
    parts.push(`<section class="pd-section pd-section--last">
      <h4 class="pd-section-title">${t(lang, "pdPositionSection")}</h4>
      <div class="pd-stat-grid">
        ${age ? `<div class="pd-stat"><span class="pd-lbl">${t(lang, "pdOpened")}</span><strong class="pd-val">${esc(age.date)}</strong></div>
               <div class="pd-stat"><span class="pd-lbl">${t(lang, "pdAge")}</span><strong class="pd-val">${age.days} ${t(lang, "pdDays")}</strong></div>` : ""}
        ${inPool ? `<div class="pd-stat pd-stat--wide"><span class="pd-lbl">${t(lang, "inPoolLbl")}</span><strong class="pd-val pd-val--wrap">${inPool}</strong></div>` : ""}
      </div>
    </section>`);
  }
  if (r?.detailUrl) {
    parts.push(
      `<a class="pool-revert-link" href="${esc(r.detailUrl)}" target="_blank" rel="noopener">${t(lang, "revertOpen")} \u2197</a>`
    );
  }
  parts.push("</div>");
  const idAttr = detailId ? ` id="${esc(detailId)}"` : "";
  return `<div class="pool-drawer"${idAttr}>${parts.join("")}</div>`;
}
function poolPairKeyForFmt(p) {
  return p.revert?.pairKey || normPair(p.pair || p.poolId || "");
}
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
        pairKey: r.pairKey || pk
      };
    }
    if (ocOk) {
      return {
        rangeMin: p.rangeMin,
        rangeMax: p.rangeMax,
        rangeCurrent: p.rangeCurrent,
        feeTier: p.feeTier,
        pairKey: pk,
        onchain: !!p.onchainMetrics
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
      pairKey: r.pairKey || pk
    };
  }
  if (ocOk) {
    return {
      rangeMin: p.rangeMin,
      rangeMax: p.rangeMax,
      rangeCurrent: p.rangeCurrent,
      feeTier: p.feeTier,
      pairKey: pk,
      onchain: !!p.onchainMetrics
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
        pairKey: r0.pairKey || pk
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
  const segLeft = (min - trackMin) / trackSpan * 100;
  const segWidth = span / trackSpan * 100;
  let markerPct = (cur - trackMin) / trackSpan * 100;
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
  const seen = /* @__PURE__ */ new Set();
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
    revertDexCount: m?.revertDexCount ?? 0
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
  }
  const rest = state.data.protocolGroups.filter((g) => g.protocol !== "Wallet").sort((a, b) => (b.protocolUsd || 0) - (a.protocolUsd || 0));
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
  }
}
function renderLiquidityCompact(list, protocol) {
  return `<div class="pool-list">${(list || []).map((p) => {
    const key = poolRowKey(p, protocol);
    const open = state.poolDetailKey === key;
    const inPool = (p.inPool || []).map((x) => `<span>${esc(x.symbol)} ${esc(x.amount)}</span>`).join(" \xB7 ");
    const r = p.revert;
    const fees = poolFeeSummary(p);
    const feesUsd = fees?.complete && fees.totalUsd > 1e-3 ? fees.totalUsd : fees?.unclaimedUsd > 1e-3 ? fees.unclaimedUsd : r?.uncollectedUsd;
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
            ${apy != null ? `<div class="pool-apy-hero">${fmtPct(apy)}</div><div class="pool-apy-lbl">${t(lang, "poolApyLbl")}</div>` : feesUsd > 1e-3 ? `<div class="pool-apy-hero fees-only">+${fmtUsd(feesUsd, true)}</div><div class="pool-apy-lbl">${t(lang, "pdFeesUnclaimed")}</div>` : `<div class="pool-apy-hero muted">\u2014</div>`}
            <div class="pool-usd-sm">${fmtUsd(p.positionUsd, true)}</div>
            ${!open && feesUsd > 1e-3 ? `<div class="pool-fees-sm">+${fmtUsd(feesUsd, true)} ${t(lang, fees?.complete ? "feesShort" : "pdFeesUnclaimed")}</div>` : ""}
            <span class="pool-chev" aria-hidden="true"></span>
          </div>
        </button>
        ${open ? renderPoolExpandedDetail(p, detailId) : ""}
      </div>`;
  }).join("")}</div>`;
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
  const inner = chainGroups.map((g) => {
    const cKey = `${pKey}|${g.chain}`;
    const cOpen = isOpen(cKey);
    const head = renderAccHead(
      chainLabel(g.chain, lang),
      g.protocolUsd,
      cKey,
      true,
      chainBadgeHtml(g.chain, 24)
    );
    return `
      <div class="acc acc--nested ${cOpen ? "open" : ""}">
        ${head}
        <div class="acc-panel">${renderLiquidityCompact(filterLiqByChain(g.liquidity), protocol)}${filterLendByChain(g.lending).length ? renderLending(filterLendByChain(g.lending)) : ""}</div>
      </div>`;
  }).join("");
  return `
    <section class="acc ${open ? "open" : ""}">
      ${renderAccHead(protocol, total, pKey, false)}
      <div class="acc-panel acc-panel--stack">${inner}</div>
    </section>`;
}
function renderWalletAccordion(g) {
  const tokens = filterByChain(g.walletTokens);
  const sum = tokens.reduce((s, t2) => s + (t2.usd || 0), 0);
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
  const kinds = (g.kinds || []).map((k) => `<span class="pill kind">${esc(translateKind(lang, k))}</span>`).join("");
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
  const segments = groups.filter((g) => g.protocolUsd > 0.5).map((g, i) => ({
    label: pillLabel(g, groups),
    value: g.protocolUsd || 0,
    color: ["#22d3ee", "#a78bfa", "#4ade80", "#f472b6", "#fbbf24", "#fb7185"][i % 6]
  })).sort((a, b) => b.value - a.value).slice(0, 8);
  const chainSeg = (d.chains || []).filter((c) => c.usd > 0.5).map((c, i) => ({
    label: chainLabel(c.slug, lang),
    value: c.usd,
    color: chainColor(c.slug) || "#6b7cff"
  }));
  const total = d.totalUsd || 1;
  const walletPct = Math.round((d.walletUsd || 0) / total * 100);
  const liqPct = Math.round((d.liqUsd || 0) / total * 100);
  const lendPct = Math.round((d.lendUsd || 0) / total * 100);
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
          <p class="an-note">${t(lang, "chartNote")}${(d.coverageGapUsd ?? 0) > 0.5 ? ` \xB7 ${t(lang, "coverageGapNote", { gap: fmtUsd(d.coverageGapUsd) })}` : ""}</p>
        </div>
      </div>
    </section>`;
}
function renderConicDonut(segments) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let pct = 0;
  const stops = segments.map((seg) => {
    const start = pct;
    pct += seg.value / total * 100;
    return `${seg.color} ${start}% ${pct}%`;
  });
  const bg = stops.length ? `conic-gradient(${stops.join(", ")})` : "conic-gradient(#333 0% 100%)";
  return `<div class="donut" style="background:${bg}"><div class="donut-hole"></div></div>`;
}
function renderLendAssetRows(items, variant) {
  if (!items?.length) {
    return `<p class="lend-empty">${t(lang, variant === "sup" ? "lendNoCollateral" : "lendNoDebt")}</p>`;
  }
  return items.map(
    (x) => `
    <div class="lend-asset-row lend-asset-row--${variant}">
      <span class="lend-asset-sym">${esc(x.asset)}</span>
      <span class="lend-asset-amt">${esc(x.amount)}</span>
      <span class="lend-asset-usd">${fmtUsd(x.usd, true)}</span>
    </div>`
  ).join("");
}
function formatLiqPrice(n) {
  if (n == null || !Number.isFinite(n)) return "\u2014";
  const v = Number(n);
  if (v >= 1e3) return `$${Math.round(v).toLocaleString("en-US")}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}
function renderLending(list) {
  return `<div class="lend-list">${(list || []).map((p) => {
    const hf = p.healthFactor;
    const hfClass = hf != null && hf < 1.2 ? " lend-hf--warn" : hf != null && hf < 1.5 ? " lend-hf--mid" : "";
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
          ${hf != null ? `<div class="lend-metric${hfClass}"><span>${t(lang, "healthFactor")}</span><strong>${esc(String(hf))}</strong></div>` : ""}
          ${p.liquidationPrice != null ? `<div class="lend-metric"><span>${t(lang, "liquidationLbl")}</span><strong>${esc(formatLiqPrice(p.liquidationPrice))}</strong></div>` : ""}
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
        ${rewUsd > 1e-3 ? `<p class="lend-rewards">${t(lang, "rewardsLbl")}: ${fmtUsd(rewUsd, true)}</p>` : ""}
      </article>`;
  }).join("")}</div>`;
}
function reattachRevert() {
  if (!state.data?.protocolGroups?.length) return;
  const w = state.data.wallet?.toLowerCase();
  if (state.revertWallet && w && state.revertWallet !== w) return;
  applyPortfolioPipeline(state.data, {
    revertPositions: state.revertPositions,
    krystalPositions: state.krystalPositions
  });
  syncDisplayTotals(state.data);
}
function mergeRangeFields(fromPortfolio) {
  if (!state.data?.protocolGroups?.length || !fromPortfolio?.protocolGroups) return false;
  const idx = /* @__PURE__ */ new Map();
  for (const g of fromPortfolio.protocolGroups) {
    for (const p of g.liquidity || []) {
      const tid = String(p.poolId || "").match(/#(\d+)/)?.[1];
      const key = tid ? `tid:${tid}` : `${g.protocol}|${chainSlug(p.chain)}|${String(p.poolId || p.pair || "").toLowerCase()}`;
      idx.set(key, p);
    }
  }
  let n = 0;
  for (const g of state.data.protocolGroups) {
    for (const p of g.liquidity || []) {
      const tid = String(p.poolId || "").match(/#(\d+)/)?.[1];
      const key = tid ? `tid:${tid}` : `${g.protocol}|${chainSlug(p.chain)}|${String(p.poolId || p.pair || "").toLowerCase()}`;
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
  const r = await fetchWithTimeout(apiUrl(`/api/enrich-ranges?${q}`), 12e4);
  const j = await r.json();
  if (!r.ok || !j.ok || !j.portfolio) throw new Error(j.error || "RANGES_FAILED");
  return j.portfolio;
}
function applyPortfolio(p, wallet) {
  applyPortfolioPipeline(p, {
    revertPositions: state.revertPositions,
    krystalPositions: state.krystalPositions
  });
  const walletUsd = p.walletUsd;
  const liqUsd = p.liqUsd;
  const lendUsd = p.lendUsd;
  state.data = {
    wallet,
    fetchedAt: Date.now(),
    partial: !!p.partial,
    fromCache: !!p._cached || !!p.fromCache,
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
    schemaVersion: PORTFOLIO_SCHEMA
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
    state.view === "all" && !state.chainFilter && !state.protocolFilter
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
  $("updatedAt").textContent = `${t(lang, "updated")}: ${new Date(d.fetchedAt).toLocaleString(lang === "ru" ? "ru-RU" : "en-US")}${src ? ` \xB7 ${src}` : ""}`;
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
  const analyticsReady = state.view === "all" && !state.protocolFilter && !state.chainFilter && !d.partial && !state.enriching;
  $("analytics").innerHTML = analyticsReady ? renderAnalytics(d) : "";
  renderHistorySection();
  updateNavActive();
  const groups = getVisibleGroups();
  const pillSource = state.view === "liquidity" ? (d.protocolGroups || []).filter((g) => g.liquidity?.length) : state.view === "lending" ? (d.protocolGroups || []).filter((g) => g.lending?.length) : d.protocolGroups || [];
  const rev = countRevertLpStats();
  let revertHdr = "";
  const hm = d.hybridMeta || {};
  if (d.source === "hybrid" || d.hybrid) {
    revertHdr = `<p class="revert-stats">${t(lang, "portfolioHybrid", {
      onchainUsd: fmtUsd(hm.onchainUsd ?? 0),
      totalUsd: fmtUsd(d.totalUsd ?? 0),
      fill: hm.fillCount ?? d.stats?.debankFillCount ?? 0
    })}</p><p class="revert-stats sub">${t(lang, "portfolioHybridHint")}</p>`;
    if (hm.computedUsd != null && Math.abs((hm.gapUsd ?? 0) / (d.totalUsd || 1)) > 0.03) {
      revertHdr += `<p class="revert-stats sub">${t(lang, "portfolioHybridGap", {
        computed: fmtUsd(hm.computedUsd),
        gap: fmtUsd(Math.abs(hm.gapUsd ?? 0))
      })}</p>`;
    }
  } else if (d.onchain || d.source === "onchain") {
    const st = d.stats || {};
    revertHdr = `<p class="revert-stats">${t(lang, "portfolioOnchain", {
      lp: st.lpCount ?? rev.total,
      lend: st.lendCount ?? 0,
      chains: st.chains ?? (d.chains || []).length
    })}</p><p class="revert-stats sub">${t(lang, "portfolioOnchainHint")}</p>`;
  }
  if ((state.view === "all" || state.view === "liquidity") && (rev.total > 0 || rev.revertCount > 0)) {
    revertHdr += `<p class="revert-stats">${t(lang, "revertLpStats", rev)}</p>`;
    const sumVars = {
      ...rev,
      debankDexUsd: (rev.debankDexUsd ?? 0).toFixed(2),
      revertDexUsd: (rev.revertDexUsd ?? 0).toFixed(2)
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
  $("positions").innerHTML = renderFilterBanner() + (state.view === "all" ? renderProtocolPills(pillSource) : renderProtocolPills(groups)) + revertHdr + `<div class="proto-cards">${renderPositionsLayout(groups)}</div>`;
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
  const canShow = state.data && state.view === "all" && !state.chainFilter && !state.protocolFilter && !state.historyLoading && state.historySeries?.length > 0;
  if (!canShow) {
    hideHistoryChart();
    return;
  }
  wrap.hidden = false;
  const status = $("historyStatus");
  if (status) status.textContent = `${t(lang, "historyNote")} \xB7 ${t(lang, "historyChartHint")}`;
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
      6e4
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
    hs.textContent = `${t(lang, "historyNote")} \xB7 ${t(lang, "historyChartHint")}`;
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
        lw.innerHTML = `<button type="button" class="last-wallet-btn" data-wallet="${esc(last)}">${t(lang, "lastWallet")}: ${esc(last.slice(0, 6))}\u2026${esc(last.slice(-4))}</button>`;
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
      else if (phase === "chains" && p === "connect" || phase === "merge" && (p === "connect" || p === "chains") || phase === "done" && p !== "merge") {
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
  const prevPositions = keepStale && state.revertWallet === wallet.toLowerCase() && state.revertPositions?.length ? [...state.revertPositions] : [];
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
    const r = await fetchWithTimeout(apiUrl(`/api/revert?${q}`), 12e4);
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
      requestRevert(true).then((fresh) => {
        if (applyRevertResponse(fresh) && state.data) render();
      }).catch((e) => console.warn("revert refresh", e));
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
    const r = await fetchWithTimeout(apiUrl(`/api/enrich-krystal?${q}`), 12e4);
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
    await fetchRevert(wallet, { force: refresh, keepStale: true });
    await fetchKrystalEnrich(wallet);
    setLoadStep("ranges", "active");
    state.rangesError = null;
    state.rangesEnriched = 0;
    try {
      const enriched = await fetchLpRanges(wallet);
      if (mergeRangeFields(enriched)) {
        state.rangesEnriched = (state.data?.protocolGroups || []).reduce(
          (n, g) => n + (g.liquidity || []).filter((p) => p.rangeMin != null && p.rangeMax != null).length,
          0
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
    if (!await checkApiReady()) {
      if (!await waitForApi(15e3)) throw new Error("NO_API");
    }
    if (!silent) {
      setLoadStep("connect", "done");
      setLoadStep("debank", "active");
    }
    const cached = !refresh && !silent && loadCache(wallet);
    if (cached && !cached.partial) {
      applyPortfolio({ ...cached, partial: false }, wallet);
      setLoadStep("debank", "done");
      setLoadStep("positions", "done");
      state.loadPct = 42;
      renderLoadProgress();
      setLoading(false);
      render();
      void runEnrichmentPipeline(wallet, { refresh: false });
    } else {
      if (!refresh && !silent) {
        try {
          const preview = await fetchPortfolio(wallet, {
            source: "debank",
            quick: true,
            refresh: false
          });
          applyPortfolio({ ...preview, partial: true }, wallet);
          render();
        } catch (e) {
          console.warn("debank preview", e);
        }
      }
      if (!silent) setLoading(true, t(lang, "loadingQuick"), "debank");
      try {
        const p = await fetchPortfolio(wallet, {
          source: "debank",
          quick: false,
          refresh
        });
        p.partial = false;
        if (!silent) {
          setLoadStep("debank", "done");
          setLoadStep("positions", "done");
        }
        applyPortfolio(p, wallet);
        saveCache(wallet, state.data);
        updateLoadPreview(p);
      } catch (e) {
        console.warn("full debank", e);
        if (!state.data) throw e;
        state.data.partial = true;
      }
      if (!silent) {
        setLoading(false);
        state.loadPct = Math.max(state.loadPct, 55);
        renderLoadProgress();
      }
      render();
      void runEnrichmentPipeline(wallet, { refresh });
    }
    try {
      localStorage.setItem("pt-last-wallet", wallet);
    } catch {
    }
    const q = new URLSearchParams(window.location.search);
    q.set("wallet", wallet);
    const base = getAppBase();
    const path = base ? `${base}/` : location.pathname.replace(/\/[^/]*$/, "/") || "/";
    window.history.replaceState({}, "", `${path}?${q.toString()}`);
    if (!silent && (state.data?.totalUsd ?? 0) < 1e-3 && !state.data?.protocolGroups?.length) {
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
      const msg = e.message === "NO_API" ? noApiMessage() : aborted ? t(lang, "errFetch") : e.message === "FETCH_FAILED" || e.message.startsWith("HTTP_") ? `${t(lang, "errFetch")} (${e.message})` : e.message === "PARSE_FAILED" || e.message.includes("PARSE_FAILED") ? t(lang, "errParse") : `${t(lang, "errFetch")} (${e.message})`;
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
      if (target && target !== input && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
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
        if (!await checkApiReady() && !await waitForApi(12e3)) {
          $("error").textContent = noApiMessage();
          $("error").hidden = false;
          return;
        }
        await scanWallet();
      })();
    },
    true
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
  if (location.protocol.startsWith("http") && (location.hostname === "127.0.0.1" || location.hostname === "localhost") && location.port !== "5500") {
    location.replace(
      "http://127.0.0.1:5500/index.html" + (location.search || "") + (location.hash || "")
    );
    return;
  }
  const ok = await waitForApi(15e3);
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
    checkApiReady().then((ok) => {
      if (!ok) return;
      const cached = loadCache(w);
      if (cached) {
        applyPortfolio({ ...cached, _cached: true, partial: false }, w);
        showResults();
        render();
        backgroundEnrich(w, { refresh: false });
        return;
      }
      scanWallet();
    });
  }
}
init();
