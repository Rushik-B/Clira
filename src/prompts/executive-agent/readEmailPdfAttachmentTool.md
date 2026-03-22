Read and extract text from a PDF attachment on a specific Gmail message.

**Cost:** This runs **full-document PDF extraction** (slow and token-heavy on large files). Treat it as a **read-for-meaning** tool, not a file handoff.

**When to use:** Only when the user needs **what the PDF says**: quotes, facts, deadlines, amounts, or a summary grounded in the attachment text.

**When *not* to use:** If the user only wants the **original file** sent or shown on the messaging channel (e.g. "send me the PDF", "show the agreement here"), **do not** call this tool to satisfy that. Use the **media delivery** path instead: expose `media_delivery_pack` if needed, then `read_email_attachment_content` (to obtain `contentRefs`) and `deliver_content_reference`. Prefer `read_email_attachment_content` for that flow even for PDFs so you have one consistent attachment read tool.

**Batching:** Never call this in the **same step** as `request_tool_pack_exposure`. If you need delivery tools, call `request_tool_pack_exposure` **alone** first; run PDF read/delivery after the pack is exposed.

This is the PDF-specific compatibility tool. Prefer `read_email_attachment_content` when the user may be referring to non-PDF email attachments like `.docx`, `.xlsx`, `.csv`, or `.txt`, or when you need `contentRefs` for delivery.

Use this only after you have the exact email `messageId`.

Use the structured contract:
- Required: `messageId`
- Optional: `mailboxId`, `mailboxEmail`, `attachmentId`, `attachmentFilename`

Rules:
- First locate the exact email with `search_inbox_context` or `list_inbox_emails`.
- Pass `mailboxId` or `mailboxEmail` when you already know it from a prior tool result.
- If the tool says the email has multiple PDF attachments, call it again with `attachmentId` or a more specific `attachmentFilename`.
- Do not claim an exact attachment fact unless it appears in this tool's `extractedText`.

Examples:
- Read the syllabus PDF from that email -> use the email `messageId`; add `mailboxId` if available
- Pull the invoice from the receipt email -> use `messageId` plus `attachmentFilename="invoice.pdf"` if multiple PDFs are present
- What does the attached PDF say about the deadline? -> locate the email, then call this tool

Parallelism: When reading multiple PDFs (across different emails or multiple attachments), call this tool for ALL of them in the same step. There is no penalty for parallel calls; every sequential step adds latency. Do not parallel this tool with `request_tool_pack_exposure`.

Invalid patterns:
- Do not call this without first identifying the specific email.
- Do not guess which PDF to use when the tool returns multiple candidates.
- Do not use this for delivery-only asks when `read_email_attachment_content` + `deliver_content_reference` is the right shape (see tool description above).
