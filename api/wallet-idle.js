/**
 * Idle wallet assets (spot tokens not in DeFi) for public portfolio capital.
 * EVM: Debank profile via Jina markdown. Solana: native SOL balance.
 */

const JINA_HEADERS = {
  Accept: "text/plain",
  "User-Agent": "publicportfolio-wallet-idle/1.0",
};

function parseUsdLine(s) {
  const m = String(s || "")
    .trim()
    .match(/^\$([\d,]+(?:\.\d+)?)$/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Debank: блок Wallet → `$141` перед Token. */
function parseDebankWalletIdleUsd(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  let best = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== "Wallet") continue;
    let found = null;
    for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
      const t = lines[j].trim();
      if (!t) continue;
      if (t === "Token" || t === "Lending" || t === "Liquidity Pool") break;
      const usd = parseUsdLine(t);
      if (usd != null) {
        found = usd;
        break;
      }
    }
    if (found != null && found > best) best = found;
  }
  return best;
}

async function fetchDebankWalletIdle(wallet) {
  const w = String(wallet || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(w)) return { usd: 0, source: "invalid_evm" };
  const url = `https://r.jina.ai/https://debank.com/profile/${w}`;
  const res = await fetch(url, { headers: JINA_HEADERS, cache: "no-store" });
  if (!res.ok) return { usd: 0, error: `jina_${res.status}` };
  const text = await res.text();
  if (text.length < 800) return { usd: 0, error: "debank_page_short" };
  const usd = parseDebankWalletIdleUsd(text);
  return { usd, source: "debank-jina", chars: text.length };
}

async function fetchSolanaIdleUsd(wallet) {
  const w = String(wallet || "").trim();
  if (!w || w.startsWith("0x")) return { usd: 0 };
  try {
    const balRes = await fetch("https://api.mainnet-beta.solana.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [w],
      }),
      cache: "no-store",
    });
    const balJson = await balRes.json();
    const lamports = Number(balJson?.result?.value || 0);
    const sol = lamports / 1e9;
    if (!(sol > 0)) return { usd: 0, sol: 0 };
    const pxRes = await fetch(
      "https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT",
      { cache: "no-store" }
    );
    const pxJson = await pxRes.json();
    const px = Number(pxJson?.price || 0);
    const usd = px > 0 ? sol * px : 0;
    return { usd, sol, price: px, source: "solana-rpc" };
  } catch (err) {
    return { usd: 0, error: String(err?.message || err) };
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ error: "GET only" });
    return;
  }

  const evm =
    String(req.query?.wallet || req.query?.evm || "").trim() ||
    "0x1fb07ac5643428710ee3bf5a73a4a66d0762f355";
  const sol = String(req.query?.solana || req.query?.sol || "").trim();

  try {
    const [evmIdle, solIdle] = await Promise.all([
      fetchDebankWalletIdle(evm),
      sol ? fetchSolanaIdleUsd(sol) : Promise.resolve({ usd: 0 }),
    ]);
    const walletIdleUsd =
      Math.round((Number(evmIdle.usd || 0) + Number(solIdle.usd || 0)) * 100) / 100;
    res.status(200).json({
      walletIdleUsd,
      evmUsd: Math.round(Number(evmIdle.usd || 0) * 100) / 100,
      solanaUsd: Math.round(Number(solIdle.usd || 0) * 100) / 100,
      evm,
      solana: sol || null,
      sources: {
        evm: evmIdle.source || evmIdle.error || null,
        solana: solIdle.source || solIdle.error || null,
      },
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err), walletIdleUsd: 0 });
  }
}
