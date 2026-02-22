# Setup Guide

This guide gets Clira running locally with the same app/worker topology used in production.

## Prerequisites

- Node.js 22.x
- npm 10.x
- Docker + Docker Compose
- Postgres and Redis ports available (`15432`, `16379`)
- Google Cloud project (Gmail API + Pub/Sub) for push ingestion

## 1) Install and configure

```bash
npm install
cp .env.example .env
```

Set all required values in `.env`.

## 2) Start infra

```bash
docker compose up -d db redis
```

## 3) Apply database schema

```bash
npm run migrate:deploy
```

## 4) Start app and worker

Terminal A:

```bash
npm run dev
```

Terminal B:

```bash
npm run start:worker
```

## 5) Validate

- App loads at `http://localhost:3000`
- Health endpoint: `GET /api/health` returns `healthy`
- Worker logs show startup and queue readiness

## 6) Configure Gmail push

Use `docs/gmail-pubsub.md` to configure Pub/Sub and webhook delivery.

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

1. Restart app + worker so both processes load new env values.

If running full Docker stack:

```bash
docker compose up -d --force-recreate app worker
```

If running local `npm run dev` + `npm run start:worker`, restart both terminals.

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
- Configure webhook URLs with HTTPS
