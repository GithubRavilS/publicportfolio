#!/usr/bin/env node
/** stdout: portfolio JSON from DeBank OpenAPI */
import { buildPortfolioFromDebankApi } from "../js/debank-api-portfolio.js";
import { finalizeDebankPortfolioClone } from "../js/portfolio-pipeline.js";

const wallet = process.argv[2];
const key = process.env.DEBANK_ACCESS_KEY || process.env.DEBANK_OPENAPI_KEY || "";
const showSmall = process.env.PT_SHOW_SMALL === "1";

if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
  process.stderr.write("usage: run-debank-api.mjs 0x...\n");
  process.exit(1);
}
if (!key) {
  process.stderr.write("DEBANK_ACCESS_KEY missing\n");
  process.exit(2);
}

try {
  const raw = await buildPortfolioFromDebankApi(wallet, key, { showSmallBalances: showSmall });
  const p = finalizeDebankPortfolioClone(raw);
  process.stdout.write(
    JSON.stringify({
      totalUsd: p.totalUsd,
      debankTotalUsd: p.debankTotalUsd,
      walletUsd: p.walletUsd,
      liqUsd: p.liqUsd,
      lendUsd: p.lendUsd,
      computedTotalUsd: p.computedTotalUsd,
      coverageGapUsd: p.coverageGapUsd,
      overCountUsd: p.overCountUsd,
      partial: p.partial,
      chains: p.chains,
      protocolTabs: p.protocolTabs,
      protocolGroups: p.protocolGroups,
      lending: p.lending,
      liquidity: p.liquidity,
      walletTokens: p.walletTokens,
      walletByChain: p.walletByChain,
      hasSmallBalanceHint: p.hasSmallBalanceHint,
      fromDebankApi: true,
      source: "debank-api",
      netCurve: raw.netCurve,
    }),
  );
} catch (e) {
  process.stderr.write(String(e.message || e));
  process.exit(1);
}
