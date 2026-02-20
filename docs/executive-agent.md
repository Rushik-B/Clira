# Executive Agent Channels

Clira can optionally expose conversational control through SMS and WhatsApp.

## Supported Channels

- Twilio webhook: `/api/twilio/webhook`
- Twilio chat endpoint: `/api/twilio/chat`
- WhatsApp webhook: `/api/whatsapp/webhook`
- WhatsApp chat endpoint: `/api/whatsapp/chat`

Core Gmail pipeline remains functional even if channel credentials are not configured.

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

## Operational Notes

- Message processing lives under `src/lib/services/twilio` and `src/lib/services/whatsapp`
- Reminder delivery status can be updated from outbound WhatsApp status callbacks
- Keep webhook URLs HTTPS in production
