import { readFile, writeFile } from "node:fs/promises";

const endpoint =
  process.env.NAVIGATOR_SNAPSHOT_URL ||
  "https://cry-maden008.pythonanywhere.com/portfolio-check/api/public/navigator-snapshot";
const adjustmentUsd = 800;
const response = await fetch(endpoint, { headers: { accept: "application/json" } });
if (!response.ok) throw new Error(`Navigator snapshot returned HTTP ${response.status}`);
const snapshot = await response.json();
if (snapshot?.ok !== true || !snapshot?.updatedAt || !Number.isFinite(Number(snapshot?.totals?.totalUsd))) {
  throw new Error("Navigator snapshot is incomplete; refusing to record history");
}
const date = new Date(snapshot.updatedAt).toISOString().slice(0, 10);
const equityUsd = Math.round((Number(snapshot.totals.totalUsd) + adjustmentUsd) * 100) / 100;
const path = "data/public-equity-history.json";
let rows = JSON.parse(await readFile(path, "utf8"));
if (!Array.isArray(rows)) throw new Error("History file must contain an array");
const lending = (snapshot.walletPacks || []).flatMap((pack) => pack.lendingPositions || []).filter((position) => Number(position.collateralUsd || 0) > 0 || Number(position.debtUsd || position.borrowUsd || 0) > 0);
const rates = lending.map((position) => Number(position.borrowApy ?? position.supplyApy)).filter(Number.isFinite);
const healthFactors = lending.map((position) => Number(position.healthFactor)).filter((value) => Number.isFinite(value) && value > 0);
const totals = snapshot.totals;
const next = {
  date,
  equityUsd,
  walletIdleUsd: Number(totals.walletUsd || 0),
  collateralUsd: Number(totals.collateralUsd || 0),
  debtUsd: Number(totals.borrowUsd || 0),
  liquidityUsd: Number(totals.liquidityUsd || 0),
  yieldPrincipalUsd: Number(totals.yieldUsd || 0),
  rewardsAccruedUsd: Number(totals.rewardsUsd || 0),
  borrowAprPct: rates.length ? Math.round((rates.reduce((sum, rate) => sum + rate, 0) / rates.length) * 100) / 100 : null,
  healthFactor: healthFactors.length ? Math.min(...healthFactors) : null,
  asOf: snapshot.updatedAt,
};
const index = rows.findIndex((row) => row.date === date);
if (index >= 0) rows[index] = next;
else rows.push(next);
rows = rows
  .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(Number(row.equityUsd)))
  .sort((a, b) => a.date.localeCompare(b.date))
  .slice(-1000);
await writeFile(path, `${JSON.stringify(rows, null, 2)}\n`);
console.log(`Recorded ${date}: $${equityUsd.toFixed(2)} (equity only)`);
