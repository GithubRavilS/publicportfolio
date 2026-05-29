/** Логотипы и цвета протоколов (DeFiLlama icons + fallback) */
const PROTO = {
  Wallet: { slug: "wallet", color: "#fbbf24", emoji: "◇" },
  "GMX V2": { slug: "gmx", color: "#4f46e5" },
  Hyperliquid: { slug: "hyperliquid", color: "#97fce4" },
  "Uniswap V3": { slug: "uniswap", color: "#ff007a" },
  "Uniswap V4": { slug: "uniswap", color: "#ff007a" },
  Beefy: { slug: "beefy", color: "#f9f4e8" },
  "PancakeSwap V3": { slug: "pancakeswap", color: "#d1884f" },
  "Aerodrome V3": { slug: "aerodrome", color: "#0052ff" },
  "Pendle V2": { slug: "pendle", color: "#1e88e5" },
  "Compound V3": { slug: "compound", color: "#00d395" },
};

function escAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/** TVL-порядок на вкладке «Ликвидность». */
const LIQ_PROTOCOL_RANK = {
  "Uniswap V3": 10,
  "Uniswap V4": 20,
  "PancakeSwap V3": 30,
  "Aerodrome V3": 40,
};

export function protocolLiquidityRank(name) {
  const n = String(name || "");
  if (LIQ_PROTOCOL_RANK[n] != null) return LIQ_PROTOCOL_RANK[n];
  const low = n.toLowerCase();
  if (low.includes("uniswap v3")) return 10;
  if (low.includes("uniswap v4")) return 20;
  if (low.includes("pancake")) return 30;
  if (low.includes("aerodrome")) return 40;
  return 500;
}

export function compareLiquidityProtocols(a, b, usdA = 0, usdB = 0) {
  const ra = protocolLiquidityRank(a);
  const rb = protocolLiquidityRank(b);
  if (ra !== rb) return ra - rb;
  return usdB - usdA;
}

export function protocolMeta(name) {
  const n = String(name || "");
  if (PROTO[n]) return { ...PROTO[n], name: n };
  const key = Object.keys(PROTO).find((k) => k.toLowerCase() === n.toLowerCase());
  if (key) return { ...PROTO[key], name: n };
  return {
    name: n,
    slug: n.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    color: "#6b7cff",
  };
}

export function protocolLogoHtml(name, size = 24) {
  const m = protocolMeta(name);
  if (m.emoji) {
    return `<span class="proto-logo proto-logo--emoji" style="width:${size}px;height:${size}px;background:${m.color}">${m.emoji}</span>`;
  }
  const urls = [
    `https://icons.llama.fi/${m.slug}.png`,
    `https://static.debank.com/image/project/logo_url/${m.slug}/${m.slug}.png`,
  ];
  return `<span class="proto-logo-wrap" style="width:${size}px;height:${size}px">
    <img class="proto-logo" src="${escAttr(urls[0])}" data-fallbacks="${escAttr(urls.join("|"))}" alt="" width="${size}" height="${size}" loading="lazy" onerror="ptProtoImgFallback(this)" />
    <span class="proto-logo-fallback" style="background:${m.color}">${escAttr(m.name.slice(0, 1))}</span>
  </span>`;
}

if (typeof window !== "undefined") {
  window.ptProtoImgFallback = function (img) {
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
