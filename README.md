# Clira

Clira is a self-hosted AI email assistant built around draft-first workflows, deterministic filtering, and separate worker processes for ingestion and reply generation.

## Fast Self-Host

This is the default launch path. It assumes Docker and Docker Compose are installed.

1. Clone the repo and copy the environment template.

```bash
cp .env.example .env
```

2. Initialize local runtime state and generated secrets.

```bash
npm run selfhost:init
```

If you do not want to use `npm`, run `bash scripts/selfhost-init.sh` directly.

3. Configure Gmail Pub/Sub and write the generated values back into `.env`.

```bash
npm run setup:google -- --project-id YOUR_PROJECT_ID --mode pull --write-env
```

4. Fill in the remaining required values in `.env`.

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- your AI provider key

5. Pull and start the launch default stack.

```bash
npm run selfhost:up
```

6. Open Clira.

- App: [http://localhost:13000](http://localhost:13000)
- Liveness: [http://localhost:13000/api/health](http://localhost:13000/api/health)
- Deep readiness: [http://localhost:13000/api/health?deep=1](http://localhost:13000/api/health?deep=1)

## Image Versions

Clira now publishes two kinds of image tags:

- `main` and `sha-<commit>` for continuous builds from the `main` branch
- `vX.Y.Z`, `vX.Y`, and `latest` for release tags such as `v0.1.0`

For evaluation and internal testing, the default `CLIRA_IMAGE=ghcr.io/rushik-b/clira:main` is fine.
For production or any install you want to keep stable, pin `CLIRA_IMAGE` to an exact release tag in `.env`.

## What Starts By Default

`npm run selfhost:up` starts the `core` profile:

- `app`
- `worker`
- `gmail-pull-worker`
- `cron`
- `db`
- `redis`

`backfill-worker` is intentionally not part of the default launch profile. Add it only when you want inbox search backfill:

```bash
npm run selfhost:up:full
```

## Required Environment Values

Minimum first-run values live at the top of [`.env.example`](/Users/Rushik/Downloads/clira-os/Clira/.env.example). The important ones are:

- `APP_PUBLIC_URL`
- `NEXTAUTH_SECRET`
- `CRON_SECRET`
- `EMAIL_ENCRYPT_SECRET`
- `EMAIL_ENCRYPT_SALT`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GMAIL_PUBSUB_TOPIC`
- `GMAIL_PUBSUB_PULL_SUBSCRIPTION`
- `GOOGLE_APPLICATION_CREDENTIALS`
- `AI_PROVIDER`
- provider auth for the selected model backend

Clira stores local runtime secrets under `.clira-runtime/`. The default Gmail service-account file path is `./.clira-runtime/google-service-account.json`.

## Self-Host Commands

| Command | What it does |
| --- | --- |
| `npm run selfhost:init` | Creates `.env` if missing, generates secrets, creates `.clira-runtime`, and runs diagnostics |
| `npm run selfhost:doctor` | Read-only diagnostics for env, Docker, ports, Gmail credentials, and AI provider config |
| `npm run selfhost:up` | Pulls and starts the default `core` self-host profile |
| `npm run selfhost:up:full` | Pulls and starts `core` plus `backfill-worker` |
| `npm run selfhost:down` | Stops the self-host stack |
| `npm run selfhost:logs` | Tails the main self-host services |
| `npm run setup:google` | Provisions Gmail Pub/Sub resources and optional `.env` updates |

## Contributor Workflow

If you are developing Clira rather than just hosting it, use [docs/setup.md](/Users/Rushik/Downloads/clira-os/Clira/docs/setup.md). That doc covers:

- local `npm run dev`
- worker processes in separate terminals
- local builds with `docker-compose.dev.yml`
- contributor-oriented verification

## AI Provider Notes

Google remains the default provider. The OpenRouter env names are still used for compatibility, but `OPENROUTER_BASE_URL` can point at any OpenAI-compatible endpoint. That includes OpenRouter, LM Studio, vLLM, and similar gateways. Details live in [docs/ai-providers.md](/Users/Rushik/Downloads/clira-os/Clira/docs/ai-providers.md).

## Documentation

- Self-host guide: [docs/self-host.md](/Users/Rushik/Downloads/clira-os/Clira/docs/self-host.md)
- Contributor setup: [docs/setup.md](/Users/Rushik/Downloads/clira-os/Clira/docs/setup.md)
- Gmail Pub/Sub: [docs/gmail-pubsub.md](/Users/Rushik/Downloads/clira-os/Clira/docs/gmail-pubsub.md)
- AI providers: [docs/ai-providers.md](/Users/Rushik/Downloads/clira-os/Clira/docs/ai-providers.md)
- Troubleshooting: [docs/troubleshooting.md](/Users/Rushik/Downloads/clira-os/Clira/docs/troubleshooting.md)
- Operations: [docs/operations.md](/Users/Rushik/Downloads/clira-os/Clira/docs/operations.md)
- Full docs index: [docs/README.md](/Users/Rushik/Downloads/clira-os/Clira/docs/README.md)
