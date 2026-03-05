# Operations Runbook

Operational baseline for running Clira in a stable app + worker + cron topology.

## Service Topology

- `app`: Next.js server (`npm run start`)
- `worker`: BullMQ worker (`npm run start:worker`)
- `gmail-pull-worker`: Pub/Sub pull ingestion worker (`npm run start:gmail-pull-worker`)
- `cron`: Local scheduler (`npm run start:cron`) that triggers cron endpoints
- `db`: Postgres
- `redis`: Redis

Telegram v1 runtime model:

- Telegram polling is hosted in `worker` only.
- Do not run duplicate worker instances that share the same bot token unless ownership/coordination is handled.

## Health Checks

- App health: `GET /api/health`
- Queue stream auth check: `GET /api/queue/stream` (requires session)
- Health response includes `gmailIngestionMode` and pull-worker heartbeat status

## Cron Endpoints

All cron endpoints require:

```text
Authorization: Bearer <CRON_SECRET>
```

Primary endpoints:

- `POST /api/cron/sort` - enqueue always-on sorting jobs
- `POST /api/cron/reminders` - enqueue due reminders and mark stale reminders
- `GET /api/cron/renew-gmail-watches` - renew Gmail watch subscriptions
- `POST /api/gmail-push/webhook` - active only when mode=`push`

## Suggested Cron Schedule

- Reminders: every minute
- Renew Gmail watches: daily (or more frequently if required)
- Always-on sorting: every 2 hours

## Queue and Worker Verification

Worker startup should log queue workers for onboarding, replies, sorting, mapping, and memory bootstrap.
Gmail pull worker startup should log subscription name, flow-control settings, and heartbeat updates.

Operational checks:

1. Ensure Redis connectivity from both app and worker
2. Confirm jobs are enqueued in API route logs
3. Confirm worker consumes and marks completion/failure with retries

Telegram-specific checks:

1. Confirm `TELEGRAM_BOT_TOKEN` is present in worker runtime env
2. Confirm worker log includes Telegram monitor start
3. Confirm graceful shutdown logs Telegram monitor stop
4. Verify poll offset row exists/updates in `TelegramPollerState`

## Logging Focus Areas

- Gmail push ingestion: `src/lib/email/gmailPushService.ts`
- Gmail pull ingestion worker: `src/gmail-pull-worker.ts`, `src/lib/email/gmailPullWorker.ts`
- Reply generation stages: `src/lib/services/core/replyGenerator.ts`
- Twilio/WhatsApp webhooks: `src/app/api/twilio/webhook/route.ts`, `src/app/api/whatsapp/webhook/route.ts`
- Telegram poller + processor: `src/lib/services/telegram/telegramClient.ts`, `src/lib/services/telegram/messageProcessor.ts`
- Cron failures: `src/app/api/cron/*`

## Deployment Checklist

- Strong secrets (`NEXTAUTH_SECRET`, `CRON_SECRET`)
- HTTPS for all webhook endpoints
- Persistent volumes for Postgres/Redis
- Separate process supervision for app and worker
- Automated backups for database
