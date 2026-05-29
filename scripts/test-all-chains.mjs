#!/usr/bin/env node
/** Скан всех сетей из SCAN_CHAINS (без API-ключей). PT_FAST=1 — быстрый режим. */
import { scanOnchainPortfolio } from "../js/onchain-portfolio.js";
import { SCAN_CHAINS } from "../js/onchain-registry.js";

const WALLET = process.env.PT_WALLET || "0xE6C9B6407676432a95cE23fd414021ED31fC0566";

const t0 = Date.now();
const p = await scanOnchainPortfolio(WALLET, { chains: SCAN_CHAINS });
const ms = Date.now() - t0;

console.log(
  JSON.stringify(
    {
      ok: true,
      ms,
      chains: SCAN_CHAINS,
      scannedChains: p.stats?.chains,
      totalUsd: p.totalUsd,
      lp: p.stats?.lpCount,
      lend: p.stats?.lendCount,
      protocolTabs: p.protocolTabs?.slice(0, 12),
    },
    null,
    2,
  ),
);
