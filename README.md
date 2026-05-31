# Portfolio Tracker

DeFi portfolio viewer (DeBank + on-chain RPC): wallet balances, LP positions, lending, chain filters.

> **Cursor:** открывай папку `~/Documents/Cursor/portfolio-tracker` (см. [PROJECT.md](PROJECT.md)).

**Production:** [cry-maden008.pythonanywhere.com/portfolio](https://cry-maden008.pythonanywhere.com/portfolio/)

**GitHub:** [github.com/GithubRavilS/publicportfolio](https://github.com/GithubRavilS/publicportfolio) — branch `portfolio-tracker`

## Stack

- **Frontend:** vanilla JS (`js/app.js` → `js/app.bundle.js`), `css/styles.css`
- **Backend:** Python (`server.py` + `wsgi.py`), Node scripts for DeBank/Revert parsing
- **Deploy:** PythonAnywhere (WSGI mount at `/portfolio`)

## Development

```bash
npm install
npm run verify          # lint, bundle, ruff smoke
npm run verify:debank   # compare 10 wallets vs DeBank (needs network)
python3 server.py       # local API on :5500
```

Copy `config.example.json` → `config.json` (never commit `config.json`).

## Deploy to PythonAnywhere

**Production URL:** [cry-maden008.pythonanywhere.com/portfolio](https://cry-maden008.pythonanywhere.com/portfolio/) — это не GitHub, а отдельный сервер. GitHub хранит код; PA показывает сайт.

### Автодеплой (без ручной заливки zip)

**Один раз** — скопируй `.env.pa.example` → `.env.pa` и вставь API token с [pythonanywhere.com → Account → API token](https://www.pythonanywhere.com/account/#api_token).

Дальше всё само:

| Команда | Что делает |
|---|---|
| `npm run deploy:remote` | Заливает файлы на PA через API + Reload (агент делает это после правок) |
| `npm run deploy:setup` | PA сам тянет GitHub каждый час (`git pull`) — zip вообще не нужен |

**GitHub Actions** (push → deploy за ~2 мин): скопируй `docs/deploy-pa-workflow.yml` в `.github/workflows/` и добавь secrets `PA_API_TOKEN`, `PA_USERNAME`, `PA_DOMAIN` в репо на GitHub.

### Ручной zip (fallback)

```bash
npm run deploy:pa   # → deploy/pa-upload.zip
```

## CI

GitHub Actions workflow is in [docs/ci-workflow.yml](docs/ci-workflow.yml) (copy to `.github/workflows/ci.yml` when PAT has `workflow` scope).

## Agent hooks

Cursor stop-hooks run `nano-staged` + `npm run verify` after JS/Python edits. See `.cursor/rules/portfolio-agent.mdc`.
