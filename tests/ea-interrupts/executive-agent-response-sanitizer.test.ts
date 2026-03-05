import { describe, expect, test } from 'vitest';
import { stripInternalMetadataFromAssistantResponse } from '@/lib/ai/agents/executive-agent/helpers';

describe('Executive agent response sanitizer', () => {
  test('removes trailing tool history metadata from assistant response', () => {
    const input = `Your STAT 271 Midterm 2 is next Wednesday, March 11th, from 5:30 PM to 7:30 PM at the RCB Images Theatre.

Midterm 1 already passed, but just a heads-up: the deadline to appeal your grade for it is this Friday, March 6th.

[Tool history] send_progress_update, search_inbox_context, append_to_supermemory, search_calendar`;

    const result = stripInternalMetadataFromAssistantResponse(input);

    expect(result.stripped).toBe(true);
    expect(result.response).not.toContain('[Tool history]');
    expect(result.response).toContain('Your STAT 271 Midterm 2');
    expect(result.response).toContain('deadline to appeal your grade');
  });

  test('removes leaked timestamp wrapper and preserves message payload', () => {
    const input = `[Timestamp] 2026-03-05T04:02:11.758Z
No worries. Standing by if you need anything else!`;

    const result = stripInternalMetadataFromAssistantResponse(input);

    expect(result.stripped).toBe(true);
    expect(result.response).toBe('No worries. Standing by if you need anything else!');
  });

  test('keeps normal assistant responses unchanged', () => {
    const input = 'Done. Meeting moved to 3:00 PM tomorrow.';

    const result = stripInternalMetadataFromAssistantResponse(input);

    expect(result.stripped).toBe(false);
    expect(result.response).toBe(input);
  });
});
