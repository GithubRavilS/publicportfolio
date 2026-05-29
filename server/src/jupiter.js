/** Jupiter Ultra API — holdings по Solana-адресу. Ключ: https://portal.jup.ag */
export async function fetchJupiterHoldings(address, apiKey) {
  if (!apiKey) return null;
  const url = `https://api.jup.ag/ultra/v1/holdings/${encodeURIComponent(address)}`;
  const r = await fetch(url, {
    headers: {
      Accept: "application/json",
      "x-api-key": apiKey.trim(),
    },
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Jupiter ${r.status}: ${t.slice(0, 200)}`);
  }
  return r.json();
}
