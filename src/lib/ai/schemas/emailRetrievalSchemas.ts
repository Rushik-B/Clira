import { z } from 'zod';

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
  queriesTried: z.array(z.string()).describe('Gmail queries executed during retrieval'),
  threadsScanned: z.number().int().min(0).describe('Number of threads scanned'),
  messagesScanned: z.number().int().min(0).describe('Number of messages scanned'),
  timeWindow: z.string().describe('Human summary of the time window searched'),
  pagesFetched: z.number().int().min(0).describe('Number of Gmail pages fetched'),
  truncated: z.boolean().describe('True if budgets stopped the search early'),
  budgetNotes: z.array(z.string()).optional().describe('Budget or coverage notes'),
});

export type EmailEvidenceCoverageDTO = z.infer<typeof EmailEvidenceCoverageSchema>;

export const EmailEvidencePackSchema = z.object({
  matches: z.array(EmailEvidenceMatchSchema).describe('Ranked best matches'),
  quotes: z.array(EmailEvidenceQuoteSchema).describe('Supporting quotes from matches'),
  coverage: EmailEvidenceCoverageSchema.describe('Coverage metadata for the search'),
  confidence: z.enum(['low', 'medium', 'high']).describe('Overall confidence in the matches'),
  followUpQuestions: z
    .array(z.string())
    .describe('Clarifying questions if the request is ambiguous or results are weak'),
});

export type EmailEvidencePackDTO = z.infer<typeof EmailEvidencePackSchema>;
