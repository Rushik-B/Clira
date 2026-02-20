# Troubleshooting

Common setup and runtime issues with direct checks and fixes.

## App Starts But Login Fails

Checks:

- `NEXTAUTH_SECRET` is set and stable
- `NEXTAUTH_URL` matches actual app URL
- Google OAuth callback URL is correctly configured

## Gmail Push Not Processing New Mail

Checks:

- Pub/Sub topic exists and matches runtime topic name
- Webhook endpoint is reachable over HTTPS
- Mailbox status is `CONNECTED`
- Gmail watch renewal cron is running

Actions:

- Re-run `/api/gmail-push/setup`
- Trigger `/api/cron/renew-gmail-watches` with cron auth header

## Queue UI Not Updating

Checks:

- SSE endpoint `/api/queue/stream` is authorized
- App logs show event emission from queue event bus
- Network path allows long-lived SSE connections

## Worker Not Processing Jobs

Checks:

- `REDIS_URL` is reachable
- Worker process (`npm run start:worker`) is running
- Job enqueue logs appear in API routes

## Replies Not Generated

Checks:

- User onboarding state complete (`masterPromptGenerated`)
- Email passed filtering rules
- LLM key (`GOOGLE_GENERATIVE_AI_API_KEY`) is present

## Pub/Sub Webhook Retries Continuously

Checks:

- Endpoint returns fast 200 responses
- Reverse proxy/load balancer timeout is long enough
- JSON payload parsing errors are not being thrown before response

## Twilio Or WhatsApp Webhook Rejections

Checks:

- Signature secrets are correct
- Public webhook URL matches provider-side configuration exactly
- Proxy forwarded headers are correct for signature reconstruction

## Database Errors On Boot

Checks:

- `DATABASE_URL` points to live Postgres
- `npm run migrate:deploy` succeeded
- No pending migration drift (`npm run migrate:status`)
