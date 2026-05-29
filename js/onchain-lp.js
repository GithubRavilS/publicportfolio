/**
 * Ончейн LP: все NFPM на поддерживаемых сетях, USD через v3-math + CoinGecko.
 */
import { normPair, normToken, pairMeta, invertPoolPrice } from "./revert-parse.js";
import { CHAINS, SCAN_CHAINS } from "./onchain-registry.js";
import {
  rpcForChain,
  ethCallRotate,
  padAddr,
  encodeAddress,
  encodeUint256,
} from "./onchain-rpc.js";
import { amountsForLiquidity, formatAmount } from "./onchain-v3-math.js";
import { fetchPricesUsd, usdValue } from "./onchain-prices.js";
import { computeUnclaimedFees, rawFeesToAmounts } from "./onchain-v3-fees.js";
import {
  getPositionMintBlock,
  getBlockTimestamp,
  sumCollectedFees,
} from "./onchain-position-meta.js";
import {
  applyPositionSnapshot,
  annualizedApy,
  isOnchainDexProtocol,
  positionStoreKey,
} from "./lp-position-store.js";

const SEL = {
  balanceOf: "0x70a08231",
  tokenOfOwnerByIndex: "0x2f745c59",
  positions: "0x99fbab88",
  slot0: "0x3850c7bd",
  decimals: "0x313ce567",
  symbol: "0x95d89b41",
  getPool: "0x1698ee82",
};

const ERC721_TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f55a4df523b3ef";

function decodeInt24(word) {
  let v = BigInt(word);
  if (v >= 2n ** 255n) v -= 2n ** 256n;
  const max = 2n ** 23n;
  if (v > max) v -= 2n ** 24n;
  if (v < -max) v += 2n ** 24n;
  return Number(v);
}

function decodeUint24(word) {
  return Number(BigInt(word) & 0xffffffn);
}

function decodeAddress(word) {
  return "0x" + BigInt(word).toString(16).padStart(40, "0").slice(-40);
}

export function tickToPriceRatio(tick, decimals0, decimals1) {
  return Math.pow(1.0001, tick) * Math.pow(10, decimals0 - decimals1);
}

export function displayRangeFromTicks(
  tickLower,
  tickUpper,
  tickCurrent,
  decimals0,
  decimals1,
  pairKey,
) {
  const meta = pairMeta(pairKey);
  const pLo = tickToPriceRatio(tickLower, decimals0, decimals1);
  const pHi = tickToPriceRatio(tickUpper, decimals0, decimals1);
  const pCur = tickToPriceRatio(tickCurrent, decimals0, decimals1);

  if (meta.hasBtc || meta.hasGold) {
    const inv = (p) => invertPoolPrice(p);
    const a = inv(pLo);
    const b = inv(pHi);
    const c = inv(pCur);
    return { rangeMin: Math.min(a, b), rangeMax: Math.max(a, b), rangeCurrent: c };
  }
  return {
    rangeMin: Math.min(pLo, pHi),
    rangeMax: Math.max(pLo, pHi),
    rangeCurrent: Math.max(Math.min(pCur, Math.max(pLo, pHi)), Math.min(pLo, pHi)),
  };
}

async function readTokenMeta(chain, address) {
  const decHex = await ethCallRotate(chain, address, SEL.decimals);
  const decimals = decHex && decHex !== "0x" ? parseInt(decHex, 16) : 18;
  let symbol = normToken(address.slice(0, 6));
  try {
    const symHex = await ethCallRotate(chain, address, SEL.symbol);
    if (symHex && symHex.length > 130) {
      const len = parseInt(symHex.slice(66, 130), 16);
      symbol = normToken(
        Buffer.from(symHex.slice(130, 130 + len * 2), "hex")
          .toString("utf8")
          .replace(/\0/g, ""),
      );
    }
  } catch {
    /* */
  }
  return { address: address.toLowerCase(), decimals, symbol };
}

function decodeSlot0Tick(hex) {
  const word1 = BigInt("0x" + hex.slice(64, 128));
  let tick = Number(word1 & 0xffffffn);
  if (tick & 0x800000) tick -= 0x1000000;
  return tick;
}

