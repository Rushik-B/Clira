import { describe, expect, test } from 'vitest';
import {
  extractGmailPayloadBodyText,
  extractGmailPayloadBodyTextWithAttachments,
  truncateGmailExtractedBody,
} from '@/lib/email/gmailPayloadBody';

function b64(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64');
}

function b64Url(s: string): string {
  return b64(s).replace(/\+/g, '-').replace(/\//g, '_');
}

describe('extractGmailPayloadBodyText', () => {
  test('returns empty for nullish payload', () => {
    expect(extractGmailPayloadBodyText(null)).toBe('');
    expect(extractGmailPayloadBodyText(undefined)).toBe('');
  });

  test('decodes top-level body with standard base64', () => {
    const payload = { body: { data: b64('Hello inbox') } };
    expect(extractGmailPayloadBodyText(payload)).toBe('Hello inbox');
  });

  test('decodes top-level body with Gmail base64url alphabet', () => {
    const payload = { body: { data: b64Url('plus/slash test') } };
    expect(extractGmailPayloadBodyText(payload)).toBe('plus/slash test');
  });

  test('extracts searchable link text from nested multipart HTML invites', () => {
    const html = '<a href="https://meet.google.com/abc-defg-hij">Join with Google Meet</a>';
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/calendar', body: { data: b64('BEGIN:VCALENDAR\nEND:VCALENDAR') } },
            { mimeType: 'text/html', body: { data: b64(html) } },
          ],
        },
      ],
    };
    const extracted = extractGmailPayloadBodyText(payload);
    expect(extracted).toContain('Join with Google Meet');
    expect(extracted).toContain('https://meet.google.com/abc-defg-hij');
  });

  test('appends missing actionable links from richer alternate parts', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: b64('Join with Google Meet') } },
        {
          mimeType: 'text/html',
          body: { data: b64('<a href="https://meet.google.com/abc-defg-hij">Join with Google Meet</a>') },
        },
      ],
    };
    const extracted = extractGmailPayloadBodyText(payload);
    expect(extracted).toContain('Join with Google Meet');
    expect(extracted).toContain('https://meet.google.com/abc-defg-hij');
  });

  test('falls back to text/calendar when no plain/html (ICS-only leaf)', () => {
    const ics = 'BEGIN:VCALENDAR\nX-WR-CALNAME:test\nEND:VCALENDAR';
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [{ mimeType: 'text/calendar', body: { data: b64(ics) } }],
    };
    expect(extractGmailPayloadBodyText(payload)).toBe(ics);
  });

  test('can fetch textual attachment parts when inline body data is absent', async () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          partId: '1',
          mimeType: 'text/calendar',
          filename: 'invite.ics',
          body: { attachmentId: 'att-1' },
        },
      ],
    };

    const extracted = await extractGmailPayloadBodyTextWithAttachments(
      payload,
      async ({ attachmentId }) =>
        attachmentId === 'att-1'
          ? b64Url('BEGIN:VCALENDAR\nURL:https://meet.google.com/abc-defg-hij\nEND:VCALENDAR')
          : null,
    );

    expect(extracted).toContain('BEGIN:VCALENDAR');
    expect(extracted).toContain('https://meet.google.com/abc-defg-hij');
  });
});

describe('truncateGmailExtractedBody', () => {
  test('leaves short bodies unchanged', () => {
    expect(truncateGmailExtractedBody('abc')).toBe('abc');
  });

  test('truncates at default limit', () => {
    const long = 'x'.repeat(12_000);
    expect(truncateGmailExtractedBody(long)).toHaveLength(10_000);
  });
});
