import type { AggregatePayload } from "./types";

const base = () => import.meta.env.VITE_AGGREGATOR_URL?.replace(/\/$/, "") || "";

export async function fetchPortfolio(wallet: string): Promise<AggregatePayload> {
  const url = `${base()}/v1/aggregate`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ wallet: wallet.trim() }),
  });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const j = await r.json();
      if (j?.error) msg = j.error;
    } catch {
      const t = await r.text();
      if (t) msg = t.slice(0, 200);
    }
    throw new Error(msg);
  }
  return r.json();
}
