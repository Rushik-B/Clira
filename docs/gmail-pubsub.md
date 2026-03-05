# Gmail Pub/Sub Ingestion

Clira supports two Gmail ingestion modes:

- `pull` (default): dedicated `gmail-pull-worker` consumes Pub/Sub subscription.
- `push` (optional): Pub/Sub pushes to `POST /api/gmail-push/webhook`.

Both modes reuse `GmailPushService.processPushNotification` for downstream processing.

## Required Topic Source Of Truth

All Gmail watch setup and renewal flows use:

- `GMAIL_PUBSUB_TOPIC`

Example:

```env
GMAIL_PUBSUB_TOPIC=projects/<project-id>/topics/clira-email-updates
```

## Automated Setup (Recommended)

Pull mode (default):

```bash
npm run setup:google -- \
  --project-id YOUR_PROJECT_ID \
  --mode pull
```

Push mode:

```bash
npm run setup:google -- \
  --project-id YOUR_PROJECT_ID \
  --mode push \
  --domain your-domain.com
```

What the script configures:

- Pub/Sub topic
- Gmail publisher IAM binding
- Service account + key
- Subscription retry policy (`min 10s`, `max 600s`)
- Pull mode only: DLQ topic/subscription + dead-letter policy

## Runtime Configuration

```env
GMAIL_INGESTION_MODE=pull
GMAIL_PUBSUB_TOPIC=projects/<project-id>/topics/clira-email-updates
GMAIL_PUBSUB_PULL_SUBSCRIPTION=projects/<project-id>/subscriptions/clira-gmail-pull-sub
GMAIL_PUBSUB_PULL_MAX_MESSAGES=25
GMAIL_PUBSUB_PULL_MAX_BYTES=10485760
GMAIL_PUBSUB_PULL_SHUTDOWN_TIMEOUT_MS=15000
```

Push mode notes:

- Set `GMAIL_INGESTION_MODE=push`
- `POST /api/gmail-push/webhook` is enabled only in push mode
- In pull mode, webhook returns `404`

## Runtime Endpoints

- `POST /api/gmail-push/setup` - configure watch for authenticated mailbox
- `GET /api/cron/renew-gmail-watches` - renew watches for all connected mailboxes
- `POST /api/gmail-push/webhook` - push-mode delivery endpoint only

## Validation

Pull mode:

1. Start `npm run start:gmail-pull-worker`.
2. Connect mailbox or call `/api/gmail-push/setup`.
3. Send a test email to connected inbox.
4. Verify pull worker logs message ack/nack and downstream processing.

Push mode:

1. Set `GMAIL_INGESTION_MODE=push`.
2. Ensure public HTTPS domain reaches `/api/gmail-push/webhook`.
3. Send a test email and verify webhook logs + processing.

## Common Failure Modes

- Missing `GMAIL_PUBSUB_TOPIC`: watch setup/renew fails fast.
- Pull mode missing `GMAIL_PUBSUB_PULL_SUBSCRIPTION`: worker fails fast.
- Malformed Pub/Sub payload: acknowledged and logged as non-retryable.
- Retryable processing failure: message nacked; Pub/Sub retry policy applies.
- Persistent failures: message dead-lettered when DLQ policy threshold is reached.
