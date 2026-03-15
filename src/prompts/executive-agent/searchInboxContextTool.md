Search the user inbox and return a compact evidence pack with ranked matches, quotes, and coverage.

Use the structured contract:
- Required: `action` = `find` | `summarize_range` | `count` | `aggregate`
- Optional: `mode`, `mailboxId`, `mailboxEmail`, `queryText`, `filters`, `options`

Rules:
- Use `queryText` only for actual text search terms.
- Put sender, recipient, date range, relative window, attachment, thread, message, and mailbox scope into typed fields.
- `filters` is only for narrowing constraints. Do not put the main search phrase inside `filters`.
- Use `list_inbox_emails` instead when you need the complete bounded set of matching emails, not ranked evidence.
- Use `read_email_pdf_attachment` after this tool when the user needs the actual contents of a PDF attachment from an exact email.
- Results from this tool are evidence packs, not automatic proof. Snippets, semantic matches, and thread expansion can tell you what something probably refers to without fully confirming every detail.
- Use `find` for ranked email matches.
- Use `summarize_range` for summaries over a constrained slice of mail.
- Use `count` for deterministic totals.
- Use `aggregate` for grouped breakdowns. This requires `options.groupBy`.
- Use `deep` for analytical, quantitative, or aggregative questions, exact wording, attachments, or when quick results are weak.
- Use `quick` for simple lookup.
- If the matches are low-confidence, truncated, semantically matched, or the index is lagging, carry that uncertainty into the final answer naturally.
- If the user asks what a term means in a thread, it is valid to explain what it appears to refer to from the thread context.
- Do not claim an exact identity, address, location, or definition unless the result explicitly contains it.
- Do not imply that you are watching for future replies unless a real alert/reminder/watch action was created.

Examples:
- Good: `queryText="STAT 271 syllabus"` with `filters.hasAttachment=true`
- Bad: `filters.queryText="STAT 271 syllabus"`
- Check my inbox for Feb 19 -> `action="summarize_range"` with `filters.startDate` and `filters.endDate`
- Any emails from Alice with attachments last week? -> `action="find"` with `filters.sender`, `filters.hasAttachment`, and date filters
- How many recruiter emails last month? -> `action="count"` with `queryText="recruiter"` and `filters.relativeWindow="last_30_days"`
- Summarize GitHub notifications today -> `action="summarize_range"` with `queryText="github"` and `filters.relativeWindow="today"`

Invalid patterns:
- Do not use an `intent` field.
- Do not stuff structured constraints into `queryText`.
