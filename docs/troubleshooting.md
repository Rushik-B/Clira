# Troubleshooting

## App Will Not Boot

Checks:

- `npm run selfhost:doctor`
- Docker daemon is running
- required ports are not already occupied
- `.env` exists
- `NEXTAUTH_SECRET`, `CRON_SECRET`, `EMAIL_ENCRYPT_SECRET`, and `EMAIL_ENCRYPT_SALT` are populated

Actions:

- Run `npm run selfhost:init`
- Re-run `npm run selfhost:doctor`
- If ports `13000`, `15432`, or `16379` are already in use, free them or change your local mapping strategy

## Login Fails

Checks:

- `APP_PUBLIC_URL` matches the browser URL users open
- `NEXTAUTH_URL` is correct for your current mode
- Google OAuth callback URLs are configured for both localhost and your public domain if applicable
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set

Actions:

- For Docker self-host, prefer `http://localhost:13000` locally
- Re-check the callback URL in Google Cloud after any public URL change

## Mailbox Connect Fails

Checks:

- `EMAIL_ENCRYPT_SECRET` and `EMAIL_ENCRYPT_SALT` are set
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are valid
- Google OAuth consent screen and scopes are configured

Actions:

- Re-run `npm run selfhost:init` if encryption secrets were missing
- Disconnect and reconnect the mailbox after fixing auth config

## Gmail Ingestion Is Not Working

Checks:

- `GMAIL_INGESTION_MODE=pull` unless you intentionally configured push
- `GMAIL_PUBSUB_TOPIC` is fully qualified
- `GMAIL_PUBSUB_PULL_SUBSCRIPTION` is fully qualified
- `GOOGLE_APPLICATION_CREDENTIALS` points at a readable file
- `gmail-pull-worker` is running
- `/api/health?deep=1` reports a healthy pull-worker heartbeat

Actions:

- Run `npm run setup:google -- --project-id <id> --mode pull --write-env`
- Check `.clira-runtime/google-service-account.json`
- Review `npm run selfhost:logs`

## Worker, Cron, or Backfill Problems

Checks:

- `worker` is running
- `cron` is running
- `backfill-worker` was only enabled if you intended to run it
- Redis is reachable

Actions:

- For the default launch path, use `npm run selfhost:up`
- For inbox-search backfill, use `npm run selfhost:up:full`
- If cron is running but jobs fail, confirm the app container is healthy and internal container networking is intact

## Health Endpoint Confusion

Checks:

- `/api/health` is liveness only
- `/api/health?deep=1` is strict readiness

Actions:

- Use `/api/health` to confirm the app process is serving traffic
- Use `/api/health?deep=1` to debug DB, env, model config, and Gmail pull-worker readiness

## AI Provider Errors

Checks:

- `AI_PROVIDER` matches the credentials you configured
- For Google, either `GOOGLE_GENERATIVE_AI_API_KEY` or `GOOGLE_API_KEY` is set
- For compatible endpoints, `AI_PROVIDER=openrouter`, `OPENROUTER_API_KEY`, and `OPENROUTER_BASE_URL` are set

Actions:

- Compare your `.env` with [docs/ai-providers.md](/Users/Rushik/Downloads/clira-os/Clira/docs/ai-providers.md)
- Re-run `npm run selfhost:doctor` after any provider change
