Read and extract text from a PDF attachment on a specific Gmail message.

Use this only after you have the exact email `messageId`.

Use the structured contract:
- Required: `messageId`
- Optional: `mailboxId`, `mailboxEmail`, `attachmentId`, `attachmentFilename`

Rules:
- First locate the exact email with `search_inbox_context` or `list_inbox_emails`.
- Pass `mailboxId` or `mailboxEmail` when you already know it from a prior tool result.
- If the tool says the email has multiple PDF attachments, call it again with `attachmentId` or a more specific `attachmentFilename`.
- Use this when the user wants the actual PDF contents, exact wording from the PDF, or facts that are only inside the attachment.
- Do not claim an exact attachment fact unless it appears in this tool's `extractedText`.

Examples:
- Read the syllabus PDF from that email -> use the email `messageId`; add `mailboxId` if available
- Pull the invoice from the receipt email -> use `messageId` plus `attachmentFilename="invoice.pdf"` if multiple PDFs are present
- What does the attached PDF say about the deadline? -> locate the email, then call this tool

Parallelism: When reading multiple PDFs (across different emails or multiple attachments), call this tool for ALL of them in the same step. There is no penalty for parallel calls; every sequential step adds latency.

Invalid patterns:
- Do not call this without first identifying the specific email.
- Do not guess which PDF to use when the tool returns multiple candidates.
