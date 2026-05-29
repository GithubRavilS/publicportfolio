# Portfolio Tracker → App Store (краткий каркас)

## Архитектура (mobile-ready)

```
mobile (Expo/React Native)
    ↓ HTTPS JSON
PythonAnywhere API (server.py / wsgi.py)
    ↓ subprocess
Node: debank-parse → portfolio-pipeline → hybrid-merge → revert enrich
    ↓
DeBank (Jina) + Revert (Jina) + RPC (бесплатные ноды)
```

- **Единая модель:** `protocolGroups`, `totalUsd`, `computedTotalUsd`, `coverageGapUsd` (`PORTFOLIO_SCHEMA=9`).
- **Секреты только на сервере:** `config.json` не в клиенте; в приложении — только wallet address.
- **Нет платных API в клиенте:** ScraperAPI опционален на сервере; основной канал — `r.jina.ai`.

## Требования Apple (чеклист перед сабмитом)

1. **Privacy Nutrition Labels** — собираем только адрес кошелька (не PII); нет аккаунтов.
2. **Privacy Policy URL** — описать: read-only DeFi analytics, данные не продаём.
3. **App Tracking Transparency** — не нужен, если нет трекеров/рекламы.
4. **Keychain** — опционально хранить последний wallet локально (не seed phrase).
5. **Не хранить приватные ключи** — только публичные адреса (Guideline 2.1).
6. **Encryption export** — HTTPS only → обычно exempt (стандартное TLS).
7. **Background fetch** — только по действию пользователя (pull-to-refresh).
8. **TestFlight** — 10 тест-кошельков как regression suite (`scripts/test-10-wallets.mjs`).

## Следующие шаги для mobile

- `mobile/` уже есть: подключить к `GET /portfolio?wallet=…` как web.
- Общие типы вынести в `shared/portfolio-schema.json` (опционально).
- UI повторить web KPI + accordions; не дублировать парсер в приложении.
