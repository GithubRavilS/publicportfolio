/**
 * GET /api/public-portfolio/v2
 * Read-only Public Portfolio from DeFi Navigator personal-cabinet cache snapshot.
 * Preview/Production: NAVIGATOR_SNAPSHOT_URL (PA read-only export) is required for complete=true.
 * Saved JSON is never presented as a live snapshot when the endpoint fails.
 */

import {
  buildFromSource,
  DEFAULT_NAVIGATOR_SNAPSHOT_URL,
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
    const vercelEnv = String(process.env.VERCEL_ENV || "");
    const isHosted = vercelEnv === "preview" || vercelEnv === "production";
    const snapshotUrl =
      process.env.NAVIGATOR_SNAPSHOT_URL ||
      (isHosted ? DEFAULT_NAVIGATOR_SNAPSHOT_URL : "");

    const payload = await buildFromSource({
      url: snapshotUrl || undefined,
      limit: limit != null ? Number(limit) : undefined,
      cursor,
      // Hosted: keep last file only as degraded view; never as complete/live.
      allowFileFallback: true,
      requireLiveEndpoint: isHosted || Boolean(snapshotUrl),
      log: (...args) => console.info(...args),
    });

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
