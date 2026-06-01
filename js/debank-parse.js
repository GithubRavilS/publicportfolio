import { CHAINS, chainSlug, slugFromHeaderName, isDebankChainLabel } from "./chains.js";
import { primaryCollateralMarketPrice, liquidationPriceFromHealth } from "./lending-metrics.js";

const NAV = new Set([
  "Portfolio",
  "Community",
  "Portfolio API",
  "More",
  "Connect Wallet",
  "NFTs",
  "Transactions",
  "Badge",
  "Default",
  "Change",
  "Summary",
  "Time Machine",
  "Stream",
  "Follow",
  "History",
  "Withdraw",
  "Claim",
  "Pool",
  "Balance",
  "Rewards",
  "Supplied",
  "Borrowed",
  "Price",
  "Amount",
  "USD Value",
  "Token",
  "Liquidity Pool",
  "Lending",
  "Wallet",
  "All Chain",
  "Data updated",
  "Hi offer price",
  "Say Hi",
  "TVF",
  "Earnings",
  "Followers",
  "Following",
  "No ID",
  "Search address / memo / Web3 ID",
]);

const DUST_USD = 0.01;

const KNOWN_PROTOCOL_PREFIXES =
  /uniswap|pancake|compound|aave|fluid|curve|balancer|gmx|beefy|yearn|aerodrome|velodrome|pendle|morpho|euler|sushi|maker|lido|stakewise|rocket|convex|frax|supernova|hyperliquid/i;

/** Имена протоколов из Jina markdown: убираем [](url) и склеенные ссылки. */
export function cleanProtocolName(name) {
  return String(name || "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, (_, label) => label || "")
    .replace(/\[\]\([^)]*\)/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function protocolKey(name) {
  return cleanProtocolName(name).toLowerCase();
}

/** Приводим Jina markdown к плотному тексту для парсера. */
export function normalizeDebankInput(raw) {
  const linesOut = [];
  let started = false;
  for (const line of String(raw || "").split("\n")) {
    let s = line.replace(/\r/g, "").trim();
    if (!started) {
      if (s.startsWith("Markdown Content:")) {
        started = true;
        continue;
      }
      if (
        s.startsWith("Title:") ||
        s.startsWith("URL Source:") ||
        s.startsWith("Published Time:")
      ) {
        continue;
      }
    }
    if (!s || s.startsWith("![")) continue;
    s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, (_, label) => label || "");
    s = s.replace(/\[\]\([^)]*\)/g, "");
    s = s.replace(
      /Wallet(?=(PancakeSwap|Uniswap|Compound|Aave|Curve|Fluid|GMX|Sushi|Balancer|Morpho|Yearn|Beefy|Velodrome|Aerodrome|Lido|Pendle|Euler|Synthetix|Hyperliquid))/i,
      "Wallet\n",
    );
    s = s.replace(/V3(?=(Compound|Pancake|Uniswap|Aave|Curve|Sushi|Balancer))/i, "V3\n");
    s = s.trim();
    if (!s) continue;
    const hm = s.match(/^Health Rate\s*>?\s*([\d.]+)/i);
    if (hm) {
      linesOut.push("Health Rate", hm[1]);
      continue;
    }
    if (/^Health Rate\s*>\s*10/i.test(s)) {
      linesOut.push("Health Rate", ">10");
      continue;
    }
    linesOut.push(s);
  }
  return linesOut.join("\n");
}

function isLikelyTokenSymbol(l) {
  const s = String(l || "").trim();
  if (!s || s.length > 20) return false;
  if (/^\$/.test(s)) return false;
  if (/^[\d,]+\.?\d*$/.test(s)) return false;
  if (/^0x[a-fA-F0-9]{4,}$/i.test(s)) return false;
  return /^[A-Za-z][A-Za-z0-9.+₮₀-₉]*$/.test(s);
}

function isPriceOnlyLine(l) {
  const s = String(l || "").trim();
  if (!s.startsWith("$")) return false;
  const v = parseUsd(s);
  return v != null && v >= 50;
}

/** Цена токена в таблице Wallet ($2,031.5100), не итог портфеля. */
function isTokenUnitPriceLine(line) {
  return /\$\d[\d,]*\.\d{3,}/.test(String(line || "").trim());
}

/** Итог под аватаром (сразу после 0x…). */
function scanBannerPortfolioTotal(lines) {
  for (let i = 0; i < Math.min(lines.length, 45); i++) {
    const line = lines[i].trim();
    if (isTokenUnitPriceLine(line)) continue;
    const v = parseUsd(line);
    if (v == null || v < 1 || line.includes("%")) continue;
    const prev = (lines[i - 1] || "").trim();
    const prev2 = (lines[i - 2] || "").trim();
    if (
      /^0x[a-fA-F0-9]{40}$/i.test(prev) ||
      /^0x[a-fA-F0-9]{40}$/i.test(prev2) ||
      /bio yet$/i.test(prev)
    ) {
      return v;
    }
  }
  return 0;
}

function isChainOrNavLabel(l) {
  const s = String(l || "").trim();
  if (!s || NAV.has(s)) return true;
  if (/^unfold\b/i.test(s)) return true;
  if (isDebankChainLabel(s)) return true;
  const slug = slugFromHeaderName(s);
  return !!CHAINS[slug] && s.length < 24;
}

function parseUsd(line) {
  const m = String(line || "")
    .trim()
    .match(/\$([\d,]+\.?\d*)/);
  if (!m) return null;
  return parseFloat(m[1].replace(/,/g, "")) || 0;
}

function parseParenUsd(line) {
  const m = String(line || "").match(/\(\$([\d,]+\.?\d*)\)/);
  if (!m) return null;
  return parseFloat(m[1].replace(/,/g, "")) || 0;
}

