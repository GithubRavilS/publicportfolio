/** Сети DeBank (slug для ?chain=) */
export const CHAINS = {
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
    color: "#97fce4",
  },
};

const ALIASES = {
  ethereum: "eth",
  optimism: "op",
  arbitrum: "arb",
  polygon: "matic",
  avalanche: "avax",
  "gnosis chain": "gnosis",
  bnb: "bsc",
  "bnb chain": "bsc",
};

/** DeBank CDN + TrustWallet fallback */
const LOGO_DEBANK = {
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
  hyperliquid: "hyperliquid",
};

const LOGO_TRUST = {
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
  blast: "blast",
};

export function chainSlug(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (CHAINS[s]) return s;
  if (ALIASES[s]) return ALIASES[s];
  if (s === "op" || s === "optimism") return "op";
  if (s === "ethereum" || s === "eth") return "eth";
  if (s === "arbitrum" || s === "arb") return "arb";
  if (s === "polygon" || s === "matic") return "matic";
  if (s === "bnb" || s === "bsc") return "bsc";
  return s || "unknown";
}

export function chainLabel(slug, lang) {
  const c = CHAINS[slug];
  if (!c) return String(slug || "—").toUpperCase();
  return c.label[lang] || c.label.en;
}

export function chainColor(slug) {
  return CHAINS[slug]?.color || "#6b7cff";
}

export function slugFromHeaderName(name) {
  const n = String(name || "").trim();
  if (n === "OP") return "op";
  if (n === "Base") return "base";
  if (n === "Hyperliquid") return "hyperliquid";
  if (n === "HyperEVM") return "hyperevm";
  if (n === "BNB Chain") return "bsc";
  if (n === "Arbitrum") return "arb";
  if (n === "Ethereum") return "eth";
  if (n === "Optimism") return "op";
  if (n === "Polygon") return "matic";
  if (n === "Avalanche") return "avax";
  return chainSlug(n);
}

/** Имя сети в таб-grid DeBank (не протокол). */
export function isDebankChainLabel(name) {
  const n = String(name || "").trim();
  if (!n || n === "Wallet") return false;
  const slug = slugFromHeaderName(n);
  if (!slug || slug === "unknown") return false;
  return Boolean(CHAINS[slug]) || Boolean(ALIASES[n.toLowerCase()]);
}

export function chainLogoUrls(slug) {
  const id = LOGO_DEBANK[slug] || slug;
  const tw = LOGO_TRUST[slug];
  const urls = [`https://static.debank.com/image/chain/chain_icon/${id}.png`];
  if (tw) {
    urls.push(
      `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${tw}/info/logo.png`,
    );
  }
  return urls;
}

/** Иконка сети: логотип + tooltip, уголок на токенах */
export function chainBadgeHtml(slug, size = 20, opts = {}) {
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
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

if (typeof window !== "undefined") {
  window.ptChainImgFallback = function (img) {
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
