# Self-Host Guide

This guide is for operators who want Clira running locally or on a VM with the least possible setup friction.

## Prerequisites

- Docker
- Docker Compose
- Google Cloud project with Gmail API and Pub/Sub enabled

`npm` is only needed if you want to use the package-script wrappers. The underlying scripts can also be run directly with `bash`.

## 1. Prepare the environment

```bash
cp .env.example .env
npm run selfhost:init
```

What `selfhost:init` does:

- creates `.env` if it is missing
- creates `.clira-runtime/`
- generates `NEXTAUTH_SECRET`
- generates `CRON_SECRET`
- generates `EMAIL_ENCRYPT_SECRET`
- generates `EMAIL_ENCRYPT_SALT`
- runs diagnostics

## 2. Configure Gmail Pub/Sub

Pull mode is the default and recommended launch path.

```bash
npm run setup:google -- --project-id YOUR_PROJECT_ID --mode pull --write-env
```

This provisions:

- Pub/Sub topic
- pull subscription
- dead-letter topic and subscription
- service account
- service-account key at `./.clira-runtime/google-service-account.json`

It also prints the OAuth callback URLs that must exist in Google Cloud:

- `http://localhost:13000/api/auth/callback/google`
- `https://<your-domain>/api/auth/callback/google`

## 3. Fill in the remaining required values

Edit `.env` and set:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- your AI provider key

Google is the default AI provider. If you use an OpenAI-compatible endpoint, keep `AI_PROVIDER=openrouter` and point `OPENROUTER_BASE_URL` at that compatible server.

## 4. Start Clira

Image version policy:

- `ghcr.io/rushik-b/clira:main` follows the latest successful `main` branch build
- `ghcr.io/rushik-b/clira:sha-<commit>` pins an exact branch build
- `ghcr.io/rushik-b/clira:vX.Y.Z` pins a release
- `latest` only moves on release tags

For anything stable, set `CLIRA_IMAGE` in `.env` to an exact release tag before you start the stack.

Default launch profile:

```bash
npm run selfhost:up
```

This starts:

- `app`
- `worker`
- `gmail-pull-worker`
- `cron`
- `db`
- `redis`

Optional full profile with inbox search backfill:

```bash
npm run selfhost:up:full
```

## 5. Verify

- App: `http://localhost:13000`
- Liveness: `http://localhost:13000/api/health`
- Deep readiness: `http://localhost:13000/api/health?deep=1`

Expected health behavior:

- `/api/health` returns `200` if the app is serving traffic
- `/api/health?deep=1` returns `500` until database, env, model config, and Gmail pull-worker heartbeat are all healthy

## Runtime Notes

- `.clira-runtime/` is local machine state. Do not treat it as repo content.
- `cron` is part of the required self-host topology. It triggers internal `/api/cron/*` routes and should stay enabled.
- `backfill-worker` is optional for first-run success. Without it, inbox search backfill is deferred.

## Useful Commands

```bash
npm run selfhost:doctor
npm run selfhost:logs
npm run selfhost:down
```
