/**
 * Убрать синтетические доборы DeBank, дубли LP и кошелька; починить chain=unknown.
 */
import { chainSlug } from "./chains.js";
import { normalizeChain, poolPairKey } from "./revert-match.js";

function roundUsd(n) {
  return Math.round((n || 0) * 100) / 100;
}

/** Синтетический добор DeBank (не реальная LP-позиция). */
export function isSyntheticLiquidityRow(p, protocol) {
  if (!p) return true;
  const proto = String(protocol || "");
  if (proto.startsWith("DeBank ·") || proto === "DeBank") return true;
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
  const pair = String(p.pair || poolPairKey(p) || "")
    .trim()
    .toLowerCase();
  if (pair && pair.includes("+")) {
    return `${protocol}|${chainSlug(p.chain)}|${pair}`;
  }
  const pid = String(p.poolId || pair || "")
    .trim()
    .toLowerCase();
  return `${protocol}|${chainSlug(p.chain)}|${pid}`;
}

/** Схлопнуть дубли с той же парой и близким USD (main + chain page). */
function collapseNearDuplicateLiquidity(portfolio) {
  const winners = new Map();
  for (const g of portfolio.protocolGroups || []) {
    for (const p of g.liquidity || []) {
      if (isSyntheticLiquidityRow(p, g.protocol)) continue;
      const pair = String(p.pair || poolPairKey(p) || "")
        .trim()
        .toLowerCase();
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
      const pair = String(p.pair || poolPairKey(p) || "")
        .trim()
        .toLowerCase();
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

/** Одна lending-позиция на протокол/сеть. */
export function dedupeLendingPositions(portfolio) {
  if (!portfolio?.protocolGroups) return portfolio;
  const winners = new Map();
  for (const g of portfolio.protocolGroups) {
    for (const p of g.lending || []) {
      if (p.debankFill) continue;
      const sk = lendingSoftKey(g.protocol, p);
      const prev = winners.get(sk);
      if (!prev) {
        winners.set(sk, { g, p });
        continue;
      }
      const score = (x) =>
        (x.p.healthFactor != null ? 2 : 0) + (chainSlug(x.p.chain) !== "unknown" ? 1 : 0);
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

/** Удалить фейковые «DeBank · Base» и debankFill. */
export function stripSyntheticDebankFills(portfolio) {
  if (!portfolio?.protocolGroups) return portfolio;
  for (const g of portfolio.protocolGroups) {
    if (String(g.protocol || "").startsWith("DeBank ·")) {
      g.liquidity = [];
      g.lending = [];
      g.protocolUsd = 0;
      continue;
    }
    g.liquidity = (g.liquidity || []).filter((p) => !isSyntheticLiquidityRow(p, g.protocol));
    g.lending = (g.lending || []).filter((p) => !p.debankFill);
  }
  portfolio.protocolGroups = portfolio.protocolGroups.filter(
    (g) =>
      g.protocol === "Wallet" ||
      (g.liquidity || []).length ||
      (g.lending || []).length ||
      (g.walletTokens || []).length,
  );
  return portfolio;
}

/** Один пул — одна запись (лучшая по обогащению). */
export function dedupeLiquidityPositions(portfolio) {
  if (!portfolio?.protocolGroups) return portfolio;
  const winners = new Map();

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

/** unknown → сеть из пулов; слить группы с одним protocol|chain. */
export function fixProtocolGroupChains(portfolio) {
  if (!portfolio?.protocolGroups) return portfolio;
  for (const g of portfolio.protocolGroups) {
    if (g.protocol === "Wallet") continue;
    const chains = (g.liquidity || [])
      .map((p) => chainSlug(p.chain))
      .filter((c) => c && c !== "unknown");
    if ((!g.chain || g.chain === "unknown") && chains.length) {
      const freq = new Map();
      for (const c of chains) freq.set(c, (freq.get(c) || 0) + 1);
      g.chain = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
    for (const p of g.liquidity || []) {
      if (!p.chain || p.chain === "unknown") {
        if (g.chain && g.chain !== "unknown") p.chain = g.chain;
      }
    }
  }

  const merged = new Map();
  const wallet = portfolio.protocolGroups.find((g) => g.protocol === "Wallet");
  for (const g of portfolio.protocolGroups) {
    if (g.protocol === "Wallet") continue;
    const ch = g.chain || "unknown";
    const k = `${g.protocol}\0${ch}`;
    if (!merged.has(k)) {
      merged.set(k, { ...g, kinds: [...(g.kinds || [])] });
      continue;
    }
    const t = merged.get(k);
    t.liquidity.push(...(g.liquidity || []));
    t.lending.push(...(g.lending || []));
    for (const kind of g.kinds || []) {
      if (!t.kinds.includes(kind)) t.kinds.push(kind);
    }
  }

  let groups = [...merged.values()];

  const byProtocol = new Map();
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
        target.liquidity.push(...(u.liquidity || []));
        target.lending.push(...(u.lending || []));
        for (const kind of u.kinds || []) {
          if (!target.kinds.includes(kind)) target.kinds.push(kind);
        }
      }
      const liqBy = new Map();
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

/** Кошелёк: одна строка на chain+symbol (крупнейшая USD при дубле парсера). */
export function dedupeWalletTokens(portfolio) {
  const list = portfolio.walletTokens || [];
  if (!list.length) return portfolio;
  const byKey = new Map();
  for (const t of list) {
    const ch = chainSlug(t.chain || "unknown");
    t.chain = ch;
    const k = `${ch}:${String(t.symbol || "").toUpperCase()}`;
    const prev = byKey.get(k);
    if (!prev || (t.usd || 0) > (prev.usd || 0)) byKey.set(k, { ...t });
  }
  portfolio.walletTokens = [...byKey.values()].sort((a, b) => (b.usd || 0) - (a.usd || 0));
  const walletByChain = {};
  for (const t of portfolio.walletTokens) {
    const c = t.chain || "unknown";
    if (!walletByChain[c]) walletByChain[c] = [];
    walletByChain[c].push(t);
  }
  portfolio.walletByChain = walletByChain;
  const wg = portfolio.protocolGroups?.find((g) => g.protocol === "Wallet");
  if (wg) wg.walletTokens = portfolio.walletTokens;
  return portfolio;
}

export function dedupePortfolioPositions(portfolio) {
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
