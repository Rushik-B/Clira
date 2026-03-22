Deliver a previously returned content reference to the user on Telegram as the original file.

Use this only when the user explicitly asks to send, share, forward, or show them the **original file** on this messaging channel (Telegram).

**Workflow (order matters):**
1. If `deliver_content_reference` is **not** in your tool list yet, call **`request_tool_pack_exposure` with `media_delivery_pack` only**, in a step by itself. Do not parallel it with PDF/attachment reads.
2. Locate the email if needed (`search_inbox_context` / `list_inbox_emails`).
3. Call **`read_email_attachment_content`** (preferred) or `read_email_pdf_attachment` to get `contentRefs`, then call **`deliver_content_reference`** with the copied reference. You may call the read + deliver tools **in the same step** once delivery is allowed.

Use the structured contract:
- Required: `reference`
- Optional: `targetChannel`, `caption`

Rules:
- Copy the entire `reference` object from an earlier tool result `contentRefs` array.
- Do not invent or modify any reference fields.
- Use `targetChannel="telegram"` when the user asks for Telegram delivery.
- This sends the original file bytes, not an extracted summary.
- If the user wants **wording or facts from inside** the file but not the file itself, answer from the read tool's `extractedText`; you may skip delivery.

Examples:
- Send me that PDF here -> expose `media_delivery_pack` alone if needed, then `read_email_attachment_content` + `deliver_content_reference` with `targetChannel="telegram"`
- Forward the image file to Telegram -> use the exact `reference` from the earlier tool result, `targetChannel="telegram"`

Invalid patterns:
- Do not call this without a real reference object from a prior tool result.
- Do not use this when the user has not asked for delivery of the original file.