function parseTokenAmountLine(line) {
  const s = String(line || "").trim();
  if (!s || s.startsWith("$")) return null;
  const patterns = [
    /^([\d,]*\.\d+(?:e[+-]?\d+)?)\s+([A-Za-z0-9.+]+)(?:\s*\(|$)/i,
    /^(\d[\d,]*\.?\d*(?:e[+-]?\d+)?)\s+([A-Za-z0-9.+]+)(?:\s*\(|$)/i,
    /^([\d,]+,\d+)\s+([A-Za-z0-9.+]+)(?:\s*\(|$)/i,
  ];
  for (let i = 0; i < patterns.length; i++) {
    const m = s.match(patterns[i]);
    if (!m) continue;
    let amount = m[1];
    if (i === 2) amount = amount.replace(",", ".");
    else amount = amount.replace(/,/g, "");
    return { amount, symbol: m[2] };
  }
  return null;
}

function nextNonEmptyLine(lines, fromIndex) {
  for (let j = fromIndex + 1; j < Math.min(fromIndex + 6, lines.length); j++) {
    const s = lines[j]?.trim() || "";
    if (s) return { text: s, index: j };
  }
  return null;
}

function nextNonemptyIndex(lines, from, limit = lines.length) {
  let j = from;
  while (j < limit && !lines[j]?.trim()) j++;
  return j;
}

function protocolUsdAfterHeader(lines, lineIndex, maxLook = 8) {
  for (let j = lineIndex + 1; j < Math.min(lineIndex + maxLook, lines.length); j++) {
    const s = lines[j]?.trim() || "";
    if (!s || s.startsWith("![")) continue;
    if (s.startsWith("[")) continue;
    const v = parseUsd(s);
    if (v != null && v > 0) return v;
  }
  return 0;
}

const TABLE_HDR = new Set([
  "Token",
  "Price",
  "Amount",
  "USD Value",
  "Supplied",
  "Borrowed",
  "Health",
]);

function isProtocolHeader(line, lines, lineIndex) {
  const l = cleanProtocolName(line.trim());
  if (!l || NAV.has(l) || TABLE_HDR.has(l)) return false;
  if (/^health\s*rate/i.test(l)) return false;
  if (l.startsWith("$") || l.startsWith("#") || l.startsWith("0x")) return false;
  if (l.startsWith("[")) return false;
  if (/\s/.test(l) && !/v\d/i.test(l)) return false;
  if (/^\d/.test(l)) return false;
  if (l.toLowerCase().includes("unfold")) return false;
  if (l.toLowerCase().includes("show all")) return false;
  if (l.toLowerCase().includes("small balance")) return false;
  if (isPriceOnlyLine(l)) return false;
  if (isChainOrNavLabel(l)) return false;
  if (isPoolPairLine(l)) return false;
  const usd = protocolUsdAfterHeader(lines, lineIndex, 3);
  if (usd < DUST_USD) return false;
  if (KNOWN_PROTOCOL_PREFIXES.test(l)) return true;
  return /[A-Za-z]/.test(l) && l.length < 48 && !isLikelyTokenSymbol(l);
}

export function parseChainBreakdown(lines) {
  const chains = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i].trim();
    if (l === "All Chain" || l === "Portfolio") {
      i++;
      continue;
    }
    const nxt = nextNonEmptyLine(lines, i);
    const combined = nxt?.text || "";
    const mCombined = combined.match(/^\$([\d,]+\.?\d*)\s+(\d+)%$/);
    if (mCombined && l && !l.startsWith("$") && !NAV.has(l)) {
      chains.push({
        slug: slugFromHeaderName(l),
        name: l,
        usd: parseFloat(mCombined[1].replace(/,/g, "")) || 0,
        pct: parseFloat(mCombined[2]) || 0,
      });
      i = (nxt?.index ?? i) + 1;
      continue;
    }
    const next = lines[i + 1]?.trim() || "";
    const pct = lines[i + 2]?.trim() || "";
    if (next.match(/^\$[\d,]/) && pct.match(/^\d+%$/)) {
      chains.push({
        slug: slugFromHeaderName(l),
        name: l,
        usd: parseUsd(next),
        pct: parseFloat(pct) || 0,
      });
      i += 3;
      continue;
    }
    if (/^unfold\b/i.test(l) || l === "Wallet" || l === "Liquidity Pool") break;
    if (i > 280) break;
    i++;
  }
  return chains;
}

function parseRewardLines(lines, start, end) {
  const rewards = [];
  for (let i = start; i < end; i++) {
    const l = lines[i].trim();
    if (l === "Claim" || l === "Withdraw") continue;
    const p = parseTokenAmountLine(l);
    const usd = parseParenUsd(l);
    if (p && usd != null) {
      rewards.push({ symbol: p.symbol, amount: p.amount, usd });
      continue;
    }
    const p2 = parseTokenAmountLine(l);
    if (p2 && i + 1 < end) {
      const usd2 = parseUsd(lines[i + 1]) ?? parseParenUsd(lines[i + 1]);
      if (usd2 != null) {
        rewards.push({ symbol: p2.symbol, amount: p2.amount, usd: usd2 });
      }
    }
  }
  return rewards;
}

export function parseYieldPoolsInRange(lines, start, end, protocol, chain) {
  const pools = [];
  let i = start;
  while (i < end) {
    const l = lines[i].trim();
    if (l === "Pool" || l === "Balance" || l === "USD Value") {
      i++;
      continue;
    }
    if (NAV.has(l) || l === "Claim" || l === "Withdraw") {
      i++;
      continue;
    }
    if (isPriceOnlyLine(l)) {
      i++;
      continue;
    }
    if (/^\d{5,}$/.test(l)) {
      let farmUsd = 0;
      let farmEnd = i + 1;
      for (let j = i + 1; j < Math.min(i + 16, end); j++) {
        const u = parseUsd(lines[j]);
        if (u != null && u > farmUsd) {
          farmUsd = u;
          farmEnd = j + 1;
        }
      }
      if (farmUsd > 0) {
        pools.push({
          protocol,
          chain,
          poolId: `#${l}`,
          pair: `${protocol} #${l}`,
          kind: "Farming",
          inPool: [],
          positionUsd: farmUsd,
          claimable: [],
          claimableUsd: 0,
          netUsd: farmUsd,
        });
        i = farmEnd;
        continue;
      }
    }
    if (/^[\d,]+\.?\d*$/.test(l)) {
      i++;
      continue;
    }
    if (/^[A-Za-z0-9+.\- ]+$/.test(l) && l.length < 48 && !l.startsWith("$")) {
      const poolName = l;
      const skipNames = new Set(["Yield", "Pool", "Balance", "USD Value", "Liquidity Pool"]);
      if (
        skipNames.has(poolName) ||
        isAmountLikePoolName(poolName) ||
        isChainOrNavLabel(poolName) ||
        poolName.toLowerCase() === protocol.toLowerCase() ||
        poolName.toLowerCase() === chain?.toLowerCase()
      ) {
        i++;
        continue;
      }
      const singleAssetVault = !isPoolPairLine(poolName) && isLikelyTokenSymbol(poolName);
      if (singleAssetVault) {
        const balances = [];
        let positionUsd = 0;
        let j = i + 1;
        while (j < end && j < i + 10) {
          const row = lines[j].trim();
          if (isProtocolHeader(row, lines, j) || row === "Liquidity Pool") break;
          const tok = parseTokenAmountLine(row);
          if (tok) balances.push(tok);
          const u = parseUsd(row);
          if (u != null && u > positionUsd) positionUsd = u;
          j++;
        }
        if (positionUsd > 0 || balances.length) {
          pools.push({
            protocol,
            chain,
            poolId: poolName,
            pair: poolName,
            kind: "Yield",
            inPool: balances,
            positionUsd,
            claimable: [],
            claimableUsd: 0,
            netUsd: positionUsd,
          });
        }
        i = j;
        continue;
      }
      const balances = [];
      let positionUsd = 0;
      let j = i + 1;
      while (j < end && j < i + 12) {
        const row = lines[j].trim();
        if (row === "Lending" || row === "Liquidity Pool" || row.startsWith("#")) break;
        if (isProtocolHeader(row, lines, j)) break;
        const tok = parseTokenAmountLine(row);
        if (tok) {
          balances.push(tok);
          j++;
          continue;
        }
        const u = parseUsd(row);
        if (u != null && u > positionUsd) {
          positionUsd = u;
        }
        j++;
      }
      if (balances.length || positionUsd > 0) {
        let pair = poolName;
        let poolId = poolName;
        const isPendle = /pendle/i.test(protocol);
        const generic = /^(deposit|yield|pool|balance)$/i.test(poolName);
        if (isPendle || generic) {
          const pt = balances.find((b) => /^(PT|YT)-/i.test(b.symbol));
          const named = balances.find((b) => b.symbol && b.symbol.length > 2);
          if (pt) {
            pair = pt.symbol;
            poolId = pt.symbol;
          } else if (named) {
            pair = named.symbol;
            poolId = named.symbol;
          }
        }
        pools.push({
          protocol,
          chain,
          poolId,
          pair,
          kind: isPendle ? "Yield" : generic ? "Deposit" : "Yield",
          inPool: balances,
          positionUsd,
          claimable: [],
          claimableUsd: 0,
          netUsd: positionUsd,
        });
      }
      i = j;
      continue;
    }
    i++;
  }
  return pools;
}

function isAmountLikePoolName(name) {
  const s = String(name || "").trim();
  if (/^\d[\d,.]*\s+[A-Za-z0-9.]{2,20}$/i.test(s)) return true;
  return false;
}

function pairFromInPool(balances) {
  const syms = [];
  for (const b of balances || []) {
    const sym = String(b.symbol || "").trim();
    if (sym && !syms.includes(sym)) syms.push(sym);
  }
  if (syms.length >= 2) return `${syms[0]}+${syms[1]}`;
  if (syms.length === 1) return syms[0];
  return "";
}

function normalizeLiquidityRow(p, protocol) {
  if (isAmountLikePoolName(p.pair) || isAmountLikePoolName(p.poolId)) {
    const fromBal = pairFromInPool(p.inPool);
    if (fromBal) {
      p.pair = fromBal;
      if (!String(p.poolId || "").includes("+")) p.poolId = fromBal;
    }
  }
  if (/^(?:[A-Za-z ]+)?#\d{5,}$/i.test(String(p.pair || "")) && p.inPool?.length >= 2) {
    const fromBal = pairFromInPool(p.inPool);
    if (fromBal) p.pair = fromBal;
  }
  if (
    /#\d{5,}/.test(String(p.poolId || p.pair || "")) &&
    (p.positionUsd || 0) < 1.25 &&
    !(p.inPool || []).length
  ) {
    p._drop = true;
  }
  return p;
}

function isPoolPairLine(l) {
  if (!l || l.startsWith("$") || l.startsWith("#")) return false;
  if (NAV.has(l) || /^(Pool|Balance|Rewards|USD Value|Withdraw|Claim)$/i.test(l)) return false;
  if (!l.includes("+")) return false;
  return /^[^$\s#]+\+[^$\s#]+$/.test(l) && l.length < 48;
}

function parseLiquidityPoolsInRange(lines, start, end, protocol, chain) {
  const pools = [];
  let i = start;
  while (i < end) {
    const l = lines[i].trim();
    if (isPoolPairLine(l)) {
      const pair = l;
      const inPool = [];
      let positionUsd = 0;
      const claimable = [];
      let j = i + 1;
      while (j < end && j < i + 20) {
        const row = lines[j].trim();
        if (
          row.startsWith("#") ||
          isPoolPairLine(row) ||
          row === "Liquidity Pool" ||
          row === "Lending"
        )
          break;
        if (isProtocolHeader(row, lines, j)) break;
        if (row === "Claim" || row === "Withdraw") {
          j++;
          continue;
        }
        const tok = parseTokenAmountLine(row);
        if (tok && !row.includes("(")) {
          inPool.push(tok);
          j++;
          continue;
        }
        const u = parseUsd(row);
        if (u != null && !row.includes("(")) {
          positionUsd = Math.max(positionUsd, u);
          j++;
          break;
        }
        j++;
      }
      if (positionUsd > 0 || inPool.length) {
        pools.push({
          protocol,
          chain,
          poolId: pair,
          pair,
          inPool,
          positionUsd,
          claimable,
          claimableUsd: 0,
          netUsd: positionUsd,
        });
      }
      i = j;
      continue;
    }
    if (l.startsWith("#")) {
      const poolId = l;
      const pair = lines[i + 1]?.trim() || "";
      const inPool = [];
      let positionUsd = 0;
      const claimable = [];
      let j = i + 2;
      while (j < end && j < i + 30) {
        const row = lines[j].trim();
        if (row.startsWith("#") || row === "Lending" || row === "Liquidity Pool") break;
        if (row === "Claim") {
          j++;
          continue;
        }
        if (row === "Withdraw") {
          j++;
          continue;
        }
        const tok = parseTokenAmountLine(row);
        const usdP = parseParenUsd(row);
        if (tok && usdP != null) {
          claimable.push({ symbol: tok.symbol, amount: tok.amount, usd: usdP });
          j++;
          continue;
        }
        if (tok && !row.includes("(")) {
          inPool.push(tok);
          j++;
          continue;
        }
        const v = parseUsd(row);
        if (v != null && !row.includes("(") && v > positionUsd) {
          positionUsd = v;
        }
        j++;
      }
      const claimableUsd = claimable.reduce((s, x) => s + x.usd, 0);
      if (!positionUsd && claimableUsd > 0) positionUsd = claimableUsd;
      if (positionUsd > 0 || inPool.length) {
        pools.push({
          protocol,
          chain,
          poolId,
          pair,
          inPool,
          positionUsd,
          claimable,
          claimableUsd,
          netUsd: positionUsd,
        });
      }
      i = j;
      continue;
    }
    i++;
  }
  return pools;
}

export function parseLendingInRange(lines, start, end, protocol, chain) {
  const positions = [];
  let i = start;
  while (i < end) {
    if (lines[i].trim().toLowerCase() !== "lending") {
      i++;
      continue;
    }
    let healthFactor = null;
    const supplied = [];
    const borrowed = [];
    const rewards = [];
    i++;
    let mode = null;
    const blockStart = i;

    while (i < end) {
      const l = lines[i].trim();
      const low = l.toLowerCase();
      if (l === "Lending" && mode) break;
      if (l === "Liquidity Pool" || (l === "Wallet" && mode)) break;
      if (isProtocolHeader(l, lines, i)) break;

      if (low.includes("health")) {
        const hf = l.match(/health\s*rate\s*(\d+[.,]?\d*)/i);
        if (hf) healthFactor = parseFloat(hf[1].replace(",", "."));
        else if (l.includes(">10") || l.includes("> 10")) healthFactor = 10;
        else if (lines[i + 1]?.trim() === ">10") {
          healthFactor = 10;
          i++;
        } else if (lines[i + 1]?.trim().match(/^(\d+[.,]?\d*)$/)) {
          healthFactor = parseFloat(lines[i + 1].trim().replace(",", "."));
          i++;
        }
        i++;
        continue;
      }

      if (l === "Supplied") {
        mode = "supplied";
        i++;
        continue;
      }
      if (l === "Borrowed") {
        mode = "borrowed";
        i++;
        continue;
      }
      if (l === "Rewards") {
        mode = "rewards";
        i++;
        continue;
      }
      if (["Balance", "USD Value", "Claim", "Withdraw", ""].includes(l)) {
        i++;
        continue;
      }

      if (mode === "rewards") {
        const asset = l;
        if (/^[A-Za-z0-9.+]+$/.test(asset) && asset.length < 20) {
          let usd = null;
          let amount = "";
          if (i + 1 < end) {
            const n = lines[i + 1].trim();
            const m = n.match(new RegExp(`([\\d,]+\\.?[\\d]*)\\s+${asset}`, "i"));
            if (m) {
              amount = m[1].replace(/,/g, "");
              i++;
            }
            for (let k = 1; k <= 4 && i + k < end; k++) {
              const u = parseUsd(lines[i + k]);
              if (u != null) {
                usd = u;
                i += k;
                break;
              }
            }
          }
          if (usd != null) rewards.push({ asset, amount, usd });
        }
        i++;
        continue;
      }

      if (mode === "supplied" || mode === "borrowed") {
        const uOnly = parseUsd(l);
        if (uOnly != null && uOnly > 0 && !l.startsWith("[")) {
          let asset = "Token";
          for (let k = i - 1; k >= Math.max(blockStart, i - 5); k--) {
            const prev = lines[k] || "";
            if (/cbbtc|cbb7c000/i.test(prev)) asset = "cbBTC";
            else if (/a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48/i.test(prev)) asset = "USDC";
            else if (/dac17f958d2ee523a2206206994597c13d831ec7/i.test(prev)) asset = "USDT";
            else if (/c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/i.test(prev)) asset = "WETH";
          }
          const side = mode === "supplied" ? supplied : borrowed;
          side.push({ asset, amount: "", usd: uOnly });
          i++;
          continue;
        }
      }

      if (mode && /^[A-Za-z0-9.+]+$/.test(l) && l.length < 24) {
        const asset = l;
        let amountStr = "";
        let usdVal = null;
        if (i + 1 < end) {
          const n = lines[i + 1].trim();
          const m = n.match(
            new RegExp(
              `([\\d,]*\\.\\d+|\\d[\\d,]*\\.?\\d*)\\s+${asset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
              "i",
            ),
          );
          if (m) {
            amountStr = m[1].replace(/,/g, "");
            i++;
          }
        }
        for (let k = 1; k <= 6 && i + k < end; k++) {
          const u = parseUsd(lines[i + k]);
          if (u != null) {
            usdVal = u;
            i += k;
            break;
          }
          if (/^[A-Z0-9.+]+$/.test(lines[i + k].trim()) && lines[i + k].trim().length < 20) break;
        }
        if (usdVal != null) {
          const item = { asset, amount: amountStr, usd: usdVal };
          if (mode === "supplied") supplied.push(item);
          else if (mode === "borrowed") borrowed.push(item);
        }
      }
      i++;
    }

    if (supplied.length || borrowed.length) {
      const collateralUsd = supplied.reduce((s, x) => s + x.usd, 0);
      const debtUsd = borrowed.reduce((s, x) => s + x.usd, 0);
      const hf = healthFactor && healthFactor > 0 ? healthFactor : null;
      const marketPrice = primaryCollateralMarketPrice(supplied);
      const liquidationPrice = liquidationPriceFromHealth({
        healthFactor: hf,
        supplied,
        marketPrice,
      });
      positions.push({
        protocol,
        chain,
        healthFactor: hf,
        supplied,
        borrowed,
        rewards,
        rewardsUsd: rewards.reduce((s, x) => s + x.usd, 0),
        collateralUsd,
        debtUsd,
        netUsd: collateralUsd - debtUsd,
        marketPrice,
        liquidationPrice,
      });
    } else {
      i = blockStart;
    }
  }
  return positions;
}

function lineAtSkipEmpty(lines, idx) {
  for (let j = idx; j < lines.length; j++) {
    const s = lines[j]?.trim() || "";
    if (s) return { text: s, index: j };
  }
  return null;
}

function parseWalletTokensInRange(lines, start, end, chain, showSmall) {
  const tokens = [];
  let i = start;
  while (i < end) {
    if (lines[i].trim() !== "Token") {
      i++;
      continue;
    }
    const priceHdr = lineAtSkipEmpty(lines, i + 1);
    const amountHdr = priceHdr ? lineAtSkipEmpty(lines, priceHdr.index + 1) : null;
    if (priceHdr?.text !== "Price" || amountHdr?.text !== "Amount") {
      i++;
      continue;
    }
    i = amountHdr.index + 1;
    const usdHdr = lineAtSkipEmpty(lines, i);
    if (usdHdr?.text === "USD Value") i = usdHdr.index + 1;
    while (i < end) {
      if (!lines[i]?.trim()) {
        i++;
        continue;
      }
      const row0 = lines[i].trim();
      if (
        NAV.has(row0) ||
        row0 === "Liquidity Pool" ||
        row0 === "Lending" ||
        row0.startsWith("#") ||
        isProtocolHeader(row0, lines, i)
      ) {
        break;
      }
      if (/health/i.test(row0) || /show all/i.test(row0) || /small balance/i.test(row0)) {
        i++;
        continue;
      }

      let sym = "";
      let priceLine = "";
      let amountLine = "";
      let usdLine = "";

      const rowClean = row0.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim();
      if (isLikelyTokenSymbol(rowClean)) {
        const pi = nextNonemptyIndex(lines, i + 1, end);
        const ai = nextNonemptyIndex(lines, pi + 1, end);
        const ui = nextNonemptyIndex(lines, ai + 1, end);
        if (!lines[pi]?.trim().includes("$")) break;
        sym = rowClean;
        priceLine = lines[pi]?.trim() || "";
        amountLine = lines[ai]?.trim() || "";
        usdLine = lines[ui]?.trim() || "";
        i = nextNonemptyIndex(lines, ui + 1, end);
      } else if (parseUsd(row0) != null) {
        const ai = nextNonemptyIndex(lines, i + 1, end);
        const ui = nextNonemptyIndex(lines, ai + 1, end);
        amountLine = lines[ai]?.trim() || "";
        if (!/^\d/.test(amountLine)) break;
        priceLine = row0;
        usdLine = lines[ui]?.trim() || "";
        const tok = parseTokenAmountLine(amountLine);
        const priceVal = parseUsd(priceLine) || 0;
        if (tok?.symbol) sym = tok.symbol;
        else if (priceVal > 500)
          sym = tokens.filter((t) => t.symbol === "ETH").length ? "WETH" : "ETH";
        else if (priceVal > 10) sym = "BNB";
        else sym = "USDC";
        i = nextNonemptyIndex(lines, ui + 1, end);
      } else break;

      let usd = parseUsd(usdLine);
      if (usdLine.includes("<") && usdLine.includes("$"))
        usd = parseUsd(usdLine.replace("<", "")) ?? 0;
      if (usd == null) usd = 0;

      if (!showSmall && usd > 0 && usd < DUST_USD) continue;
      if (!showSmall && usd === 0 && !amountLine) continue;

      tokens.push({
        symbol: sym,
        price: priceLine,
        amount: amountLine.replace(/(\d)\.(\d*)\./, "$1.$2"),
        usd,
        chain: chainSlug(chain),
      });
    }
    break;
  }
  return tokens;
}

function sectionHasContent(lines, start, end) {
  const text = lines.slice(start, end).join("\n");
  if (/Liquidity Pool|Lending|Yield|Farming/i.test(text)) return true;
  if (/Deposit/i.test(text) && !/Token\s*\n\s*Price/i.test(text)) return true;
  return false;
}

export function buildProtocolSections(lines) {
  const sections = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const l = cleanProtocolName(lines[i].trim());
    if (!l || !isProtocolHeader(l, lines, i)) continue;
    const protocolUsd = protocolUsdAfterHeader(lines, i);
    let end = lines.length;
    for (let j = i + 1; j < lines.length - 1; j++) {
      if (isProtocolHeader(cleanProtocolName(lines[j].trim()), lines, j)) {
        end = j;
        break;
      }
    }
    if (!sectionHasContent(lines, i, end)) {
      i = end - 1;
      continue;
    }
    sections.push({ protocol: l, protocolUsd, start: i, end });
    i = end - 1;
  }
  return sections;
}

function mergeChains(a, b) {
  const map = new Map();
  for (const c of [...(a || []), ...(b || [])]) {
    const prev = map.get(c.slug);
    if (!prev || (c.usd || 0) > (prev.usd || 0)) map.set(c.slug, { ...c });
  }
  return [...map.values()].sort((x, y) => (y.usd || 0) - (x.usd || 0));
}

function dedupeProtocolTabs(tabs) {
  const map = new Map();
  for (const t of tabs || []) {
    if (!isValidProtocolTab(t.protocol)) continue;
    const k = protocolKey(t.protocol);
    const usd = t.usd || 0;
    if (usd < 1) continue;
    const prev = map.get(k);
    if (!prev || usd < prev.usd) map.set(k, { protocol: cleanProtocolName(t.protocol), usd });
  }
  return [...map.values()].sort((a, b) => (b.usd || 0) - (a.usd || 0));
}

function mergeProtocolTabs(a, b) {
  return dedupeProtocolTabs([...(a || []), ...(b || [])]);
}

export function isValidProtocolTab(name) {
  const p = cleanProtocolName(name);
  if (!p || p.length > 36) return false;
  const compact = p.replace(/\s+/g, "");
  if (/compound.*pancake|pancake.*compound|uniswap.*compound/i.test(compact)) return false;
  if ((p.match(/\bv3\b/gi) || []).length > 1) return false;
  return (
    p === "Wallet" ||
    KNOWN_PROTOCOL_PREFIXES.test(p) ||
    /v\d|swap|lend|fluid|beefy|yearn|gmx/i.test(p)
  );
}

function parseProtocolTabGrid(lines) {
  const tabs = [];
  let started = false;
  for (let i = 0; i < lines.length - 1; i++) {
    const l = cleanProtocolName(lines[i].trim());
    if (l.includes("Unfold") || l === "All Chain") started = true;
    if (!started) continue;
    if (l === "Token" && lines[i + 1]?.trim() === "Price") break;
    if (["Default", "Change", "Summary", "Time Machine"].includes(l)) break;
    if (!isValidProtocolTab(l)) continue;
    let tabUsd = 0;
    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      const v = parseUsd(lines[j]?.trim() || "");
      if (v != null && v >= 0.01) {
        tabUsd = v;
        break;
      }
    }
    if (tabUsd > 0 && !isChainOrNavLabel(l) && !isLikelyTokenSymbol(l)) {
      tabs.push({ protocol: l, usd: tabUsd });
    }
  }
  return tabs;
}

export function buildProtocolGroups(lending, liquidity, walletTokens, protocolTabs) {
  const map = new Map();
  const ensure = (protocol, chain) => {
    const k = `${protocol}\0${chain || "unknown"}`;
    if (!map.has(k)) {
      map.set(k, {
        protocol,
        chain: chain || "unknown",
        protocolUsd: 0,
        kinds: [],
        lending: [],
        liquidity: [],
        walletTokens: [],
      });
    }
    return map.get(k);
  };
  const addKind = (g, kind) => {
    if (!g.kinds.includes(kind)) g.kinds.push(kind);
  };

  for (const p of lending) {
    const ch = p.protocol?.toLowerCase().includes("hyperliquid") ? "hyperliquid" : p.chain;
    const g = ensure(p.protocol, ch);
    g.lending.push(p);
    addKind(g, "Lending");
  }
  for (const p of liquidity) {
    const ch = p.protocol?.toLowerCase().includes("hyperliquid") ? "hyperliquid" : p.chain;
    const g = ensure(p.protocol, ch);
    g.liquidity.push(p);
    addKind(g, p.kind || "Liquidity Pool");
  }

  const walletUsd = (walletTokens || []).reduce((s, t) => s + (t.usd || 0), 0);
  if (walletTokens?.length || walletUsd > 0) {
    const g = ensure("Wallet", "all");
    g.walletTokens = walletTokens;
    addKind(g, "Wallet");
  }

  for (const g of map.values()) {
    const lendU = g.lending.reduce((s, p) => s + Math.max(p.netUsd || 0, 0), 0);
    const liqU = g.liquidity.reduce((s, p) => s + (p.positionUsd || 0), 0);
    if (g.protocol === "Wallet") {
      const tab = (protocolTabs || []).find((t) => t.protocol === "Wallet");
      g.protocolUsd = tab?.usd > 0 ? tab.usd : walletUsd;
    } else {
      g.protocolUsd = lendU + liqU;
    }
  }

  return [...map.values()]
    .map((g) => ({
      ...g,
      id: `${g.protocol}|${g.chain}`,
      protocolUsd: Math.round((g.protocolUsd || 0) * 100) / 100,
    }))
    .filter(
      (g) =>
        g.protocolUsd > 0.005 || g.walletTokens?.length || g.liquidity?.length || g.lending?.length,
    )
    .sort((a, b) => b.protocolUsd - a.protocolUsd);
}

function inferChainForSection(section, chains, chainProtocolIndex) {
  const p = section.protocol.toLowerCase();
  if (p.includes("hyperliquid")) return "hyperliquid";
  if (p.includes("gmx")) return "arb";
  if (p.includes("aerodrome")) return "base";
  if (p.includes("velodrome")) return "op";
  if (p.includes("pancake")) {
    const baseUsd = chains.find((c) => c.slug === "base")?.usd || 0;
    const arbUsd = chains.find((c) => c.slug === "arb")?.usd || 0;
    if (baseUsd >= arbUsd && baseUsd > 0) return "base";
  }
  const key = `${section.protocol}:${Math.round(section.protocolUsd)}`;
  if (chainProtocolIndex[key]) return chainProtocolIndex[key];
  return "unknown";
}

/** NFT #id — одна позиция; Jina/chain-pages часто дублируют на arb/eth (ошибка scrape, не DeBank). */
function liquidityTokenId(p) {
  const raw = String(p.poolId || p.pair || "");
  const m = raw.match(/#(\d{4,})/) || String(p.poolId || "").match(/^(\d{5,})$/);
  return m ? m[1] : null;
}

export function dedupeLiquidityByTokenId(rows) {
  const byTid = new Map();
  const rest = [];
  for (const p of rows) {
    const tid = liquidityTokenId(p);
    if (tid) {
      p.tokenId = tid;
      const prev = byTid.get(tid);
      if (!prev || (p.positionUsd || 0) >= (prev.positionUsd || 0)) byTid.set(tid, p);
      continue;
    }
    const proto = String(p.protocol || "").toLowerCase();
    const pair = String(p.pair || p.poolId || "").toLowerCase();
    const isOverview =
      pair.includes(proto) && pair.length < 40 && !pair.includes("+") && byTid.size > 0;
    if (!isOverview) rest.push(p);
  }
  const seen = new Set();
  const outRest = [];
  for (const p of rest) {
    const k = `${p.chain}|${p.protocol}|${p.poolId}|${p.pair}`;
    if (seen.has(k)) continue;
    seen.add(k);
    outRest.push(p);
  }
  return [...byTid.values(), ...outRest];
}

/** Индекс протоколов с chain-страниц: protocol -> slug */
export function indexProtocolsOnChainPage(text, chainSlugId) {
  const lines = text.split("\n");
  const map = {};
  for (const sec of buildProtocolSections(lines)) {
    const k = `${sec.protocol}:${Math.round(sec.protocolUsd)}`;
    map[k] = chainSlugId;
  }
  return map;
}

export function parseDebankProfileText(rawText, options = {}) {
  const showSmall = !!options.showSmallBalances;
  const chainTexts = options.chainTexts || {};
  const lines = normalizeDebankInput(rawText).split("\n");

  let chains = parseChainBreakdown(lines);
  let protocolTabs = parseProtocolTabGrid(lines);
  for (const text of Object.values(chainTexts)) {
    const clines = normalizeDebankInput(text).split("\n");
    chains = mergeChains(chains, parseChainBreakdown(clines));
    protocolTabs = mergeProtocolTabs(protocolTabs, parseProtocolTabGrid(clines));
  }
  protocolTabs = dedupeProtocolTabs(protocolTabs);
  const chainSum = chains.reduce((s, c) => s + (c.usd || 0), 0);
  const bannerTotal = scanBannerPortfolioTotal(lines);
  let totalUsd = chainSum;
  if (bannerTotal > 0) {
    totalUsd = chainSum > 0 ? Math.max(chainSum, bannerTotal) : bannerTotal;
  } else if (!totalUsd) {
    for (let i = 0; i < Math.min(lines.length, 40); i++) {
      const line = lines[i].trim();
      if (isTokenUnitPriceLine(line)) continue;
      const v = parseUsd(line);
      if (v != null && v > 1 && !line.includes("%")) {
        totalUsd = v;
        break;
      }
    }
  }
  if (chainSum > 0 && totalUsd > chainSum * 2.5) {
    totalUsd = chainSum;
  }
  const chainProtocolIndex = { ...options.chainProtocolIndex };

  for (const [slug, text] of Object.entries(chainTexts)) {
    const part = indexProtocolsOnChainPage(text, slug);
    Object.assign(chainProtocolIndex, part);
  }

  const sections = buildProtocolSections(lines);
  const lending = [];
  const liquidity = [];
  let walletTokens = [];

  const seenLiq = new Set();
  const seenLend = new Set();

  function addLiquidity(items) {
    for (const p of items) {
      const k = `${p.chain}:${p.protocol}:${p.poolId}:${p.pair}`;
      if (seenLiq.has(k)) continue;
      seenLiq.add(k);
      liquidity.push(p);
    }
  }
  function addLending(items) {
    for (const p of items) {
      const k = `${p.chain}:${p.protocol}:${p.collateralUsd}:${p.debtUsd}`;
      if (seenLend.has(k)) continue;
      seenLend.add(k);
      lending.push(p);
    }
  }

  function parseSectionsFromLines(textLines, defaultChain) {
    const secs = buildProtocolSections(textLines);
    for (const sec of secs) {
      const liqBefore = liquidity.length;
      const lendBefore = lending.length;
      const slice = textLines.slice(sec.start, sec.end);
      const text = slice.join("\n");
      let chain =
        defaultChain && defaultChain !== "unknown"
          ? defaultChain
          : chainProtocolIndex[`${sec.protocol}:${Math.round(sec.protocolUsd)}`] ||
            inferChainForSection(sec, chains, chainProtocolIndex);
      if (sec.protocol.toLowerCase().includes("hyperliquid")) chain = "hyperliquid";
      if (sec.protocol.toLowerCase().includes("gmx")) chain = "arb";
      chain = inferChainFromSectionText(text, chain);

      const ch = chainSlug(chain);
      if (text.includes("Liquidity Pool")) {
        addLiquidity(parseLiquidityPoolsInRange(textLines, sec.start, sec.end, sec.protocol, ch));
      }
      if (text.includes("Farming") || text.includes("Yield")) {
        addLiquidity(parseYieldPoolsInRange(textLines, sec.start, sec.end, sec.protocol, ch));
      }
      if (text.toLowerCase().includes("lending")) {
        addLending(parseLendingInRange(textLines, sec.start, sec.end, sec.protocol, ch));
      }
      if (text.includes("Deposit") && !text.includes("Liquidity Pool")) {
        addLiquidity(parseYieldPoolsInRange(textLines, sec.start, sec.end, sec.protocol, ch));
      }
      if (/Staking|Locked|Vesting|Perpetual|Perp/i.test(text)) {
        addLiquidity(parseYieldPoolsInRange(textLines, sec.start, sec.end, sec.protocol, ch));
      }
    }
  }

  function inferChainFromSectionText(text, fallback) {
    if (/base_token|chain\/logo_url\/base/i.test(text)) return "base";
    if (/op_token|logo_url\/op\//i.test(text)) return "op";
    if (/arb_token|logo_url\/arb\//i.test(text)) return "arb";
    if (/eth_token|logo_url\/eth\//i.test(text) || /mainnet/i.test(text)) return "eth";
    if (/logo_url\/bsc\//i.test(text)) return "bsc";
    if (/logo_url\/matic\//i.test(text)) return "matic";
    return fallback;
  }

  parseSectionsFromLines(lines, "unknown");
  for (const [slug, ctext] of Object.entries(chainTexts)) {
    parseSectionsFromLines(
      ctext.split("\n").map((l) => l.replace(/\r/g, "")),
      slug,
    );
  }

  function scanWalletTables(textLines, defaultChain, forceChain, options = {}) {
    for (let i = 0; i < textLines.length - 4; i++) {
      if (options.once && walletTokens.length > 0) break;
      if (textLines[i].trim() !== "Token") continue;
      const priceHdr = lineAtSkipEmpty(textLines, i + 1);
      if (priceHdr?.text !== "Price") continue;
      let chain = defaultChain;
      if (!forceChain) {
        for (let j = i; j >= Math.max(0, i - 30); j--) {
          if (textLines[j].trim() === "Wallet") {
            for (let k = j - 1; k >= Math.max(0, j - 20); k--) {
              const slug = slugFromHeaderName(textLines[k].trim());
              if (CHAINS[slug]) {
                chain = slug;
                break;
              }
            }
            break;
          }
        }
      }
      let end = textLines.length;
      for (let j = i + 4; j < textLines.length - 1; j++) {
        const l = textLines[j].trim();
        if (isProtocolHeader(l, textLines, j) || l === "Liquidity Pool" || l === "Lending") {
          end = j;
          break;
        }
      }
      walletTokens.push(...parseWalletTokensInRange(textLines, i, end, chain, showSmall));
    }
  }

  const mainHasWalletTable = (() => {
    for (let i = 0; i < lines.length - 2; i++) {
      if (lines[i].trim() !== "Wallet") continue;
      if (lines[i + 1]?.trim() === "Token" && lines[i + 2]?.trim() === "Price") return true;
    }
    return false;
  })();

  for (const [slug, text] of Object.entries(chainTexts)) {
    scanWalletTables(normalizeDebankInput(text).split("\n"), slug, true, { once: false });
  }
  scanWalletTables(lines, chains[0]?.slug || "eth", false, { once: false });

  const walletByKey = new Map();
  for (const t of walletTokens) {
    const ch = chainSlug(t.chain || "unknown");
    t.chain = ch;
    const k = `${ch}:${String(t.symbol || "").toUpperCase()}`;
    const prev = walletByKey.get(k);
    if (!prev || (t.usd || 0) > (prev.usd || 0)) walletByKey.set(k, { ...t });
  }
  walletTokens = [...walletByKey.values()].sort((a, b) => (b.usd || 0) - (a.usd || 0));

  const liqUsd = liquidity.reduce((s, p) => s + (p.positionUsd || 0), 0);
  const lendUsd = lending.reduce((s, p) => s + (p.netUsd || 0), 0);
  const walletUsd = walletTokens.reduce((s, t) => s + (t.usd || 0), 0);

  if (!totalUsd) totalUsd = liqUsd + lendUsd + walletUsd;

  const walletByChain = {};
  for (const t of walletTokens) {
    const c = t.chain || "unknown";
    if (!walletByChain[c]) walletByChain[c] = [];
    walletByChain[c].push(t);
  }
  for (const c of Object.keys(walletByChain)) {
    walletByChain[c].sort((a, b) => (b.usd || 0) - (a.usd || 0));
  }

  const liquidityDeduped = dedupeLiquidityByTokenId(liquidity);
  const liquidityRows = liquidityDeduped
    .map((p) => {
      normalizeLiquidityRow(p, p.protocol);
      return p;
    })
    .filter((p) => !p._drop);

  const protocolGroups = buildProtocolGroups(lending, liquidityRows, walletTokens, protocolTabs);
  const walletTab = protocolTabs.find((t) => t.protocol === "Wallet");
  if (walletTab?.usd > 0) {
    const w = protocolGroups.find((g) => g.protocol === "Wallet");
    if (w) w.protocolUsd = walletTab.usd;
  }

  const debankTotalUsd = totalUsd;
  const liqUsdFinal = liquidityRows.reduce((s, p) => s + (p.positionUsd || 0), 0);
  const lendUsdFinal = lending.reduce((s, p) => s + (p.netUsd || 0), 0);
  const walletUsdFinal = walletTokens.reduce((s, t) => s + (t.usd || 0), 0);
  const computedSum = liqUsdFinal + lendUsdFinal + walletUsdFinal;

  if (!debankTotalUsd) totalUsd = computedSum;

  return {
    totalUsd: debankTotalUsd || totalUsd,
    debankTotalUsd: debankTotalUsd || totalUsd,
    computedTotalUsd: Math.round(computedSum * 100) / 100,
    coverageGapUsd: Math.max(
      0,
      Math.round(((debankTotalUsd || totalUsd) - computedSum) * 100) / 100,
    ),
    partial: computedSum + 0.5 < (debankTotalUsd || totalUsd),
    walletUsd: Math.round(walletUsdFinal * 100) / 100,
    liqUsd: Math.round(liqUsdFinal * 100) / 100,
    lendUsd: Math.round(lendUsdFinal * 100) / 100,
    chains,
    protocolTabs,
    protocolGroups,
    walletTokens,
    walletByChain,
    lending,
    liquidity: liquidityRows,
    hasSmallBalanceHint: lines.some((l) => /small balance/i.test(l) || /show all/i.test(l)),
  };
}
