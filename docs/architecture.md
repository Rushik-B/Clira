# Architecture

Clira uses a staged, safety-oriented email workflow with explicit boundaries between filtering, planning, and stylistic rewriting.

## Core Flow

```text
Gmail push notification
  -> GmailPushService
  -> EmailFilterService (deterministic checks)
  -> routing + queue state
  -> ReplyGeneratorService
       Stage 1: ReplyPlannerAgent (tools + structured plan)
       Stage 2: StyleAgent (voice transform only)
  -> draft output + queue review UI
```

## Main Components

| Component | Role | Key files |
| --- | --- | --- |
| Web app | UI, API routes, auth | `src/app`, `src/components`, `src/lib/auth/auth.ts` |
| Worker | background jobs for onboarding, reply generation, mapping, reminders | `src/worker.ts` |
| Queue system | job definitions and retry policy | `src/lib/services/utils/queues.ts` |
| Gmail ingestion | push setup and history processing | `src/lib/email/gmailPushService.ts` |
| Reply generation | planning + style stages | `src/lib/services/core/replyGenerator.ts` |
| Filtering | hard and user-config filters | `src/lib/email/emailFilterService.ts` |
| Persistence | relational store | `prisma/schema.prisma` |

## Queue Topology

Defined queue names in runtime:

- `user-onboarding`
- `master-prompt-generation`
- `reply-generation`
- `email-jobs`
- `batch-sort`
- `model-retrain`
- `fast-onboarding-proposal`
- `folder-generation`
- `email-mapping`
- `email-learning`
- `email-categorization`
- `supermemory-bootstrap`
- reminder notifications queue (from reminder services)

## Data Model Highlights

- Multi-mailbox support via `Mailbox`
- Email/thread records encrypted-at-rest fields in `Email`/`Thread`
- OAuth and content encryption keys tracked in `EncryptionKey`
- Routing and adaptation via `Label`, `EmailMapping`, `EmailLearning`
- Operational observability via `BatchSortJob`, `ActionHistory`, reminders

## Security Boundaries

- Deterministic filters run before LLM generation
- Style stage cannot introduce new facts by design
- OAuth and email-content encryption supports KMS-backed key management
- Webhook signature verification for Twilio and WhatsApp
- Cron endpoints require bearer auth via `CRON_SECRET`

## Realtime UI Updates

Queue UI updates are streamed over SSE:

- Endpoint: `GET /api/queue/stream`
- User-scoped events emitted from `src/lib/events/queueEvents.ts`
- Heartbeat `ping` events keep long-lived connections active
