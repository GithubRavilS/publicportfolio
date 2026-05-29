#!/usr/bin/env node
import { parsePct, aprToApy, normPair, normToken } from "../js/revert-parse.js";

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

assert(normToken("USD₮0") === "USDT", "USD₮0 → USDT");
assert(normPair("WETH+USD₮0") === normPair("WETH/USDT"), "pair alias");
assert(parsePct("-1,158%") === -11.58, "comma decimal APR");
assert(parsePct("13%") === 13, "plain pct");
assert(Math.abs(aprToApy(13) - 13.8) < 0.2, "apy from 13% apr");

console.log("test-revert-parse: OK");
