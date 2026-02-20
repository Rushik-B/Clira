# Gmail Pub/Sub Setup

This guide configures Gmail push notifications that feed Clira's ingestion pipeline.

## Important Topic Name

Current code paths set up watches against topic:

- `projects/<GOOGLE_CLOUD_PROJECT_ID>/topics/clira-email-updates`

If you use the setup script, pass `--topic clira-email-updates` explicitly.

## Automated Setup (Recommended)

```bash
npm run setup:google -- \
  --project-id YOUR_PROJECT_ID \
  --domain your-domain.com \
  --topic clira-email-updates
```

This script:

- Enables required APIs
- Creates Pub/Sub topic + push subscription
- Grants Gmail publisher IAM role
- Creates a service account key

## Manual Setup

1. Enable APIs in GCP project:
- Gmail API
- Pub/Sub API
- IAM API

2. Create topic:
- `clira-email-updates`

3. Create push subscription:
- Endpoint: `https://YOUR_DOMAIN/api/gmail-push/webhook`

4. Grant Gmail publish permissions on the topic:
- Member: `gmail-api-push@system.gserviceaccount.com`
- Role: `roles/pubsub.publisher`

5. Create a service account key for app runtime access.

## Required Environment Variables

- `GOOGLE_CLOUD_PROJECT_ID`
- `GOOGLE_APPLICATION_CREDENTIALS`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

## Runtime Endpoints

- `POST /api/gmail-push/setup` - configure watch for authenticated mailbox
- `POST /api/gmail-push/webhook` - Pub/Sub delivery endpoint
- `GET /api/cron/renew-gmail-watches` - periodic renewal

## Validation

1. Connect Gmail account in app.
2. Trigger watch setup (`/api/gmail-push/setup` or mailbox connect flow).
3. Send a test email to connected inbox.
4. Verify logs show webhook receipt and queue state updates.

## Common Failure Modes

- 401/403 from Google APIs: token scopes or credential mismatch
- Pub/Sub webhook retries: endpoint not reachable or non-200 response
- No new emails processed: stale/invalid watch, renew via cron endpoint
- Missing mailbox context: mailbox is disconnected or credentials expired
