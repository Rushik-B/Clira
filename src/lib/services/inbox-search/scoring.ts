import type { InboxSearchFreshness } from '@/lib/services/inbox-search/types';
import type { InboxSearchQueryIntent } from '@/lib/services/inbox-search/query-intent';

const MAX_MATCHED_TERMS = 4;

function normalizeComparableValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function collectInboxMatchedTerms(fields: string[], terms: string[]): string[] {
  if (terms.length === 0) {
    return [];
  }

  const normalizedFields = fields
    .map((field) => normalizeComparableValue(field))
    .filter(Boolean);

  const matchedTerms: string[] = [];
  for (const term of terms) {
    const normalizedTerm = normalizeComparableValue(term);
    if (!normalizedTerm) {
      continue;
    }

    if (normalizedFields.some((field) => field.includes(normalizedTerm))) {
      matchedTerms.push(term.trim());
    }

    if (matchedTerms.length >= MAX_MATCHED_TERMS) {
      break;
    }
  }

  return matchedTerms;
}

export function hasInboxExactSenderMatch(from: string, senderTerms: string[]): boolean {
  if (senderTerms.length === 0) {
    return false;
  }

  const normalizedFrom = normalizeComparableValue(from);
  return senderTerms.some((term) => {
    const normalizedTerm = normalizeComparableValue(term);
    return normalizedTerm.length > 0 && normalizedFrom.includes(normalizedTerm);
  });
}

export function hasInboxExactSubjectMatch(subject: string, subjectTerms: string[]): boolean {
  if (subjectTerms.length === 0) {
    return false;
  }

  const normalizedSubject = normalizeComparableValue(subject);
  return subjectTerms.some((term) => {
    const normalizedTerm = normalizeComparableValue(term);
    return normalizedTerm.length > 0 && normalizedSubject.includes(normalizedTerm);
  });
}

export function calculateInboxRecencyBoost(
  sentAt: Date | string,
  now = new Date(),
): number {
  const sentAtDate = sentAt instanceof Date ? sentAt : new Date(sentAt);
  const elapsedMs = Math.max(0, now.getTime() - sentAtDate.getTime());
  const daysAgo = elapsedMs / (24 * 60 * 60 * 1000);
  return 1 / (1 + daysAgo / 30);
}

export function roundInboxScore(value: number): number {
  return Number(value.toFixed(6));
}

export function buildInboxWhyRelevant(params: {
  matchedTerms: string[];
  exactSenderMatch: boolean;
  exactSubjectMatch: boolean;
  literalSenderMatch?: boolean;
  literalParticipantMatch?: boolean;
  literalSubjectMatch?: boolean;
  literalBodyMatch?: boolean;
  directCorrespondence?: boolean;
  lexicalScore: number;
  semanticScore?: number | null;
}): string {
  const reasons: string[] = [];

  if (params.exactSenderMatch) {
    reasons.push('Sender matched exactly');
  }

  if (params.exactSubjectMatch) {
    reasons.push('Subject phrase matched');
  }

  if (params.literalSenderMatch && !params.exactSenderMatch) {
    reasons.push('Sender contained the query');
  }

  if (params.literalParticipantMatch) {
    reasons.push('Recipients matched the query');
  }

  if (params.literalSubjectMatch && !params.exactSubjectMatch) {
    reasons.push('Subject contained the query');
  }

  if (params.literalBodyMatch) {
    reasons.push('Body contained the query');
  }

  if (params.directCorrespondence) {
    reasons.push('Likely direct correspondence');
  }

  if (params.matchedTerms.length > 0) {
    reasons.push(`Matched terms: ${params.matchedTerms.join(', ')}`);
  }

  if (typeof params.semanticScore === 'number') {
    reasons.push(`Semantic similarity ${params.semanticScore.toFixed(3)}`);
  }

  if (reasons.length === 0) {
    reasons.push(
      params.lexicalScore > 0
        ? 'Matched local lexical search'
        : 'Matched local inbox filters',
    );
  }

  return `${reasons.join('. ')}.`;
}

export function inferInboxSearchConfidence(params: {
  candidateCount: number;
  topScore: number;
  secondScore?: number;
  freshness: InboxSearchFreshness;
  hasExactBoost: boolean;
  queryIntent?: InboxSearchQueryIntent;
  literalMatchCount?: number;
  semanticOnlyCount?: number;
}): 'low' | 'medium' | 'high' {
  if (params.candidateCount === 0) {
    return 'low';
  }

  if (params.freshness === 'stale' || params.freshness === 'unknown') {
    return 'low';
  }

  const focusedIntent =
    params.queryIntent === 'contact_or_person' ||
    params.queryIntent === 'email_or_domain' ||
    params.queryIntent === 'exact_phrase' ||
    params.queryIntent === 'entity_or_place';
  const literalMatchCount = params.literalMatchCount ?? 0;
  const semanticOnlyCount = params.semanticOnlyCount ?? 0;
  const topScoreGap = params.topScore - (params.secondScore ?? 0);

  if (focusedIntent && literalMatchCount === 0) {
    return 'low';
  }

  if (focusedIntent && semanticOnlyCount >= Math.ceil(params.candidateCount / 2)) {
    return 'low';
  }

  if (
    params.hasExactBoost ||
    (literalMatchCount > 0 && topScoreGap >= 0.75) ||
    (literalMatchCount > 0 && params.topScore >= 3.2)
  ) {
    return 'high';
  }

  if (focusedIntent && literalMatchCount <= 1) {
    return 'low';
  }

  return params.topScore >= 2.2 ? 'medium' : 'low';
}
