import { describe, expect, test } from 'vitest';
import { prepareInboxBodyText } from '@/lib/services/inbox-search/text-prep';

describe('prepareInboxBodyText', () => {
  test('strips html markup and quoted reply sections', () => {
    const raw = `<div>Hello team,<br/>Status is green.</div>
<div>On Tue, Jan 1, 2026 at 10:00 AM Someone wrote:</div>
<blockquote>> old quoted text</blockquote>`;

    const prepared = prepareInboxBodyText(raw);

    expect(prepared).toContain('Hello team,');
    expect(prepared).toContain('Status is green.');
    expect(prepared).not.toContain('Someone wrote');
    expect(prepared).not.toContain('old quoted text');
    expect(prepared).not.toContain('<div>');
  });

  test('strips trailing signature blocks', () => {
    const raw = `Please review this.

Thanks,
Rushik
--
Sent from my iPhone`;

    const prepared = prepareInboxBodyText(raw);

    expect(prepared).toContain('Please review this.');
    expect(prepared).not.toContain('Sent from my iPhone');
    expect(prepared).not.toContain('--');
  });
});
