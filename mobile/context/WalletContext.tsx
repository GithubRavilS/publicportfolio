import React, { createContext, useContext, useMemo, useState } from "react";
import type { AggregatePayload } from "@/lib/types";

type Ctx = {
  wallet: string;
  setWallet: (w: string) => void;
  lastPayload: AggregatePayload | null;
  setLastPayload: (p: AggregatePayload | null) => void;
};

const WalletContext = createContext<Ctx | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [wallet, setWallet] = useState("");
  const [lastPayload, setLastPayload] = useState<AggregatePayload | null>(null);
  const v = useMemo(
    () => ({ wallet, setWallet, lastPayload, setLastPayload }),
    [wallet, lastPayload]
  );
  return <WalletContext.Provider value={v}>{children}</WalletContext.Provider>;
}

export function useWalletPortfolio() {
  const c = useContext(WalletContext);
  if (!c) throw new Error("WalletProvider missing");
  return c;
}

export function useSetLastPayload() {
  return useWalletPortfolio().setLastPayload;
}

export const useLastPayload = () => useWalletPortfolio().lastPayload;
