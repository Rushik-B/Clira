import type { InboxSearchFilters } from '@/lib/services/inbox-search/types';

export type InboxSearchQueryIntent =
  | 'filter_only'
  | 'email_or_domain'
  | 'exact_phrase'
  | 'contact_or_person'
  | 'entity_or_place'
  | 'broad_semantic';

export type InboxSearchQueryIntentAnalysis = {
  intent: InboxSearchQueryIntent;
  queryKeywords: string[];
  queryEmails: string[];
  quotedPhrases: string[];
  domainTokens: string[];
  literalPriorityTerms: string[];
  exactSenderTerms: string[];
  exactSubjectTerms: string[];
  semanticSimilarityFloor: number;
  preferLiteralMatches: boolean;
  suppressSemanticOnlyWeakMatches: boolean;
  semanticCandidateLimit: number;
  note?: string;
};

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'for',
  'to',
  'from',
  'with',
  'about',
  'into',
  'over',
  'after',
  'before',
  'this',
  'that',
  'these',
  'those',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'on',
  'in',
  'at',
  'by',
  'it',
  'its',
  'i',
  'me',
  'my',
  'we',
  'us',
  'our',
  'you',
  'your',
  'he',
  'she',
  'they',
  'them',
  'their',
  'as',
  'if',
  'then',
  'than',
  'so',
  'not',
  'no',
  'yes',
  'just',
  'can',
  'could',
  'should',
  'would',
]);

const GENERIC_INBOX_INTENT_TOKENS = new Set([
  'email',
  'emails',
  'mail',
  'inbox',
  'message',
  'messages',
  'received',
  'receive',
  'sent',
  'search',
  'find',
  'show',
  'tell',
  'check',
  'look',
  'lookup',
  'happened',
]);

const DATE_LIKE_TOKEN_REGEX =
  /^(?:\d{1,2}(?:st|nd|rd|th)?|\d{4}-\d{2}-\d{2}|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|yesterday|week|month|quarter|year)$/i;
const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const QUOTED_PHRASE_REGEX = /"([^"]+)"/g;
const DOMAIN_TOKEN_REGEX = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i;
const ALPHA_TOKEN_REGEX = /^[a-z][a-z'-]{1,24}$/i;

function hasStructuredFilterSignal(filters?: InboxSearchFilters): boolean {
  return Boolean(
    filters?.sender ||
      filters?.recipient ||
      filters?.subjectContains ||
      filters?.bodyContains ||
      (filters?.keywords?.length ?? 0) > 0 ||
      typeof filters?.hasAttachment === 'boolean' ||
      filters?.startDate ||
      filters?.endDate ||
      filters?.relativeWindow ||
      filters?.threadId ||
      filters?.messageId,
  );
}

function extractQuotedPhrases(text: string): string[] {
  const phrases: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = QUOTED_PHRASE_REGEX.exec(text)) !== null) {
    const phrase = match[1]?.trim();
    if (phrase) {
      phrases.push(phrase);
    }
    if (phrases.length >= 4) {
      break;
    }
  }

  return Array.from(new Set(phrases));
}

function extractEmails(text: string): string[] {
  const matches = text.match(EMAIL_REGEX) ?? [];
  return Array.from(new Set(matches.map((email) => email.toLowerCase())));
}

function extractKeywords(text: string, limit = 6): string[] {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9@._-]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length > 2)
    .filter((token) => !STOPWORDS.has(token));

  return Array.from(new Set(tokens)).slice(0, limit);
}

function extractLexicalKeywords(text: string, limit = 6): string[] {
  return extractKeywords(text, limit).filter((token) => {
    if (GENERIC_INBOX_INTENT_TOKENS.has(token)) {
      return false;
    }

    if (DATE_LIKE_TOKEN_REGEX.test(token)) {
      return false;
    }

    return true;
  });
}

export function isFocusedInboxQueryIntent(intent: InboxSearchQueryIntent): boolean {
  return (
    intent === 'email_or_domain' ||
    intent === 'exact_phrase' ||
    intent === 'contact_or_person' ||
    intent === 'entity_or_place'
  );
}

