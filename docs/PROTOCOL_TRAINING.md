# Обучение on-chain адаптеров (как DeBank, шаг за шаг)

## DeBank scrape vs debank.com

Сайт DeBank показывает верные сети. Ошибки **arb/eth** в наших отчётах — из **Jina markdown** (дубли NFT на chain-страницах).

Исправление: `js/debank-lp-chains.js` — `ownerOf` + on-chain USD/CAKE/стейк для NFT.

Проверка: `node scripts/debug-debank-pancake.mjs 0xWallet`

## Процесс

1. Выбрать протокол из очереди: `node scripts/train-protocol.mjs --list`
2. Добавить 10 кошельков с позициями в `scripts/training-wallets.txt`
3. Запустить сверку:
   ```bash
   node scripts/train-protocol.mjs uniswap-v3 --wallets scripts/training-wallets.txt
   ```
4. **PASS** = сумма USD ±15%, все позиции DeBank найдены on-chain, нет лишних >$5
5. Если FAIL — правим `js/onchain-*.js` / `js/protocols/`, повторяем
6. Статус в `js/protocols/registry.js` → `trained`, переходим к следующему

## Что уже сканируется on-chain

| ID | Модуль | Статус |
|----|--------|--------|
| uniswap-v3 | `onchain-lp.js` + NFPM в registry | learning |
| aerodrome-v3 | NFPM base | planned |
| pancakeswap-v3 | NFPM + MasterChef + `pendingCake` | learning — стейк, CAKE, сеть |
| aave-v3 | `onchain-lending.js` | planned |
| compound-v3 | `onchain-compound.js` | planned |
| fluid | `onchain-fluid.js` | planned |

## Etherscan в цепочке

Etherscan = **логи Transfer** (найти NFT tokenId) + **eth_call** к NFPM/pool.  
Не отдаёт «все DeFi позиции» — мы сами знаем контракт Uniswap/Aave и читаем `positions()`, `balanceOf`.

## Твоя роль

Если FAIL с непонятной позицией — пришли:
- адрес кошелька
- скрин DeBank / Revert
- вывод `train-protocol.mjs`

Я допишу парсер; ты помогаешь только на «слепых» протоколах.
