/**
 * Нормализация в единую модель для клиента + дедупликация.
 */

function isEvmAddress(s) {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

/** Грубая эвристика Solana base58 */
function isLikelySolana(s) {
  if (isEvmAddress(s)) return false;
  if (s.length < 32 || s.length > 48) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
}

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function pickHealthFactor(detail) {
  if (!detail || typeof detail !== "object") return null;
  const keys = ["health_rate", "health_factor", "healthFactor", "health_ratio", "healthRate"];
  for (const k of keys) {
    const v = num(detail[k]);
    if (v !== null && v > 0) return v;
  }
  const nested = detail.health_factor ?? detail.healthFactor;
  return num(nested);
}

function collateralMarkPrice(detail) {
  const list =
    detail?.supply_token_list || detail?.collateral_token_list || detail?.token_list || [];
  if (!Array.isArray(list) || !list.length) return null;
  const withPrice = list.filter((t) => num(t?.price) > 0);
  if (!withPrice.length) return null;
  withPrice.sort(
    (a, b) => (num(b.amount) * num(b.price) || 0) - (num(a.amount) * num(a.price) || 0),
  );
  return num(withPrice[0].price);
}

function liquidationHintFromDebankItem(item) {
  const detail = item?.detail;
  const hf = pickHealthFactor(detail);
  const px = collateralMarkPrice(detail);
  if (!hf || !px) return null;
  return { healthFactor: hf, markPriceUsd: px, liquidationPriceUsd: px / hf };
}

function classifyDebankItem(item) {
  const types = item?.detail_types || item?.detail?.types || [];
  const name = String(item?.name || "").toLowerCase();
  const joined = [...(Array.isArray(types) ? types : []), name].join(" ");
  if (
    joined.includes("lending") ||
    joined.includes("borrow") ||
    joined.includes("loan") ||
    joined.includes("aave") ||
    name.includes("lend")
  ) {
    return "lending";
  }
  if (
    joined.includes("liquidity") ||
    joined.includes("amm") ||
    joined.includes("dex") ||
    name.includes("pool") ||
    name.includes("lp")
  ) {
    return "liquidity";
  }
  return "other";
}

function stableKeyDebank(chain, protocolId, item) {
  const pool =
    item?.detail?.pool_id ||
    item?.detail?.pool?.id ||
    item?.detail?.position_id ||
    item?.id ||
    item?.name;
  const dt = (item?.detail_types || []).join(",");
  return `debank:${chain}:${protocolId}:${dt}:${pool}`;
}

function mapDebankComplex(complexList) {
  if (!Array.isArray(complexList)) return [];
  const out = [];
  for (const proto of complexList) {
    const protocolId = proto?.id || "";
    const chain = proto?.chain || "";
    const items = proto?.portfolio_item_list || [];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const cat = classifyDebankItem(item);
      const stats = item?.stats || {};
      const net = num(stats.net_usd_value);
      const asset = num(stats.asset_usd_value);
      const debt = num(stats.debt_usd_value);
      const liq = liquidationHintFromDebankItem(item);
      out.push({
        source: "debank",
        category: cat,
        dedupeKey: stableKeyDebank(chain, protocolId, item),
        chain,
        protocolId,
        protocolName: proto?.name || protocolId,
        protocolLogo: proto?.logo_url || null,
        positionName: item?.name || null,
        netUsd: net,
        assetUsd: asset,
        debtUsd: debt,
        liquidationHint: liq,
        raw: item,
      });
    }
  }
  return out;
}

function mapKrystal(positions, status) {
  if (!Array.isArray(positions)) return [];
  return positions.map((p) => {
    const chainId = p?.chainId ?? p?.chain_id;
    const id = p?.id || p?.positionId || "";
    const pool = p?.pool || {};
    const token0 = pool?.token0?.symbol || "?";
    const token1 = pool?.token1?.symbol || "?";
    const pair = `${token0}/${token1}`;
    const dedupeKey = `krystal:${chainId}:${id}:${pair}`;
    const invested = num(p?.initialUSD) ?? num(p?.depositedUSD);
    const current = num(p?.currentUSD) ?? num(p?.liquidityUSD);
    let apy = num(p?.apr) ?? num(p?.farmApr);
    if (apy !== null && apy < 1) apy *= 100;
    return {
      source: "krystal",
      category: "liquidity",
      dedupeKey,
      chain: String(chainId ?? ""),
      protocolId: String(p?.protocol || p?.dexId || "krystal"),
      protocolName: String(p?.protocol || "Krystal"),
      protocolLogo: p?.protocolLogo || null,
      positionName: pair,
      pair,
      status,
      netUsd: current,
      investedUsd: invested,
      currentUsd: current,
      apyPercent: apy,
      raw: p,
    };
  });
}

function mapDebankTokens(tokenList) {
  if (!Array.isArray(tokenList)) return [];
  const out = [];
  for (const t of tokenList) {
    const chain = t?.chain || "";
    const id = t?.id || "";
    const usd = num(t?.usd_value ?? t?.amount * t?.price);
    const amt = num(t?.amount);
    if (!id && !t?.symbol) continue;
    if ((usd === null || usd <= 0) && (amt === null || amt <= 0)) continue;
    out.push({
      source: "debank",
      category: "wallet",
      dedupeKey: `debank:token:${chain}:${id}`,
      chain,
      protocolId: "wallet",
      protocolName: "Wallet",
      protocolLogo: t?.logo_url || null,
      positionName: t?.symbol || t?.name || id.slice(0, 10),
      netUsd: usd,
      amount: amt,
      raw: t,
    });
  }
  out.sort((a, b) => (num(b.netUsd) || 0) - (num(a.netUsd) || 0));
  return out;
}

