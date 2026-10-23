# Public Portfolio v2 — backend handoff for Cursor

## Goal

Replace the site's mixed, partially stale browser aggregation with one read-only portfolio snapshot from the DeFi Navigator account/cache. The user reports approximately **$15,189** in the DeFi Navigator account. The current endpoint snapshot reports **$11,291.69**, so mark it incomplete until the missing lending export is included and the totals reconcile. The UI prototype is `public-portfolio-v2.html`; it requests `GET /api/public-portfolio/v2` (or a configurable `window.PUBLIC_PORTFOLIO_API`). No private keys, signing functions, account session tokens, or credentials may be exposed to this public page.

## Current reconciliation issue found in PublicPortfolio

- The current page imports `data/portfolio-data.js`, queries LP values separately through `/api/lp-sheet`, and fetches idle balances separately from `/api/wallet-idle`; it can also reuse `pp_wallet_idle_v1` from browser `localStorage`. Those sources can have different update times and wallet coverage.
- Current equity calculation is effectively **collateral − debt + active LP value + idle wallet balance + internal equity adjustment**. Rewards are shown separately. The backend must define disjoint components so the same LP/yield/collateral principal is not counted twice.
- Preserve the existing **+$800 internal equity adjustment** in the authoritative net-worth total. Keep its value in one backend configuration source; apply it only when calculating `netWorthUsd`. Do not return it as a separate API field or include it in wallet balances, positions, categories, rewards, transaction history, or any other breakdown.
- The user reports DeFi Navigator at **$15,189**. The first backend snapshot totals **$11,291.69**, a difference of **$3,897.31**. Treat these as reconciliation inputs, not hard-coded production values. The backend investigation identified missing Jupiter/Solana lending entries from the cache export. Do not label the snapshot complete until the export includes all intended lending sources and a component-by-component comparison by wallet, chain, position type and timestamp reconciles the total. The displayed total must come from the canonical backend total, not a frontend re-sum of independently stale APIs.

## Endpoint contract

### `GET /api/public-portfolio/v2`

Return one coherent, already-computed snapshot:

```json
{
  "meta": {
    "updatedAt": "ISO-8601 UTC",
    "source": "DeFi Navigator",
    "walletCount": 2,
    "chains": 0,
    "stale": false,
    "complete": false,
    "incompleteReasons": ["Lending export is missing one or more configured sources"],
    "snapshotId": "opaque non-secret id"
  },
  "summary": {
    "netWorthUsd": 0,
    "walletIdleUsd": 0,
    "collateralUsd": 0,
    "liquidityUsd": 0,
    "yieldPrincipalUsd": 0,
    "debtUsd": 0,
    "rewardsAccruedUsd": 0,
    "borrowAprPct": null,
    "healthFactor": null,
    "changePct30d": null
  },
  "positions": [],
  "transactions": [],
  "history": []
}
```

`netWorthUsd` is authoritative. Provide a documented formula and ensure categories are mutually exclusive. Recommended reconciliation formula: idle wallet assets + collateral principal + LP principal + other yield principal − debt + the configured internal equity adjustment (**currently +$800**). The adjustment is part of the headline net worth only and must not appear as its own value anywhere in the public response or UI. `rewardsAccruedUsd` remains a separate display metric and is excluded from `netWorthUsd` unless the DeFi Navigator account itself includes those claims; if included, mark that explicitly and avoid counting them a second time.

Each position should include stable `id`, `type` (`lending`, `liquidity`, `yield`, `wallet`, `vault`), `protocol`, `chain`, non-sensitive display-only `walletLabel`, `asset`, `valueUsd`, `collateralUsd`, `debtUsd`, `ratePct`, `rewardUsd`, optional `healthFactor`, and `includedInNetWorth`. Include richer fields in `details` when available: underlying quantities, supply/borrow APY, liquidation threshold/price, utilization, accrued fees, reward tokens, pool range, and source timestamp.

Each transaction should include stable `id`, ISO date, chain, protocol, action, asset, signed amount, `amountUsd`, category, and a public explorer URL when available. History rows should be daily canonical `date` + `equityUsd` values. Pagination/filter query parameters can be added for long transaction history; do not silently truncate without returning a cursor.

## Required behavior

1. Read from the already-maintained DeFi Navigator cache/database. Do not call DeBank/protocol sources on every public page view. Cache or precompute on the backend and return a single snapshot ID/time for all sections.
2. Include both configured wallets and all supported chains, plus every position class visible in the DeFi Navigator account. Do not rely on a first-wallet-only parser or browser localStorage.
3. Keep the existing `$800` internal equity adjustment in one backend configuration source and apply it only to `summary.netWorthUsd`. Do not expose it separately in the public response, position data, category totals, transaction history, or UI. Permit changing it intentionally. Never silently clamp/replace values based on a threshold.
4. Return `meta.stale` when the source cache is old, and `meta.complete` plus `meta.incompleteReasons` when any configured wallet/source is missing or unsupported. Keep the last good snapshot available, but visibly label stale or incomplete snapshots and show their timestamp; never present old or partial balances as complete/live. Only set `complete: true` after all configured source exports are covered.
5. Include per-position source identifiers and an audit/reconciliation report in server logs (no credentials). For the current mismatch, identify exactly which components account for the `$4,101` net displayed difference after accounting for the existing `$800` adjustment.
6. Public response must contain only fields intentionally approved for the public portfolio. Never include auth cookies, access tokens, private notes, private user/account data, or any write capability.

## Frontend integration notes

- Prototype is intentionally in demo mode if the endpoint is unavailable; it displays a visible demo banner rather than pretending demo balances are live.
- Point `window.PUBLIC_PORTFOLIO_API` to the final endpoint if the route differs. Remove demo fallback only after production payload and reconciliation have been verified.
- The prototype expects the backend's `netWorthUsd` as the headline total. The internal equity adjustment is already included there and must not be sent or rendered separately. Accrued rewards remain a separate display metric. It shows a warning unless `meta.complete === true`, or when `meta.stale === true`; include clear `incompleteReasons` in the response.
- Check the route against Vercel's existing `api/` functions and avoid colliding with `/api/lp-sheet` or `/api/wallet-idle` until the new endpoint is deployed.
