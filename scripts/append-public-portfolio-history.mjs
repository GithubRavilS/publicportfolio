import fs from "node:fs/promises";

const apiUrl = process.env.PUBLIC_PORTFOLIO_API_URL
  || "https://publicportfolio-mu.vercel.app/api/public-portfolio/v2";
const historyPath = "data/public-equity-history.json";

const response = await fetch(apiUrl, { headers: { accept: "application/json" } });
if (!response.ok) throw new Error(`Public Portfolio API returned HTTP ${response.status}`);
const api = await response.json();
if (api?.meta?.liveFromEndpoint !== true) {
  throw new Error("Refusing to archive a snapshot that did not come from the live Navigator endpoint.");
}
if (api?.meta?.stale === true) {
  console.log(`Skipping stale Navigator snapshot from ${api?.meta?.updatedAt || "unknown date"}.`);
  process.exit(0);
}
if (api?.meta?.complete !== true) {
  throw new Error("Refusing to archive an incomplete portfolio snapshot.");
}
const equityUsd = Number(api?.summary?.netWorthUsd);
const updatedAt = String(api?.meta?.updatedAt || "");
const updatedMs = Date.parse(updatedAt);
if (!Number.isFinite(equityUsd) || !Number.isFinite(updatedMs)) {
  throw new Error("API snapshot is missing a valid net worth or updatedAt timestamp.");
}

const history = JSON.parse(await fs.readFile(historyPath, "utf8"));
if (!Array.isArray(history)) throw new Error("History archive must be a JSON array.");
const day = new Date(updatedMs).toISOString().slice(0, 10);
const existing = history.findIndex((row) => row.date === day);
const previous = existing >= 0 ? history[existing] : {};
const point = { ...previous, date: day, equityUsd: Math.round(equityUsd * 100) / 100, asOf: updatedAt, snapshotId: api?.meta?.snapshotId || null, source: "navigator-cabinet" };
if (existing >= 0) history[existing] = point;
else history.push(point);
history.sort((a, b) => a.date.localeCompare(b.date));

await fs.writeFile(historyPath, JSON.stringify(history, null, 2) + "\n");
console.log(`Archived ${day}: $${point.equityUsd.toFixed(2)} (${existing >= 0 ? "updated" : "added"}).`);
