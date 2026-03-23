# Contributor Setup

This guide is for developing Clira locally. If you only want to run the product, use [docs/self-host.md](/Users/Rushik/Downloads/clira-os/Clira/docs/self-host.md) instead.

## Prerequisites

- Node.js 22.x
- npm 10.x
- Docker + Docker Compose
- Google Cloud project with Gmail API + Pub/Sub

## 1. Install dependencies

```bash
npm install
cp .env.example .env
```

For local `next dev`, set:

```env
NEXTAUTH_URL=http://localhost:3000
```

If you switch back to Docker self-host, set `NEXTAUTH_URL` back to `http://localhost:13000` or just rely on `APP_PUBLIC_URL` inside containers.

## 2. Start local infra

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile core up -d db redis
```

## 3. Apply the schema

```bash
npm run migrate:deploy
```

## 4. Run the local processes

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

Optional Terminal E for inbox search backfill:

```bash
npm run start:backfill-worker
```

## 5. Validate

- App: `http://localhost:3000`
- Liveness: `http://localhost:3000/api/health`
- Deep readiness: `http://localhost:3000/api/health?deep=1`

## Local Docker Build Path

If you want to run the full stack from a locally built image instead of the published GHCR image:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile core up --build -d
```

Add `--profile backfill` if you want the backfill worker as well.

## Notes

- The contributor path keeps the production-style split between app, worker, Gmail pull worker, and cron.
- `cron` requires `CRON_SECRET`.
- Mailbox token encryption requires `EMAIL_ENCRYPT_SECRET` and `EMAIL_ENCRYPT_SALT`.
- Use `npm run setup:google -- --project-id <id> --mode pull --write-env` to provision Gmail Pub/Sub into `.env`.
