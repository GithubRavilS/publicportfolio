# Portfolio Tracker — отдельный проект

**Открывай в Cursor именно эту папку:**  
`/Users/ravilcrypto/Documents/Cursor/portfolio-tracker`

Это единственный актуальный репозиторий трекера (DeBank + RPC + Revert + deploy на PythonAnywhere).

## Связи

| Что | Где |
|-----|-----|
| **Код (этот проект)** | `~/Documents/Cursor/portfolio-tracker` |
| **GitHub** | [github.com/GithubRavilS/publicportfolio](https://github.com/GithubRavilS/publicportfolio) — ветка `portfolio-tracker` |
| **Production** | [cry-maden008.pythonanywhere.com/portfolio](https://cry-maden008.pythonanywhere.com/portfolio/) |
| **Секреты деплоя** | `.env.pa` (локально, не в git) — см. `.env.pa.example` |
| **Конфиг API/RPC** | `config.json` (локально на PA и у себя) — см. `config.example.json` |

## Не путать с другими папками в `~/Documents/Cursor/`

| Папка | Что это |
|-------|---------|
| `Portfolio Tracker app` | **Старая копия** того же кода (до переезда сюда). Можно архивировать. |
| `publicportfolio-push` | Старый прототип (Python parser + другой UI). Не деплоится. |
| `Инструмент Portfolio Management` | Другой продукт (Apps Script / LegoLabs), не этот трекер. |
| `Crystal`, `Revert-выгрузка` | Отдельные утилиты, не основной app. |

## Быстрый старт

```bash
cd ~/Documents/Cursor/portfolio-tracker
npm install
cp config.example.json config.json   # при необходимости
npm run verify
python3 server.py                    # http://127.0.0.1:5500
```

Деплой: `npm run deploy:remote` (нужен `.env.pa`).

## В Cursor

File → Open Folder → `portfolio-tracker`  
Или: агент уже переключён на этот root через `move_agent_to_root`.
