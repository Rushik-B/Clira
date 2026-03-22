/**
 * Decodes Gmail `messages` resource payload bodies into UTF-8 text.
 *
 * Gmail uses nested multiparts (e.g. multipart/mixed -> multipart/alternative)
 * for calendar invites, encrypted mail, and related HTML. Push ingestion and
 * GmailService must share traversal logic so stored `Email.body` and inbox
 * index `bodyText` stay aligned.
 */

import {
  appendUniqueUrlsToBodyText,
  extractUrlsFromText,
  stripHtmlPreservingNewlines,
} from '@/lib/email/text';

const GMAIL_BODY_MAX_CHARS = 10_000;

type GmailPayloadPart = {
  mimeType?: string;
  filename?: string;
  body?: {
    data?: string;
    attachmentId?: string;
  };
  parts?: GmailPayloadPart[];
};

type GmailBodyCandidate = {
  mimeType: string | null;
  text: string;
};

export type GmailAttachmentDataLoader = (params: {
  attachmentId: string;
  mimeType: string | null;
  filename: string | null;
}) => Promise<string | null>;

function decodeGmailBase64Url(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return Buffer.from(normalized, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

function normalizeMimeType(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const [mimeType] = value.trim().toLowerCase().split(';', 1);
  return mimeType?.trim() || null;
}

function isHtmlMimeType(mimeType: string | null): boolean {
  return mimeType === 'text/html' || mimeType === 'application/xhtml+xml';
}

function isTextualAttachmentCandidate(part: GmailPayloadPart, mimeType: string | null): boolean {
  if (mimeType?.startsWith('text/')) {
    return true;
  }

  const normalizedFilename = part.filename?.trim().toLowerCase() ?? '';
  return /\.(txt|md|html?|xml|json|ics|csv)$/i.test(normalizedFilename);
}

function normalizeDecodedGmailText(text: string, mimeType: string | null): string {
  const normalizedLineEndings = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalizedLineEndings) {
    return '';
  }

  if (isHtmlMimeType(mimeType)) {
    return stripHtmlPreservingNewlines(normalizedLineEndings);
  }

  return normalizedLineEndings;
}

function scoreGmailBodyCandidate(candidate: GmailBodyCandidate): number {
  const mimeType = candidate.mimeType;
  const urlCount = extractUrlsFromText(candidate.text).length;
  const lengthScore = Math.min(candidate.text.length, 4000) / 40;
  const lineScore = candidate.text.split('\n').filter((line) => line.trim().length > 0).length;

  let mimeScore = 10;
  if (mimeType === 'text/plain') {
    mimeScore = 40;
  } else if (isHtmlMimeType(mimeType)) {
    mimeScore = 35;
  } else if (mimeType === 'text/calendar') {
    mimeScore = 25;
  } else if (mimeType?.startsWith('text/')) {
    mimeScore = 20;
  }

  return mimeScore + urlCount * 20 + lengthScore + lineScore;
}

function pickBestBodyCandidate(candidates: GmailBodyCandidate[]): GmailBodyCandidate | null {
  let best: GmailBodyCandidate | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const score = scoreGmailBodyCandidate(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

function finalizeGmailBodyCandidates(candidates: GmailBodyCandidate[]): string {
  const nonEmptyCandidates = candidates.filter((candidate) => candidate.text.trim().length > 0);
  if (nonEmptyCandidates.length === 0) {
    return '';
  }

  const bestCandidate = pickBestBodyCandidate(nonEmptyCandidates);
  if (!bestCandidate) {
    return '';
  }

  const allUrls = nonEmptyCandidates.flatMap((candidate) => extractUrlsFromText(candidate.text));
  return appendUniqueUrlsToBodyText(bestCandidate.text, allUrls);
}

function readInlineGmailBodyCandidate(payload: GmailPayloadPart): GmailBodyCandidate | null {
  const mimeType = normalizeMimeType(payload.mimeType);

  if (!payload.body?.data) {
    return null;
  }

  const text = normalizeDecodedGmailText(decodeGmailBase64Url(payload.body.data), mimeType);
  if (!text) {
    return null;
  }

  return {
    mimeType,
    text,
  };
}

function collectInlineGmailBodyCandidates(payload: GmailPayloadPart | null | undefined): GmailBodyCandidate[] {
  if (!payload) {
    return [];
  }

  const candidates: GmailBodyCandidate[] = [];

  const inlineCandidate = readInlineGmailBodyCandidate(payload);
  if (inlineCandidate) {
    candidates.push(inlineCandidate);
  }

  for (const child of payload.parts ?? []) {
    candidates.push(...collectInlineGmailBodyCandidates(child));
  }

  return candidates;
}

async function collectGmailBodyCandidatesWithAttachments(
  payload: GmailPayloadPart | null | undefined,
  loadAttachmentData: GmailAttachmentDataLoader,
  seenAttachmentIds: Set<string>,
): Promise<GmailBodyCandidate[]> {
  if (!payload) {
    return [];
  }

  const mimeType = normalizeMimeType(payload.mimeType);
  const candidates: GmailBodyCandidate[] = [];
  const inlineCandidate = readInlineGmailBodyCandidate(payload);
  if (inlineCandidate) {
    candidates.push(inlineCandidate);
  }
  const attachmentId = payload.body?.attachmentId?.trim();

  if (
    attachmentId &&
    !payload.body?.data &&
    !seenAttachmentIds.has(attachmentId) &&
    isTextualAttachmentCandidate(payload, mimeType)
  ) {
    seenAttachmentIds.add(attachmentId);
    const attachmentData = await loadAttachmentData({
      attachmentId,
      mimeType,
      filename: payload.filename?.trim() || null,
    });

    if (attachmentData) {
      const text = normalizeDecodedGmailText(decodeGmailBase64Url(attachmentData), mimeType);
      if (text) {
        candidates.push({
          mimeType,
          text,
        });
      }
    }
  }

  for (const child of payload.parts ?? []) {
    candidates.push(
      ...(await collectGmailBodyCandidatesWithAttachments(child, loadAttachmentData, seenAttachmentIds)),
    );
  }

  return candidates;
}

/**
 * Recursively extracts the best available textual body from a Gmail API payload
 * (message.payload or a nested part). It scores text/plain, HTML, calendar,
 * and other decodable text leaves, then appends actionable URLs discovered in
 * alternate representations so invite links survive indexing.
 */
export function extractGmailPayloadBodyText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  return finalizeGmailBodyCandidates(collectInlineGmailBodyCandidates(payload as GmailPayloadPart));
}

export async function extractGmailPayloadBodyTextWithAttachments(
  payload: unknown,
  loadAttachmentData: GmailAttachmentDataLoader,
): Promise<string> {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const candidates = await collectGmailBodyCandidatesWithAttachments(
    payload as GmailPayloadPart,
    loadAttachmentData,
    new Set<string>(),
  );

  return finalizeGmailBodyCandidates(candidates);
}

/** Same cap as {@link GmailService} parseEmailMessage for stored body size. */
export function truncateGmailExtractedBody(body: string, maxChars = GMAIL_BODY_MAX_CHARS): string {
  if (body.length <= maxChars) {
    return body;
  }
  return body.slice(0, maxChars);
}
