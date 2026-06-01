# Гибрид Alchemy + RPC

## Фаза 1 (сразу на экране, цель 3–8 с)

`source=hybrid` без `enrich=1`:

- Alchemy Portfolio API: ERC20 + native + NFT в кошельке
- LP NFT (Uniswap/Pancake NFPM): `positions()` по tokenId
- **Не видит** Pancake **Farming** (NFT в MasterChef)

## Фаза 2 (фон, 1–2 мин)

`source=hybrid&enrich=1`:

- RPC farm scan (getLogs) + CAKE rewards
- Мерж с фазой 1 по `tokenId`

## Настройка

`config.json`:

```json
"alchemy_api_key": "ваш_ключ",
"rpc_urls": {
  "base": "https://base-mainnet.g.alchemy.com/v2/тот_же_ключ"
}
```

Ключ: [dashboard.alchemy.com](https://dashboard.alchemy.com/) → App → API Key.

## API

- Быстро: `/api/portfolio?wallet=0x…&source=hybrid&refresh=1`
- Обогащение: `&enrich=1`
