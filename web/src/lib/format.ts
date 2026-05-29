export function fmtUsd(n: number | null | undefined, opts?: { compact?: boolean }) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (opts?.compact) {
    if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (Math.abs(n) >= 1e4) return `$${(n / 1e3).toFixed(1)}k`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 100 ? 0 : 2,
  }).format(n);
}

export function fmtPct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

export function fmtAmount(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1e6) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (Math.abs(n) >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toPrecision(3);
}

export function shortAddress(addr: string) {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function chainLabel(chain: string) {
  const map: Record<string, string> = {
    eth: "Ethereum",
    arb: "Arbitrum",
    op: "Optimism",
    base: "Base",
    bsc: "BNB Chain",
    matic: "Polygon",
    avax: "Avalanche",
    sol: "Solana",
  };
  return map[chain] || chain.toUpperCase();
}
