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

## Local Development Tips

- Use `npm run lint` and `npm test` before PRs
- For queue UI development modes, see `src/dev/README.md`
- For full container run: `docker compose up --build`

## Production Notes

- Use strong `NEXTAUTH_SECRET` and `CRON_SECRET`
- Keep app and worker as separate processes
- Configure persistent Postgres and Redis volumes
- Configure webhook URLs with HTTPS
