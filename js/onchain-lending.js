import { CHAINS, SCAN_CHAINS } from "./onchain-registry.js";
import { rpcForChain, encodeAddress, padAddr } from "./onchain-rpc.js";
import { fetchPricesUsd, usdValue } from "./onchain-prices.js";
import { applyLendingMetrics } from "./lending-metrics.js";

const SEL_USER_ACCOUNT = "0xbf92857c";
const SEL_RESERVES_LIST = "0x89035730";
const SEL_GET_RESERVE_DATA = "0x35ea6a75";
const SEL_BALANCE = "0x70a08231";
const SEL_DECIMALS = "0x313ce567";
const SEL_SYMBOL = "0x95d89b41";

function decodeUint(hex, i) {
  return BigInt("0x" + hex.slice(i * 64, (i + 1) * 64));
}

function decodeAddressWord(hex, i) {
  return "0x" + hex.slice(i * 64 + 24, (i + 1) * 64);
}

async function readErc20Symbol(rpc, addr) {
  try {
    const symHex = await rpc.ethCall(addr, SEL_SYMBOL);
    if (symHex?.length > 130) {
      const len = parseInt(symHex.slice(66, 130), 16);
      return Buffer.from(symHex.slice(130, 130 + len * 2), "hex")
        .toString("utf8")
        .replace(/\0/g, "")
        .toUpperCase();
    }
  } catch {
    /* */
  }
  return addr.slice(2, 8).toUpperCase();
}

async function getReservesList(rpc, pool) {
  const raw = await rpc.ethCall(pool, SEL_RESERVES_LIST);
  if (!raw || raw.length < 128) return [];
  const hex = raw.slice(2);
  const offset = Number(decodeUint(hex, 0));
  const len = Number(decodeUint(hex, offset / 32));
  const assets = [];
  const base = offset / 32 + 1;
  for (let i = 0; i < len; i++) {
    assets.push(decodeAddressWord(hex, base + i));
  }
  return assets;
}

async function getReserveTokens(rpc, pool, asset) {
  const data = SEL_GET_RESERVE_DATA + padAddr(asset);
  const raw = await rpc.ethCall(pool, data);
  if (!raw || raw.length < 64 * 10) return null;
  const hex = raw.slice(2);
  return {
    aToken: decodeAddressWord(hex, 7),
    debtToken: decodeAddressWord(hex, 9),
  };
}

async function erc20Balance(rpc, token, wallet) {
  const raw = await rpc.ethCall(token, SEL_BALANCE + padAddr(wallet));
  return BigInt(raw || 0);
}

async function erc20Decimals(rpc, token) {
  const raw = await rpc.ethCall(token, SEL_DECIMALS);
  return parseInt(raw, 16) || 18;
}

export async function scanAaveLending(wallet, chains = SCAN_CHAINS) {
  const w = wallet.toLowerCase();
  const positions = [];
  const symbols = new Set();

  for (const chain of chains) {
    const aave = CHAINS[chain]?.aave;
    if (!aave?.pool) continue;
    const rpc = rpcForChain(chain);

    let account;
    try {
      const raw = await rpc.ethCall(aave.pool, SEL_USER_ACCOUNT + padAddr(w));
      if (!raw || raw.length < 64 * 6) continue;
      const hex = raw.slice(2);
      account = {
        collateralBase: decodeUint(hex, 0),
        debtBase: decodeUint(hex, 1),
        healthFactor: Number(decodeUint(hex, 5)) / 1e18,
      };
    } catch {
      continue;
    }

    if (account.collateralBase === 0n && account.debtBase === 0n) continue;

    const supplied = [];
    const borrowed = [];
    try {
      const assets = await getReservesList(rpc, aave.pool);
      for (const asset of assets.slice(0, 40)) {
        const rt = await getReserveTokens(rpc, aave.pool, asset);
        if (!rt) continue;
        const sym = await readErc20Symbol(rpc, asset);
        symbols.add(sym);
        const dec = await erc20Decimals(rpc, asset);
        const aBal = await erc20Balance(rpc, rt.aToken, w);
        if (aBal > 0n) {
          const amount = Number(aBal) / 10 ** dec;
          supplied.push({ asset: sym, amount: String(amount), usd: 0, _sym: sym, _amt: amount });
        }
        const dBal = await erc20Balance(rpc, rt.debtToken, w);
        if (dBal > 0n) {
          const amount = Number(dBal) / 10 ** dec;
          borrowed.push({ asset: sym, amount: String(amount), usd: 0, _sym: sym, _amt: amount });
        }
      }
    } catch {
      /* reserve detail failed — use aggregates */
    }

    const prices = await fetchPricesUsd([...symbols]);
    let collateralUsd = 0;
    let debtUsd = 0;
    for (const s of supplied) {
      s.usd = usdValue(s._amt, s._sym, prices);
      delete s._sym;
      delete s._amt;
      collateralUsd += s.usd;
    }
    for (const b of borrowed) {
      b.usd = usdValue(b._amt, b._sym, prices);
      delete b._sym;
      delete b._amt;
      debtUsd += b.usd;
    }

    if (!collateralUsd && !debtUsd) {
      collateralUsd = Number(account.collateralBase) / 1e8;
      debtUsd = Number(account.debtBase) / 1e8;
    }

    const hf =
      account.healthFactor > 1e10 ? 10 : account.healthFactor > 0 ? account.healthFactor : null;

    positions.push(
      applyLendingMetrics({
        protocol: aave.protocol,
        chain,
        healthFactor: hf,
        supplied,
        borrowed,
        rewards: [],
        rewardsUsd: 0,
        collateralUsd,
        debtUsd,
        netUsd: collateralUsd - debtUsd,
        source: "onchain",
      }),
    );
  }

  return positions;
}
