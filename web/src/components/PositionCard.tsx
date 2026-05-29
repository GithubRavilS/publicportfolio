import type { AggregatePosition } from "../types";
import { chainLabel, fmtAmount, fmtPct, fmtUsd } from "../lib/format";

type Props = { item: AggregatePosition };

export function PositionCard({ item }: Props) {
  const invested = item.investedUsd ?? item.assetUsd;
  const current = item.currentUsd ?? item.netUsd;
  const liq = item.liquidationHint;
  const logo = item.protocolLogo;
  const initial = (item.positionName || item.protocolName || "?")[0]?.toUpperCase();

  return (
    <article className="position-card">
      <div className="position-top">
        {logo ? (
          <img className="protocol-logo" src={logo} alt="" loading="lazy" />
        ) : (
          <div className="protocol-logo placeholder">{initial}</div>
        )}
        <div className="position-main">
          <div className="position-name">{item.positionName || item.pair || "Позиция"}</div>
          <div className="position-meta">
            {item.protocolName} · {chainLabel(item.chain)}
            {item.status ? ` · ${item.status}` : ""}
          </div>
          <div className="position-source">{(item.sources || [item.source]).join(" + ")}</div>
        </div>
        <div className="position-value">
          <div className="usd">{fmtUsd(item.netUsd, { compact: true })}</div>
          {item.apyPercent != null ? (
            <div className="sub">APR {fmtPct(item.apyPercent)}</div>
          ) : item.amount != null ? (
            <div className="sub">{fmtAmount(item.amount)}</div>
          ) : null}
        </div>
      </div>

      <div className="position-stats">
        <div className="position-stat">
          <div className="lbl">Активы</div>
          <div className="val">{fmtUsd(invested ?? item.assetUsd, { compact: true })}</div>
        </div>
        <div className="position-stat">
          <div className="lbl">Долг</div>
          <div className="val">{fmtUsd(item.debtUsd, { compact: true })}</div>
        </div>
        <div className="position-stat">
          <div className="lbl">Net</div>
          <div className="val" style={{ color: "var(--accent)" }}>
            {fmtUsd(current, { compact: true })}
          </div>
        </div>
      </div>

      {liq ? (
        <div className="liq-hint">
          Health factor {liq.healthFactor.toFixed(3)} · оценка ликвидации ~$
          {liq.liquidationPriceUsd.toFixed(4)}
        </div>
      ) : null}
    </article>
  );
}
