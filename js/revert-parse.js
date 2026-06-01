/** Парсер страницы revert.finance/account/{wallet} (Jina markdown). */

const NETWORK_TO_CHAIN = {
  mainnet: "eth",
  ethereum: "eth",
  arbitrum: "arb",
  base: "base",
  optimism: "op",
  polygon: "matic",
  matic: "matic",
  bsc: "bsc",
  unichain: "unichain",
};

export function aprToApy(apr) {
  if (apr == null || !Number.isFinite(apr)) return null;
  const a = Number(apr);
  if (Math.abs(a) > 500) return null;
  return (Math.pow(1 + a / 100 / 12, 12) - 1) * 100;
}

function parseUsd(line) {
  const m = String(line || "").match(/\$([\d,]+\.?\d*)/);
  if (!m) return null;
  return parseFloat(m[1].replace(/,/g, "")) || 0;
}

/** Проценты: -1,158% → -11.58 (запятая не тысячи). */
export function parsePct(line) {
  const s = String(line || "").trim();
  if (!s.endsWith("%")) return null;
  const body = s.slice(0, -1);
  let v = NaN;
  const commaDec = body.match(/^(-?)(\d+),(\d+)$/);
  if (commaDec && !body.includes(".")) {
    const whole = commaDec[2];
    const frac = commaDec[3];
    if (frac.length >= 3) {
      v = parseFloat(`${commaDec[1]}${whole}${frac}`) / 100;
    } else {
      v = parseFloat(`${commaDec[1]}${whole}.${frac}`);
    }
  }
  if (!Number.isFinite(v)) {
    v = parseFloat(body.replace(/,/g, ""));
  }
  if (!Number.isFinite(v)) return null;
  if (Math.abs(v) > 500) return null;
  return v;
}

function parseNum(line) {
  const s = String(line || "")
    .trim()
    .replace(/\s/g, "")
    .replace(/,/g, "");
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : null;
}

export function pairMeta(pairKey) {
  const tokens = String(pairKey || "")
    .split("+")
    .filter(Boolean);
  return {
    allStable: tokens.length >= 2 && tokens.every((t) => STABLE_TOKENS.has(t)),
    hasBtc: tokens.some((t) => BTC_TOKENS.has(t) || t.endsWith("BTC")),
    hasGold: tokens.some((t) => GOLD_TOKENS.has(t)),
  };
}

/** Подсказки рыночной цены с других позиций кошелька (WBTC/USDT и т.д.). */
export function buildMarketHints(positions) {
  const hints = {};
  for (const p of positions || []) {
    const pk = p.pairKey || normPair(p.pair);
    const cur = p.rangeCurrent;
    if (cur != null && cur >= 5000 && (pk.includes("BTC") || pk.includes("WBTC"))) {
      hints.btcUsd = cur;
    }
    if (cur != null && cur >= 500 && pk.includes("XAUT")) {
      hints.goldUsd = cur;
    }
  }
  return hints;
}

function mapChain(network) {
  return NETWORK_TO_CHAIN[String(network || "").toLowerCase()] || network;
}

const TOKEN_ALIASES = {
  USDT0: "USDT",
  USDTE: "USDT",
  "USD₮0": "USDT",
  USDC0: "USDC",
  XAUT0: "XAUT",
  XAUT: "XAUT",
  XAUt0: "XAUT",
  XAUt: "XAUT",
  CBBTC: "CBBTC",
  WBTC: "WBTC",
  WETH: "WETH",
  ETH: "ETH",
};

const STABLE_TOKENS = new Set(["USDC", "USDT", "DAI", "GHO", "RLUSD", "FRAX", "USDE", "LUSD"]);
const BTC_TOKENS = new Set(["WBTC", "CBBTC", "BTC", "TBTC"]);
const GOLD_TOKENS = new Set(["XAUT"]);

export function normToken(symbol) {
  let s = String(symbol || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/₮/g, "T");
  if (TOKEN_ALIASES[s]) return TOKEN_ALIASES[s];
  return s;
}

export function normPair(pair) {
  return String(pair || "")
    .replace(/\s+/g, "")
    .replace(/-/g, "/")
    .split(/[+/]/)
    .filter(Boolean)
    .map(normToken)
    .sort()
    .join("+");
}

