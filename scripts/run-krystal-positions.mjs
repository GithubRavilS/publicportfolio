#!/usr/bin/env node
/** Fetch Krystal positions → stdout JSON array */
import { fetchKrystalAll } from "../js/krystal-fetch.js";

const wallet = process.argv[2];
const apiKey = process.env.KRYSTAL_CLOUD_API_KEY || process.env.KRYSTAL_API_KEY || "";
if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
  process.stderr.write("usage: run-krystal-positions.mjs 0x...\n");
  process.exit(1);
}
if (!apiKey) {
  process.stdout.write("[]");
  process.exit(0);
}
try {
  const positions = await fetchKrystalAll(apiKey, wallet);
  process.stdout.write(JSON.stringify(positions));
} catch (e) {
  process.stderr.write(String(e.message || e));
  process.exit(1);
}
