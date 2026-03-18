/**
 * User Profile Bootstrap Generator for Supermemory
 *
 * Generates a high-confidence user profile document for Supermemory.
 * Per SUPERMEMORY.md Section 4.3 and Section 5, Step 7:
 *
 * This document gives Supermemory a clean, high-confidence "about the user" baseline.
 * Uses gemini-3.0-pro (or equivalent) since it's only 1 call per user.
 */

import { z } from 'zod';
import { callObject } from '@/lib/ai/callLlm';
import { models } from '@/lib/ai/models';
import { logger } from '@/lib/logger';
import { readPromptFile } from '@/lib/prompts';
import {
  UserProfileBootstrapContent,
  ThreadEpisodeContent,
} from './types';

// ============================================================================
// Zod Schema for LLM Output
// ============================================================================

const ConfidenceFieldSchema = z.object({
  value: z.string().describe('The extracted value, or empty string if unknown'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Confidence score between 0 and 1'),
});

const UserProfileBootstrapContentSchema = z.object({
  full_name: ConfidenceFieldSchema.describe("User's full name"),
  preferred_name: ConfidenceFieldSchema.describe("User's preferred/first name"),
  email_address: ConfidenceFieldSchema.describe("User's primary email address"),
  common_signoff_name: ConfidenceFieldSchema.describe('Name commonly used in email sign-offs'),
  timezone_hint: ConfidenceFieldSchema.describe(
    'Timezone hint based on email patterns (e.g., "US/Eastern", "Europe/London")',
  ),
  role_or_company_hint: ConfidenceFieldSchema.describe(
    'Role or company/role or occupation hint from email signatures/context',
  ),
  notes: z
    .string()
    .max(500)
    .describe('Additional high-confidence observations. Only include facts strongly supported by evidence.'),
});

// ============================================================================
// Prompts
// ============================================================================

const SYSTEM_PROMPT = `You are an expert at extracting identity information from email communication patterns.
Your task is to create a concise user profile based on their email behavior.

IMPORTANT RULES:
1. Only include information with HIGH confidence (≥0.7)
2. Leave fields empty (value: "") if unsure - do NOT guess
3. Base all observations on actual evidence from the emails
4. Confidence must be realistic: 
   - 1.0 = certain (e.g., email address explicitly provided)
   - 0.8-0.9 = highly confident (consistent pattern across multiple emails)
   - 0.6-0.7 = moderately confident (appears in some emails)
   - <0.6 = set value to "" (not confident enough to include)
5. For timezone hints, look for patterns like:
   - Email send times
   - References to local time ("I'll call at 3pm EST")
   - Location references
6. For role/company hints, look for:
   - Email signatures
   - How they introduce themselves
   - Topics they discuss

Output a JSON object with confidence scores for each field.`;

function buildUserPrompt(
  userEmail: string,
  signoffNames: string[],
  fromDisplayNames: string[],
  episodeSamples: ThreadEpisodeContent[],
  receivedEmailsInsights: ReceivedEmailsInsights | null,
): string {
  const uniqueSignoffs = [...new Set(signoffNames)].slice(0, 10);
  const uniqueFromNames = [...new Set(fromDisplayNames)].slice(0, 10);
  const episodeSummaries = episodeSamples
    .slice(0, 25)
    .map((ep, i) => `${i + 1}. SENT: ${ep.sent_email_summary.substring(0, 200)}...`)
    .join('\n');

  // Format received email insights
  let receivedInsightsText = '(no unreplied received emails analyzed)';
  if (receivedEmailsInsights) {
    receivedInsightsText = `PROFESSIONAL CONTEXT:
${receivedEmailsInsights.professional_context}

EXPERTISE AREAS:
${receivedEmailsInsights.expertise_areas.length > 0 ? receivedEmailsInsights.expertise_areas.map(e => `- ${e}`).join('\n') : '(none identified)'}

RELATIONSHIP PATTERNS:
${receivedEmailsInsights.relationship_patterns}

COMMON REQUEST TYPES:
${receivedEmailsInsights.common_request_types.length > 0 ? receivedEmailsInsights.common_request_types.map(r => `- ${r}`).join('\n') : '(none identified)'}

NOTABLE OBSERVATIONS:
${receivedEmailsInsights.notable_observations}`;
  }

  const template = readPromptFile('supermemory/profileGeneratorUserPrompt.md');

  return template
    .replace('{userEmail}', userEmail)
    .replace(
      '{fromDisplayNames}',
      uniqueFromNames.length > 0 ? uniqueFromNames.join('\n') : '(no display names observed)',
    )
    .replace(
      '{signoffNames}',
      uniqueSignoffs.length > 0 ? uniqueSignoffs.join('\n') : '(no sign-offs observed)',
    )
    .replace('{episodeSummaries}', episodeSummaries || '(no episodes available)')
    .replace('{receivedEmailsInsights}', receivedInsightsText);
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract sign-off names from sent email bodies
 * Looks for common closing patterns like "Best,\nJohn" or "Thanks,\nJohn Smith"
 */
export function extractSignoffNames(sentEmailBodies: string[]): string[] {
  const signoffs: string[] = [];

  const closingPatterns = [
    /(?:Best|Best regards|Kind regards|Regards|Thanks|Thank you|Cheers|Sincerely|Warm regards|All the best),?\s*\n+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi,
    /(?:^|\n)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*$/gm, // Name at end of email
  ];

  for (const body of sentEmailBodies) {
    const trimmedBody = body.slice(-500); // Only check last 500 chars
    for (const pattern of closingPatterns) {
      const matches = trimmedBody.matchAll(pattern);
      for (const match of matches) {
        const name = match[1]?.trim();
        if (name && name.length >= 2 && name.length <= 50) {
          // Filter out common non-name patterns
          if (!/^(sent|from|to|cc|subject|date|forwarded|original)/i.test(name)) {
            signoffs.push(name);
          }
        }
      }
    }
  }

  return signoffs;
}

/**
 * Extract display names from "From" headers
 * e.g., "John Smith <john@example.com>" -> "John Smith"
 */
export function extractFromDisplayNames(fromHeaders: string[]): string[] {
  const names: string[] = [];

  for (const from of fromHeaders) {
    // Pattern: "Display Name <email@domain.com>"
    const match = from.match(/^(.+?)\s*<[^>]+>$/);
    if (match && match[1]) {
      const name = match[1].replace(/^["']|["']$/g, '').trim(); // Remove quotes
      if (name && name.length >= 2 && name.length <= 100) {
        names.push(name);
      }
    }
  }

  return names;
}

// ============================================================================
// Received Emails Analysis (Step 1: Extract Learnings using flash-lite)
// ============================================================================

/**
 * Schema for received emails analysis output
 */
const ReceivedEmailsInsightsSchema = z.object({
  professional_context: z
    .string()
    .max(800)
    .describe('What professional context can be inferred about the user from who contacts them and why'),
  expertise_areas: z
    .array(z.string())
    .max(12)
    .describe('Areas of expertise implied by the topics people reach out about'),
  relationship_patterns: z
    .string()
    .max(800)
    .describe('Patterns in professional relationships and network (e.g., frequently contacted by recruiters, vendors, colleagues)'),
  common_request_types: z
    .array(z.string())
    .max(12)
    .describe('Common types of requests or topics people contact the user about'),
  notable_observations: z
    .string()
    .max(1000)
    .describe('Any other notable patterns or observations about the user based on incoming emails'),
});

interface ReceivedEmailsInsights {
  professional_context: string;
  expertise_areas: string[];
  relationship_patterns: string;
  common_request_types: string[];
  notable_observations: string;
}

/**
 * Analyze unreplied received emails to extract insights about the user
 * Uses flash-lite to understand patterns in who contacts them and why
 */
async function analyzeReceivedEmailsForProfile(
  receivedEmails: Array<{ from: string; subject: string; body: string; snippet: string; date: Date }>,
  abortSignal?: AbortSignal,
): Promise<ReceivedEmailsInsights | null> {
  if (receivedEmails.length === 0) {
    logger.info('[ProfileGenerator] No received emails to analyze')
    return null;
  }

  logger.info(`[ProfileGenerator] Analyzing ${receivedEmails.length} unreplied received emails...`)

  // Format emails for analysis (truncate bodies, sort by date)
  const sortedEmails = [...receivedEmails]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 300); // Hard limit to 300 most recent

  const formattedEmails = sortedEmails
    .map((email, idx) => {
      const truncatedBody = email.body.substring(0, 500); // Limit body length
      const dateStr = email.date.toISOString().split('T')[0]; // YYYY-MM-DD
      return `[Email ${idx + 1}] Date: ${dateStr}
From: ${email.from}
Subject: ${email.subject}
Body excerpt: ${truncatedBody}...`;
    })
    .join('\n\n---\n\n');

  const systemPrompt = readPromptFile('supermemory/receivedEmailsAnalysisSystemPrompt.md');
  const userPromptTemplate = readPromptFile('supermemory/receivedEmailsAnalysisUserPrompt.md');
  const userPrompt = userPromptTemplate.replace('{formattedEmails}', formattedEmails);

  try {
    const { object } = await callObject<ReceivedEmailsInsights>({
      model: models.flashLite(), // Use fast, cheap model for analysis
      system: systemPrompt,
      prompt: userPrompt,
      schema: ReceivedEmailsInsightsSchema,
      temperature: 0.3,
      providerOptions: { google: { thinkingConfig: { thinkingLevel: 'medium' } } },
      op: 'supermemory.profile.analyze-received',
      concurrency: { key: 'supermemory.profile', maxConcurrency: 3 },
      retry: { maxAttempts: 2 },
      abortSignal,
    });

    // Truncate fields if they exceed limits (defensive checks)
    if (object.relationship_patterns.length > 800) {
      logger.warn(
        `[ProfileGenerator] relationship_patterns exceeded 800 chars (${object.relationship_patterns.length}), truncating`,
      );
      object.relationship_patterns = object.relationship_patterns.substring(0, 797) + '...';
    }
    if (object.notable_observations.length > 1000) {
      logger.warn(
        `[ProfileGenerator] notable_observations exceeded 1000 chars (${object.notable_observations.length}), truncating`,
      );
      object.notable_observations = object.notable_observations.substring(0, 997) + '...';
    }
    if (object.common_request_types.length > 12) {
      logger.warn(
        `[ProfileGenerator] common_request_types exceeded 12 items (${object.common_request_types.length}), truncating`,
      );
      object.common_request_types = object.common_request_types.slice(0, 12);
    }
    if (object.expertise_areas.length > 12) {
      logger.warn(
        `[ProfileGenerator] expertise_areas exceeded 12 items (${object.expertise_areas.length}), truncating`,
      );
      object.expertise_areas = object.expertise_areas.slice(0, 12);
    }

    logger.info('[ProfileGenerator] ✅ Received emails analyzed successfully')
    return object;
  } catch (error) {
    // Check if it's a validation error we can fix
    if (
      error &&
      typeof error === 'object' &&
      'cause' in error &&
      error.cause &&
      typeof error.cause === 'object' &&
      'issues' in error.cause &&
      Array.isArray((error.cause as { issues: unknown[] }).issues) &&
      'value' in error &&
      typeof error.value === 'object' &&
      error.value !== null
    ) {
      const zodError = error.cause as {
        issues: Array<{ path: string[]; code: string; maximum?: number }>;
      };
      const rawValue = error.value as Partial<ReceivedEmailsInsights>;

      // Try to fix all validation issues
      const fixed = { ...rawValue } as Partial<ReceivedEmailsInsights>;
      let needsFix = false;

      for (const issue of zodError.issues) {
        if (issue.code === 'too_big' && issue.path.length > 0) {
          const field = issue.path[0] as keyof ReceivedEmailsInsights;
          const maxLength = issue.maximum || 0;

          if (field === 'relationship_patterns' && typeof fixed.relationship_patterns === 'string') {
            if (fixed.relationship_patterns.length > maxLength) {
              fixed.relationship_patterns = fixed.relationship_patterns.substring(0, maxLength - 3) + '...';
              needsFix = true;
              logger.warn(
                `[ProfileGenerator] relationship_patterns exceeded ${maxLength} chars (${rawValue.relationship_patterns?.length}), truncating`,
              );
            }
          } else if (field === 'notable_observations' && typeof fixed.notable_observations === 'string') {
            if (fixed.notable_observations.length > maxLength) {
              fixed.notable_observations = fixed.notable_observations.substring(0, maxLength - 3) + '...';
              needsFix = true;
              logger.warn(
                `[ProfileGenerator] notable_observations exceeded ${maxLength} chars (${rawValue.notable_observations?.length}), truncating`,
              );
            }
          }
        } else if (issue.code === 'too_big' && issue.path[0] === 'common_request_types') {
          if (Array.isArray(fixed.common_request_types) && fixed.common_request_types.length > (issue.maximum || 8)) {
            fixed.common_request_types = fixed.common_request_types.slice(0, issue.maximum || 8);
            needsFix = true;
            logger.warn(
              `[ProfileGenerator] common_request_types exceeded ${issue.maximum || 8} items (${rawValue.common_request_types?.length}), truncating array`,
            );
          }
        }
      }

      if (needsFix) {
        try {
          // Validate the fixed object
          const validated = ReceivedEmailsInsightsSchema.parse(fixed);
          logger.info('[ProfileGenerator] ✅ Received emails analyzed successfully (after validation fixes)');
          return validated;
        } catch (parseError) {
          logger.warn('[ProfileGenerator] Fixed object still failed validation, falling back:', parseError);
        }
      }
    }

    logger.error('[ProfileGenerator] Failed to analyze received emails:', error);
    // If validation fails, continue without received email insights
    // The profile can still be generated from sent emails and episodes
    return null;
  }
}

// ============================================================================
// Main Generator Function
// ============================================================================

/**
 * Generate a user profile bootstrap document for Supermemory
 *
 * @param userEmail - The user's email address
 * @param sentEmailBodies - Array of sent email bodies to extract sign-off names from
 * @param fromHeaders - Array of "From" headers from sent emails
 * @param episodeSamples - Sample of thread episode summaries (already generated)
 * @param unrepliedReceivedEmails - Array of unreplied received emails for context analysis
 * @param abortSignal - Optional abort signal
 * @returns The user profile content
 */
export async function generateUserProfileBootstrap(params: {
  userEmail: string;
  sentEmailBodies: string[];
  fromHeaders: string[];
  episodeSamples: ThreadEpisodeContent[];
  unrepliedReceivedEmails?: Array<{ from: string; subject: string; body: string; snippet: string; date: Date }>;
  abortSignal?: AbortSignal;
}): Promise<UserProfileBootstrapContent> {
  const startTime = Date.now();
  const { userEmail, sentEmailBodies, fromHeaders, episodeSamples, unrepliedReceivedEmails, abortSignal } = params;

  logger.info(`[ProfileGenerator] Generating user profile bootstrap for ${userEmail}`);

  // Extract names from email data
  const signoffNames = extractSignoffNames(sentEmailBodies);
  const fromDisplayNames = extractFromDisplayNames(fromHeaders);

  logger.debug(
    `[ProfileGenerator] Extracted ${signoffNames.length} sign-offs, ${fromDisplayNames.length} display names`,
  );

  // Step 1: Analyze unreplied received emails (if provided)
  let receivedEmailsInsights: ReceivedEmailsInsights | null = null;
  if (unrepliedReceivedEmails && unrepliedReceivedEmails.length > 0) {
    logger.info(`[ProfileGenerator] Step 1: Analyzing ${unrepliedReceivedEmails.length} unreplied received emails...`);
    receivedEmailsInsights = await analyzeReceivedEmailsForProfile(unrepliedReceivedEmails, abortSignal);
  } else {
    logger.info('[ProfileGenerator] No unreplied received emails provided, skipping analysis step');
  }

  // Step 2: Generate final profile combining all insights
  logger.info('[ProfileGenerator] Step 2: Generating final profile with all insights...');
  const prompt = buildUserPrompt(userEmail, signoffNames, fromDisplayNames, episodeSamples, receivedEmailsInsights);

  // Use the higher-quality model for profile generation (only 1 call per user)
  const { object } = await callObject<UserProfileBootstrapContent>({
    model: models.pro(), // Using pro model as per plan
    system: SYSTEM_PROMPT,
    prompt,
    schema: UserProfileBootstrapContentSchema,
    temperature: 0.3,
    op: 'supermemory.profile.generate',
    concurrency: { key: 'supermemory.profile', maxConcurrency: 3 },
    retry: { maxAttempts: 2 },
    abortSignal,
  });

  // Always set email_address to the known email with high confidence
  const profileContent: UserProfileBootstrapContent = {
    ...object,
    email_address: {
      value: userEmail,
      confidence: 1.0,
    },
  };

  // Filter out low-confidence fields (set to empty)
  const filteredProfile = filterLowConfidenceFields(profileContent);

  const duration = Date.now() - startTime;
  logger.info(`[ProfileGenerator] ✅ Profile generated in ${duration}ms`);

  return filteredProfile;
}

/**
 * Filter out fields with confidence below threshold
 */
function filterLowConfidenceFields(
  profile: UserProfileBootstrapContent,
  threshold: number = 0.6,
): UserProfileBootstrapContent {
  const filterField = (
    field: { value: string; confidence: number },
  ): { value: string; confidence: number } => {
    if (field.confidence < threshold) {
      return { value: '', confidence: 0 };
    }
    return field;
  };

  return {
    full_name: filterField(profile.full_name),
    preferred_name: filterField(profile.preferred_name),
    email_address: profile.email_address, // Always keep email
    common_signoff_name: filterField(profile.common_signoff_name),
    timezone_hint: filterField(profile.timezone_hint),
    role_or_company_hint: filterField(profile.role_or_company_hint),
    notes: profile.notes || '',
  };
}

/**
 * Validate that a user profile is suitable for ingestion
 */
export function validateProfileContent(profile: UserProfileBootstrapContent): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  // Must have at least the email address
  if (!profile.email_address.value || profile.email_address.value.trim().length === 0) {
    issues.push('email_address is required');
  }

  // Check for reasonable notes length
  if (profile.notes && profile.notes.length > 500) {
    issues.push(`notes exceeds limit (${profile.notes.length}/500)`);
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Convert profile content to Supermemory document content string
 */
export function profileContentToDocumentString(profile: UserProfileBootstrapContent): string {
  return JSON.stringify(profile, null, 2);
}
