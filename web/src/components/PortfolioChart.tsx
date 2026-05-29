import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtUsd } from "../lib/format";

type Point = { t: number; v: number };

type Props = { points: Point[] };

export function PortfolioChart({ points }: Props) {
  if (points.length < 2) return null;

  const data = points.map((p) => ({
    date: new Date(p.t * 1000).toLocaleDateString("ru-RU", {
      month: "short",
      day: "numeric",
    }),
    value: p.v,
  }));

  return (
    <div className="chart-card">
      <div className="chart-title">Динамика портфеля (DeBank)</div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="fillAccent" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#30d158" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#30d158" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            tick={{ fill: "rgba(245,245,247,0.45)", fontSize: 11 }}
            axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            tick={{ fill: "rgba(245,245,247,0.45)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={56}
            tickFormatter={(v) => fmtUsd(v, { compact: true })}
          />
          <Tooltip
            contentStyle={{
              background: "#161620",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 12,
              fontSize: 13,
            }}
            labelStyle={{ color: "rgba(245,245,247,0.6)" }}
            formatter={(v: number) => [fmtUsd(v), "Баланс"]}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#30d158"
            strokeWidth={2}
            fill="url(#fillAccent)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
