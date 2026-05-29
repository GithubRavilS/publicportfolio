/**
 * Единая цепочка портфеля (web + mobile):
 * DeBank parse → dedupe → normalize totals → optional enrich hooks.
 */
import { parseDebankProfileText } from "./debank-parse.js";
import { dedupePortfolioPositions } from "./portfolio-dedupe.js";
import {
  normalizePortfolioChains,
  syncDisplayTotals,
  PORTFOLIO_SCHEMA,
} from "./portfolio-normalize.js";
import {
  fillCoverageFromProtocolTabs,
  fillCoverageFromChainGaps,
  fillCoverageResidual,
} from "./portfolio-debank-fill.js";
import { mergeRevertLiquidity } from "./revert-portfolio-merge.js";

export { PORTFOLIO_SCHEMA };

/** @param {object} raw — результат parseDebankProfileText */
export function finalizeDebankPortfolio(raw) {
  if (!raw) return raw;
  const p = { ...raw, schemaVersion: PORTFOLIO_SCHEMA };
  fillCoverageFromProtocolTabs(p);
  fillCoverageFromChainGaps(p);
  fillCoverageResidual(p);
  return syncDisplayTotals(normalizePortfolioChains(p));
}

/**
 * @param {string} mainText
 * @param {object} opts — chainTexts, chainProtocolIndex, showSmallBalances
 */
export function buildPortfolioFromDebank(mainText, opts = {}) {
  const parsed = parseDebankProfileText(mainText, opts);
  return finalizeDebankPortfolio(parsed);
}

/** После загрузки Revert / on-chain. */
export function enrichPortfolio(portfolio, { revertPositions = null } = {}) {
  if (!portfolio) return portfolio;
  let p = portfolio;
  if (revertPositions?.length) {
    p = mergeRevertLiquidity(p, revertPositions);
  }
  return syncDisplayTotals(p);
}

export function applyPortfolioPipeline(portfolio, enrich = {}) {
  return enrichPortfolio(finalizeDebankPortfolio(portfolio), enrich);
}
