import fs from "node:fs/promises";

const apiUrl = process.env.PUBLIC_PORTFOLIO_API_URL
  || "https://publicportfolio-mu.vercel.app/api/public-portfolio/v2";
const dataPath = "data/portfolio-data.js";

const response = await fetch(apiUrl, { headers: { accept: "application/json" } });
if (!response.ok) throw new Error(`Public Portfolio API returned HTTP ${response.status}`);
const api = await response.json();
if (api?.meta?.complete !== true || api?.meta?.stale !== false || api?.meta?.liveFromEndpoint !== true) {
  throw new Error("Refusing to archive an incomplete, stale, or non-live portfolio snapshot.");
}
const equityUsd = Number(api?.summary?.netWorthUsd);
const updatedAt = String(api?.meta?.updatedAt || "");
if (!Number.isFinite(equityUsd) || !Number.isFinite(Date.parse(updatedAt))) {
  throw new Error("API snapshot is missing a valid net worth or updatedAt timestamp.");
}

const raw = await fs.readFile(dataPath, "utf8");
const assignment = raw.indexOf("=");
if (assignment < 0) throw new Error("Could not parse data/portfolio-data.js.");
let json = raw.slice(assignment + 1).trim();
if (json.endsWith(";")) json = json.slice(0, -1).trim();
const portfolio = JSON.parse(json);
if (!Array.isArray(portfolio.snapshots)) portfolio.snapshots = [];

const day = updatedAt.slice(0, 10);
const existing = portfolio.snapshots.findIndex((row) =>
  String(row.timestamp || row.date || row.day || "").slice(0, 10) === day
);
const previous = existing >= 0 ? portfolio.snapshots[existing] : {};
const point = { ...previous, timestamp: updatedAt, equityUsd: Math.round(equityUsd * 100) / 100 };
if (existing >= 0) portfolio.snapshots[existing] = point;
else portfolio.snapshots.push(point);
portfolio.snapshots.sort((a, b) => String(a.timestamp || a.date || "").localeCompare(String(b.timestamp || b.date || "")));
portfolio.currentCapitalUsd = point.equityUsd;
portfolio.exportedAt = updatedAt;

await fs.writeFile(dataPath, "window.PORTFOLIO_DATA = " + JSON.stringify(portfolio, null, 2) + "\n");
console.log(`Archived ${day}: $${point.equityUsd.toFixed(2)} (${existing >= 0 ? "updated" : "added"}).`);