export function normFeeTier(tier) {
  const m = String(tier || "").match(/([\d.]+)\s*%/);
  return m ? parseFloat(m[1]) : null;
}

export const RANGE_FLIP_THRESHOLD = 0.5;

/** Jina/Revert markdown округляет до 0.00001 — точных тиков нет. */
export function isCoarseMicroRange(raw) {
  const nums = (raw || []).filter((n) => n != null && Number.isFinite(n) && n > 0);
  if (nums.length < 2) return false;
  return nums.every((n) => n < 0.0001);
}

/** Оценка цены BTC/cbBTC по составу позиции DeBank (USDC + cbBTC). */
export function spotFromInPool(inPool, positionUsd, pairKey) {
  const meta = pairMeta(pairKey);
  if (!meta.hasBtc || !inPool?.length) return null;
  let stableUsd = 0;
  let btcAmt = 0;
  for (const x of inPool) {
    const sym = normToken(x.symbol);
    const amt = parseFloat(String(x.amount || "0").replace(/,/g, ""));
    if (!Number.isFinite(amt) || amt <= 0) continue;
    if (STABLE_TOKENS.has(sym)) stableUsd += amt;
    if (BTC_TOKENS.has(sym)) btcAmt += amt;
  }
  if (btcAmt <= 0 || positionUsd <= stableUsd) return null;
  const px = (positionUsd - stableUsd) / btcAmt;
  if (px < 1000 || px > 500000) return null;
  return px;
}

/** Revert показывает цену пула как 0.0000128 — для UI берём 1/x (USD за 1 BTC и т.д.). */
export function invertPoolPrice(n) {
  if (n == null || !Number.isFinite(n) || n <= 0) return n;
  if (n < RANGE_FLIP_THRESHOLD) return 1 / n;
  return n;
}

function rangeFromOrdered(min, cur, max) {
  const a = Math.min(min, max);
  const b = Math.max(min, max);
  const c = cur ?? (a + b) / 2;
  return { rangeMin: a, rangeMax: b, rangeCurrent: c, rangeNums: [a, c, b] };
}

/** Диапазон пригоден для UI (стейбл ≈1, не «микро»-заглушка Jina). */
export function isDisplayRangeUsable(rangeMin, rangeMax, rangeCurrent, pairKey) {
  if (rangeMin == null || rangeMax == null) return false;
  const meta = pairMeta(pairKey);
  const nums = [rangeMin, rangeMax, rangeCurrent].filter((x) => x != null && Number.isFinite(x));
  if (isCoarseMicroRange(nums)) return false;
  if (meta.allStable) {
    const mid = (rangeMin + rangeMax) / 2;
    if (mid < 0.85 || mid > 1.15) return false;
  }
  return true;
}

/** Формат цены на полосе диапазона: стейблы — 4 знака, BTC/ETH — целые. */
export function fmtRangeDisplay(n, pairKey) {
  if (n == null || !Number.isFinite(n)) return "—";
  const v = Number(n);
  const meta = pairMeta(pairKey);
  if (meta.allStable) return v.toFixed(4);
  if (v >= 1000) return Math.round(v).toLocaleString("en-US");
  if (v >= 1) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return v.toFixed(4);
}

/**
 * @param {number[]} rangeNums — числа с карточки Revert (часто min, current, max)
 * @param {string} pairKey
 * @param {{ largeNums?: number[], marketHints?: object }} opts
 */