async function readPoolSlot0(chain, poolAddress) {
  const raw = await ethCallRotate(chain, poolAddress, SEL.slot0);
  if (!raw || raw === "0x" || raw.length < 130) return null;
  const hex = raw.slice(2);
  return { tick: decodeSlot0Tick(hex), sqrtX96: BigInt("0x" + hex.slice(0, 64)) };
}

async function readPosition(chain, nfpm, tokenId) {
  const data = SEL.positions + encodeUint256(tokenId);
  const raw = await ethCallRotate(chain, nfpm, data);
  if (!raw || raw.length < 64 * 10) return null;
  const hex = raw.slice(2);
  const word = (i) => "0x" + hex.slice(i * 64, (i + 1) * 64);
  const w10 = hex.length >= 64 * 11 ? word(10) : "0x0";
  const w11 = hex.length >= 64 * 12 ? word(11) : "0x0";
  return {
    token0: decodeAddress(word(2)),
    token1: decodeAddress(word(3)),
    fee: decodeUint24(word(4)),
    tickLower: decodeInt24(word(5)),
    tickUpper: decodeInt24(word(6)),
    liquidity: BigInt(word(7)),
    feeGrowthInside0LastX128: BigInt(word(8)),
    feeGrowthInside1LastX128: BigInt(word(9)),
    tokensOwed0: BigInt(w10) & (2n ** 128n - 1n),
    tokensOwed1: BigInt(w11) & (2n ** 128n - 1n),
  };
}

async function enumerateTokenIds(rpc, nfpm, wallet) {
  const ids = new Set();
  try {
    const balRaw = await rpc.ethCall(nfpm, SEL.balanceOf + padAddr(wallet));
    const n = Number(BigInt(balRaw || 0));
    for (let i = 0; i < n; i++) {
      const data = SEL.tokenOfOwnerByIndex + padAddr(wallet) + encodeUint256(i);
      const tid = BigInt(await rpc.ethCall(nfpm, data));
      if (tid > 0n) ids.add(tid.toString());
    }
  } catch {
    /* */
  }
  if (!ids.size) {
    let latest;
    try {
      latest = await rpc.blockNumber();
    } catch {
      return [];
    }
    const walletTopic = "0x" + padAddr(wallet);
    const chunk = 50000n;
    let to = latest;
    while (to > latest - 200000n && to > 0n) {
      const from = to > chunk ? to - chunk : 0n;
      try {
        const logs = await rpc.call("eth_getLogs", [
          {
            fromBlock: "0x" + from.toString(16),
            toBlock: "0x" + to.toString(16),
            address: nfpm,
            topics: [ERC721_TRANSFER, null, walletTopic],
          },
        ]);
        for (const log of logs || []) {
          if (log.topics?.[3]) ids.add(BigInt(log.topics[3]).toString());
        }
      } catch {
        /* */
      }
      to = from > 0n ? from - 1n : 0n;
    }
  }
  return [...ids];
}

async function resolvePoolAddress(chain, factory, token0, token1, fee, nf) {
  if (!factory) return null;
  const [a, b] = token0.toLowerCase() < token1.toLowerCase() ? [token0, token1] : [token1, token0];
  const feeWords = new Set();
  const isAero = nf?.protocol?.includes("Aerodrome");
  if (isAero) {
    for (const ts of [fee, 1, 50, 100, 200, 500, 2000]) {
      feeWords.add(BigInt(ts).toString(16).padStart(64, "0"));
    }
  } else {
    feeWords.add(BigInt(fee).toString(16).padStart(64, "0"));
    const div = nf?.feeDiv || 10000;
    if (div !== 10000) {
      const alt = Math.round((fee / div) * 10000);
      feeWords.add(BigInt(alt).toString(16).padStart(64, "0"));
    }
    for (const tier of [100, 500, 3000, 10000, 2500, 250]) {
      feeWords.add(BigInt(tier).toString(16).padStart(64, "0"));
    }
  }
  for (const fw of feeWords) {
    try {
      const raw = await ethCallRotate(
        chain,
        factory,
        SEL.getPool + encodeAddress(a) + encodeAddress(b) + fw,
      );
      if (!raw || raw.length < 66) continue;
      const pool = ("0x" + raw.replace(/^0x/, "").slice(-40)).toLowerCase();
      if (pool === "0x0000000000000000000000000000000000000000") continue;
      return pool;
    } catch {
      /* */
    }
  }
  return null;
}

