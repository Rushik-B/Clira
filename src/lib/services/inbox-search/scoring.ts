import type { InboxSearchFreshness } from '@/lib/services/inbox-search/types';

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
  freshness: InboxSearchFreshness;
  hasExactBoost: boolean;
}): 'low' | 'medium' | 'high' {
  if (params.candidateCount === 0) {
    return 'low';
  }

  if (params.freshness === 'stale' || params.freshness === 'unknown') {
    return 'low';
  }

  if (params.hasExactBoost || params.topScore >= 4) {
    return 'high';
  }

  return 'medium';
}
