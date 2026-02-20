# Operations Runbook

Operational baseline for running Clira in a stable app + worker topology.

## Service Topology

- `app`: Next.js server (`npm run start`)
- `worker`: BullMQ worker (`npm run start:worker`)
- `db`: Postgres
- `redis`: Redis

## Health Checks

- App health: `GET /api/health`
- Queue stream auth check: `GET /api/queue/stream` (requires session)

## Cron Endpoints

All cron endpoints require:

```text
Authorization: Bearer <CRON_SECRET>
```

Primary endpoints:

- `POST /api/cron/sort` - enqueue always-on sorting jobs
- `POST /api/cron/reminders` - enqueue due reminders and mark stale reminders
- `GET /api/cron/renew-gmail-watches` - renew Gmail watch subscriptions

## Suggested Cron Schedule

- Reminders: every minute
- Renew Gmail watches: daily (or more frequently if required)
- Always-on sorting: every 2 hours

## Queue and Worker Verification

Worker startup should log queue workers for onboarding, replies, sorting, mapping, and memory bootstrap.

Operational checks:

1. Ensure Redis connectivity from both app and worker
2. Confirm jobs are enqueued in API route logs
3. Confirm worker consumes and marks completion/failure with retries

## Logging Focus Areas

- Gmail push ingestion: `src/lib/email/gmailPushService.ts`
- Reply generation stages: `src/lib/services/core/replyGenerator.ts`
- Twilio/WhatsApp webhooks: `src/app/api/twilio/webhook/route.ts`, `src/app/api/whatsapp/webhook/route.ts`
- Cron failures: `src/app/api/cron/*`

## Deployment Checklist

- Strong secrets (`NEXTAUTH_SECRET`, `CRON_SECRET`)
- HTTPS for all webhook endpoints
- Persistent volumes for Postgres/Redis
- Separate process supervision for app and worker
- Automated backups for database
