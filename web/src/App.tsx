import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchPortfolio } from "./api";
import { PortfolioChart } from "./components/PortfolioChart";
import { PositionCard } from "./components/PositionCard";
import type { AggregatePayload, TabKey } from "./types";
import { fmtUsd, shortAddress } from "./lib/format";

const TAB_LABELS: Record<TabKey, string> = {
  wallet: "Кошелёк",
  liquidity: "Ликвидность",
  lending: "Лендинг",
  other: "Прочее",
};

function tabSum(items: { netUsd?: number | null }[]) {
  return items.reduce((s, x) => s + (x.netUsd ?? 0), 0);
}

export default function App() {
  const [wallet, setWallet] = useState("");
  const [payload, setPayload] = useState<AggregatePayload | null>(null);
  const [tab, setTab] = useState<TabKey>("wallet");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (address: string) => {
    const w = address.trim();
    if (!w) {
      setError("Введите адрес кошелька");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const data = await fetchPortfolio(w);
      setPayload(data);
      setWallet(w);
      const params = new URLSearchParams(window.location.search);
      params.set("wallet", w);
      window.history.replaceState({}, "", `?${params.toString()}`);
      const counts = data.tabs;
      const defaultTab: TabKey =
        (counts.lending?.length ?? 0) > 0
          ? "lending"
          : (counts.liquidity?.length ?? 0) > 0
            ? "liquidity"
            : (counts.wallet?.length ?? 0) > 0
              ? "wallet"
              : "other";
      setTab(defaultTab);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить портфель");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("wallet");
    if (q?.trim()) {
      setWallet(q.trim());
      load(q.trim());
    }
  }, [load]);

  const positions = payload?.tabs?.[tab] ?? [];

  const tabTotals = useMemo(() => {
    if (!payload) return null;
    return {
      wallet: tabSum(payload.tabs.wallet),
      liquidity: tabSum(payload.tabs.liquidity),
      lending: tabSum(payload.tabs.lending),
      other: tabSum(payload.tabs.other),
    };
  }, [payload]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    load(wallet);
  };

  return (
    <>
      <div className="app-bg" aria-hidden />
      <div className="shell">
        <header className="header">
          <div className="brand">
            <span className="brand-title">Portfolio Tracker</span>
            <span className="brand-sub">DeBank · Ethereum &amp; EVM</span>
          </div>
          {payload ? (
            <span className="wallet-pill" title={payload.wallet}>
              {shortAddress(payload.wallet)}
            </span>
          ) : null}
        </header>

        {!payload ? (
          <section className="hero">
            <h1>Весь портфель по одному адресу</h1>
            <p>
              Введите адрес EVM-кошелька — подтянем позиции из DeBank: токены на кошельке, пулы
              ликвидности, лендинг и остальные протоколы.
            </p>
            <form className="search-card" onSubmit={onSubmit}>
              <div className="search-inner">
                <input
                  value={wallet}
                  onChange={(e) => setWallet(e.target.value)}
                  placeholder="0x… адрес Ethereum / EVM"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button type="submit" className="btn-go" disabled={loading}>
                  Go
                </button>
              </div>
            </form>
            <div className="chips">
              <span className="chip">DeBank Open API</span>
              <span className="chip">Лендинг &amp; займы</span>
              <span className="chip">LP &amp; AMM</span>
              <span className="chip">Мультичейн EVM</span>
            </div>
            {error ? <div className="error-banner">{error}</div> : null}
          </section>
        ) : (
          <>
            <button
              type="button"
              className="back-link"
              onClick={() => {
                setPayload(null);
                setError(null);
                window.history.replaceState({}, "", "/");
              }}
            >
              ← Новый адрес
            </button>

            <div className="portfolio-header">
              <div className="balance-block">
                <div className="label">Общая оценка</div>
                <div className="value">
                  {fmtUsd(payload.totals.combinedUsd ?? payload.totals.debankUsd)}
                </div>
                <div className="balance-meta">
                  DeBank · обновлено {new Date(payload.fetchedAt).toLocaleString("ru-RU")}
                </div>
              </div>
            </div>

            {tabTotals ? (
              <div className="stats-grid">
                {(Object.keys(TAB_LABELS) as TabKey[]).map((k) => (
                  <div key={k} className="stat-card">
                    <div className="stat-label">{TAB_LABELS[k]}</div>
                    <div className="stat-value">{fmtUsd(tabTotals[k], { compact: true })}</div>
                  </div>
                ))}
              </div>
            ) : null}

            <PortfolioChart points={payload.chart.points} />

            {payload.warnings.length > 0 ? (
              <div className="warnings">
                {payload.warnings.map((w, i) => (
                  <p key={i}>· {w}</p>
                ))}
              </div>
            ) : null}

            <div className="tabs" role="tablist">
              {(Object.keys(TAB_LABELS) as TabKey[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={tab === k}
                  className={`tab ${tab === k ? "active" : ""}`}
                  onClick={() => setTab(k)}
                >
                  {TAB_LABELS[k]}
                  <span className="tab-count">({payload.tabs[k]?.length ?? 0})</span>
                </button>
              ))}
            </div>

            {positions.length === 0 ? (
              <div className="empty-tab">Нет позиций в этой категории</div>
            ) : (
              <div className="positions-list">
                {positions.map((item) => (
                  <PositionCard key={item.dedupeKey} item={item} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {loading ? (
        <div className="loading-overlay" role="status">
          <div className="loading-card">
            <div className="spinner" />
            <h3>Сканируем кошелёк</h3>
            <p>Загружаем данные из DeBank…</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
