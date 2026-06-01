#!/usr/bin/env node
/** stdin: { portfolio, wallet } → stdout: sanitized portfolio */
import { finalizeOnchainPortfolio } from "../js/portfolio-onchain-finalize.js";

const raw = await new Promise((res) => {
  const c = [];
  process.stdin.on("data", (d) => c.push(d));
  process.stdin.on("end", () => res(Buffer.concat(c).toString("utf8")));
});

const { portfolio, wallet } = JSON.parse(raw || "{}");
if (!portfolio || !/^0x[a-fA-F0-9]{40}$/.test(wallet || "")) {
  process.stderr.write("INVALID_INPUT\n");
  process.exit(1);
}

const out = await finalizeOnchainPortfolio(portfolio, wallet);
process.stdout.write(JSON.stringify({ ok: true, portfolio: out }));
