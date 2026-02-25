import { describe, expect, test } from 'vitest';
import { normalizeMarkdownForTelegram } from '@/lib/services/telegram/messageFormatting';

describe('normalizeMarkdownForTelegram', () => {
  test('converts markdown-style bullets and bold to Telegram HTML', () => {
    const input = [
      'Here\'s the breakdown for **Feb 27-28**:',
      '',
      '**Conflicts:**',
      '*   **Friday (Feb 27):** US Visa Appointment',
      '*   **Saturday (Feb 28):** No conflicts',
    ].join('\n');

    const normalized = normalizeMarkdownForTelegram(input);

    expect(normalized).toContain("Here's the breakdown for <b>Feb 27-28</b>:");
    expect(normalized).toContain('<b>Conflicts:</b>');
    expect(normalized).toContain('\u2022 <b>Friday (Feb 27):</b> US Visa Appointment');
    expect(normalized).toContain('\u2022 <b>Saturday (Feb 28):</b> No conflicts');
  });

  test('escapes raw HTML and converts links', () => {
    const input = 'Use <script> and [docs](https://example.com?a=1&b=2).';
    const normalized = normalizeMarkdownForTelegram(input);

    expect(normalized).toContain('&lt;script&gt;');
    expect(normalized).toContain('<a href="https://example.com?a=1&amp;b=2">docs</a>');
  });
});
