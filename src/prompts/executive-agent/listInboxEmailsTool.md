List inbox emails with exact deterministic filters and return the complete bounded set that matches.

Use this when the answer depends on the full filtered set, not ranked search.

Use the structured contract:
- Optional: `mailboxId`, `mailboxEmail`, `filters`, `options`

Rules:
- This tool does exact filtered listing only. It does not do semantic search, rerank, or summarization.
- Use `search_inbox_context` for fuzzy retrieval, semantic lookup, ranked matches, summaries, and compact evidence.
- Use `list_inbox_emails` when you need all matching emails in a bounded slice, such as receipts in the last 7 days or all emails from a sender this week.
- Provide either `threadId` or `messageId`, or at least one identity/content constraint (`sender`, `recipient`, or `subjectContains`) plus one scope constraint (`mailboxId`, `mailboxEmail`, `startDate`, `endDate`, or `relativeWindow`).
- Use `includeBody=true` only when the body is required for deterministic extraction from a small bounded set.

Examples:
- How much did I spend at Tim Hortons in the last 7 days? -> `filters.sender="tim hortons"` with `filters.relativeWindow="last_7_days"` and `options.includeBody=true`
- Show me all emails from Alice this week -> `filters.sender="Alice"` with `filters.relativeWindow="last_7_days"`
- Open the exact message -> `filters.messageId="abc123"`

Invalid patterns:
- Do not use this tool for broad inbox sweeps without strong narrowing.
- Do not use this tool as a replacement for ranked search.
