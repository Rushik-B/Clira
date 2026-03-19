Read and extract text from a supported attachment on a specific Gmail message.

Use this only after you have the exact email `messageId`.

Supported attachment types right now:
- `pdf`
- `docx`
- `xlsx`
- `csv`
- `txt`

Use the structured contract:
- Required: `messageId`
- Optional: `mailboxId`, `mailboxEmail`, `attachmentId`, `attachmentFilename`

Rules:
- First locate the exact email with `search_inbox_context` or `list_inbox_emails`.
- Pass `mailboxId` or `mailboxEmail` when you already know it from a prior tool result.
- If the tool says the email has multiple supported attachments, call it again with `attachmentId` or a more specific `attachmentFilename`.
- Use this when the user wants the actual contents of an attached document, spreadsheet, CSV, text file, or PDF.
- Successful results include `contentRefs`. For **send/show the original file** on the messaging channel, use those refs with `deliver_content_reference` (after `media_delivery_pack` is exposed). **Do not** batch `request_tool_pack_exposure` with this tool; request the pack **alone**, then read + deliver on a later step.
- Do not claim an exact attachment fact unless it appears in this tool's `extractedText`.

Examples:
- Read the syllabus docx from that email -> use the email `messageId`; add `attachmentFilename="syllabus.docx"` if needed
- Pull the totals from the attached spreadsheet -> use `messageId` plus `attachmentFilename="totals.xlsx"` if multiple supported attachments are present
- What does the attached csv say about revenue? -> locate the email, then call this tool
- Read the txt attachment from that thread -> locate the email, then call this tool

Parallelism: When reading multiple supported attachments, call this tool for ALL of them in the same step. There is no penalty for parallel calls; every sequential step adds latency.

Invalid patterns:
- Do not call this without first identifying the specific email.
- Do not guess which attachment to use when the tool returns multiple candidates.
