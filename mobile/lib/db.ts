import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import type { AggregatePayload } from "./types";

let dbPromise: Promise<SQLiteDatabase> | null = null;

export async function getDb(): Promise<SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await openDatabaseAsync("sy_portfolio.db");
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS portfolio_snapshots (
          id INTEGER PRIMARY KEY NOT NULL,
          wallet TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          total_usd REAL,
          payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_snapshots_wallet_time
          ON portfolio_snapshots (wallet, created_at DESC);
      `);
      return db;
    })();
  }
  return dbPromise;
}

export async function saveSnapshot(payload: AggregatePayload): Promise<void> {
  const db = await getDb();
  const total = payload.totals.combinedUsd ?? payload.totals.debankUsd ?? payload.totals.solanaJupiterUsd ?? null;
  await db.runAsync(
    `INSERT INTO portfolio_snapshots (wallet, created_at, total_usd, payload_json) VALUES (?, ?, ?, ?)`,
    [payload.wallet.toLowerCase(), payload.fetchedAt, total, JSON.stringify(payload)]
  );
}

export async function loadSnapshotsForChart(
  wallet: string,
  maxPoints = 60
): Promise<{ t: number; v: number }[]> {
  const db = await getDb();
  const w = wallet.toLowerCase();
  const rows = await db.getAllAsync<{ created_at: number; total_usd: number | null }>(
    `SELECT created_at, total_usd FROM portfolio_snapshots WHERE wallet = ? ORDER BY created_at DESC LIMIT ?`,
    [w, maxPoints]
  );
  const pts = rows
    .filter((r) => r.total_usd != null && r.total_usd > 0)
    .map((r) => ({ t: r.created_at, v: r.total_usd as number }))
    .reverse();
  return pts;
}
