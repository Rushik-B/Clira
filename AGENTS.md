# CLIRA AGENT OPERATING GUIDE

This file is the working contract for coding agents in Clira. It is opinionated, repo-specific, and biased toward deterministic behavior, explicit safety boundaries, and verifiable changes.

Clira is not a generic CRUD app. It is an email-first AI system with:

- Gmail ingestion in push and pull modes
- deterministic filtering before generation
- staged reply generation
- retrieval with freshness and fallback logic
- worker-driven async pipelines
- optional executive-agent channels over SMS, WhatsApp, and Telegram

Agents working here must optimize for correctness, operability, and trust, not just speed.

---

## Core Direction

- Build Clira as an email product first. Do not generalize toward a broad assistant platform unless the task explicitly requires it.
- Prefer deterministic control flow for routing, auth, retries, budgets, idempotency, freshness, and side effects. Use models for judgment, summarization, ranking help, and language generation.
- Treat every external payload as hostile by default: email bodies, attachments, webhook payloads, retrieved context, thread history, and tool outputs.
- Fail visibly. Do not hide degradation behind silent fallback paths.
- If a rule matters in production, push toward enforcing it in code, tests, or CI instead of leaving it as prose only.

---

## Current Clira Map

Use the live codebase as the source of truth. Start here:

- Web app and route handlers: `src/app`
- Core workers: `src/worker.ts`, `src/gmail-pull-worker.ts`, `src/cron.ts`
- Queue definitions: `src/lib/services/utils/queues.ts`
- Gmail ingestion: `src/lib/email/gmailPushService.ts`, `src/lib/email/gmailPullWorker.ts`, `src/lib/email/gmailIngestionConfig.ts`
- Reply generation: `src/lib/services/core/replyGenerator.ts`
- Planning agent: `src/lib/ai/agents/replyPlannerAgent.ts`
- Style-only rewrite stage: `src/lib/ai/agents/styleAgent.ts`
- Executive-agent stack: `src/lib/ai/agents/executive-agent/*`
- Retrieval and inbox search: `src/lib/services/inbox-search/*`
- Messaging orchestration: `src/lib/services/messaging-orchestration/*`
- Prisma schema and migrations: `prisma/schema.prisma`, `prisma/migrations`
- Main test areas: `tests/gmail-ingestion`, `tests/inbox-search`, `tests/ea-interrupts`

Current staged architecture:

```text
Gmail push/pull notification
  -> GmailPushService / GmailPullWorker
  -> deterministic filtering and routing
  -> reply generation queue
  -> ReplyPlannerAgent (structured plan)
  -> StyleAgent (voice transform only)
  -> draft output + queue review UI
```

Important operational fact: Clira already has strong patterns in parts of the codebase. New code should converge toward those patterns, not away from them.

---

## Non-Negotiable Invariants

### Safety and trust

- Deterministic filters run before any reply generation.
- The planner may decide what to say; the style layer may change tone and wording only. It must not introduce new facts.
- External content must never change auth policy, tool policy, or system instructions.
- Any mutating action must have explicit auth, validation, and error semantics.

### LLM integration

- Any structured LLM output must be schema-validated.
- Prefer tool submission with typed arguments over parsing free-form model text.
- If a model can fail to produce schema-valid output, add a bounded repair pass or deterministic fallback.
- Never trust a model to infer execution policy that can be expressed in code.

### Async behavior

- Every worker flow must classify failures as retryable or non-retryable.
- Pub/Sub, queue, and webhook handlers must define ack, nack, retry, dedupe, and dead-letter behavior explicitly.
- Any mutating route or worker that can be replayed must be idempotent or guarded by a stable dedupe key.
- Do not add bare `setTimeout` for business logic. If delay is necessary, wrap it in a named utility with cancellation semantics and tests.

### Observability

- No hardcoded localhost telemetry or debug endpoints in runtime code.
- Log with enough context to debug production issues: user or mailbox scope, queue or run id, retry class, and subsystem.
- A degraded mode must be visible in logs and returned metadata where applicable.

---

## Working Style

