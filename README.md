# Clira

Clira is a self-hosted AI email assistant focused on safe automation and draft-first workflows. Your data stays in your infrastructure.

## Why Clira

- Self-hosted by default (app + worker + Postgres + Redis)
- Draft-first pipeline with deterministic filtering before LLM generation
- Multi-mailbox aware Gmail integration
- Provider-aware AI model layer with Gemini defaults and OpenRouter support
- Optional conversational channels (Twilio SMS, WhatsApp Cloud API, Telegram)
- Optional long-term memory via Supermemory

## Current Product Scope

- Implemented: Gmail ingestion, queue review UI, staged reply generation, smart folders, onboarding pipeline
- Implemented: Optional Twilio, WhatsApp, and Telegram assistant channels
- Implemented: Worker-based background processing and cron endpoints
- Not implemented: Outlook pipeline parity

## Architecture At A Glance

```text
Gmail Pub/Sub Topic
   |                         (mode=push only)
   |--> gmail-pull-worker --> /api/gmail-push/webhook
                 |                    |
                 +---------+----------+
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
- Google Cloud project with Gmail API + Pub/Sub

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

5. Start app, worker, Gmail pull worker, and local cron (separate terminals)

```bash
npm run dev
npm run start:worker
npm run start:gmail-pull-worker
npm run start:cron
```

6. Open the app

- http://localhost:3000

## Full Docker Path

```bash
docker compose up --build
```

This starts `app`, `worker`, `cron`, `db`, and `redis` using the production image build.

Before running on a VM, set `APP_PUBLIC_URL` in `.env` to the real externally reachable app URL.
Examples:

- `APP_PUBLIC_URL=http://<vm-ip>:13000`
- `APP_PUBLIC_URL=https://app.example.com`

If you want unauthenticated users redirected to a separate landing page, also set `APP_LANDING_PAGE_URL`.

## Required Environment Variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `CLIRA_DB_APP_USER` / `CLIRA_DB_APP_PASSWORD` | Dedicated app DB role used by local + Docker workflows |
| `REDIS_URL` | Redis connection for BullMQ + runtime cache |
| `NEXTAUTH_SECRET` | Auth/session signing secret |
| `NEXTAUTH_URL` | Canonical app URL |
| `APP_PUBLIC_URL` | Docker/VM public app URL used to populate `NEXTAUTH_URL` inside containers |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth for mailbox auth |
| `AI_PROVIDER` | Language-model provider selector (`google` default, `openrouter` optional) |
| `GOOGLE_GENERATIVE_AI_API_KEY` / `GOOGLE_API_KEY` | Gemini auth when `AI_PROVIDER=google` |
| `OPENROUTER_API_KEY` | OpenRouter auth when `AI_PROVIDER=openrouter` |
| `EXA_API_KEY` | Enables executive-agent public web search via the `search_web` tool |
| `GMAIL_INGESTION_MODE` | `pull` (default) or `push` |
| `GMAIL_PUBSUB_TOPIC` | Gmail watch Pub/Sub topic (source of truth) |
| `GMAIL_PUBSUB_PULL_SUBSCRIPTION` | Required when `GMAIL_INGESTION_MODE=pull` |

## Optional Integrations And Flags

- Twilio channel: `TWILIO_*`
- WhatsApp Cloud API: `WHATSAPP_*`
- Telegram Bot API: `TELEGRAM_*`
- Supermemory: `SUPERMEMORY_*`
- Executive-agent public web search: `EXA_API_KEY` (optional, only needed for `search_web`)
- KMS encryption toggles: `ENABLE_KMS_OAUTH_ENCRYPTION`, `ENABLE_KMS_EMAIL_ENCRYPTION`, `KMS_KEY_ID`
- Always-on sorting toggles: `FEATURE_FLAG_ALWAYS_ON_SORTING`, `ALWAYS_ON_SORT_*`, `MAPPING_*`
- Model routing overrides: see `docs/ai-providers.md`

## Core Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start Next.js app |
| `npm run start:worker` | Start BullMQ worker process |
| `npm run start:gmail-pull-worker` | Start Gmail pull ingestion worker |
| `npm run start:cron` | Start local cron scheduler that triggers `/api/cron/*` |
| `npm run build` | Build app + worker bundle |
| `npm run lint` | Run lint checks |
| `npm test` | Run Jest tests |
| `npm run setup:google` | Bootstrap Gmail Pub/Sub resources |
| `npm run benchmark` | Run benchmark scaffold |
| `npm run migrate:status` | Show Prisma migration status |

## Operational Endpoints

- `GET /api/health` - app health + env validation + active language-model provider config + Gmail ingestion mode/heartbeat
- `POST /api/cron/sort` - always-on sorting trigger (requires `Authorization: Bearer $CRON_SECRET`)
- `POST /api/cron/reminders` - enqueue due reminders (same auth)
- `GET /api/cron/renew-gmail-watches` - renew Gmail watch subscriptions (same auth)
- `POST /api/gmail-push/webhook` - only active when `GMAIL_INGESTION_MODE=push`

## Documentation

- Setup: `docs/setup.md`
- Architecture: `docs/architecture.md`
- Operations Runbook: `docs/operations.md`
- Gmail Pub/Sub: `docs/gmail-pubsub.md`
- Executive Agent Channels: `docs/executive-agent.md`
- Folder And Routing System: `docs/folders.md`
- MasterPrompt System: `docs/masterprompt.md`
- Supermemory Integration: `docs/supermemory.md`
- AI Providers: `docs/ai-providers.md`
- Benchmarks: `docs/benchmarks.md`
- Security: `docs/security.md`
- Troubleshooting: `docs/troubleshooting.md`
- Docs index: `docs/README.md`
- API Reference: `docs/api-reference.md`

## Security

See `docs/security.md` and `SECURITY.md` for deployment hardening, credential handling, and vulnerability reporting guidance.

## Contributing

See `CONTRIBUTING.md`.