export function normalizeRevertRange(rangeNums, pairKey, opts = {}) {
  const raw = (rangeNums || []).filter((n) => n != null && Number.isFinite(n));
  const large = (opts.largeNums || []).filter((n) => n >= 100);
  const hints = opts.marketHints || {};
  const meta = pairMeta(pairKey);

  if (large.length >= 2) {
    const sorted = [...large].sort((a, b) => a - b);
    let cur =
      raw.length >= 3 && raw[1] >= 100
        ? raw[1]
        : large.length >= 3
          ? large[1]
          : (sorted[0] + sorted[sorted.length - 1]) / 2;
    return rangeFromOrdered(sorted[0], cur, sorted[sorted.length - 1]);
  }

  if (meta.allStable && raw.length >= 2) {
    const band = raw.filter((n) => n >= 0.85 && n <= 1.15);
    const vals = band.length >= 2 ? band : raw;
    if (vals.length >= 2) {
      const cur = vals.length >= 3 ? vals[1] : vals[Math.floor(vals.length / 2)];
      const sorted = [...vals].sort((a, b) => a - b);
      return rangeFromOrdered(sorted[0], cur, sorted[sorted.length - 1]);
    }
    if (raw.every((n) => n < RANGE_FLIP_THRESHOLD)) {
      const inv = raw.map(invertPoolPrice).filter((n) => n >= 0.85 && n <= 1.15);
      if (inv.length >= 2) {
        const sorted = [...inv].sort((a, b) => a - b);
        const cur = inv.length >= 3 ? inv[1] : sorted[Math.floor(sorted.length / 2)];
        return rangeFromOrdered(sorted[0], cur, sorted[sorted.length - 1]);
      }
    }
  }

  if (raw.length >= 2 && raw.every((n) => n < RANGE_FLIP_THRESHOLD)) {
    const inv = raw.map(invertPoolPrice);
    const rangeMin = Math.min(...inv);
    const rangeMax = Math.max(...inv);
    const spot =
      hints.spotUsd || (meta.hasBtc ? hints.btcUsd : null) || (meta.hasGold ? hints.goldUsd : null);

    if (isCoarseMicroRange(raw) && spot) {
      const loF = 1.22;
      const hiF = 1.151;
      return rangeFromOrdered(spot / loF, spot, spot * hiF);
    }

    let rangeCurrent = raw.length >= 3 ? invertPoolPrice(raw[1]) : (rangeMin + rangeMax) / 2;
    const atEdge = rangeCurrent >= rangeMax * 0.998 || rangeCurrent <= rangeMin * 1.002;
    if (atEdge) {
      if (spot) rangeCurrent = spot;
      else {
        const sortedRaw = [...raw].sort((a, b) => a - b);
        rangeCurrent = invertPoolPrice(sortedRaw[Math.floor(sortedRaw.length / 2)]);
      }
    }
    return rangeFromOrdered(rangeMin, rangeCurrent, rangeMax);
  }

  if (raw.length && raw.every((n) => n >= RANGE_FLIP_THRESHOLD && n < 1e6)) {
    if (raw.length >= 3) return rangeFromOrdered(raw[0], raw[1], raw[2]);
    if (raw.length === 2) return rangeFromOrdered(raw[0], (raw[0] + raw[1]) / 2, raw[1]);
    const c = raw[0];
    return rangeFromOrdered(c * 0.999, c, c * 1.001);
  }

  return { rangeMin: null, rangeMax: null, rangeCurrent: null, rangeNums: [] };
}

/** Только Fee APR; отрицательный Total APR не используем. */
export function feeAprForDisplay(feeApr) {
  const v = sanitizeApr(feeApr);
  if (v == null || v < 0) return null;
  return v;
}

export function displayApyFromFeeApr(feeApr) {
  const fee = feeAprForDisplay(feeApr);
  return fee != null ? aprToApy(fee) : null;
}

export function finalizeRevertPosition(rev, marketHints = null) {
  const nums =
    rev.rangeNums?.length > 0
      ? rev.rangeNums
      : [rev.rangeMin, rev.rangeCurrent, rev.rangeMax].filter(
          (x) => x != null && Number.isFinite(x),
        );
  const range = normalizeRevertRange(nums, rev.pairKey || normPair(rev.pair), {
    largeNums: rev.largeNums,
    marketHints: marketHints || rev.marketHints,
  });
  const displayApy = displayApyFromFeeApr(rev.feeApr);
  return {
    ...rev,
    ...range,
    displayApy,
    apy: displayApy,
    feeApy: displayApy,
  };
}

export function formatPairDisplay(pair) {
  return String(pair || "")
    .replace(/\s+/g, "")
    .split(/[+/]/)
    .filter(Boolean)
    .map((s) => normToken(s))
    .join("+");
}

function isSkippableRow(row) {
  return (
    !row ||
    row.startsWith("!") ||
    row.startsWith("[") ||
    /keyboard_|ios_share|manage_search|HOLD|Deposit|Withdraw|Compound|Simulator|Logs|Rewards/i.test(
      row,
    ) ||
    row === "v3" ||
    row === "CL" ||
    row.length > 48
  );
}