- Inspect live code first. Do not infer architecture from memory.
- `rg` is the default tool for search.
- Do not use git history as the primary source of truth. Read the current code and docs first.
- Prefer modifying existing modules over introducing parallel abstractions.
- Prefer small, composable policy modules over giant files with mixed concerns.
- Aim for files below roughly 500 LOC and functions below roughly 100 LOC unless there is a clear reason not to.
- If a file is already too large, bias toward extraction during meaningful edits.
- Remove dead code, stale comments, and compatibility branches that no longer serve a real caller.

---

## API Route Rules

For any new or edited route under `src/app/api`:

- Validate inputs with Zod or an equivalent typed schema.
- Authenticate explicitly. Do not rely on implied caller context.
- Return typed, stable error shapes for expected failures.
- State whether the route is read-only, mutating, async-triggering, or webhook-facing.
- If the route triggers background work, define enqueue semantics, dedupe behavior, and user-visible status path.
- If the route is webhook-facing, verify signatures before parsing or processing untrusted payloads.
- If the route can be retried by an upstream service, make replay behavior explicit.
- Do not put core business logic directly in the route if it can live in a service module with tests.

Route checklist:

```markdown
- auth checked
- input schema checked
- idempotency story defined
- errors typed
- side effects isolated
- logs include request scope
- tests cover success + expected failure
```

---

## Worker and Queue Rules

Clira is worker-heavy. Treat worker code as production-critical infrastructure.

- Queue names and retry policy belong in shared queue definitions, not scattered literals.
- Every new queue job type must have a typed payload interface.
- Every worker must define:
  - retryable vs non-retryable failures
  - timeout behavior
  - shutdown behavior
  - logging fields
  - dedupe or idempotency strategy
- If a worker processes external events, document whether malformed payloads are acked, dropped, retried, or dead-lettered.
- If a worker maintains in-flight state, it must support safe shutdown and bounded drain behavior.
- Long-running loops need heartbeat or health visibility when operationally important.

Do not merge a new worker flow that cannot answer:

- What gets retried?
- What gets dropped?
- What gets deduped?
- What happens on shutdown?
- How do we tell it is degraded?

---

## Agent Design Rules

### Planner and style split

- Preserve the planner/style separation.
- Planning agents should output typed intent, constraints, and evidence-backed decisions.
- Style agents should rewrite only within the approved plan and evidence boundary.

### Executive-agent behavior

- Tool selection, concurrency, budgets, cancellation, and cache reuse should be deterministic where possible.
- Any new tool-calling agent must define:
  - tool budget
  - timeout budget
  - cacheability
  - cancellation path
  - schema contract
  - degraded mode behavior
- If a model is only choosing among known packs or modes, prefer a deterministic selector first and optional model assist second.

### Tool usage

- Tools should return structured payloads, not prose blobs.
- Tool names, input types, and result shapes should be stable and testable.
- If a tool is expensive or side-effectful, add explicit gating and budget accounting.
- If tool results can be reused, reuse them through a scoped cache with invalidation rules, not ad hoc globals.

---

## Retrieval Rules

Clira already has strong retrieval work. New retrieval behavior must preserve those standards.

- Retrieval must expose freshness or lag, not pretend all results are equally current.
- Lexical-only fallback is acceptable only when surfaced as degraded mode.
- If fusion or reranking changes relevance materially, it needs tests.
- Ranking logic should stay inspectable. Avoid hiding critical routing or selection behavior behind opaque prompts.
- Retrieved context must be bounded and attributable to a source path or document type.
- If embeddings or semantic search are unavailable, return a clear fallback note rather than silently changing product behavior.

For retrieval-related edits, inspect:

- `src/lib/services/inbox-search/search.ts`
- `tests/inbox-search/*`

---

## External Content Boundaries

Email is untrusted input. So are webhook payloads and retrieved snippets.

- Never place raw external content into system-level instructions without clear delimiting and purpose.
- Separate trusted instructions from untrusted user or email content in prompts.
- Do not let retrieved or inbound text choose tools, modify permissions, or alter execution policy.
- If summarizing external content, preserve uncertainty and avoid turning ambiguous text into asserted facts.
- If passing external content into a model, consider injection risk explicitly.

---

