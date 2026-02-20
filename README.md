# Clira

Clira is a self-hosted AI email assistant focused on safe automation and draft-first workflows. Your data stays in your infrastructure.

## Why Clira

- Self-hosted by default (app + worker + Postgres + Redis)
- Draft-first pipeline with deterministic filtering before LLM generation
- Multi-mailbox aware Gmail integration
- Optional conversational channels (Twilio SMS, WhatsApp Cloud API)
- Optional long-term memory via Supermemory

## Current Product Scope

- Implemented: Gmail ingestion, queue review UI, staged reply generation, smart folders, onboarding pipeline
- Implemented: Optional Twilio and WhatsApp assistant channels
- Implemented: Worker-based background processing and cron endpoints
- Not implemented: Outlook pipeline parity

## Architecture At A Glance

```text
Gmail Pub/Sub/Webhook
        |
        v
/api/gmail-push/webhook
        |
        v
GmailPushService
  -> filtering (deterministic)
  -> routing and queue state
  -> reply-generation jobs (BullMQ)
        |
        v
ReplyGeneratorService
  Stage 1: Planner Agent (tools/context)
  Stage 2: Style Agent (voice only, no new facts)
        |
        v
Draft + queue UI + optional channel delivery
```

## Quick Start (Local)

Prerequisites:

- Node.js 22.x
- npm 10.x
- Docker + Docker Compose
- Google Cloud project with Gmail API + Pub/Sub (for push ingestion)

1. Install dependencies

```bash
npm install
```

2. Configure environment

```bash
cp .env.example .env
```

Fill all required variables in `.env`.

3. Start infrastructure

```bash
docker compose up -d db redis
```

4. Run migrations

```bash
npm run migrate:deploy
```

5. Start app and worker (separate terminals)

```bash
npm run dev
npm run start:worker
```

6. Open the app

- http://localhost:3000

## Full Docker Path

```bash
docker compose up --build
```

This starts `app`, `worker`, `db`, and `redis` using the production image build.

## Required Environment Variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `REDIS_URL` | Redis connection for BullMQ + runtime cache |
| `NEXTAUTH_SECRET` | Auth/session signing secret |
| `NEXTAUTH_URL` | Canonical app URL |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth for mailbox auth |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini key for AI generation |
| `GOOGLE_CLOUD_PROJECT_ID` | GCP project for Gmail push/watch setup |

## Optional Integrations And Flags

- Twilio channel: `TWILIO_*`
- WhatsApp Cloud API: `WHATSAPP_*`
- Supermemory: `SUPERMEMORY_*`
- KMS encryption toggles: `ENABLE_KMS_OAUTH_ENCRYPTION`, `ENABLE_KMS_EMAIL_ENCRYPTION`, `KMS_KEY_ID`
- Always-on sorting toggles: `FEATURE_FLAG_ALWAYS_ON_SORTING`, `ALWAYS_ON_SORT_*`, `MAPPING_*`

## Core Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start Next.js app |
| `npm run start:worker` | Start BullMQ worker process |
| `npm run build` | Build app + worker bundle |
| `npm run lint` | Run lint checks |
| `npm test` | Run Jest tests |
| `npm run setup:google` | Bootstrap Gmail Pub/Sub resources |
| `npm run benchmark` | Run benchmark scaffold |
| `npm run migrate:status` | Show Prisma migration status |

## Operational Endpoints

- `GET /api/health` - app health + env validation
- `POST /api/cron/sort` - always-on sorting trigger (requires `Authorization: Bearer $CRON_SECRET`)
- `POST /api/cron/reminders` - enqueue due reminders (same auth)
- `GET /api/cron/renew-gmail-watches` - renew Gmail watch subscriptions (same auth)

## Documentation

- Setup: `docs/setup.md`
- Architecture: `docs/architecture.md`
- Operations Runbook: `docs/operations.md`
- Gmail Pub/Sub: `docs/gmail-pubsub.md`
- Executive Agent Channels: `docs/executive-agent.md`
- Folder And Routing System: `docs/folders.md`
- MasterPrompt System: `docs/masterprompt.md`
- Supermemory Integration: `docs/supermemory.md`
- Benchmarks: `docs/benchmarks.md`
- Security: `docs/security.md`
- Troubleshooting: `docs/troubleshooting.md`
- Docs index: `docs/README.md`
- API Reference: `docs/api-reference.md`

## Security

See `docs/security.md` and `SECURITY.md` for deployment hardening, credential handling, and vulnerability reporting guidance.

## Contributing

See `CONTRIBUTING.md`.
