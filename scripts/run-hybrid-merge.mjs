#!/usr/bin/env node
/** stdin: { "onchain": {...}, "debank": {...} } */
import { readFileSync } from "fs";
import { mergeHybridPortfolio } from "../js/portfolio-hybrid-merge.js";

const raw = readFileSync(0, "utf8");
const { onchain, debank } = JSON.parse(raw || "{}");
const portfolio = mergeHybridPortfolio(onchain || null, debank || null);
process.stdout.write(JSON.stringify({ ok: true, portfolio }));
