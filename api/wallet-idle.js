/**
 * Wallet idle + live EVM lending from Debank (Jina).
 * Solana idle: native SOL. Jupiter lending stays on the client from export/API.
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

function chainFromNearby(lines, idx) {
  for (let j = Math.max(0, idx - 8); j < Math.min(lines.length, idx + 3); j++) {
    const s = lines[j] || "";
    const m = s.match(/chain\/logo_url\/([a-z0-9]+)\//i);
    if (m) {
      const slug = m[1].toLowerCase();
      return { eth: "eth", op: "op", arb: "arb", base: "base", matic: "matic", bsc: "bsc" }[slug] || slug;
    }
    const m2 = s.match(/project\/logo_url\/([a-z0-9_]+)\//i);
    if (m2) {
      const proj = m2[1].toLowerCase();
      if (proj.startsWith("op_")) return "op";
      if (proj.startsWith("arb_")) return "arb";
      if (proj.startsWith("base_")) return "base";
    }
  }
  return "eth";
}

function tokenHint(lines, start, end) {
  for (let j = start; j < Math.min(end, lines.length); j++) {
    const s = lines[j] || "";
    if (/coin\/logo_url\/eth\//i.test(s) || /\/eth\//i.test(s)) return "ETH";
    if (/a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48/i.test(s)) return "USDC";
  }
  return "";
}

function parseDebankLending(markdown, wallet) {
  const lines = String(markdown || "").split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() !== "Lending") {
      i += 1;
      continue;
    }
    let protocol = "Unknown";
    for (let j = i - 1; j >= Math.max(0, i - 12); j--) {
      const t = lines[j].trim();
      if (!t || t.startsWith("![") || t.startsWith("[]") || t.startsWith("#")) continue;
      if (parseUsdLine(t) != null) continue;
      if (["Balance", "USD Value", "Supplied", "Borrowed"].includes(t)) continue;
      protocol = t;
      break;
    }
    let hf = 0;
    const hfLine = `${lines[i + 1] || ""} ${lines[i + 2] || ""}`;
    const hfM = hfLine.match(/Health Rate\s*(>?\s*[\d.]+)/i);
    if (hfM) {
      const raw = hfM[1].replace(">", "").trim();
      hf = Number(raw);
      if (!Number.isFinite(hf)) hf = hfM[0].includes(">") ? 25 : 0;
    }
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === "Lending" && j > i + 3) {
        end = j;
        break;
      }
    }
    let suppliedUsd = 0;
    let borrowedUsd = 0;
    let collAsset = "";
    let borrowAsset = "";
    let mode = null;
    for (let j = i + 1; j < end; j++) {
      const t = lines[j].trim();
      if (t === "Supplied") {
        mode = "sup";
        continue;
      }
      if (t === "Borrowed") {
        mode = "bor";
        continue;
      }
      if (t === "Lending") break;
      const usd = parseUsdLine(t);
      if (usd == null) continue;
      if (mode === "sup" && suppliedUsd <= 0 && usd >= 0.5) {
        suppliedUsd = usd;
        collAsset = tokenHint(lines, j - 4, j) || "ETH";
      } else if (mode === "bor" && borrowedUsd <= 0 && usd >= 0.5) {
        borrowedUsd = usd;
        borrowAsset = tokenHint(lines, j - 4, j) || "USDC";
      }
    }
    if (suppliedUsd >= 5 || borrowedUsd >= 5) {
      out.push({
        protocol,
        chain: chainFromNearby(lines, i),
        collateralAsset: collAsset || "ETH",
        collateralAmount: 0,
        collateralUsd: Math.round(suppliedUsd * 100) / 100,
        borrowAsset: borrowAsset || "USDC",
        borrowAmount: Math.round(borrowedUsd * 1e6) / 1e6,
        borrowUsd: Math.round(borrowedUsd * 100) / 100,
        supplied: [{ asset: collAsset || "ETH", amount: 0, usd: Math.round(suppliedUsd * 100) / 100 }],
        borrowed: borrowedUsd > 0
          ? [{ asset: borrowAsset || "USDC", amount: borrowedUsd, usd: Math.round(borrowedUsd * 100) / 100 }]
          : [],
        netUsd: Math.round((suppliedUsd - borrowedUsd) * 100) / 100,
        healthFactor: hf,
        link: wallet ? `https://debank.com/profile/${wallet}` : "https://debank.com",
        dataSource: "debank-jina",
      });
    }
    i = end < lines.length ? end : i + 1;
  }
  return out;
}

async function fetchDebankProfile(wallet) {
  const w = String(wallet || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(w)) return { usd: 0, lending: [], error: "invalid_evm" };
  const url = `https://r.jina.ai/https://debank.com/profile/${w}`;
  const res = await fetch(url, { headers: JINA_HEADERS, cache: "no-store" });
  if (!res.ok) return { usd: 0, lending: [], error: `jina_${res.status}` };
  const text = await res.text();
  if (text.length < 800) return { usd: 0, lending: [], error: "debank_page_short" };
  return {
    usd: parseDebankWalletIdleUsd(text),
    lending: parseDebankLending(text, w),
    source: "debank-jina",
    chars: text.length,
  };
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
    const [evmProfile, solIdle] = await Promise.all([
      fetchDebankProfile(evm),
      sol ? fetchSolanaIdleUsd(sol) : Promise.resolve({ usd: 0 }),
    ]);
    const walletIdleUsd =
      Math.round((Number(evmProfile.usd || 0) + Number(solIdle.usd || 0)) * 100) / 100;
    const lending = Array.isArray(evmProfile.lending) ? evmProfile.lending : [];
    const lendColl = lending.reduce((s, p) => s + Number(p.collateralUsd || 0), 0);
    const lendDebt = lending.reduce((s, p) => s + Number(p.borrowUsd || 0), 0);
    res.status(200).json({
      walletIdleUsd,
      evmUsd: Math.round(Number(evmProfile.usd || 0) * 100) / 100,
      solanaUsd: Math.round(Number(solIdle.usd || 0) * 100) / 100,
      lending,
      lendingCollateralUsd: Math.round(lendColl * 100) / 100,
      lendingDebtUsd: Math.round(lendDebt * 100) / 100,
      evm,
      solana: sol || null,
      sources: {
        evm: evmProfile.source || evmProfile.error || null,
        solana: solIdle.source || solIdle.error || null,
      },
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err), walletIdleUsd: 0, lending: [] });
  }
}
