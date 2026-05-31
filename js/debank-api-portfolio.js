/**
 * DeBank OpenAPI → наш portfolio schema (1:1 с debank.com).
 */
import { chainSlug } from "./chains.js";
import { buildProtocolGroups } from "./debank-parse.js";
import { primaryCollateralMarketPrice, liquidationPriceFromHealth } from "./lending-metrics.js";
import { fetchDebankBundle } from "./debank-api.js";

const DUST = 0.01;

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function roundUsd(n) {
  return Math.round((n || 0) * 100) / 100;
}

function tokenSide(list) {
  return (list || []).map((t) => ({
    asset: t.symbol || t.optimized_symbol || t.display_symbol || "?",
    amount: String(t.amount ?? ""),
    usd: num(t.amount) * num(t.price) || num(t.usd_value),
  }));
}

function inPoolFromTokens(list) {
  return (list || []).map((t) => ({
    symbol: t.symbol || t.optimized_symbol || "?",
    amount: String(t.amount ?? ""),
  }));
}

function classifyItem(item) {
  const types = (item?.detail_types || []).map((x) => String(x).toLowerCase());
  const joined = types.join(" ");
  const name = String(item?.name || "").toLowerCase();
  const blob = `${joined} ${name}`;
  if (/lending|borrow|loan|aave|lend/.test(blob)) return "lending";
  if (item?.detail?.borrow_token_list?.length) return "lending";
  if (/liquidity|amm|dex|pool|lp|farming|yield|vesting|locked|deposit|common|staked/.test(blob)) {
    return "liquidity";
  }
  if (item?.detail?.supply_token_list?.length >= 2 && item?.detail?.pool) return "liquidity";
  return "liquidity";
}

function pairFromItem(item) {
  const syms = (item?.detail?.supply_token_list || [])
    .map((t) => t.symbol || t.optimized_symbol)
    .filter(Boolean);
  if (syms.length >= 2) return `${syms[0]}+${syms[1]}`;
  if (item?.name && /\+/.test(item.name)) return item.name;
  if (syms.length === 1) return syms[0];
  return item?.name || "Pool";
}

function poolIdFromItem(item, pair) {
  const pool = item?.detail?.pool?.id || item?.pool?.id;
  const nft = item?.detail?.position_index ?? item?.detail?.token_id ?? item?.detail?.nft_id;
  if (nft != null) return `${pair} #${nft}`;
  if (pool) return String(pool).slice(0, 42);
  return pair;
}

function itemToLending(protocol, chain, item) {
  const detail = item?.detail || {};
  const supplied = tokenSide(detail.supply_token_list || detail.collateral_token_list);
  const borrowed = tokenSide(detail.borrow_token_list);
  const rewards = tokenSide(detail.reward_token_list);
  const collateralUsd = num(item?.stats?.asset_usd_value);
  const debtUsd = num(item?.stats?.debt_usd_value);
  const netUsd = num(item?.stats?.net_usd_value);
  const hf =
    num(detail.health_rate) || num(detail.health_factor) || num(detail.healthFactor) || null;
  const marketPrice = primaryCollateralMarketPrice(supplied);
  const liquidationPrice = liquidationPriceFromHealth({
    healthFactor: hf,
    supplied,
    marketPrice,
  });
  return {
    protocol,
    chain,
    healthFactor: hf,
    supplied,
    borrowed,
    rewards,
    rewardsUsd: rewards.reduce((s, x) => s + x.usd, 0),
    collateralUsd,
    debtUsd,
    netUsd,
    marketPrice,
    liquidationPrice,
    fromDebankApi: true,
  };
}

function itemToLiquidity(protocol, chain, item) {
  const detail = item?.detail || {};
  const types = (item?.detail_types || []).map((x) => String(x).toLowerCase());
  const pair = pairFromItem(item);
  const kind = types.some((t) => /farm|yield|reward|vest|stak/.test(t))
    ? "Farming"
    : "Liquidity Pool";
  const inPool = inPoolFromTokens(detail.supply_token_list);
  const claimable = tokenSide(detail.reward_token_list);
  return {
    protocol,
    chain,
    poolId: poolIdFromItem(item, pair),
    pair,
    inPool,
    positionUsd: num(item?.stats?.net_usd_value) || num(item?.stats?.asset_usd_value),
    claimable,
    claimableUsd: claimable.reduce((s, x) => s + x.usd, 0),
    netUsd: num(item?.stats?.net_usd_value),
    kind,
    feeTier: detail.fee_rate != null ? String(detail.fee_rate) : undefined,
    fromDebankApi: true,
  };
}

