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

## Telegram Messages Not Reaching Clira

Checks:

- Worker process is running (`npm run start:worker`)
- `TELEGRAM_BOT_TOKEN` is set and valid
- `TELEGRAM_ENABLED` is not explicitly set to `false`
- Settings API (`GET /api/settings/telegram`) reports `telegramConfigured: true`

Actions:

- Restart worker and verify Telegram monitor startup log
- Send a fresh DM to bot and verify pairing instruction is returned for unknown sender
- Re-link using pairing code in Settings -> Text Clira if link is inactive

## Telegram Pairing Code Fails

Checks:

- Code is exactly 8 chars (no spaces)
- Code has not expired (TTL is 1 hour)
- Account is not already actively linked to another user

Actions:

- Request a new code by sending another DM to the bot
- Retry approval through `POST /api/settings/telegram`
- Unlink stale mappings with `DELETE /api/settings/telegram` and re-link

## Reminders/Alerts Delivered To Wrong Channel

Checks:

- `notificationDeliveryChannel` in user settings is correct (`WHATSAPP`, `TELEGRAM`, `BOTH`)
- At least one eligible channel link exists for the selected preference
- WhatsApp numbers are verified if WhatsApp is selected

Actions:

- Update preference via `PATCH /api/settings/messaging-channels`
- Use consolidated read endpoint `GET /api/settings/text-channels` to verify current state

## Database Errors On Boot

Checks:

- `DATABASE_URL` points to live Postgres
- `npm run migrate:deploy` succeeded
- No pending migration drift (`npm run migrate:status`)
