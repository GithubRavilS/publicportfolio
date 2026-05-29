import { COINGECKO_IDS } from "./onchain-registry.js";

const cache = new Map();
const CACHE_MS = 120_000;

export async function fetchPricesUsd(symbols) {
  const need = [...new Set(symbols.map((s) => String(s).toUpperCase()))].filter(
    (s) => s && !cache.has(s),
  );
  const ids = [];
  const symToId = {};
  for (const sym of need) {
    let id = COINGECKO_IDS[sym];
    if (!id && (sym === "CBBTC" || sym === "WBTC")) id = COINGECKO_IDS.BTC;
    if (id) {
      ids.push(id);
      symToId[sym] = id;
    }
  }
  if (need.some((s) => s === "CBBTC" || s === "WBTC") && !ids.includes(COINGECKO_IDS.BTC)) {
    ids.push(COINGECKO_IDS.BTC);
    symToId._btcRef = COINGECKO_IDS.BTC;
  }
  if (ids.length) {
    try {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`;
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      const j = await r.json();
      const now = Date.now();
      for (const [sym, id] of Object.entries(symToId)) {
        if (sym === "_btcRef") continue;
        const px = j[id]?.usd;
        if (px != null) cache.set(sym, { px, at: now });
      }
      const btcPx = j[COINGECKO_IDS.BTC]?.usd;
      if (btcPx != null) {
        for (const s of ["CBBTC", "WBTC", "TBTC"]) cache.set(s, { px: btcPx, at: now });
      }
    } catch {
      /* */
    }
  }
  const out = {};
  const now = Date.now();
  for (const sym of symbols) {
    const s = String(sym).toUpperCase();
    const c = cache.get(s);
    if (c && now - c.at < CACHE_MS) out[s] = c.px;
    else if (s === "USDC" || s === "USDT" || s === "DAI" || s === "GHO" || s === "RLUSD")
      out[s] = 1;
    else if (s === "CBBTC" || s === "WBTC" || s === "TBTC") {
      const btc = cache.get("BTC")?.px ?? cache.get("ETH")?.px;
      if (btc != null) out[s] = btc;
    }
  }
  return out;
}

export function usdValue(amount, symbol, prices) {
  const px = prices[String(symbol).toUpperCase()];
  if (px == null || !Number.isFinite(amount)) return 0;
  return amount * px;
}
