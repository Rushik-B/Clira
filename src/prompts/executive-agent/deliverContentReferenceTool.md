Deliver a previously returned content reference to the user on Telegram as the original file.

Use this only when the user explicitly asks to send, share, forward, or show them the original file on Telegram.

Use the structured contract:
- Required: `reference`
- Optional: `targetChannel`, `caption`

Rules:
- Copy the entire `reference` object from an earlier tool result `contentRefs` array.
- Do not invent or modify any reference fields.
- Use `targetChannel="telegram"` when the user asks for Telegram delivery.
- This sends the original file bytes, not an extracted summary.
- If the user only wants the file contents or summary, use the read tool instead of this delivery tool.

Examples:
- Send me that PDF on Telegram -> use the exact `reference` from `read_email_attachment_content` or `read_email_pdf_attachment`, `targetChannel="telegram"`
- Forward the image file to Telegram -> use the exact `reference` from the earlier tool result, `targetChannel="telegram"`

Invalid patterns:
- Do not call this without a real reference object from a prior tool result.
- Do not use this when the user has not asked for delivery of the original file.
