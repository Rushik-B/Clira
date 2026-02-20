THREAD INFORMATION:
Subject: {subject}
Thread ID: {threadId}
Message Count: {messageCount}
Thread Started: {threadStartAt}
Latest Activity: {threadLastAt}

TARGET SENT EMAIL (the user's reply to summarize):
Message ID: {targetMessageId}
Sent At: {targetSentAt}

FULL THREAD (chronological order, oldest to newest):
Messages marked [YOU] are from the user ({userEmail}).
Messages marked [THEY] are from others.

{formattedMessages}

---

Generate the 2-field JSON summary focusing on:
1. sent_email_summary: What did the user communicate/commit to/decide in their reply (the [YOU] message)? MAXIMUM 1400 characters.
2. received_thread_summary: What did others want, and what is the conversation context leading up to the user's reply? MAXIMUM 1700 characters.

REQUIRED: ALWAYS include date and time information in BOTH summaries. Use the consistent format: "YYYY-MM-DD HH:MM UTC" (e.g., "2024-01-15 14:30 UTC"). For sent_email_summary, include the date/time when the user sent their reply. For received_thread_summary, include relevant dates/times for key events, decisions, or messages mentioned in the thread context. This date/time information is MANDATORY and must be included in every summary.

CRITICAL: These character limits are HARD CONSTRAINTS that MUST NOT be exceeded. Count your characters carefully. If a summary is too long, condense it by removing redundancy, using concise language, and prioritizing the most critical information. Include concrete details, dates, names, and short quotes where critical, but always stay within the limits.

