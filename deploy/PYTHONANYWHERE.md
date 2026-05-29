# Деплой Portfolio Tracker на PythonAnywhere

## Что нужно

- Аккаунт [pythonanywhere.com](https://www.pythonanywhere.com) (лучше платный — на free ограничены внешние запросы)
- **Node.js** в консоли: `node --version` (парсер DeBank/Revert вызывает `node`)
- Файл `config.json` с ключом ScraperAPI (как локально)

## 1. Загрузить проект

Через **Files** или git в каталог, например:

`/home/ВАШ_ЛОГИН/portfolio-tracker`

## 2. Виртуальное окружение

```bash
cd ~/portfolio-tracker
python3.10 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## 3. Web app

1. **Web** → **Add a new web app** → Manual configuration → Python 3.10
2. **Virtualenv**: `/home/ВАШ_ЛОГИН/portfolio-tracker/venv`
3. **WSGI configuration file** — замените содержимое на:

```python
import sys
path = '/home/ВАШ_ЛОГИН/portfolio-tracker'
if path not in sys.path:
    sys.path.insert(0, path)
from wsgi import application
```

4. **Reload** веб-приложения

Сайт: `https://ВАШ_ЛОГИН.pythonanywhere.com/`

## 4. Whitelist URL (обязательно на free)

**Web** → ваш сайт → раздел про allowed hosts / API — добавьте:

- `r.jina.ai`
- `api.scraperapi.com` (если используете ScraperAPI)
- `api.coingecko.com`
- `revert.finance` (через Jina)

Без этого API вернёт ошибки.

## 5. config.json

```json
{
  "debank_scraperapi_key": "ВАШ_КЛЮЧ"
}
```

Права: только вы читаете файл.

## 6. Node.js

В Bash:

```bash
which node
```

Если нет — на платных планах иногда ставят через `nvm`; без Node парсинг не работает.

## 7. Кэш

Папки `.cache/` создаются автоматически. На PA можно оставить в проекте.

## Быстрый тест без PA

Локально + туннель (ngrok / localtunnel):

```bash
python3 server.py
# в другом терминале:
ngrok http 5500
```

Ссылку из ngrok отдайте тестерам.

## Ссылка для людей

После деплоя:

`https://ВАШ_ЛОГИН.pythonanywhere.com/?wallet=0x...` — сразу откроет портфель.

Или главная — вставка адреса (Cmd+V на телефоне — долгое нажатие → Вставить).
