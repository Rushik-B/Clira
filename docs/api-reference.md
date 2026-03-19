# API Reference

This document lists all application API routes under `src/app/api` and their exported HTTP methods.

## Conventions

- Base prefix: `/api`
- Dynamic path segments use Next.js notation: `[id]`, `[labelId]`, `[...nextauth]`
- Session-protected routes generally rely on `getServerSession(authOptions)`
- Cron routes use `Authorization: Bearer <CRON_SECRET>`
- Provider webhooks validate signatures (`Twilio`, `WhatsApp`) before processing

## High-Impact Endpoints

- Health: `GET /api/health` (reports active language-model providers and missing provider config)
- Queue stream (SSE): `GET /api/queue/stream`
- Gmail push webhook: `POST /api/gmail-push/webhook` (only when `GMAIL_INGESTION_MODE=push`)
- Gmail watch setup: `POST /api/gmail-push/setup`
- Always-on sorting trigger: `POST /api/cron/sort`
- Reminder cron trigger: `POST /api/cron/reminders`
- Renew Gmail watches: `GET /api/cron/renew-gmail-watches`

## Full Endpoint Matrix

| Endpoint | Methods | Domain |
| --- | --- | --- |
| /api/action-history | GET | Email Ops |
| /api/auth/[...nextauth] | framework-managed | Auth |
| /api/auth/calendar-write | GET | Auth |
| /api/auth/check-scopes | GET | Auth |
| /api/auto-fetch-emails | POST | Ops & Cron |
| /api/batch-jobs/status | GET | Ops & Cron |
| /api/cron/reminders | POST,GET | Ops & Cron |
| /api/cron/renew-gmail-watches | GET | Ops & Cron |
| /api/cron/sort | POST,GET | Ops & Cron |
| /api/debug-filter | POST,GET | Dev & Test |
| /api/dev/emit-queue-event | POST | Dev & Test |
| /api/dev/supermemory-bootstrap | POST,GET | Dev & Test |
| /api/dev/supermemory-test | POST,GET | Dev & Test |
| /api/email-mapping/bulk | POST,PUT | Email Ops |
| /api/email-mapping | GET,POST,PUT,DELETE | Email Ops |
| /api/email-review/correct | POST | Email Ops |
| /api/email-review | GET | Email Ops |
| /api/email-stats | GET | Email Ops |
| /api/feedback-analytics | GET | Email Ops |
| /api/folders/[id]/learnings | GET,DELETE | Folders |
| /api/folders/[id] | GET,PUT,DELETE | Folders |
| /api/folders/[id]/rules | GET,POST,DELETE,PUT | Folders |
| /api/folders/[id]/test-prompt | POST | Folders |
| /api/folders/chat | POST | Folders |
| /api/folders/chat/status | GET | Folders |
| /api/folders/conversations/[labelId] | GET,DELETE | Folders |
| /api/folders/corrections | POST | Folders |
| /api/folders/generate | POST,GET | Folders |
| /api/folders/reorganize | POST | Folders |
| /api/folders | GET,POST | Folders |
| /api/folders/rules/bulk | GET | Folders |
| /api/folders/sort-now | POST,GET | Folders |
| /api/folders/stats | GET | Folders |
| /api/generate-reply | POST,GET | Queue & Reply |
| /api/gmail-push/setup | POST | Channels & Webhooks |
| /api/gmail-push/webhook | POST | Channels & Webhooks |
| /api/health | GET | Ops & Cron |
| /api/jobs/status | GET | Ops & Cron |
| /api/labels | GET,POST,PUT,DELETE | Labels |
| /api/mailbox/[id] | PATCH,DELETE | Mailbox |
| /api/mailbox/connect | POST,GET | Mailbox |
| /api/mailbox/connect/start | GET | Mailbox |
| /api/mailbox | GET | Mailbox |
| /api/master-prompt/activate | POST | Queue & Reply |
| /api/master-prompt/auto-generate | POST | Queue & Reply |
| /api/master-prompt/ensure | POST | Queue & Reply |
| /api/master-prompt/generate | POST,GET | Queue & Reply |
| /api/master-prompt/history | GET | Queue & Reply |
| /api/master-prompt | GET,POST,PUT | Queue & Reply |
| /api/onboarding/complete | POST | Onboarding |
| /api/onboarding/email-categorization | POST,GET | Onboarding |
| /api/onboarding/email-categorization/update | POST,DELETE | Onboarding |
| /api/onboarding/email-mapping/suggest | POST | Onboarding |
| /api/onboarding/examples | GET,POST | Onboarding |
| /api/onboarding/folders/accept | POST | Onboarding |
| /api/onboarding/folders/finalize | POST | Onboarding |
| /api/onboarding/folders/generate-fast | POST,GET | Onboarding |
| /api/onboarding/folders/refine | POST,GET | Onboarding |
| /api/onboarding/folders | GET,POST | Onboarding |
| /api/onboarding/inbox-review/batch-correction | POST | Onboarding |
| /api/onboarding/inbox-review/batch-suggestion | POST | Onboarding |
| /api/onboarding/inbox-review/correct-email | POST | Onboarding |
| /api/onboarding/inbox-review/learn-rule | POST | Onboarding |
| /api/onboarding/inbox-review/preview | GET | Onboarding |
| /api/onboarding/learning/process-feedback | POST | Onboarding |
| /api/onboarding/llm-folders/generate | POST | Onboarding |
| /api/onboarding/progress | POST,GET,DELETE | Onboarding |
| /api/prompt/refine | POST | Queue & Reply |
| /api/queue/[labelId] | GET | Queue & Reply |
| /api/queue/generate-draft | POST | Queue & Reply |
| /api/queue/generated-reply | GET | Queue & Reply |
| /api/queue | GET,POST | Queue & Reply |
| /api/queue/stream | GET | Queue & Reply |
| /api/settings/calendar | GET,POST | Settings |
| /api/settings/email-filters | GET,POST | Settings |
| /api/settings/messaging-channels | GET,PATCH | Settings |
| /api/settings/telegram | GET,POST,DELETE | Settings |
| /api/settings/telegram/health | GET | Settings |
| /api/settings/text-channels | GET | Settings |
| /api/settings/twilio | GET,POST | Settings |
| /api/settings/whatsapp | GET,POST | Settings |
| /api/test-email | POST,GET | Dev & Test |
| /api/test-fixes | GET | Dev & Test |
| /api/test-gmail-flow | POST | Dev & Test |
| /api/test-reply-generation | POST | Dev & Test |
| /api/test-scope-upgrade | GET | Dev & Test |
| /api/test-simulate-email | POST,GET | Dev & Test |
| /api/twilio/chat | POST,GET,DELETE | Channels & Webhooks |
| /api/twilio/webhook | GET,POST | Channels & Webhooks |
| /api/user/account | DELETE | User |
| /api/user/onboarding-status | GET | User |
| /api/user/settings/auto-sorting | GET,PATCH | User |
| /api/user/settings/autonomy | GET,PATCH | User |
| /api/user/settings/notifications | GET,PATCH | User |
| /api/user/whatsapp-promo-status | GET,POST | User |
| /api/whatsapp/chat | POST,GET,DELETE | Channels & Webhooks |
| /api/whatsapp/send-draft | POST,GET | Channels & Webhooks |
| /api/whatsapp/webhook | GET,POST | Channels & Webhooks |

## Auth Expectations By Domain

- `Auth`, `User`, `Mailbox`, `Onboarding`, `Folders`, `Email Ops`, `Queue & Reply`, and `Settings` are primarily authenticated user routes.
- `Channels & Webhooks` contains provider callback endpoints and chat endpoints; webhooks are signature-validated.
- `Ops & Cron` contains operational and scheduled endpoints; cron routes require bearer auth.
- `Dev & Test` endpoints are for development, diagnostics, and manual verification flows.

## Source of Truth

- Routes are filesystem-based under `src/app/api/**/route.ts`
- Method support is determined by exported handlers in each route file
