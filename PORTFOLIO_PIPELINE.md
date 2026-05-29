# Portfolio pipeline (web → mobile)

## Поток данных

1. **DeBank (Jina)** — источник истины по `totalUsd` и списку позиций.
2. **`buildPortfolioFromDebank`** (`js/portfolio-pipeline.js`) — парс → `dedupe` → `normalize` → KPI.
3. **Hybrid** (`mergeHybridPortfolio`) — ончейн заменяет совпадения; Revert — APY/диапазоны; DeBank — пробелы.
4. **`syncDisplayTotals`** — `totalUsd = debankTotalUsd`, категории = сумма позиций, `partial` при расхождении.

## Модули

| Файл                           | Назначение                              |
| ------------------------------ | --------------------------------------- |
| `js/debank-parse.js`           | Парс markdown DeBank                    |
| `js/portfolio-dedupe.js`       | Без «DeBank · Chain», дубли LP/кошелька |
| `js/portfolio-normalize.js`    | Сети, KPI, gap                          |
| `js/portfolio-sanity.js`       | Отсечение битого ончейн (Fluid decode)  |
| `js/portfolio-hybrid-merge.js` | DeBank + on-chain                       |
| `js/revert-portfolio-merge.js` | Revert enrich                           |
| `scripts/run-debank-parse.mjs` | CLI для `server.py`                     |

## Правила UI

- Не показывать `DeBank ·`, `debankFill`, теги источника.
- Итог сверху = DeBank; кошелёк + ликвидность + лендинг ≈ computed.
- LP: пара, сеть, диапазон, комиссии — drawer внутри карточки.

## Деплой

```bash
npx esbuild js/app.js --bundle --format=esm --outfile=js/app.bundle.js
# index.html ?v=APP_VER, Web Reload на PythonAnywhere
```
