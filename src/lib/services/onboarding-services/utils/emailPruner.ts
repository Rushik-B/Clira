export interface EmailPruneInput {
  subject?: string;
  body?: string;
}

export interface EmailPruneOutput {
  prunedBody: string;
}

/**
 * Neutral email pruner for routing. Purpose: reduce tokens without injecting
 * classification hints. No folder-specific heuristics; only structural trimming.
 *
 * Strategy:
 * - Keep only the top-of-thread content (before quoted replies/signatures)
 * - Collapse whitespace
 * - Hard cap by characters
 */
export function pruneEmailContentForRouting(input: EmailPruneInput): EmailPruneOutput {
  const rawBody = (input.body || '').trim();

  // 1) Keep the latest visible message (strip quoted replies/signatures)
  let body = stripQuotedRepliesAndFooters(rawBody);

  // 2) Normalize whitespace
  body = normalizeWhitespace(body);

  // 3) Hard cap
  const MAX_CHARS = 600; // neutral cap; adjust if needed
  if (body.length > MAX_CHARS) {
    body = body.slice(0, MAX_CHARS - 3) + '...';
  }

  return { prunedBody: body };
}

/**
 * Email pruner for planning. Purpose: keep the highest-signal "latest message" content
 * while still reducing token usage. This is less aggressive than routing.
 */
export function pruneEmailContentForPlanning(input: EmailPruneInput): EmailPruneOutput {
  const rawBody = (input.body || '').trim();

  // 1) Keep the latest visible message (strip quoted replies/signatures)
  let body = stripQuotedRepliesAndFooters(rawBody);

  // 2) Normalize whitespace (preserve paragraph breaks)
  body = normalizeWhitespace(body);

  // 3) Hard cap (planner needs more than router)
  const MAX_CHARS = 2200;
  if (body.length > MAX_CHARS) {
    body = body.slice(0, MAX_CHARS - 3) + '...';
  }

  return { prunedBody: body };
}

function stripQuotedRepliesAndFooters(text: string): string {
  if (!text) return '';
  let t = text;

  // Remove common quoted reply separators
  t = t.split(/\nOn .* wrote:\n|\nFrom:\s.*\nSent:\s.*\n|^> .*/m)[0];

  // Remove Gmail signature separator
  t = t.split(/\n\-\- ?\n/)[0];

  // Remove long trailing legal disclaimers
  t = t.replace(/\nThis\s+email\s+and\s+any\s+attachments[\s\S]*$/i, '');
  return t.trim();
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/\t/g, ' ')
    .replace(/\u00A0/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