async function enrichLpMetrics(wallet, rpc, nf, pool, pos, t0, t1, tickCurrent, row) {
  if (!isOnchainDexProtocol(nf.protocol)) return;

  const feesRaw = pool.poolAddress
    ? await computeUnclaimedFees(row.chain, pool.poolAddress, pos, tickCurrent)
    : null;
  const unclaimed = feesRaw
    ? rawFeesToAmounts(feesRaw, t0.decimals, t1.decimals)
    : {
        amount0: Number(pos.tokensOwed0 || 0) / 10 ** t0.decimals,
        amount1: Number(pos.tokensOwed1 || 0) / 10 ** t1.decimals,
      };

  const collected = await sumCollectedFees(
    rpc,
    nf.address,
    row.tokenId,
    t0.decimals,
    t1.decimals,
    wallet,
    nf.protocol,
    row.chain,
  );

  const mintBlock = await getPositionMintBlock(
    rpc,
    nf.address,
    row.tokenId,
    wallet,
    nf.protocol,
    row.chain,
  );
  let openedAt = null;
  let hoursOpen = null;
  if (mintBlock != null) {
    openedAt = await getBlockTimestamp(rpc, mintBlock);
    if (openedAt) hoursOpen = (Date.now() - openedAt) / 3600000;
  }

  row.feesEarned = {
    unclaimed: [
      { symbol: t0.symbol, amount: unclaimed.amount0.toFixed(8) },
      { symbol: t1.symbol, amount: unclaimed.amount1.toFixed(8) },
    ],
    collected: [
      { symbol: t0.symbol, amount: collected.amount0.toFixed(8) },
      { symbol: t1.symbol, amount: collected.amount1.toFixed(8) },
    ],
  };
  row.openedAt = openedAt;
  row.hoursOpen = hoursOpen;
  row.onchainMetrics = true;
}

async function nfpmHasCode(chain, address) {
  const rpc = rpcForChain(chain);
  try {
    return await rpc.getCode(address);
  } catch {
    return false;
  }
}

async function scanChainLp(wallet, chain, symbols) {
  const w = wallet.toLowerCase();
  const liquidity = [];
  const cfg = CHAINS[chain];
  if (!cfg?.nfpm?.length) return liquidity;
  const rpc = rpcForChain(chain);

  for (const nf of cfg.nfpm) {
    if (nf.v4) continue;
    try {
      if (!(await nfpmHasCode(chain, nf.address))) continue;
    } catch {
      continue;
    }

    const tokenIds = await enumerateTokenIds(rpc, nf.address, w);
    for (const tokenIdStr of tokenIds) {
      let pos;
      try {
        pos = await readPosition(chain, nf.address, BigInt(tokenIdStr));
      } catch {
        continue;
      }
      if (!pos) continue;

      const t0 = await readTokenMeta(chain, pos.token0);
      const t1 = await readTokenMeta(chain, pos.token1);
      symbols.add(t0.symbol);
      symbols.add(t1.symbol);

      const pairKey = normPair(`${t0.symbol}+${t1.symbol}`);
      let poolAddress = await resolvePoolAddress(
        chain,
        nf.factory,
        pos.token0,
        pos.token1,
        pos.fee,
        nf,
      );
      let tickCurrent = Math.round((pos.tickLower + pos.tickUpper) / 2);
      if (poolAddress) {
        const slot = await readPoolSlot0(chain, poolAddress);
        if (slot?.tick != null) tickCurrent = slot.tick;
      }

      const range = displayRangeFromTicks(
        pos.tickLower,
        pos.tickUpper,
        tickCurrent,
        t0.decimals,
        t1.decimals,
        pairKey,
      );

      const { amount0, amount1 } = amountsForLiquidity(
        pos.liquidity,
        pos.tickLower,
        pos.tickUpper,
        tickCurrent,
      );
      const amt0 = formatAmount(amount0, t0.decimals);
      const amt1 = formatAmount(amount1, t1.decimals);

      const feeTierPct = pos.fee / (nf.feeDiv || 10000);
      const feeTier = `${feeTierPct.toFixed(2)}%`;

      liquidity.push({
        protocol: nf.protocol,
        chain,
        poolId: tokenIdStr,
        pair: pairKey.replace("+", "+"),
        pairKey,
        feeTier,
        feeTierPct,
        inPool: [
          { amount: amt0.toFixed(6), symbol: t0.symbol },
          { amount: amt1.toFixed(8), symbol: t1.symbol },
        ],
        positionUsd: 0,
        claimable: [],
        claimableUsd: 0,
        netUsd: 0,
        source: "onchain",
        onchain: true,
        tokenId: tokenIdStr,
        poolAddress,
        tickLower: pos.tickLower,
        tickUpper: pos.tickUpper,
        liquidity: pos.liquidity.toString(),
        ...range,
        _amt0: amt0,
        _amt1: amt1,
        _sym0: t0.symbol,
        _sym1: t1.symbol,
        _nf: nf,
        _pos: pos,
        _tickCurrent: tickCurrent,
        _t0: t0,
        _t1: t1,
      });
    }
  }
  return liquidity;
}