function mapJupiter(holdingsJson) {
  if (!holdingsJson || typeof holdingsJson !== "object") return [];
  const tokens = holdingsJson.tokens || holdingsJson.accounts || [];
  const arr = Array.isArray(tokens) ? tokens : [];
  const out = [];
  for (const t of arr) {
    const mint = t?.mint || t?.address || "";
    const amt = num(t?.uiAmount ?? t?.amount);
    const usd = num(t?.valueUsd ?? t?.usdValue);
    if (!mint) continue;
    out.push({
      source: "jupiter",
      category: "wallet_token",
      dedupeKey: `jupiter:sol:${mint}`,
      chain: "solana",
      protocolId: "spl-token",
      protocolName: "SPL",
      positionName: t?.symbol || mint.slice(0, 8),
      netUsd: usd,
      amount: amt,
      raw: t,
    });
  }
  return out;
}

function mergeDedupe(rows) {
  const map = new Map();
  for (const r of rows) {
    const k = r.dedupeKey;
    if (!k) continue;
    const prev = map.get(k);
    if (!prev) {
      map.set(k, { ...r, sources: [r.source] });
      continue;
    }
    const prefer = r.source === "debank" ? r : prev.source === "debank" ? prev : r;
    const nv = Math.max(num(prev.netUsd) || 0, num(r.netUsd) || 0);
    map.set(k, {
      ...prefer,
      netUsd: nv || num(r.netUsd) || num(prev.netUsd),
      sources: [...new Set([...(prev.sources || []), r.source])],
    });
  }
  return [...map.values()];
}

export function buildAggregatePayload(wallet, parts) {
  const evm = isEvmAddress(wallet);
  const sol = isLikelySolana(wallet);

  const debankRows = evm && parts.debank ? mapDebankComplex(parts.debank.complexList) : [];
  const debankWallet = evm && parts.debank ? mapDebankTokens(parts.debank.tokenList) : [];
  const krystalOpen = evm && parts.krystalOpen ? mapKrystal(parts.krystalOpen, "OPEN") : [];
  const krystalClosed = evm && parts.krystalClosed ? mapKrystal(parts.krystalClosed, "CLOSED") : [];
  const jupRows = sol && parts.jupiter ? mapJupiter(parts.jupiter) : [];

  const liquidityPool = [...debankRows, ...krystalOpen, ...krystalClosed].filter(
    (x) => x.category === "liquidity",
  );
  const lendingPool = debankRows.filter((x) => x.category === "lending");
  const other = [...debankRows.filter((x) => x.category === "other"), ...jupRows];

  const mergedLiq = mergeDedupe(liquidityPool);
  const mergedLend = mergeDedupe(lendingPool);

  const totalUsdEvm = parts.debank?.totalBalance?.total_usd_value ?? null;
  let totalSolUsd = null;
  if (sol && parts.jupiter && typeof parts.jupiter === "object") {
    totalSolUsd = num(parts.jupiter.totalUsd) ?? num(parts.jupiter.totalValueUsd);
    const tok = parts.jupiter.tokens || parts.jupiter.accounts;
    if (totalSolUsd === null && Array.isArray(tok)) {
      totalSolUsd = tok.reduce((s, t) => s + (num(t?.valueUsd ?? t?.usdValue) || 0), 0);
    }
  }

  let combinedUsd = null;
  if (totalUsdEvm != null || totalSolUsd != null) {
    combinedUsd = (totalUsdEvm || 0) + (totalSolUsd || 0);
  }

  const chartPoints = [];
  if (evm && Array.isArray(parts.debank?.netCurve)) {
    for (const pt of parts.debank.netCurve) {
      const ts = num(pt.timestamp);
      const v = num(pt.usd_value);
      if (ts !== null && v !== null) chartPoints.push({ t: Math.floor(ts), v });
    }
    chartPoints.sort((a, b) => a.t - b.t);
  }

  return {
    wallet,
    walletType: evm ? "evm" : sol ? "solana" : "unknown",
    fetchedAt: Date.now(),
    totals: {
      debankUsd: totalUsdEvm,
      solanaJupiterUsd: totalSolUsd,
      combinedUsd,
    },
    chart: {
      source: "debank_total_net_curve",
      points: chartPoints,
    },
    tabs: {
      wallet: mergeDedupe([
        ...debankWallet,
        ...jupRows.filter((x) => x.category === "wallet_token"),
      ]),
      liquidity: mergedLiq,
      lending: mergedLend,
      other: mergeDedupe(other),
    },
    sources: {
      debank: !!parts.debank,
      krystal: !!(parts.krystalOpen || parts.krystalClosed),
      jupiter: !!parts.jupiter,
      revert: false,
    },
    warnings: [
      !parts.debank && evm ? "DeBank: нет DEBANK_ACCESS_KEY в .env агрегатора" : null,
      !parts.krystalOpen && !parts.krystalClosed && evm
        ? "Krystal: нет KRYSTAL_CLOUD_API_KEY"
        : null,
      !parts.jupiter && sol ? "Jupiter: нет JUPITER_API_KEY (portal.jup.ag)" : null,
      "Revert.finance: публичного API нет — позиции Revert пока не подтягиваются (можно добавить subgraph по договорённости).",
    ].filter(Boolean),
  };
}

export { isEvmAddress, isLikelySolana };