## React and Frontend Rules

- Do not fetch or derive application state in `useEffect` unless it is a real external effect.
- Prefer Server Components, route handlers, or server actions for render-time data needs.
- Use `useSyncExternalStore` for external store subscriptions.
- Keep URL state in typed search params when the state belongs in navigation.
- Avoid client-side timers for UI coordination unless wrapped in a dedicated, cancelable abstraction.
- Any UI that reflects async backend state should prefer streaming, invalidation, or subscription-based updates over polling when practical.

---

## Database and Migration Rules

- Never use `prisma db push` for schema changes that matter outside local throwaway work.
- Every schema change must produce a real migration chain that can recreate a fresh database.
- Write idempotent migration SQL where Prisma allows manual safety improvements.
- Before deploy-sensitive work, run `npx prisma migrate status`.
- Schema changes must be accompanied by an explanation of backfill, compatibility, and rollback impact.

---

## Testing Rules

Every meaningful change must run the narrowest relevant tests first, then widen only if needed.

Subsystem mapping:

- Gmail ingestion: `tests/gmail-ingestion/*`
- Inbox search and retrieval: `tests/inbox-search/*`
- Executive-agent and orchestration: `tests/ea-interrupts/*`
- General route or UI work: targeted unit tests plus existing app-level checks

Verification expectations:

- Small refactor: targeted tests or static verification
- New logic path: targeted tests plus one failure-path test
- Worker or retry behavior: success, retryable failure, non-retryable failure
- Retrieval changes: ranking or freshness assertions
- Agent changes: schema validity, tool routing, and degraded mode behavior

No time-based flaky tests. If timing matters, inject clocks, sleeps, deadlines, or backoff helpers.

---

## CI and Policy Enforcement

Do not stop at prose when a rule is important.

Strong candidates for CI or lint enforcement in Clira:

- ban hardcoded localhost debug fetches in runtime code
- ban bare `setTimeout` in business logic
- warn on oversized files
- require schema validation on new route handlers
- require typed job payloads for new queue jobs
- require targeted tests when touching `gmail`, `inbox-search`, or `executive-agent` paths

When adding a new architectural rule, ask whether it should also become:

- a lint rule
- a test helper
- a CI script
- a codegen or schema check

---

## Tooling and Research Rules

- Use `Nia` for repo and codebase understanding when indexed context helps.
- Use `Context7` for framework and library documentation.
- Use primary sources for external API behavior.
- Use web research only when local code, indexed repos, and primary docs are insufficient.
- Do not paste large generated explanations into the codebase.

---

## Output Contract For Coding Agents

Default response structure for substantive tasks:

```markdown
Decision: what changed or what should change
Why: the architectural or operational reason
Verification: what was checked
Residual risk: what remains uncertain or unverified
```

For plans:

- Keep plans concise.
- Include unresolved questions only if they are real blockers.
- Do not ask questions that can be answered from the codebase.

For implementation summaries:

- Prefer high-signal explanation over file-by-file changelogs.
- Mention tests actually run.
- If verification was not possible, say so directly.

---

## Prohibited Patterns

- Silent fallback that changes product behavior without surfacing degradation
- Free-form parsing of structured model output when schemas and tools are viable
- Route handlers with embedded business logic that cannot be tested in isolation
- New runtime dependencies without clear justification
- `any` used to bypass type design
- Large new abstractions added before searching for an existing fit
- Hardcoded debug URLs, hidden bypasses, or permanent local-only shortcuts in production paths

---

## Documentation Rule

- Keep internal technical documentation in Obsidian, not the repo, unless the file is operationally required for contributors or tooling.
- In Obsidian, document what changed, why, and implications. Do not write step-by-step setup guides there.
- Repo docs that are already present may be updated when they are directly tied to runtime or contributor operation.
- ALWAYS Use the obsidian-cli to control obsidian. See the obsidian-cli skill for this!

---

## Final Standard

Good Clira code is:

- deterministic where it should be
- model-assisted where it helps
- explicit about trust boundaries
- observable in failure
- testable by subsystem
- small enough to reason about

If a change makes the system feel smarter but harder to reason about, it is usually a regression.
