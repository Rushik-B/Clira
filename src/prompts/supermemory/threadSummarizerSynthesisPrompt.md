THREAD INFORMATION:
Subject: {subject}
Thread ID: {threadId}
Total Messages: {messageCount}
Thread Started: {threadStartAt}
Latest Activity: {threadLastAt}

CHUNK SUMMARIES (condensed view of the full thread):
{chunkSummaries}

TARGET SENT EMAIL (the user's final reply - full text):
{targetSentFormatted}

---

Based on the chunk summaries and the full target sent email, generate the final 2-field JSON summary:
1. sent_email_summary: What did the user communicate/commit to/decide in their reply? MAXIMUM 1400 characters.
2. received_thread_summary: What did others want, and what is the conversation context? MAXIMUM 1700 characters.

CRITICAL: These character limits are HARD CONSTRAINTS that MUST NOT be exceeded. Count your characters carefully. If a summary is too long, condense it by removing redundancy, using concise language, and prioritizing the most critical information.

Use the chunk summaries for context but focus on the target sent email for the sent_email_summary.

