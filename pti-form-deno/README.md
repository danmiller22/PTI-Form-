# PTI Form + Deno Relay

## Structure
- `frontend/` — React + Vite + Tailwind, RU/EN, WebP compression, 10-photo batches
- `backend/` — Deno Deploy relay to Telegram, no storage

## Deploy
### Frontend (GitHub Pages)
```bash
cd frontend
npm i
echo 'VITE_API_BASE=https://<your-deno-deploy-domain>' > .env
npm run build
# Deploy the contents of dist/ to GitHub Pages
```

### Backend (Deno Deploy)
- New project from `backend/main.ts`.
- Env:
  - TELEGRAM_BOT_TOKEN=...
  - TELEGRAM_CHAT_ID=...
  - TELEGRAM_THREAD_ID=... (if using forum topic)
  - GROUP_DELAY_MS=1500
- Deploy. Put the URL into frontend/.env as VITE_API_BASE.
