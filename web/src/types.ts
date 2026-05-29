export type WalletType = "evm" | "solana" | "unknown";

export type TabKey = "wallet" | "liquidity" | "lending" | "other";

export type AggregatePosition = {
  source: string;
  category: string;
  dedupeKey: string;
  chain: string;
  protocolId: string;
  protocolName: string;
  protocolLogo?: string | null;
  positionName?: string | null;
  pair?: string;
  status?: string;
  netUsd?: number | null;
  investedUsd?: number | null;
  currentUsd?: number | null;
  apyPercent?: number | null;
  debtUsd?: number | null;
  assetUsd?: number | null;
  amount?: number | null;
  liquidationHint?: {
    healthFactor: number;
    markPriceUsd: number;
    liquidationPriceUsd: number;
  } | null;
  sources?: string[];
  raw?: unknown;
};

export type AggregatePayload = {
  wallet: string;
  walletType: WalletType;
  fetchedAt: number;
  totals: {
    debankUsd: number | null;
    solanaJupiterUsd: number | null;
    combinedUsd: number | null;
  };
  chart: {
    source: string;
    points: { t: number; v: number }[];
  };
  tabs: {
    wallet: AggregatePosition[];
    liquidity: AggregatePosition[];
    lending: AggregatePosition[];
    other: AggregatePosition[];
  };
  sources: Record<string, boolean>;
  warnings: string[];
};
