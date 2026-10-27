# Navigator snapshot requirements for Public Portfolio

The Public Portfolio consumes `GET /portfolio-check/api/public/navigator-snapshot`. Keep this export aligned with the personal cabinet's cache and aggregation rules.

## Fields required for detail views

- For every lending position: collateral and borrowed token rows, token amounts, USD marks, APY, health factor, liquidation price, market price, and close factor when the cabinet source has it.
- For every liquidity position: token pair, principal value, claimed and pending fees, claimed and pending incentives, fee range, in-range status, and source timestamp.
- For every yield position: asset, token amount, principal value, APY, rewards, and source timestamp.
- For each wallet: masked address, idle balance, chain, and source timestamp.
- For summary metrics: wallet idle, collateral, debt, liquidity, yield principal, rewards (outside net worth), borrowing rate, health factor, and cabinet total.

Do not calculate a close factor when the cabinet export does not provide one. Return it as null and let the UI say the source has no value.

## History

- Export a verified daily series from the same cabinet snapshots used for the current balance, not a synthetic chart.
- Keep prior daily points stable; update the current date's point when a same-day snapshot changes.
- Preserve the source timestamp and snapshot identifier for reconciliation.
- Rewards remain outside net worth. The public-only +$800 equity adjustment is applied to headline equity/history once, never to categories or positions.
- The portfolio front end records equity and summary totals daily from this read-only endpoint. The history record must contain summary fields only, not wallet addresses or raw positions.

## VIP position metrics contract

The public UI uses type-specific columns and does not display wallet identifiers.
LP lists and cards prioritize `displayApr` (annual percentage, not fraction), price
range and pool fee. These must be exported from the same cabinet snapshot as the
position value. Do not join an old sheet by pair, NFT ID alone or protocol name.

Every active LP needs:
- `displayApr` / `apr`: numeric APR in percentage points; `ratePeriod` describes the observation window when available. A missing rate is null, never zero or a lifetime-yield estimate.
- `rangeMin`, `rangeMax`, `rangeCurrent`, `rangeQuote`, `inRange`: prices all in the same quote-token orientation. Missing bounds remain null even if `inRange` is available.
- `feeTierPct`: pool swap fee in percentage points (0.05 means 0.05%). Alternatively export `feeTier` with `feeTierUnit: "percent"`. A percent string such as "0.05%" is also displayable. Raw pips/bps without units must not be guessed.
- `dynamicFee`: true for dynamic fees; only supply a numeric fee when the source actually provides the current fee.
- `updatedAt`: timestamp of the underlying position scan, not of the export request.

Public Portfolio refreshes on return to the tab and every five minutes while
visible. Endpoint/fallback snapshots or individual positions older than 36 hours
remain visible as the last available values, with their source date and an explicit
stale warning. Age alone must never blank overview metrics, position amounts,
earnings or lending risk details. Missing fields stay unavailable individually. Source refresh must be repaired in Navigator's
scan scheduler; refreshing the public export alone does not refresh its cache.

On 2026-10-27 the public cabinet endpoint still returned a 2026-10-23 snapshot.
All four LPs had null APR, fee tier and price bounds. These fields must be restored
in `backend/public_navigator_export.py` and the source cache refresh, rather than
copied from the independently updated legacy sheet.
