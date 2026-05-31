/**
 * DeBank Pro OpenAPI — тот же источник, что использует debank.com (быстро, структурированно).
 */
const BASE = "https://pro-openapi.debank.com";

export async function debankFetch(path, params, accessKey) {
  if (!accessKey?.trim()) return null;
  const u = new URL(BASE + path);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  }
  const r = await fetch(u, {
    headers: { accept: "application/json", AccessKey: accessKey.trim() },
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`DEBANK_API_${r.status}:${t.slice(0, 160)}`);
  }
  return r.json();
}

/** @param {string} address @param {string} accessKey */
export async function fetchDebankBundle(address, accessKey) {
  const id = address.toLowerCase();
  const [totalBalance, complexList, tokenList, netCurve] = await Promise.all([
    debankFetch("/v1/user/total_balance", { id }, accessKey),
    debankFetch("/v1/user/all_complex_protocol_list", { id }, accessKey),
    debankFetch("/v1/user/all_token_list", { id, is_all: "true" }, accessKey),
    debankFetch("/v1/user/total_net_curve", { id }, accessKey),
  ]);
  return { totalBalance, complexList, tokenList, netCurve };
}
