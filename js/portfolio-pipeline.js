/**
 * Единая цепочка портфеля:
 * 1) DeBank clone (без синтетических fill-строк)
 * 2) Обогащение: Revert → Krystal → lending metrics
 */
import { parseDebankProfileText } from "./debank-parse.js";
import { dedupePortfolioPositions } from "./portfolio-dedupe.js";
import {
  normalizePortfolioChains,
  syncDisplayTotals,
  PORTFOLIO_SCHEMA,
} from "./portfolio-normalize.js";
import { mergeRevertLiquidity } from "./revert-portfolio-merge.js";
import { mergeKrystalLiquidity } from "./krystal-portfolio-merge.js";
import { applyLendingMetrics } from "./lending-metrics.js";

import { portfolioFromDebankBundle, buildPortfolioFromDebankApi } from "./debank-api-portfolio.js";

export { PORTFOLIO_SCHEMA, buildPortfolioFromDebankApi, portfolioFromDebankBundle };

export function buildPortfolioFromDebankApiRaw(raw) {
  return finalizeDebankPortfolioClone({ ...raw, fromDebankApi: true, source: "debank-api" });
}

/** DeBank-клон: только нормализация, без phantom fillCoverage. */
export function finalizeDebankPortfolioClone(raw) {
  if (!raw) return raw;
  const src = raw.source || (raw.fromDebankApi ? "debank-api" : "debank");
  const p = { ...raw, schemaVersion: PORTFOLIO_SCHEMA, source: src };
  dedupePortfolioPositions(p);
  return syncDisplayTotals(normalizePortfolioChains(p));
}

export function finalizeDebankPortfolio(raw) {
  return finalizeDebankPortfolioClone(raw);
}

export function buildPortfolioFromDebank(mainText, opts = {}) {
  const parsed = parseDebankProfileText(mainText, opts);
  return finalizeDebankPortfolioClone(parsed);
}

export function applyLendingEnrichment(portfolio) {
  if (!portfolio?.protocolGroups) return portfolio;
  for (const g of portfolio.protocolGroups) {
    g.lending = (g.lending || []).map((row) => applyLendingMetrics(row));
  }
  if (portfolio.lending?.length) {
    portfolio.lending = portfolio.lending.map((row) => applyLendingMetrics(row));
  }
  return portfolio;
}

export function enrichPortfolio(
  portfolio,
  { revertPositions = null, krystalPositions = null } = {},
) {
  if (!portfolio) return portfolio;
  let p = { ...portfolio };
  if (revertPositions?.length) {
    p = mergeRevertLiquidity(p, revertPositions);
  }
  if (krystalPositions?.length) {
    p = mergeKrystalLiquidity(p, krystalPositions);
  }
  p = applyLendingEnrichment(p);
  return syncDisplayTotals(p);
}

export function applyPortfolioPipeline(portfolio, enrich = {}) {
  let p = finalizeDebankPortfolioClone(portfolio);
  return enrichPortfolio(p, enrich);
}
