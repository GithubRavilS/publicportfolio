#!/usr/bin/env node
/**
 * Local dump of GET /api/public-portfolio/v2 payload for review.
 * Usage: node scripts/dump-public-portfolio-v2.mjs [out.json]
 */

import fs from "node:fs";
import path from "node:path";
import { buildFromDisk } from "../api/_lib/build-public-portfolio-v2.js";

const outArg = process.argv[2];
const payload = buildFromDisk({
  log: (...args) => console.error(...args),
});

// Strip non-contract debug if present
if (payload?.meta?.cachePath) delete payload.meta.cachePath;

const text = JSON.stringify(payload, null, 2);
if (outArg) {
  const outPath = path.resolve(outArg);
  fs.writeFileSync(outPath, text + "\n", "utf8");
  console.error(`Wrote ${outPath}`);
}
process.stdout.write(text + "\n");
