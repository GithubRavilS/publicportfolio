#!/usr/bin/env node
/** stdin: profile plain text → stdout: parsed JSON */
import { parseDebankProfileText } from "../js/debank-parse.js";

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const text = Buffer.concat(chunks).toString("utf8");
const showSmall = process.env.PT_SHOW_SMALL === "1";
const parsed = parseDebankProfileText(text, { showSmallBalances: showSmall });
const out = {
  totalUsd: parsed.totalUsd,
  lending: parsed.lending,
  liquidity: parsed.liquidity,
  walletTokens: parsed.walletTokens,
  walletByChain: parsed.walletByChain,
  hasSmallBalanceHint: parsed.hasSmallBalanceHint,
};
process.stdout.write(JSON.stringify(out));
