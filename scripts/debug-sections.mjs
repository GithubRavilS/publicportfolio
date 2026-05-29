#!/usr/bin/env node
import fs from "fs";
import {
  buildProtocolSections,
  parseLendingInRange,
  parseYieldPoolsInRange,
} from "../js/debank-parse.js";

const text = fs.readFileSync(process.argv[2] || "/tmp/e6c9-main.txt", "utf8");
const lines = text.split("\n").map((l) => l.replace(/\r/g, ""));
const secs = buildProtocolSections(lines);
console.log("sections:", secs.length);
for (const s of secs) {
  const slice = lines.slice(s.start, s.end).join("\n");
  const flags = [
    slice.includes("Liquidity Pool") ? "LP" : "",
    /lending/i.test(slice) ? "Lend" : "",
    /yield|farming/i.test(slice) ? "Yield" : "",
  ]
    .filter(Boolean)
    .join(",");
  if (/fluid|yearn|beefy|aerodrome|supernova/i.test(s.protocol)) {
    console.log(`\n${s.protocol} $${s.protocolUsd} [${flags}] ${s.start}-${s.end}`);
    if (/lending/i.test(slice)) {
      const lend = parseLendingInRange(lines, s.start, s.end, s.protocol, "base");
      console.log(
        "  lending:",
        lend.map((p) => p.netUsd),
      );
    }
    if (/yield|farming/i.test(slice)) {
      const y = parseYieldPoolsInRange(lines, s.start, s.end, s.protocol, "eth");
      console.log(
        "  yield:",
        y.map((p) => `${p.pair} $${p.positionUsd}`),
      );
    }
  }
}
