#!/usr/bin/env node
/** stdin: portfolio JSON, argv[2]: wallet → stdout: portfolio with RPC wallet merge */
import { scanWalletBalances } from "../js/onchain-wallet.js";
import { syncDisplayTotals } from "../js/portfolio-normalize.js";
import { chainSlug } from "../js/chains.js";

const wallet = (process.argv[2] || "").trim().toLowerCase();
if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
  process.stderr.write("INVALID_WALLET\n");
  process.exit(1);
}

let portfolio = {};
try {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw) portfolio = JSON.parse(raw);
} catch (e) {
  process.stderr.write(`PARSE_FAIL:${e.message}\n`);
  process.exit(1);
}

const tabUsd = (portfolio.protocolTabs || []).find((t) => t.protocol === "Wallet")?.usd || 0;
const parsedUsd = (portfolio.walletTokens || []).reduce((s, t) => s + (t.usd || 0), 0);
const chains = (portfolio.chains || [])
  .map((c) => chainSlug(c.slug))
  .filter((s) => s && s !== "unknown");

if (tabUsd < 2 && parsedUsd < 2) {
  process.stdout.write(JSON.stringify(portfolio));
  process.exit(0);
}

const chainCount = new Set(
  (portfolio.walletTokens || []).map((t) => chainSlug(t.chain)).filter((c) => c !== "unknown"),
).size;
if (tabUsd > 0 && parsedUsd >= tabUsd * 0.9 && chainCount >= 2) {
  process.stdout.write(JSON.stringify(portfolio));
  process.exit(0);
}

const scanChains = chains.length ? chains : undefined;
const { walletTokens: rpcTokens, walletByChain } = await scanWalletBalances(wallet, scanChains);

const byKey = new Map();
for (const t of portfolio.walletTokens || []) {
  const k = `${chainSlug(t.chain)}:${String(t.symbol || "").toUpperCase()}`;
  byKey.set(k, { ...t, chain: chainSlug(t.chain) });
}
for (const t of rpcTokens || []) {
  const k = `${chainSlug(t.chain)}:${String(t.symbol || "").toUpperCase()}`;
  const prev = byKey.get(k);
  if (!prev || (t.usd || 0) > (prev.usd || 0)) {
    byKey.set(k, { ...t, chain: chainSlug(t.chain), source: "rpc" });
  }
}

portfolio.walletTokens = [...byKey.values()]
  .filter((t) => (t.usd || 0) >= 0.005)
  .sort((a, b) => (b.usd || 0) - (a.usd || 0));

portfolio.walletByChain = walletByChain;
for (const t of portfolio.walletTokens) {
  const ch = chainSlug(t.chain);
  if (!portfolio.walletByChain[ch]) portfolio.walletByChain[ch] = [];
  if (!portfolio.walletByChain[ch].some((x) => x.symbol === t.symbol)) {
    portfolio.walletByChain[ch].push(t);
  }
}

let wg = (portfolio.protocolGroups || []).find((g) => g.protocol === "Wallet");
if (!wg) {
  wg = {
    protocol: "Wallet",
    chain: "all",
    protocolUsd: 0,
    kinds: ["Wallet"],
    lending: [],
    liquidity: [],
    walletTokens: [],
    id: "Wallet|all",
  };
  portfolio.protocolGroups = [wg, ...(portfolio.protocolGroups || [])];
}
wg.walletTokens = portfolio.walletTokens;
wg.protocolUsd = portfolio.walletTokens.reduce((s, t) => s + (t.usd || 0), 0);

portfolio = syncDisplayTotals(portfolio);
process.stdout.write(JSON.stringify(portfolio));
