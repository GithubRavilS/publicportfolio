# Portfolio Tracker

DeFi portfolio viewer (DeBank + on-chain RPC): wallet balances, LP positions, lending, chain filters.

**Production:** [cry-maden008.pythonanywhere.com/portfolio](https://cry-maden008.pythonanywhere.com/portfolio/)

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

### Option A — git pull (recommended)

On PA (Bash), once:

```bash
cd ~/Portfolio-tracker
git clone https://github.com/GithubRavilS/portfolio-tracker.git .
# keep existing config.json; do not overwrite
pip install -r requirements.txt
```

Updates after each push to `main`:

```bash
cd ~/Portfolio-tracker
git pull origin main
npm run bundle   # if you changed js/app.js
# Web → Reload
```

### Option B — upload zip

```bash
npm run deploy:pa
```

Upload `deploy/pa-upload.zip` via PA Files, unzip into project folder, **Web → Reload**.

See [deploy/PYTHONANYWHERE.md](deploy/PYTHONANYWHERE.md) and [deploy/MADYAN008_STEPS.md](deploy/MADYAN008_STEPS.md).

## CI

GitHub Actions runs `npm run verify` on push/PR to `main`.

## Agent hooks

Cursor stop-hooks run `nano-staged` + `npm run verify` after JS/Python edits. See `.cursor/rules/portfolio-agent.mdc`.
