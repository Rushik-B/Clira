# AGENTS.md

## Cursor Cloud specific instructions

### Overview

Clira is a self-hosted AI email assistant with two main processes: a **Next.js web app** (`npm run dev`) and a **BullMQ background worker** (`npm run start:worker`). Both require **PostgreSQL** and **Redis**, provided via Docker Compose.

### Starting infrastructure

```bash
docker compose up -d db redis
```

PostgreSQL listens on port **15432**, Redis on **16379**. The DB healthcheck takes a few seconds before it accepts connections.

### Running the app

After infrastructure is up and migrations are current:

```bash
npm run dev          # Next.js dev server on port 3000
npm run start:worker # BullMQ worker (separate terminal/background)
```

### Key commands

See `README.md` "Core Commands" table for the full list. Quick reference:

| Task | Command |
|------|---------|
| Lint | `npm run lint` |
| Test | `npx jest` |
| Migrate | `npm run migrate:deploy` |
| Migration status | `npm run migrate:status` |
| Build (prod) | `npm run build` |

### Gotchas

- **Jest is not in devDependencies.** Use `npx jest` instead of `npm test` to run tests, or the global `jest` command if installed.
- **Auth requires Google OAuth credentials.** The app redirects unauthenticated users to `/signin` (HTTP 307). Without `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, login will not work, but the app still starts and serves pages.
- **Docker must be running** before `npm run migrate:deploy` or starting the app, since the default `DATABASE_URL` points to `localhost:15432` (the Docker-mapped Postgres port).
- **`.env` must exist.** Copy from `.env.example` and fill in at minimum `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `DATABASE_URL`, and `REDIS_URL`. The app starts without external API keys but Gmail/AI features will be non-functional.
- **Prisma postinstall** runs `prisma generate` automatically on `npm install`. If you see Prisma client errors after a schema change, run `npx prisma generate` manually.
