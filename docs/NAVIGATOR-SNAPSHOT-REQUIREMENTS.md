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
