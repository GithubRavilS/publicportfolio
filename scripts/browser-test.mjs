#!/usr/bin/env node
import { chromium } from "playwright";

const BASE = process.env.PT_BASE || "http://127.0.0.1:5500";
const WALLET = "0xE6C9B6407676432a95cE23fd414021ED31fC0566";

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
});

await page.goto(`${BASE}/index.html`, { waitUntil: "networkidle" });
await page.fill("#walletInput", WALLET);
await page.click("#goBtn");

await page.waitForFunction(
  () => {
    const r = document.getElementById("results");
    const e = document.getElementById("error");
    if (r && !r.hidden) return true;
    if (e && !e.hidden) return true;
    return false;
  },
  { timeout: 120000 },
);

const errHidden = await page.locator("#error").isHidden();
const resultsHidden = await page.locator("#results").isHidden();
const errText = errHidden ? "" : await page.locator("#error").textContent();
const total = resultsHidden ? "" : await page.locator("#totalUsd").textContent();

console.log(
  JSON.stringify(
    {
      ok: !resultsHidden && errHidden,
      total,
      errText,
      errors,
    },
    null,
    2,
  ),
);

await browser.close();
process.exit(!resultsHidden && errHidden ? 0 : 1);
