# Setup Guide

This guide gets Clira running locally with the same app/worker/cron topology used in production.

## Prerequisites

- Node.js 22.x
- npm 10.x
- Docker + Docker Compose
- Postgres and Redis ports available (`15432`, `16379`)
- Google Cloud project (Gmail API + Pub/Sub)

## 1) Install and configure

```bash
npm install
cp .env.example .env
```

Set all required values in `.env`.
Fresh Docker volumes bootstrap a dedicated app DB role from `CLIRA_DB_APP_USER` / `CLIRA_DB_APP_PASSWORD`.
If your Postgres volume already exists, create or update that role once before starting app and workers.

If you plan to run the full Docker stack on a VM, also set:

- `APP_PUBLIC_URL` to the external URL users will open in the browser
- `APP_LANDING_PAGE_URL` only if unauthenticated users should be redirected to a separate landing page instead of `/signin`

### Language model provider

Clira defaults to Gemini-backed models. To keep the current setup unchanged, leave `AI_PROVIDER=google` and set `GOOGLE_GENERATIVE_AI_API_KEY` (or `GOOGLE_API_KEY`).

If you want to use OpenRouter, set `AI_PROVIDER=openrouter`, `OPENROUTER_API_KEY`, and explicit role model ids as described in `docs/ai-providers.md`.

Per-model provider overrides take precedence over the global provider if you need a mixed setup.

### Executive-agent public web search

If you want the executive agent to look up current public information on the internet, set:

```env
EXA_API_KEY=your_exa_api_key
```

This enables the executive agent's `search_web` tool. It is optional. Without it, inbox, calendar, memory, and other agent features still work, but public web search degrades cleanly as unavailable.

## 2) Start infra

```bash
docker compose up -d db redis
```

## 3) Apply database schema

```bash
npm run migrate:deploy
```

## 4) Start app, worker, Gmail pull worker, and cron

Terminal A:

```bash
npm run dev
```

Terminal B:

```bash
npm run start:worker
```

Terminal C:

```bash
npm run start:gmail-pull-worker
```

Terminal D:

```bash
npm run start:cron
```

## 5) Validate

- App loads at `http://localhost:3000`
- Health endpoint: `GET /api/health` returns `healthy`
- Worker logs show startup and queue readiness
- Gmail pull worker logs show subscription startup and heartbeat writes
- Cron logs show scheduled triggers for `/api/cron/reminders`, `/api/cron/sort`, and `/api/cron/renew-gmail-watches`

## 6) Configure Gmail ingestion

Use `docs/gmail-pubsub.md` to configure pull-default or push-mode ingestion.

## 7) Optional: Telegram setup (first-time, beginner path)

### Admin setup (one-time)

1. Create a bot with `@BotFather` in Telegram.
1. Run `/newbot` and finish bot creation.
1. Copy the bot token.
1. Set in `.env`:

```env
TELEGRAM_BOT_TOKEN=your_botfather_token
TELEGRAM_ENABLED=true
```

1. Restart app + worker + cron so all processes load new env values.

If running full Docker stack:

```bash
docker compose up -d --force-recreate app worker cron
```

If running local `npm run dev` + `npm run start:worker` + `npm run start:gmail-pull-worker` + `npm run start:cron`, restart all four terminals.

### User pairing flow (per user)

1. Open **Settings -> Text Clira -> Telegram Integration**.
2. Send any DM to the Telegram bot.
3. Copy the 8-character pairing code returned by the bot.
4. Paste code in Settings and click **Link Telegram**.
5. Confirm linked account appears under **Linked account**.

### Quick checks

- If UI shows `Telegram bot token is not configured on this environment`, token was not loaded in runtime env.
- If pairing fails, generate a fresh code from bot DM and retry.
- If wrong account is linked, click **Unlink** and link again.

## Local Development Tips

- Use `npm run lint` and `npm test` before PRs
- For queue UI development modes, see `src/dev/README.md`
- For full container run: `docker compose up --build`

## Production Notes

- Use strong `NEXTAUTH_SECRET` and `CRON_SECRET`
- Keep app and worker as separate processes
- Configure persistent Postgres and Redis volumes
- Set `APP_PUBLIC_URL` to the real public VM/domain URL before `docker compose up --build`
- Configure webhook URLs with HTTPS if using push mode
