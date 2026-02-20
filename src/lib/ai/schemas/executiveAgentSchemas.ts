/**
 * Executive Agent Schemas
 *
 * Zod schemas for the WhatsApp Executive Agent (EA) tool inputs and outputs.
 * These schemas define the structure for email drafts, contact searches, and
 * memory operations used by the EA during WhatsApp conversations.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Email Draft Schema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schema for email drafts produced by the Executive Agent.
 * Used as the terminal output when the user confirms sending an email.
 */
export const EmailDraftSchema = z.object({
  to: z
    .array(z.string().email())
    .min(1)
    .describe('Primary recipient email addresses (at least one required)'),
  cc: z
    .array(z.string().email())
    .default([])
    .describe('Carbon copy recipient email addresses'),
  subject: z
    .string()
    .min(1)
    .max(200)
    .describe('Email subject line (1-200 characters)'),
  body: z
    .string()
    .min(1)
    .max(4000)
    .describe('Email body content (1-4000 characters)'),
  reasoning: z
    .string()
    .max(500)
    .describe('Brief explanation of the draft approach and key decisions'),
});

export type EmailDraftDTO = z.infer<typeof EmailDraftSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Contact Search Schema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schema for contact search results when resolving names to emails.
 * Helps the EA identify the correct recipient when user says "email Jake".
 */
export const ContactSearchResultSchema = z.object({
  email: z
    .string()
    .email()
    .describe('The contact\'s email address'),
  name: z
    .string()
    .optional()
    .describe('Full name of the contact if available'),
  recentSubject: z
    .string()
    .optional()
    .describe('Subject of the most recent email with this contact'),
  lastContactDate: z
    .string()
    .optional()
    .describe('ISO date of the last email exchange with this contact'),
});

export type ContactSearchResultDTO = z.infer<typeof ContactSearchResultSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Memory Append Schema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schema for appending user facts/preferences to Supermemory.
 * The EA stores user-stated preferences on first mention, deduped via customId.
 */
export const MemoryAppendSchema = z.object({
  content: z
    .string()
    .min(1)
    .max(500)
    .describe('The atomic memory line (1 sentence describing a user fact/preference)'),
  type: z
    .enum(['user_preference', 'user_fact', 'relationship_info', 'scheduling_preference', 'communication_style'])
    .default('user_preference')
    .describe('Category of the memory being stored'),
});

export type MemoryAppendDTO = z.infer<typeof MemoryAppendSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Conversation Message Schema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schema for a single message in the conversation history.
 */
export const ConversationMessageSchema = z.object({
  id: z.string(),
  content: z.string(),
  role: z.enum(['USER', 'ASSISTANT', 'SYSTEM']),
  direction: z.enum(['INBOUND', 'OUTBOUND']),
  createdAt: z.date(),
  /** Tool call metadata (includes tool names, inputs, outputs, status) */
  metadata: z.record(z.unknown()).nullable().optional(),
});

export type ConversationMessageDTO = z.infer<typeof ConversationMessageSchema>;