export function analyzeInboxQueryIntent(params: {
  queryText?: string;
  filters?: InboxSearchFilters;
}): InboxSearchQueryIntentAnalysis {
  const queryText = params.queryText?.trim() ?? '';
  const quotedPhrases = extractQuotedPhrases(queryText);
  const queryEmails = extractEmails(queryText);
  const queryKeywords = extractLexicalKeywords(queryText);
  const domainTokens = queryKeywords.filter(
    (token) => DOMAIN_TOKEN_REGEX.test(token) && !token.includes('@'),
  );
  const rawWordCount = queryText
    .split(/\s+/g)
    .map((token) => token.trim())
    .filter(Boolean).length;
  const alphaKeywordCount = queryKeywords.filter((token) => ALPHA_TOKEN_REGEX.test(token)).length;
  const allAlphaKeywords =
    queryKeywords.length > 0 && alphaKeywordCount === queryKeywords.length;
  const shortFocusedKeywordQuery =
    queryKeywords.length > 0 &&
    queryKeywords.length <= 2 &&
    rawWordCount <= 3;
  const literalPriorityTerms = Array.from(
    new Set([
      ...quotedPhrases,
      ...queryEmails,
      ...domainTokens,
      ...(shortFocusedKeywordQuery ? queryKeywords : []),
    ]),
  );

  if (!queryText && hasStructuredFilterSignal(params.filters)) {
    return {
      intent: 'filter_only',
      queryKeywords,
      queryEmails,
      quotedPhrases,
      domainTokens,
      literalPriorityTerms: [],
      exactSenderTerms: [],
      exactSubjectTerms: [],
      semanticSimilarityFloor: 1,
      preferLiteralMatches: true,
      suppressSemanticOnlyWeakMatches: true,
      semanticCandidateLimit: 0,
      note: 'Running a local filter-only search because the request relies on structured filters.',
    };
  }

  if (queryEmails.length > 0 || domainTokens.length > 0) {
    const senderTerms = Array.from(new Set([...queryEmails, ...domainTokens]));
    return {
      intent: 'email_or_domain',
      queryKeywords,
      queryEmails,
      quotedPhrases,
      domainTokens,
      literalPriorityTerms: senderTerms,
      exactSenderTerms: senderTerms,
      exactSubjectTerms: senderTerms,
      semanticSimilarityFloor: 0.82,
      preferLiteralMatches: true,
      suppressSemanticOnlyWeakMatches: true,
      semanticCandidateLimit: 20,
      note:
        'Address/domain query detected; prioritizing literal sender and subject matches ahead of semantic-only results.',
    };
  }

  if (quotedPhrases.length > 0) {
    return {
      intent: 'exact_phrase',
      queryKeywords,
      queryEmails,
      quotedPhrases,
      domainTokens,
      literalPriorityTerms: quotedPhrases,
      exactSenderTerms: [],
      exactSubjectTerms: quotedPhrases,
      semanticSimilarityFloor: 0.78,
      preferLiteralMatches: true,
      suppressSemanticOnlyWeakMatches: true,
      semanticCandidateLimit: 24,
      note:
        'Exact phrase query detected; protecting literal phrase matches ahead of semantic-only results.',
    };
  }

  if (
    shortFocusedKeywordQuery &&
    allAlphaKeywords &&
    queryKeywords.length === 1 &&
    queryKeywords[0]!.length <= 7
  ) {
    return {
      intent: 'contact_or_person',
      queryKeywords,
      queryEmails,
      quotedPhrases,
      domainTokens,
      literalPriorityTerms: queryKeywords,
      exactSenderTerms: queryKeywords,
      exactSubjectTerms: queryKeywords,
      semanticSimilarityFloor: 0.74,
      preferLiteralMatches: true,
      suppressSemanticOnlyWeakMatches: true,
      semanticCandidateLimit: 28,
      note:
        'Short contact-style query detected; boosting literal participant and subject matches ahead of semantic-only results.',
    };
  }

  if (shortFocusedKeywordQuery && allAlphaKeywords && queryKeywords.length === 2) {
    return {
      intent: 'contact_or_person',
      queryKeywords,
      queryEmails,
      quotedPhrases,
      domainTokens,
      literalPriorityTerms: queryKeywords,
      exactSenderTerms: queryKeywords,
      exactSubjectTerms: queryKeywords,
      semanticSimilarityFloor: 0.74,
      preferLiteralMatches: true,
      suppressSemanticOnlyWeakMatches: true,
      semanticCandidateLimit: 28,
      note:
        'Short contact-style query detected; boosting literal participant and subject matches ahead of semantic-only results.',
    };
  }

  if (shortFocusedKeywordQuery) {
    return {
      intent: 'entity_or_place',
      queryKeywords,
      queryEmails,
      quotedPhrases,
      domainTokens,
      literalPriorityTerms: queryKeywords,
      exactSenderTerms: [],
      exactSubjectTerms: queryKeywords,
      semanticSimilarityFloor: 0.74,
      preferLiteralMatches: true,
      suppressSemanticOnlyWeakMatches: true,
      semanticCandidateLimit: 28,
      note:
        'Short exact-style query detected; prioritizing literal subject and body matches ahead of weak semantic-only results.',
    };
  }

  return {
    intent: 'broad_semantic',
    queryKeywords,
    queryEmails,
    quotedPhrases,
    domainTokens,
    literalPriorityTerms: [],
    exactSenderTerms: [],
    exactSubjectTerms: [],
    semanticSimilarityFloor: 0.58,
    preferLiteralMatches: false,
    suppressSemanticOnlyWeakMatches: false,
    semanticCandidateLimit: 80,
  };
}
