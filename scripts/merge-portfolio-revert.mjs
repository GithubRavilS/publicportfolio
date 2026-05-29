#!/usr/bin/env node
/** stdin: { portfolio, revertPositions } → stdout: portfolio */
import { mergeRevertLiquidity } from "../js/revert-portfolio-merge.js";
import { syncDisplayTotals } from "../js/portfolio-normalize.js";
import { assignJinaPlainChains } from "../js/revert-match.js";

let input = { portfolio: {}, revertPositions: [] };
try {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw) input = JSON.parse(raw);
} catch (e) {
  process.stderr.write(`PARSE_FAIL:${e.message}\n`);
  process.exit(1);
}

const { portfolio, revertPositions } = input;
if (!portfolio?.protocolGroups?.length || !revertPositions?.length) {
  process.stdout.write(JSON.stringify(portfolio || {}));
  process.exit(0);
}

const rev = assignJinaPlainChains(portfolio, revertPositions);
const out = syncDisplayTotals(mergeRevertLiquidity(portfolio, rev));
process.stdout.write(JSON.stringify(out));
