/**
 * GET /api/public-portfolio/v2
 * Read-only Public Portfolio snapshot from Navigator cache.
 * Does not call Debank or protocol APIs on request.
 */

import {
  buildFromDisk,
  INTERNAL_EQUITY_ADJUSTMENT_USD,
} from "../_lib/build-public-portfolio-v2.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.json({ error: "Method not allowed" });
  }

  try {
    const url = new URL(req.url || "/", "http://localhost");
    const limit = url.searchParams.get("limit");
    const cursor = url.searchParams.get("cursor") || undefined;

    const payload = buildFromDisk({
      limit: limit != null ? Number(limit) : undefined,
      cursor,
      log: (...args) => console.info(...args),
    });

    // Ensure adjustment config is loaded (used only inside builder for netWorthUsd).
    void INTERNAL_EQUITY_ADJUSTMENT_USD;

    res.statusCode = 200;
    return res.json(payload);
  } catch (err) {
    console.error("[public-portfolio/v2]", err);
    res.statusCode = 500;
    return res.json({
      error: "Failed to build public portfolio snapshot",
      message: String(err?.message || err),
    });
  }
}