export async function scanLpPositions(wallet, chains = SCAN_CHAINS) {
  const w = wallet.toLowerCase();
  const symbols = new Set();
  const chainList = chains.filter((c) => CHAINS[c]?.nfpm?.length);
  const parts = await Promise.all(chainList.map((chain) => scanChainLp(w, chain, symbols)));
  const liquidity = parts.flat();

  const prices = await fetchPricesUsd([...symbols]);
  for (const p of liquidity) {
    const usd0 = usdValue(p._amt0, p._sym0, prices);
    const usd1 = usdValue(p._amt1, p._sym1, prices);
    p.positionUsd = usd0 + usd1;
    p.netUsd = p.positionUsd;

    if (p._nf && p._pos) {
      await enrichLpMetrics(
        w,
        rpcForChain(p.chain),
        p._nf,
        { poolAddress: p.poolAddress },
        p._pos,
        p._t0,
        p._t1,
        p._tickCurrent,
        p,
      );
    }

    if (p.feesEarned) {
      const u0 = usdValue(parseFloat(p.feesEarned.unclaimed[0]?.amount || 0), p._sym0, prices);
      const u1 = usdValue(parseFloat(p.feesEarned.unclaimed[1]?.amount || 0), p._sym1, prices);
      const c0 = usdValue(parseFloat(p.feesEarned.collected[0]?.amount || 0), p._sym0, prices);
      const c1 = usdValue(parseFloat(p.feesEarned.collected[1]?.amount || 0), p._sym1, prices);
      p.claimableUsd = u0 + u1;
      p.collectedFeesUsd = c0 + c1;
      p.totalFeesUsd = p.claimableUsd + p.collectedFeesUsd;
      p.claimable = p.feesEarned.unclaimed.filter((x) => parseFloat(x.amount) > 0);
      p.apyAnnualized = annualizedApy(p.totalFeesUsd, p.positionUsd, p.hoursOpen);
      const storeKey = positionStoreKey(p.protocol, p.chain, p.tokenId);
      const { apyFromSnapshots } = applyPositionSnapshot(w, storeKey, {
        feesUsd: p.totalFeesUsd,
        principalUsd: p.positionUsd,
        unclaimedUsd: p.claimableUsd,
        collectedUsd: p.collectedFeesUsd,
      });
      if (apyFromSnapshots != null && Number.isFinite(apyFromSnapshots)) {
        p.apyRecent = apyFromSnapshots;
      }
    }

    delete p._amt0;
    delete p._amt1;
    delete p._sym0;
    delete p._sym1;
    delete p._nf;
    delete p._pos;
    delete p._tickCurrent;
    delete p._t0;
    delete p._t1;
    if (p.positionUsd < 0.01) p.positionUsd = 0;
  }

  return liquidity.filter((p) => {
    if (p.positionUsd >= 0.02) return true;
    try {
      return BigInt(p.liquidity || 0) > 0n;
    } catch {
      return false;
    }
  });
}
