#!/usr/bin/env node
/** stdin: portfolio JSON → merge Krystal → stdout portfolio */
import { mergeKrystalLiquidity } from "../js/krystal-portfolio-merge.js";
import { syncDisplayTotals } from "../js/portfolio-normalize.js";
import { fetchKrystalAll } from "../js/krystal-fetch.js";

const wallet = process.argv[2];
const apiKey = process.env.KRYSTAL_CLOUD_API_KEY || process.env.KRYSTAL_API_KEY || "";
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const portfolio = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");

if (!apiKey || !wallet) {
  process.stdout.write(JSON.stringify(portfolio));
  process.exit(0);
}

const positions = await fetchKrystalAll(apiKey, wallet);
const merged = syncDisplayTotals(mergeKrystalLiquidity(portfolio, positions));
process.stdout.write(JSON.stringify(merged));