/** Эвристика пары по ценам в диапазоне (ETH/USDC ~1k–5k). */
export function inferPairFromRangeNums(rangeNums) {
  const nums = (rangeNums || []).filter((n) => n > 50 && n < 500_000);
  if (nums.length < 2) return { pair: "", pairKey: "" };
  const mid = nums.length >= 3 ? nums[1] : (nums[0] + nums[1]) / 2;
  if (mid >= 400 && mid <= 25_000) {
    return { pair: "WETH/USDC", pairKey: "WETH+USDC" };
  }
  if (mid >= 50_000 && mid <= 200_000) {
    return { pair: "WBTC/USDC", pairKey: "WBTC+USDC" };
  }
  return { pair: "", pairKey: "" };
}

/**
 * Jina без markdown-ссылок на пулы — блоки "range" + "pooled assets".
 * @param {string} text
 */
export function parseRevertJinaPlainBlocks(text) {
  const lines = String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase() !== "range") continue;
    const nums = [];
    let j = i + 1;
    for (; j < Math.min(i + 8, lines.length); j++) {
      const row = lines[j];
      if (/^pooled assets$/i.test(row)) break;
      if (/^total /i.test(row) || /^fee /i.test(row) || /^uncollected/i.test(row)) break;
      const n = parseNum(row);
      if (n != null && n >= 0.0001) nums.push(n);
    }
    let pooledUsd = 0;
    let feeApr = null;
    let totalApr = null;
    let uncollectedUsd = 0;
    let totalPnlUsd = 0;
    for (; j < Math.min(i + 28, lines.length); j++) {
      const row = lines[j];
      const prev = (lines[j - 1] || "").toLowerCase();
      if (row.toLowerCase() === "range") break;
      const u = parseUsd(row);
      if (/^pooled assets$/i.test(prev) && u != null && u > 0) pooledUsd = u;
      if (
        u != null &&
        pooledUsd === 0 &&
        row.startsWith("$") &&
        u > 1 &&
        !/total pnl/i.test(prev)
      ) {
        pooledUsd = u;
      }
      if (/^uncollected fees$/i.test(prev) && u != null) uncollectedUsd = u;
      if (/^total pnl$/i.test(prev) && u != null) totalPnlUsd = u;
      const p = parsePct(row);
      if (p != null && /fee apr/i.test(prev)) feeApr = p;
      if (p != null && /total apr/i.test(prev)) totalApr = p;
    }
    if (nums.length >= 2 && pooledUsd > 1) {
      blocks.push({
        rangeNums: nums.slice(0, 3),
        largeNums: nums.filter((n) => n >= 100),
        pooledUsd,
        feeApr,
        totalApr,
        uncollectedUsd,
        totalPnlUsd,
      });
    }
  }
  return blocks.map((b, idx) => ({
    pair: "",
    pairKey: "",
    chain: "",
    network: "",
    exchange: "",
    poolAddress: "",
    positionId: `revert-slot-${idx}`,
    pooledUsd: b.pooledUsd,
    feeApr: b.feeApr,
    totalApr: b.totalApr,
    uncollectedUsd: b.uncollectedUsd,
    totalPnlUsd: b.totalPnlUsd,
    rangeNums: b.rangeNums,
    largeNums: b.largeNums?.length ? b.largeNums : b.rangeNums,
    jinaPlain: true,
    metricsOnly: true,
    detailUrl: "",
  }));
}

/**
 * @param {string} text
 */
