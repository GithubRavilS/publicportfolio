/**
 * Сверка on-chain позиций протокола с DeBank / Revert.
 */
import { extractLpTokenId } from "./lp-onchain.js";

function roundUsd(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function sumUsd(rows, field = "positionUsd") {
  return roundUsd(rows.reduce((s, r) => s + (r[field] ?? r.netUsd ?? r.positionUsd ?? 0), 0));
}

/** @param {object} portfolio @param {RegExp[]} patterns */
export function extractDebankPositions(portfolio, patterns, type = "liquidity") {
  const out = [];
  for (const g of portfolio?.protocolGroups || []) {
    if (!patterns.some((re) => re.test(g.protocol || ""))) continue;
    const rows = type === "lending" ? g.lending || [] : g.liquidity || [];
    for (const r of rows) {
      out.push({
        protocol: g.protocol,
        chain: r.chain || g.chain,
        pair: r.pair || r.poolId,
        poolId: r.poolId,
        positionUsd: r.positionUsd ?? r.netUsd ?? 0,
        netUsd: r.netUsd ?? r.positionUsd ?? 0,
        tokenId: extractLpTokenId(r),
        source: "debank",
      });
    }
  }
  return out;
}

/** @param {object[]} revertRows @param {RegExp[]} patterns */
export function extractRevertPositions(revertRows, patterns) {
  return (revertRows || [])
    .filter((r) => patterns.some((re) => re.test(r.protocol || r.exchange || "")))
    .map((r) => ({
      protocol: r.protocol || r.exchange,
      chain: r.chain,
      pair: r.pair,
      poolId: r.poolId || r.positionId,
      positionUsd: r.pooledUsd ?? r.positionUsd ?? 0,
      tokenId: r.positionId || r.tokenId,
      rangeMin: r.rangeMin,
      rangeMax: r.rangeMax,
      source: "revert",
    }));
}

const DUST_USD = 1;

/** LP: tokenId — главный ключ (DeBank часто путает сеть). */
function positionKey(r) {
  const tid = r.tokenId || extractLpTokenId(r);
  if (tid) return `#${tid}`;
  return `${r.chain}|${(r.pair || r.poolId || "").slice(0, 40)}`;
}

function rowUsd(r) {
  return r.positionUsd ?? r.netUsd ?? 0;
}

/**
 * @param {object[]} onchain
 * @param {object[]} debank
 * @param {{ usdTolerancePct?: number }} [opts]
 */
function dedupeDebankByTokenId(rows) {
  const out = new Map();
  for (const r of rows) {
    const tid = r.tokenId || extractLpTokenId(r);
    if (tid) {
      const k = `#${tid}`;
      const prev = out.get(k);
      if (!prev || rowUsd(r) > rowUsd(prev)) out.set(k, { ...r, tokenId: tid });
      continue;
    }
    const k = positionKey(r);
    const prev = out.get(k);
    if (!prev || rowUsd(r) > rowUsd(prev)) out.set(k, r);
  }
  return [...out.values()];
}

export function comparePositionSets(onchain, debank, opts = {}) {
  const tol = opts.usdTolerancePct ?? 15;
  const debankFiltered = dedupeDebankByTokenId(debank.filter((r) => rowUsd(r) >= DUST_USD));

  const onMap = new Map(onchain.map((r) => [positionKey(r), r]));
  const dbMap = new Map(debankFiltered.map((r) => [positionKey(r), r]));
  const keys = new Set([...onMap.keys(), ...dbMap.keys()]);

  const matched = [];
  const missingOnchain = [];
  const extraOnchain = [];
  const chainMismatches = [];
  let usdOn = 0;
  let usdDb = 0;

  for (const k of keys) {
    const o = onMap.get(k);
    const d = dbMap.get(k);
    if (o) usdOn += rowUsd(o);
    if (d) usdDb += rowUsd(d);
    if (o && d) {
      const oUsd = rowUsd(o);
      const dUsd = rowUsd(d);
      const gapPct = dUsd > 0 ? Math.abs((oUsd - dUsd) / dUsd) * 100 : oUsd > 1 ? 100 : 0;
      if (o.chain && d.chain && o.chain !== d.chain) {
        chainMismatches.push({
          key: k,
          onchainChain: o.chain,
          debankChain: d.chain,
          onchainUsd: roundUsd(oUsd),
          debankUsd: roundUsd(dUsd),
        });
      }
      matched.push({
        key: k,
        onchainUsd: roundUsd(oUsd),
        debankUsd: roundUsd(dUsd),
        gapPct: roundUsd(gapPct),
        chainOk: !o.chain || !d.chain || o.chain === d.chain,
      });
    } else if (d && !o) missingOnchain.push({ key: k, ...d });
    else if (o && !d) extraOnchain.push({ key: k, ...o });
  }

  const totalGapPct = usdDb > 0 ? roundUsd((Math.abs(usdOn - usdDb) / usdDb) * 100) : usdOn > 1 ? 100 : 0;
  const missingNft = missingOnchain.filter((m) => m.key.startsWith("#"));
  const missingAggregate = missingOnchain.filter((m) => !m.key.startsWith("#"));
  const pass =
    totalGapPct <= tol &&
    missingNft.length === 0 &&
    extraOnchain.filter((e) => rowUsd(e) > 5).length === 0;

  return {
    pass,
    totalGapPct,
    onchainUsd: roundUsd(usdOn),
    debankUsd: roundUsd(usdDb),
    onchainCount: onchain.length,
    debankCount: debank.length,
    matched,
    missingOnchain,
    missingNft,
    missingAggregate,
    extraOnchain,
    chainMismatches,
    debankUsdRaw: roundUsd(debank.reduce((s, r) => s + rowUsd(r), 0)),
  };
}

export function formatCompareReport(protocolName, wallet, result) {
  const lines = [
    `\n=== ${protocolName} · ${wallet.slice(0, 10)}… ===`,
    `onchain $${result.onchainUsd} (${result.onchainCount} pos) · debank $${result.debankUsd} (${result.debankCount} pos) · gap ${result.totalGapPct}%`,
    result.pass ? "PASS" : "FAIL",
  ];
  if (result.missingNft?.length) {
    lines.push(`  missing NFT on-chain (${result.missingNft.length}):`);
    for (const m of result.missingNft.slice(0, 8)) {
      lines.push(`    - ${m.key} $${m.positionUsd ?? m.netUsd}`);
    }
  }
  if (result.missingAggregate?.length) {
    lines.push(`  DeBank aggregate rows (ignore if totals OK): ${result.missingAggregate.length}`);
    for (const m of result.missingAggregate.slice(0, 4)) {
      lines.push(`    - ${m.key} $${m.positionUsd ?? m.netUsd}`);
    }
  }
  if (result.extraOnchain.length) {
    lines.push(`  extra on-chain (${result.extraOnchain.length}):`);
    for (const e of result.extraOnchain.slice(0, 8)) {
      lines.push(`    - ${e.key} $${e.positionUsd ?? e.netUsd}`);
    }
  }
  if (result.chainMismatches?.length) {
    lines.push(`  chain mismatch DeBank vs on-chain (${result.chainMismatches.length}) — on-chain wins:`);
    for (const m of result.chainMismatches.slice(0, 6)) {
      lines.push(`    · ${m.key} on-chain:${m.onchainChain} debank:${m.debankChain}`);
    }
  }
  if (result.matched.length) {
    lines.push(`  matched (${result.matched.length}):`);
    for (const m of result.matched.slice(0, 6)) {
      lines.push(`    · ${m.key} on $${m.onchainUsd} db $${m.debankUsd} (${m.gapPct}%)`);
    }
  }
  return lines.join("\n");
}
