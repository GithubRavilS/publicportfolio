#!/usr/bin/env node
/** stdin: DeBank main profile text → stdout: [{ slug, usd }] */
import { parseChainBreakdown } from "../js/debank-parse.js";

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const text = Buffer.concat(chunks).toString("utf8");
const chains = parseChainBreakdown(text.split("\n").map((l) => l.replace(/\r/g, "")));
process.stdout.write(JSON.stringify(chains.filter((c) => (c.usd || 0) > 0.01)));
