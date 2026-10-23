# Public Portfolio v2 — backend handoff for Cursor

## Goal

Replace the site's mixed, partially stale browser aggregation with one read-only portfolio snapshot from the same DeFi Navigator account/cache that currently reports approximately **$15,189** across the two configured wallets. The UI prototype is `public-portfolio-v2.html`; it requests `GET /api/public-portfolio/v2` (or a configurable `window.PUBLIC_PORTFOLIO_API`). No private keys, signing functions, account session tokens, or credentials may be exposed to this public page.

## Current reconciliation issue found in PublicPortfolio

- The current page imports `data/portfolio-data.js`, queries LP values separately through `/api/lp-sheet`, and fetches idle balances separately from `/api/wallet-idle`; it can also reuse `pp_wallet_idle_v1` from browser `localStorage`. Those sources can have different update times and wallet coverage.
- Current equity calculation is effectively **collateral − debt + active LP value + idle wallet balance + manual adjustment**. Rewards are shown separately. The backend must define disjoint components so the same LP/yield/collateral principal is not counted twice.
- `python/config.example.json` sets `manual_visual_adjustment_usd` to **800**. The page also hardcodes `$800` and replaces any configured adjustment below `$2,500` with `$800`. Remove that silent override. Return the configured manual adjustment as an explicit line item; for the current configuration it should remain **+$800**, until the owner intentionally changes it.
- The user reports DeFi Navigator at **$15,189** and Public Portfolio at **$11,088**. Treat these as reconciliation inputs, not hard-coded production values. Before release, log a component-by-component comparison by wallet, chain, position type and snapshot timestamp. The displayed total must come from the canonical backend total, not a frontend re-sum of independently stale APIs.

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
    "snapshotId": "opaque non-secret id"
  },
  "summary": {
    "netWorthUsd": 0,
    "walletIdleUsd": 0,
    "collateralUsd": 0,
    "liquidityUsd": 0,
    "yieldPrincipalUsd": 0,
    "debtUsd": 0,
    "manualAdjustmentUsd": 800,
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

`netWorthUsd` is authoritative. Provide a documented formula and ensure categories are mutually exclusive. Recommended reconciliation formula: idle wallet assets + collateral principal + LP principal + other yield principal − debt + configured manual adjustment. `rewardsAccruedUsd` remains a separate display metric and is excluded from `netWorthUsd` unless the DeFi Navigator account itself includes those claims; if included, mark that explicitly and avoid counting them a second time.

Each position should include stable `id`, `type` (`lending`, `liquidity`, `yield`, `wallet`, `vault`), `protocol`, `chain`, non-sensitive display-only `walletLabel`, `asset`, `valueUsd`, `collateralUsd`, `debtUsd`, `ratePct`, `rewardUsd`, optional `healthFactor`, and `includedInNetWorth`. Include richer fields in `details` when available: underlying quantities, supply/borrow APY, liquidation threshold/price, utilization, accrued fees, reward tokens, pool range, and source timestamp.

Each transaction should include stable `id`, ISO date, chain, protocol, action, asset, signed amount, `amountUsd`, category, and a public explorer URL when available. History rows should be daily canonical `date` + `equityUsd` values. Pagination/filter query parameters can be added for long transaction history; do not silently truncate without returning a cursor.

## Required behavior

1. Read from the already-maintained DeFi Navigator cache/database. Do not call DeBank/protocol sources on every public page view. Cache or precompute on the backend and return a single snapshot ID/time for all sections.
2. Include both configured wallets and all supported chains, plus every position class visible in the DeFi Navigator account. Do not rely on a first-wallet-only parser or browser localStorage.
3. Keep the existing manual adjustment as an explicit `$800` component in the response; store it in one backend configuration source and permit changing it intentionally. Never silently clamp/replace values based on a threshold.
4. Return stale/error metadata if the source cache is old or incomplete. Keep the last good snapshot available, but label it stale and show its timestamp; never present old balances as live.
5. Include per-position source identifiers and an audit/reconciliation report in server logs (no credentials). For the current mismatch, identify exactly which components account for the `$4,101` net displayed difference after accounting for the existing `$800` adjustment.
6. Public response must contain only fields intentionally approved for the public portfolio. Never include auth cookies, access tokens, private notes, private user/account data, or any write capability.

## Frontend integration notes

- Prototype is intentionally in demo mode if the endpoint is unavailable; it displays a visible demo banner rather than pretending demo balances are live.
- Point `window.PUBLIC_PORTFOLIO_API` to the final endpoint if the route differs. Remove demo fallback only after production payload and reconciliation have been verified.
- The prototype displays manual adjustment separately and displays accrued rewards separately. It expects the backend's `netWorthUsd` as the headline total.
- Check the route against Vercel's existing `api/` functions and avoid colliding with `/api/lp-sheet` or `/api/wallet-idle` until the new endpoint is deployed.
