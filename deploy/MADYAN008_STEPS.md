# Madyan008 — Portfolio Tracker + Crypto Soviet на одном Web app

Сайт бота: `https://madyan008.pythonanywhere.com/`  
Трекер: `https://madyan008.pythonanywhere.com/portfolio/`

Папка на сервере: `/home/Madyan008/Portfolio-tracker` (регистр букв важен!)

---

## Шаг 1. Проверить файлы (Files)

В `/home/Madyan008/Portfolio-tracker` должны быть:

- `index.html`, `server.py`, `wsgi.py`, `requirements.txt`, `config.json`
- папки `css/`, `js/` (с `app.bundle.js`)

---

## Шаг 2. Один virtualenv на оба проекта

На PA **один** Web app = **одно** виртуальное окружение.

1. Откройте **Web**
2. Найдите строку **Virtualenv** у уже существующего сайта (Crypto Soviet)
3. Запомните путь, например `/home/Madyan008/.virtualenvs/crypto-soviet` или `/home/Madyan008/Portfolio-tracker/venv`

**Рекомендация:** используйте venv бота (если он уже работает). В **Bash**:

```bash
source /home/Madyan008/.virtualenvs/ВАШ_VENV/bin/activate
pip install werkzeug
```

(подставьте реальный путь из Web → Virtualenv)

Если venv только в Portfolio-tracker — в **Web → Virtualenv** укажите:

`/home/Madyan008/Portfolio-tracker/venv`

и в venv бота доустановите зависимости бота заново (сложнее). Проще: **werkzeug в venv бота**.

---

## Шаг 3. Node.js (Bash)

```bash
node --version
which node
```

Должна быть версия. Без Node API портфеля не парсит DeBank.

---

## Шаг 4. WSGI — не создавать новый Web app!

1. **Web** → ваш единственный сайт (Crypto Soviet)
2. Нажмите синюю ссылку **WSGI configuration file**
3. Вверху файла — код бота (`application = ...`). **Не удаляйте.**
4. В **самый низ** вставьте блок из файла `deploy/combined_wsgi_snippet.py`
5. **Save**

Если внизу уже есть `def application` — переименуйте старый в `application` только один раз: сначала сохраните бота как `_original_application`, как в сниппете.

---

## Шаг 5. Reload

**Web** → зелёная кнопка **Reload** `madyan008.pythonanywhere.com`

---

## Шаг 6. Проверка

В браузере:

1. `https://madyan008.pythonanywhere.com/portfolio/` — форма трекера
2. `https://madyan008.pythonanywhere.com/portfolio/api/health` — JSON `{"ok":true,"app":"portfolio-tracker"}`
3. Бот по старому URL без `/portfolio/` — как раньше

---

## Шаг 7. Whitelist URL (если free / лимиты API)

**Web** → тот же сайт → **Allowlisted hosts** (или Account → API token):

- `r.jina.ai`
- `api.scraperapi.com`
- `api.coingecko.com`

---

## Шаг 8. Собрать `app.bundle.js` на PA (папки `web/` на сервере НЕТ)

Проект на сервере только: `/home/Maden008/Portfolio-tracker`  
(`css/`, `js/`, `scripts/`, `server.py`, `wsgi.py` — без `web/node_modules`).

**Bash на PythonAnywhere:**

```bash
cd /home/Maden008/Portfolio-tracker
npx --yes esbuild@0.25.5 js/app.js --bundle --format=esm --outfile=js/app.bundle.js
```

Или после заливки нового `package.json` с Mac:

```bash
cd /home/Maden008/Portfolio-tracker
npm install
npm run build:app
```

**Либо** собрать на Mac и залить готовый `js/app.bundle.js` через Files.

После сборки залейте/обновите также:

- все `js/onchain-*.js`, `js/portfolio-hybrid-merge.js`, `js/revert-*.js`, `js/app.js`
- `index.html` (`?v=40`)
- `server.py`, `wsgi.py`, `css/styles.css`
- `config.json` (ключи `rpc_urls`, `etherscan_keys`, `debank_scraperapi_key`)

---

## Ссылки для тестеров

- Трекер: `https://madyan008.pythonanywhere.com/portfolio/`
- С кошельком: `https://madyan008.pythonanywhere.com/portfolio/?wallet=0x...`

---

## Ошибки

| Симптом              | Что сделать                                                       |
| -------------------- | ----------------------------------------------------------------- |
| 404 на `/portfolio/` | Reload; проверить WSGI-сниппет и путь `Portfolio-tracker`         |
| 500 при открытии     | Web → **Error log**; часто нет `werkzeug` или неверный `sys.path` |
| API не отвечает      | Whitelist; `config.json`; `node` в Bash                           |
| Стили не грузятся    | Открывать именно `/portfolio/` со слэшем в конце                  |
