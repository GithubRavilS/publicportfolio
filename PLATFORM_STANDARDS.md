# Platform UI and data standards

These requirements apply to every public product page and dashboard in this repository. Use them as the default when extending the portfolio or creating another platform.

## Language

- Russian is the first-run default.
- Provide a visible language switch for Russian and English; remember the selection.
- Each language must translate the complete interface, including navigation, buttons, forms, empty states, errors, tooltips, dates, accessibility labels, and detail views. Do not ship mixed-language UI.
- Keep protocol, token, ticker, and product names in their official form.

## Devices and layout

- Build mobile-first and support current iPhone Safari and Android Chrome screen sizes.
- Include the correct viewport and safe-area handling for notched devices.
- Keep controls reachable with one hand, prevent page-level horizontal overflow, and make tables/cards usable on narrow screens.
- Use accessible touch targets and preserve keyboard navigation on desktop.

## Themes

- Provide an in-product light/dark theme switch.
- Respect the system theme on first visit, then remember the user's explicit choice.
- Keep text, controls, charts, tables, and overlays readable in both themes with sufficient contrast.

## Interaction

- Every metric card, tab, navigation item, chart control, row, and detail affordance must perform a clear action.
- Use real buttons and links where possible; interactive cards and rows need keyboard support and visible focus.
- Detail views should expose all fields supplied by the source, with clear unavailable states when a field is absent.

## Data integrity and history

- Read portfolio values from the same DeFi Navigator cabinet snapshot used by the authenticated cabinet.
- Show source timestamp, freshness, completeness, and error states. Never label demo, stale, or incomplete values as live.
- Do not invent unavailable fields or backfill history with estimates. Keep the hidden +$800 adjustment in headline public equity only; exclude it from all position/category detail and rewards.
- Persist daily snapshots from the Navigator cache so equity and key summary metrics have a factual time series. Historical backfill is allowed only from verified source records.
- Keep transaction history empty with a clear explanation when the source provides no transactions.

## Privacy

- Public history files may contain only the public portfolio summary fields explicitly approved for display.
- Never commit wallet addresses, raw cabinet responses, authentication material, private identifiers, or position-level raw payloads to GitHub.

## Project communication

- Every response about this project must end with concrete next steps whenever further work is needed, including progress updates.
- State the actions in execution order, who performs each action, and the evidence that will confirm completion. Include dependencies or blockers when relevant.
- Keep the steps detailed enough to act on; avoid generic promises to investigate or continue.
- Distinguish completed, tested, deployed, and production-verified work. Never describe a prepared patch as a completed production fix.
- If no further action is needed, end by stating that explicitly.
