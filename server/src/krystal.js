const BASE = "https://cloud-api.krystal.app";

export async function fetchKrystalPositions(apiKey, wallet, status) {
  if (!apiKey) return [];
  const u = new URL(BASE + "/v1/positions");
  u.searchParams.set("wallet", wallet);
  u.searchParams.set("positionStatus", status);
  const r = await fetch(u, {
    headers: { "KC-APIKey": apiKey.trim(), Accept: "application/json" },
  });
  if (r.status === 401) {
    throw new Error("Krystal 401: проверьте KC-APIKey (cloud.krystal.app)");
  }
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Krystal ${r.status}: ${t.slice(0, 200)}`);
  }
  const data = await r.json();
  return Array.isArray(data) ? data : [];
}
