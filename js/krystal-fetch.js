/**
 * Krystal Cloud API — LP positions (Aerodrome, PancakeSwap, etc.)
 */
const BASE = "https://cloud-api.krystal.app";

export async function fetchKrystalPositions(apiKey, wallet, status = "OPEN") {
  if (!apiKey?.trim()) return [];
  const u = new URL(`${BASE}/v1/positions`);
  u.searchParams.set("wallet", wallet);
  u.searchParams.set("positionStatus", status);
  const r = await fetch(u, {
    headers: { "KC-APIKey": apiKey.trim(), Accept: "application/json" },
  });
  if (r.status === 401) throw new Error("KRYSTAL_AUTH");
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`KRYSTAL_${r.status}:${t.slice(0, 120)}`);
  }
  const data = await r.json();
  return Array.isArray(data) ? data : [];
}

export async function fetchKrystalAll(apiKey, wallet) {
  const [open, closed] = await Promise.all([
    fetchKrystalPositions(apiKey, wallet, "OPEN").catch(() => []),
    fetchKrystalPositions(apiKey, wallet, "CLOSED").catch(() => []),
  ]);
  return [...open, ...closed.map((p) => ({ ...p, _closed: true }))];
}
