# Executive Agent Channels

Clira can optionally expose conversational control through SMS, WhatsApp, and Telegram.

## Supported Channels

- Twilio webhook: `/api/twilio/webhook`
- Twilio chat endpoint: `/api/twilio/chat`
- WhatsApp webhook: `/api/whatsapp/webhook`
- WhatsApp chat endpoint: `/api/whatsapp/chat`
- Telegram worker monitor: long polling in `src/worker.ts` (no public webhook required for v1)
- Telegram settings API: `/api/settings/telegram`

Core Gmail pipeline remains functional even if channel credentials are not configured.

## Public Web Search

Optional var:

- `EXA_API_KEY`

Behavior:

- Enables the executive agent's `search_web` tool for public internet lookups.
- This is read-only access to public web search results and snippets, not an interactive browser session.
- If `EXA_API_KEY` is missing, the executive agent still runs normally, but `search_web` returns an explicit unavailable/degraded result.

## Twilio Configuration

Required vars:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`

Optional:

- `TWILIO_WHATSAPP_NUMBER`
- `TWILIO_MESSAGING_SERVICE_SID`

Security behavior:

- Verifies `X-Twilio-Signature`
- Uses immediate webhook acknowledgment + async processing

## WhatsApp Cloud API Configuration

Required vars:

- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_VERIFY_TOKEN`

Optional:

- `WHATSAPP_API_VERSION` (defaults in `.env.example`)

Security behavior:

- GET verification handshake (`hub.verify_token`)
- POST signature verification (`X-Hub-Signature-256`)
- Immediate acknowledgment + async processing

## Telegram Configuration

### Required

- `TELEGRAM_BOT_TOKEN`

### Optional

- `TELEGRAM_ENABLED` (defaults to enabled when token exists)
- `TELEGRAM_POLL_TIMEOUT_SECONDS`
- `TELEGRAM_POLL_RETRY_MAX_MS`

### Quick setup (beginner)

1. Create a bot in Telegram with `@BotFather` (`/newbot`).
2. Add token to runtime env (`TELEGRAM_BOT_TOKEN`).
3. Restart app + worker runtime.
4. User sends DM to bot and receives 8-character pairing code.
5. User approves pairing in **Settings -> Text Clira**.

### Token source behavior

- Clira reads Telegram token from runtime env (`TELEGRAM_BOT_TOKEN`).
- Settings UI is used for account linking/unlinking only.
- Without token in runtime env, Telegram monitor remains disabled.

### Security and lifecycle behavior

- DM-first linking with short-lived pairing codes
- Pairing approval through authenticated settings API (`/api/settings/telegram`)
- Worker-hosted poller with persisted update offset (`TelegramPollerState`)

### Pairing flow summary

1. User sends DM to bot.
2. Unknown sender receives an 8-char pairing code.
3. Authenticated user approves code in **Settings -> Text Clira**.
4. Link is activated in `TelegramLink`; future messages are routed to Executive Agent.

## Operational Notes

- Message processing lives under `src/lib/services/twilio` and `src/lib/services/whatsapp`
- Telegram processing lives under `src/lib/services/telegram`
- Reminder delivery status can be updated from outbound WhatsApp status callbacks
- Reminder and alert delivery channel preference is configurable (`WHATSAPP`, `TELEGRAM`, `BOTH`)
- Keep webhook URLs HTTPS in production
