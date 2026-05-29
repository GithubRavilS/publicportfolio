const BASE = "https://pro-openapi.debank.com";

export async function debankFetch(path, params, accessKey) {
  if (!accessKey) return null;
  const u = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  }
  const r = await fetch(u, {
    headers: { accept: "application/json", AccessKey: accessKey },
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`DeBank ${r.status}: ${t.slice(0, 200)}`);
  }
  return r.json();
}

export async function fetchDebankBundle(address, accessKey) {
  const [totalBalance, complexList, tokenList, netCurve] = await Promise.all([
    debankFetch("/v1/user/total_balance", { id: address }, accessKey),
    debankFetch("/v1/user/all_complex_protocol_list", { id: address }, accessKey),
    debankFetch("/v1/user/all_token_list", { id: address, is_all: "true" }, accessKey),
    debankFetch("/v1/user/total_net_curve", { id: address }, accessKey),
  ]);
  return { totalBalance, complexList, tokenList, netCurve };
}
