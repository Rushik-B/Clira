# Gmail Pub/Sub Ingestion

Clira supports two Gmail ingestion modes:

- `pull` (default and recommended for launch): `gmail-pull-worker` consumes Pub/Sub
- `push` (advanced): Pub/Sub pushes to `POST /api/gmail-push/webhook`

Both modes reuse the same downstream processing path after delivery.

## Recommended Setup

Pull mode is the launch default because it avoids public webhook exposure during first boot.

```bash
npm run setup:google -- --project-id YOUR_PROJECT_ID --mode pull --write-env
```

By default the script:

- creates or reuses the main Pub/Sub topic
- grants Gmail publisher IAM
- creates or reuses the Clira service account
- writes the service-account key to `./.clira-runtime/google-service-account.json`
- creates or updates the pull subscription
- creates a DLQ topic and subscription
- writes the generated values back into `.env` when `--write-env` is set

If the key file already exists, the script reuses it unless you pass `--overwrite-key`.

## Push Mode

Push mode requires a public HTTPS domain:

```bash
npm run setup:google -- --project-id YOUR_PROJECT_ID --mode push --domain your-domain.com --write-env
```

Use push mode only after the base self-host path is already working.

## Required OAuth Callbacks

These URLs must exist in the Google OAuth client:

- `http://localhost:13000/api/auth/callback/google`
- `https://<your-domain>/api/auth/callback/google`

Also add the matching app origin as an authorized JavaScript origin.

## Runtime Configuration

```env
GMAIL_INGESTION_MODE=pull
GMAIL_PUBSUB_TOPIC=projects/<project-id>/topics/clira-email-updates
GMAIL_PUBSUB_PULL_SUBSCRIPTION=projects/<project-id>/subscriptions/clira-gmail-pull-sub
GOOGLE_APPLICATION_CREDENTIALS=./.clira-runtime/google-service-account.json
```

## Verification

Pull mode:

1. Start the self-host core profile or run `npm run start:gmail-pull-worker`.
2. Connect a mailbox.
3. Send a test email.
4. Verify the pull worker logs ack or retry activity.
5. Check `GET /api/health?deep=1` for a healthy pull-worker heartbeat.

Push mode:

1. Set `GMAIL_INGESTION_MODE=push`.
2. Ensure the public HTTPS endpoint reaches `/api/gmail-push/webhook`.
3. Send a test email and verify webhook processing.

## Failure Modes

- Missing `GMAIL_PUBSUB_TOPIC`: watch setup and renewals fail.
- Pull mode missing `GMAIL_PUBSUB_PULL_SUBSCRIPTION`: pull worker fails fast.
- Missing or unreadable `GOOGLE_APPLICATION_CREDENTIALS`: pull worker fails on startup.
- Stale pull-worker heartbeat: `/api/health?deep=1` returns unhealthy.
- Persistent Pub/Sub processing failures: message is retried and eventually dead-lettered.
