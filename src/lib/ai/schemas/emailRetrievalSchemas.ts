import { z } from 'zod';

const emailEvidenceActionValues = [
  'find',
  'summarize_range',
  'count',
  'aggregate',
] as const;

const emailEvidenceGroupByValues = ['sender', 'day', 'thread', 'mailbox'] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Email Retrieval Evidence Schemas
//
// These schemas define the compact evidence pack returned to the Executive Agent
// after inbox retrieval. The goal is to provide ranked matches, direct quotes,
// coverage metadata, confidence, and follow-up prompts without inbox bloat.
// ─────────────────────────────────────────────────────────────────────────────

export const EmailEvidenceMatchSchema = z.object({
  threadId: z.string().describe('Gmail thread ID that contains the matching email'),
  messageId: z.string().describe('Gmail message ID for the specific email'),
  mailboxId: z.string().optional().describe('Mailbox ID that owns this email'),
  mailboxEmail: z.string().optional().describe('Mailbox email address for context'),
  date: z.string().describe('ISO date string of the email'),
  from: z.string().describe('Sender display name + email'),
  subject: z.string().describe('Email subject line'),
  whyRelevant: z
    .string()
    .max(300)
    .describe('Short explanation of why this email matches the request'),
  quote: z
    .string()
    .max(400)
    .describe('Short, verbatim excerpt from the email that supports relevance'),
});

export type EmailEvidenceMatchDTO = z.infer<typeof EmailEvidenceMatchSchema>;

export const EmailEvidenceQuoteSchema = z.object({
  threadId: z.string().describe('Gmail thread ID that contains the quote'),
  messageId: z.string().describe('Gmail message ID that contains the quote'),
  mailboxId: z.string().optional().describe('Mailbox ID that owns this email'),
  mailboxEmail: z.string().optional().describe('Mailbox email address for context'),
  quote: z.string().max(400).describe('Verbatim excerpt from the email body'),
  note: z.string().max(200).optional().describe('Why this quote matters'),
});

export type EmailEvidenceQuoteDTO = z.infer<typeof EmailEvidenceQuoteSchema>;

export const EmailEvidenceCoverageSchema = z.object({
  action: z.enum(emailEvidenceActionValues).describe('Search action executed'),
  queriesTried: z.array(z.string()).describe('Retrieval queries or search plans executed'),
  threadsScanned: z.number().int().min(0).describe('Number of threads scanned'),
  messagesScanned: z.number().int().min(0).describe('Number of messages scanned'),
  timeWindow: z.string().describe('Human summary of the time window searched'),
  pagesFetched: z.number().int().min(0).describe('Number of paginated fetches performed'),
  truncated: z.boolean().describe('True if budgets stopped the search early'),
  filterOnly: z.boolean().describe('True when retrieval used only structured filters and no lexical query'),
  appliedFilters: z.array(z.string()).describe('Structured filters applied directly in SQL'),
  budgetNotes: z.array(z.string()).optional().describe('Budget or coverage notes'),
  engineVersion: z.string().optional().describe('Retrieval engine version'),
  indexFreshness: z
    .enum(['fresh', 'lagging', 'stale', 'unknown'])
    .optional()
    .describe('Freshness state of the local inbox index'),
  retrievalLatencyMs: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('End-to-end retrieval latency in milliseconds'),
  lexicalCandidates: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Number of lexical candidates considered'),
  semanticCandidates: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Number of semantic candidates considered'),
  fusionMethod: z.string().optional().describe('Ranking or fusion method applied'),
  indexLag: z
    .number()
    .int()
    .min(0)
    .nullable()
    .optional()
    .describe('Estimated worst-case index lag in minutes'),
  semanticUnavailable: z
    .boolean()
    .optional()
    .describe('True when semantic retrieval was unavailable and lexical-only search was used'),
});

export type EmailEvidenceCoverageDTO = z.infer<typeof EmailEvidenceCoverageSchema>;

export const EmailEvidenceMetadataSchema = z.object({
  cached: z
    .boolean()
    .optional()
    .describe('True when this evidence pack was reused from per-run memoization'),
  validationError: z
    .boolean()
    .optional()
    .describe('True when the tool rejected invalid arguments before running retrieval'),
  escalation: z
    .enum(['quick_to_deep'])
    .optional()
    .describe('Internal retrieval escalation that happened before returning the evidence pack'),
});

export type EmailEvidenceMetadataDTO = z.infer<typeof EmailEvidenceMetadataSchema>;

export const EmailEvidenceAggregateSchema = z.object({
  key: z.string().describe('Bucket value'),
  count: z.number().int().min(0).describe('Number of matches in the bucket'),
});

export type EmailEvidenceAggregateDTO = z.infer<typeof EmailEvidenceAggregateSchema>;

export const EmailEvidencePackSchema = z.object({
  action: z.enum(emailEvidenceActionValues).describe('Search action executed'),
  matches: z.array(EmailEvidenceMatchSchema).describe('Ranked best matches'),
  quotes: z.array(EmailEvidenceQuoteSchema).describe('Supporting quotes from matches'),
  coverage: EmailEvidenceCoverageSchema.describe('Coverage metadata for the search'),
  confidence: z.enum(['low', 'medium', 'high']).describe('Overall confidence in the matches'),
  metadata: EmailEvidenceMetadataSchema.optional().describe('Additive retrieval metadata'),
  summary: z.string().optional().describe('Concise action-specific summary'),
  count: z.number().int().min(0).optional().describe('Deterministic total count'),
  aggregates: z
    .array(EmailEvidenceAggregateSchema)
    .optional()
    .describe('Grouped aggregate buckets'),
  groupBy: z
    .enum(emailEvidenceGroupByValues)
    .optional()
    .describe('Group-by dimension used for aggregates'),
  followUpQuestions: z
    .array(z.string())
    .describe('Clarifying questions if the request is ambiguous or results are weak'),
});

export type EmailEvidencePackDTO = z.infer<typeof EmailEvidencePackSchema>;