export function parseRevertAccountText(text) {
  const lines = String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const positions = [];
  const poolLinkRe =
    /\[([A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+)\]\(https:\/\/revert\.finance\/#\/pool\/([^/)]+)\/([^/)]+)\/(0x[a-fA-F0-9]+)\)/i;
  const accountLinkRe = /revert\.finance\/#\/account\/(0x[a-fA-F0-9]+)\/([^/]+)\/(0x[a-fA-F0-9]+)/i;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(poolLinkRe);
    if (!m) continue;

    const pair = m[1].replace(/\s+/g, "");
    const network = m[2];
    const exchange = m[3];
    const poolAddress = m[4].toLowerCase();
    const chain = mapChain(network);

    let feeTier = "";
    let pooledUsd = 0;
    let totalPnlUsd = 0;
    let totalApr = null;
    let feeApr = null;
    let uncollectedUsd = 0;
    let positionId = poolAddress;
    let detailUrl = "";
    const rangeNums = [];
    const largeNums = [];
    const pcts = [];
    const dollarRows = [];

    for (let j = i + 1; j < Math.min(i + 40, lines.length); j++) {
      const row = lines[j];
      if (poolLinkRe.test(row)) break;

      const am = row.match(accountLinkRe);
      if (am) {
        positionId = am[3].toLowerCase();
        detailUrl = `https://revert.finance/#/account/${am[1]}/${am[2]}/${am[3]}`;
      }

      if (/^\d+\.\d+%$/.test(row) && !feeTier) {
        feeTier = row;
        continue;
      }

      const u = parseUsd(row);
      if (u != null && row.startsWith("$") && !row.includes("(")) {
        const neg = /-\s*\$/.test(row) || row.trim().startsWith("-$");
        dollarRows.push({ u, neg });
        continue;
      }

      const p = parsePct(row);
      if (p != null) {
        pcts.push(p);
        continue;
      }

      const micros = row.match(/\b0\.0\d{4,}\b/g);
      if (micros) {
        for (const m of micros) {
          const v = parseFloat(m);
          if (v > 0 && v < RANGE_FLIP_THRESHOLD && rangeNums.length < 6) rangeNums.push(v);
        }
      }

      const n = parseNum(row);
      if (n != null && !isSkippableRow(row)) {
        if (n >= 100) largeNums.push(n);
        else if (n < RANGE_FLIP_THRESHOLD && rangeNums.length < 6) rangeNums.push(n);
      }
    }

    for (const d of dollarRows) {
      if (d.neg) totalPnlUsd = -d.u;
      else if (!pooledUsd) pooledUsd = d.u;
      else uncollectedUsd = d.u;
    }

    if (pcts.length >= 2) {
      totalApr = sanitizeApr(pcts[0]);
      feeApr = sanitizeApr(pcts[1]);
    } else if (pcts.length === 1) {
      feeApr = sanitizeApr(pcts[0]);
    }

    const feeTierPct = normFeeTier(feeTier);
    const pairKey = normPair(pair);

    const microOnly = rangeNums.filter((n) => n < RANGE_FLIP_THRESHOLD);
    const orderedMicro =
      microOnly.length >= 2
        ? microOnly.slice(0, 3)
        : rangeNums.filter((n) => n < RANGE_FLIP_THRESHOLD).slice(0, 3);

    positions.push({
      pair,
      pairKey,
      chain,
      network,
      exchange: exchange.toLowerCase(),
      poolAddress,
      positionId,
      feeTier,
      feeTierPct,
      pooledUsd,
      totalPnlUsd,
      totalApr,
      feeApr,
      uncollectedUsd,
      detailUrl:
        detailUrl ||
        `https://revert.finance/#/account/${walletFromLines(lines) || ""}/${network}/${positionId}`,
      rangeNums: orderedMicro.length >= 2 ? orderedMicro : rangeNums.slice(0, 3),
      largeNums,
    });
  }

  const hints = buildMarketHints(
    positions.map((p) => ({ pairKey: p.pairKey, rangeCurrent: p.largeNums?.[1] ?? null })),
  );
  for (const p of positions) {
    if (p.largeNums?.length >= 2) {
      const sorted = [...p.largeNums].sort((a, b) => a - b);
      p.rangeCurrent =
        p.largeNums[1] >= 100 ? p.largeNums[1] : (sorted[0] + sorted[sorted.length - 1]) / 2;
    }
  }
  const hints2 = buildMarketHints(
    positions.map((p) => {
      const r = normalizeRevertRange(p.rangeNums, p.pairKey, {
        largeNums: p.largeNums,
        marketHints: hints,
      });
      return { pairKey: p.pairKey, rangeCurrent: r.rangeCurrent };
    }),
  );
  const finalized = positions.map((p) => finalizeRevertPosition(p, { ...hints, ...hints2 }));
  if (finalized.length) return finalized;

  return parseRevertJinaPlainBlocks(text);
}

function sanitizeApr(v) {
  if (v == null || !Number.isFinite(v)) return null;
  if (Math.abs(v) > 200) return null;
  return v;
}

function walletFromLines(lines) {
  for (const l of lines) {
    const m = l.match(/0x[a-fA-F0-9]{40}/);
    if (m) return m[0].toLowerCase();
  }
  return "";
}
