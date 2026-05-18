"use client";

import { useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";
import { PortfolioSnapshot } from "@/lib/types";
import { groupDailyPnl, portfolioInUnit } from "@/lib/calculations";

type Props = {
  snapshots: PortfolioSnapshot[];
  currentPrices: Record<string, number>;
};

export function DashboardCharts({ snapshots, currentPrices }: Props) {
  const [unit, setUnit] = useState<"USD" | "BTC" | "ETH">("USD");

  const equitySeries = useMemo(() => (
    snapshots.map((s) => ({
      date: s.timestamp.slice(0, 10),
      equity: Number(portfolioInUnit(s.equityUsd, unit, currentPrices).toFixed(4))
    }))
  ), [snapshots, unit, currentPrices]);

  const dailyPnl = useMemo(() => groupDailyPnl(snapshots), [snapshots]);

  return (
    <div className="row">
      <div className="card" style={{ flex: 2, minWidth: 420 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Динамика портфеля</h3>
          <div className="row">
            {(["USD", "BTC", "ETH"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setUnit(item)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 10,
                  border: "1px solid #2b385c",
                  background: unit === item ? "#1f6feb" : "rgba(15,24,42,0.8)",
                  color: "white",
                  cursor: "pointer"
                }}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="chart-wrap">
          <ResponsiveContainer>
            <LineChart data={equitySeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(158,176,214,0.18)" />
              <XAxis dataKey="date" stroke="#9fb0d3" />
              <YAxis stroke="#9fb0d3" />
              <Tooltip
                contentStyle={{
                  background: "#0f182a",
                  border: "1px solid #2a3c61",
                  borderRadius: 10,
                  color: "#ecf2ff"
                }}
              />
              <Line type="monotone" dataKey="equity" stroke="#4ea1ff" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card" style={{ flex: 1, minWidth: 320 }}>
        <h3 style={{ margin: 0 }}>Дневная доходность (PnL)</h3>
        <div className="chart-wrap">
          <ResponsiveContainer>
            <BarChart data={dailyPnl}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(158,176,214,0.18)" />
              <XAxis dataKey="date" stroke="#9fb0d3" />
              <YAxis stroke="#9fb0d3" />
              <Tooltip
                contentStyle={{
                  background: "#0f182a",
                  border: "1px solid #2a3c61",
                  borderRadius: 10,
                  color: "#ecf2ff"
                }}
              />
              <Bar dataKey="pnl" fill="#2ea043" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
