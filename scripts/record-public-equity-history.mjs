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
const next = { date, equityUsd, asOf: snapshot.updatedAt };
const index = rows.findIndex((row) => row.date === date);
if (index >= 0) rows[index] = next;
else rows.push(next);
rows = rows
  .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(Number(row.equityUsd)))
  .sort((a, b) => a.date.localeCompare(b.date))
  .slice(-1000);
await writeFile(path, `${JSON.stringify(rows, null, 2)}\n`);
console.log(`Recorded ${date}: $${equityUsd.toFixed(2)} (equity only)`);
