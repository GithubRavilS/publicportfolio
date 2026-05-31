# Ончейн-пайплайн (как мы тянем портфель без DeBank API)

## За 30 секунд

1. Пользователь вводит **публичный адрес** (0x…).
2. **Сервер** (не iPhone) сканирует до **20 EVM-сетей** параллельно.
3. Для каждой сети: нативный баланс + ERC-20 (**Etherscan Free**: `balance` + `tokentx` → `tokenbalance`, 3 req/s, 100k/день) или RPC/эксплорер на сетях без Free multichain + DeFi-контракты (LP, Aave, …).
4. **Hybrid:** сверяем с DeBank (бесплатно через Jina, не OpenAPI) → то, что ончейн не нашёл, **добираем** из DeBank с меткой `debankFill`.
5. Итог для UI: `totalUsd` = DeBank, `computedTotalUsd` = сумма позиций, `coverageGapUsd` = разница.

## Почему ончейн «меньше», чем DeBank

| Причина | Решение |
|---------|---------|
| Не знаем адреса всех токенов без индексатора | Etherscan Free: `tokentx` + `tokenbalance` (не Pro `addresstokenbalance`); gap → DeBank |
| Не все протоколы описаны | Адаптер на протокол (как Aave/Uni); остальное → DeBank fill |
| Цены | DefiLlama / CoinGecko, не оракул DeBank |
| Экзотические vaults | Постепенно добавляем в `onchain-registry.js` |

**Это нормально для v1 App Store:** честный % покрытия лучше, чем молча показывать неполные данные.

## Топ-20 сетей (`js/onchain-registry.js`)

`SCAN_CHAINS` = все с `scan: true` в `CHAINS` (сейчас 20):

eth, bsc, arb, base, matic, op, avax, era, linea, blast, scroll, mantle, gnosis, ftm, celo, cro, metis, mode, sonic, zora.

На каждой сети минимум: **кошелёк**. Где есть адреса NFPM — **Uniswap V3 LP**. Где есть pool — **Aave V3**.

## Etherscan Free (`js/etherscan-api.js`)

В `config.json`: `"etherscan_api_key": "…"` (или `ETHERSCAN_API_KEY` в env).

| Free | Pro ($50) |
|------|-----------|
| 3 req/s, 100k/день | выше лимиты |
| ~9 сетей multichain (eth, arb, matic, linea, blast, gnosis, mantle, celo, sonic) | 100% сетей |
| `balance`, `tokentx`, `tokenbalance` | + `addresstokenbalance` одним запросом |

Счётчик запросов: `.cache/etherscan-usage.json`. При ключе **mass llama wallet-scan отключён** (ложные `balanceOf` по yields).

Сети вне Free (base, bsc, op, …): нативный баланс через **RPC**, токены — эксплорер/Jina fallback.

## Команды

```bash
# Скан одного кошелька (все сети)
node scripts/run-onchain-portfolio.mjs 0xYOUR_WALLET

# Только Etherscan-кошелёк (3 сети, быстрый smoke)
node scripts/test-etherscan-wallet.mjs 0xYOUR_WALLET

# Сверка hybrid / onchain / debank (нужен запущенный API)
PT_BASE=http://127.0.0.1:5500 node scripts/compare-hybrid.mjs 0xYOUR_WALLET

npm run verify
```

## API

- `GET /api/portfolio?wallet=0x…&source=hybrid` — **по умолчанию** (ончейн + добор DeBank).
- `source=onchain` — только RPC, без DeBank.
- `source=debank` — legacy Jina/parse.

## DeFiLlama — топ-300 и пробелы

```bash
npm run build:llama          # universe + mass-index (509+ адаптеров)
npm run build:llama-index    # только data/llama-yield-index.json
node scripts/llama-gaps-report.mjs
```

**Mass-scan (`llama_token_scan`):** ~5600 контрактов из DeFiLlama yields, `balanceOf` батчами по 20 сетям → **509 проектов** без ручного кода на каждый.

- `js/protocol-adapters.js` — slug → тип адаптера (`aave_v3`, `morpho_api`, `uni_v3_nfpm`, `gap`, …).
- **Новые сканеры:** Morpho (GraphQL), Compound V3 (Comet), SparkLend (Aave-fork pool).
- **90% TVL ончейн** — цель на квартал; **hybrid** даёт пользователю полную сумму уже сейчас.

## Цель App Store

Клиент только шлёт адрес. Весь тяжёлый scan — на сервере с кэшем 10 мин. DeBank OpenAPI в проде **не обязателен**.