/** @param {object} bundle — fetchDebankBundle result */
export function portfolioFromDebankBundle(bundle, { showSmallBalances = false } = {}) {
  const debankTotalUsd = num(bundle?.totalBalance?.total_usd_value);
  const chainList = bundle?.totalBalance?.chain_list || [];

  const chains = chainList
    .map((c) => ({
      slug: chainSlug(c.id),
      name: c.name || c.id,
      usd: num(c.usd_value),
      pct: debankTotalUsd > 0 ? roundUsd((num(c.usd_value) / debankTotalUsd) * 100) : null,
    }))
    .filter((c) => c.usd > 0)
    .sort((a, b) => b.usd - a.usd);

  const walletTokens = (bundle?.tokenList || [])
    .filter((t) => showSmallBalances || num(t.usd_value) >= DUST)
    .map((t) => ({
      symbol: t.symbol || t.optimized_symbol || t.display_symbol || "?",
      amount: String(t.amount ?? ""),
      usd: num(t.usd_value),
      chain: chainSlug(t.chain),
      price: t.price != null ? `$${t.price}` : "",
      fromDebankApi: true,
    }))
    .sort((a, b) => b.usd - a.usd);

  const walletByChain = {};
  for (const t of walletTokens) {
    if (!walletByChain[t.chain]) walletByChain[t.chain] = [];
    walletByChain[t.chain].push(t);
  }

  const lending = [];
  const liquidity = [];
  const protocolTabs = [];
  const walletTabUsd = walletTokens.reduce((s, t) => s + t.usd, 0);
  if (walletTabUsd > 0) protocolTabs.push({ protocol: "Wallet", usd: roundUsd(walletTabUsd) });

  for (const proto of bundle?.complexList || []) {
    const protocol = proto.name || proto.id || "Protocol";
    const chain = chainSlug(proto.chain);
    let tabUsd = 0;
    for (const item of proto.portfolio_item_list || []) {
      const net = num(item?.stats?.net_usd_value);
      if (net < DUST && !showSmallBalances) continue;
      tabUsd += net;
      const cat = classifyItem(item);
      if (cat === "lending") lending.push(itemToLending(protocol, chain, item));
      else liquidity.push(itemToLiquidity(protocol, chain, item));
    }
    if (tabUsd >= DUST) protocolTabs.push({ protocol, usd: roundUsd(tabUsd) });
  }

  protocolTabs.sort((a, b) => b.usd - a.usd);
  const protocolGroups = buildProtocolGroups(lending, liquidity, walletTokens, protocolTabs);

  const walletUsd = roundUsd(walletTabUsd);
  const liqUsd = roundUsd(liquidity.reduce((s, p) => s + (p.netUsd ?? p.positionUsd ?? 0), 0));
  const lendUsd = roundUsd(lending.reduce((s, p) => s + (p.netUsd || 0), 0));
  const computedTotalUsd = roundUsd(walletUsd + liqUsd + lendUsd);
  const coverageGapUsd = roundUsd(Math.max(0, debankTotalUsd - computedTotalUsd));

  return {
    totalUsd: debankTotalUsd || computedTotalUsd,
    debankTotalUsd,
    computedTotalUsd,
    coverageGapUsd,
    overCountUsd:
      computedTotalUsd > debankTotalUsd ? roundUsd(computedTotalUsd - debankTotalUsd) : 0,
    partial: coverageGapUsd > Math.max(1, debankTotalUsd * 0.02),
    walletUsd,
    liqUsd,
    lendUsd,
    chains,
    protocolTabs,
    protocolGroups,
    walletTokens,
    walletByChain,
    lending,
    liquidity,
    fromDebankApi: true,
    source: "debank-api",
    netCurve: bundle?.netCurve || null,
    hasSmallBalanceHint: (bundle?.tokenList || []).some(
      (t) => num(t.usd_value) > 0 && num(t.usd_value) < DUST,
    ),
  };
}

/** @param {string} wallet @param {string} accessKey */
export async function buildPortfolioFromDebankApi(wallet, accessKey, opts = {}) {
  const bundle = await fetchDebankBundle(wallet, accessKey);
  return portfolioFromDebankBundle(bundle, opts);
}
