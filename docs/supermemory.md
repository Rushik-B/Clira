# Supermemory Integration

Supermemory is an optional long-term memory layer used to enrich contextual reply planning.

## Enablement

Required:

- `SUPERMEMORY_API_KEY`

Optional:

- `SUPERMEMORY_BASE_URL`
- `SUPERMEMORY_TIMEOUT_MS`

If not configured, reply generation continues without memory context.

## Bootstrap Flow

Supermemory bootstrap jobs are enqueued after onboarding completion and processed by worker flows.

Relevant files:

- `src/lib/services/supermemory/`
- `src/worker.ts`
- `/api/onboarding/complete`

## Operational Notes

- Bootstrap queue is deduplicated per user
- Delayed enqueue is used to avoid immediate onboarding contention
- Worker heartbeat for Supermemory is recorded in runtime

## Testing

- Dev test route: `/api/dev/supermemory-test`
- Dev bootstrap route: `/api/dev/supermemory-bootstrap`
