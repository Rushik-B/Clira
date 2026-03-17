import { z } from 'zod';
export {
  CalendarCreatorPlanBaseSchema,
  CalendarCreatorPlanSchema,
  type CalendarCreatorPlanDTO,
  CalendarEventDraftSchema,
  type CalendarEventDraftDTO,
  CalendarEventTimeSchema,
  type CalendarTargetDTO,
} from '@/lib/ai/schemas/calendarCreatorSchemas';

// Phase 0: foundational schemas derived from existing types.

export const IncomingEmailScannerOutputSchema = z.object({
  needsCalendarCheck: z.boolean().describe('Whether this email requires calendar data to respond properly'),
  calendarParameters: z
    .object({
      dateHint: z.string().optional().describe('Suggested date or time frame for calendar lookup'),
      durationHint: z.string().optional().describe('Expected duration or meeting length'),
      attendees: z.array(z.string()).optional().describe('Email addresses of potential meeting attendees'),
    })
    .optional()
    .describe('Calendar-specific parameters needed for scheduling requests'),
  emailContextQuery: z.object({
    keywords: z.array(z.string()).optional().describe('Key terms to search for in email history'),
    senderFilter: z.array(z.string()).optional().describe('Email addresses to focus search on'),
    dateWindowHint: z.string().optional().describe('Time period for relevant email context (recent, last_week, etc.)'),
    hasAttachment: z.boolean().optional().describe('Whether to look for emails with attachments'),
    maxResults: z.number().optional().describe('Maximum number of relevant emails to retrieve'),
  }).describe('Parameters for finding relevant email context'),
  urgencyLevel: z.enum(['low', 'medium', 'high']).describe('How urgently this email needs a response'),
  primaryIntent: z.enum([
    'scheduling',
    'information_request',
    'problem_report',
    'status_update',
    'follow_up',
    'other',
  ]).describe('The main purpose or intent of the incoming email'),
  reasoning: z.string().describe('Brief explanation of the analysis and why these parameters were chosen'),
});

// Export DTO types inferred from schemas for safer interop with app-level types
export type IncomingEmailScannerOutputDTO = z.infer<typeof IncomingEmailScannerOutputSchema>;

export const ReplyGenerationResultSchema = z.object({
  reply: z.string().min(1).max(4000).describe('The complete email reply text, ready to send'),
  confidence: z.number().min(0).max(100).describe('Confidence level (0-100) in the quality and appropriateness of this reply'),
  reasoning: z.string().max(500).describe('Brief explanation of key factors considered in generating this reply'),
  ccRecipients: z.array(z.string().email()).optional().describe('Additional email addresses that should be CC\'d on this reply'),
});

export type ReplyGenerationResultDTO = z.infer<typeof ReplyGenerationResultSchema>;

/**
 * Stage 1 (Gatekeeper): Router decision for whether a reply draft should be generated.
 *
 * Note: This is NOT folder/label routing; it's "reply eligibility" routing.
 */
export const ReplyRouterDecisionSchema = z.object({
  shouldReply: z
    .boolean()
    .describe('Whether the email should receive an AI-drafted reply (true) or be skipped (false)'),
  reason: z
    .string()
    .min(1)
    .max(500)
    .describe('Concise explanation for the decision, suitable for logs/debug'),
  shouldNotify: z
    .boolean()
    .default(false)
    .describe('True if email matches any user alert rule'),
  matchedAlertId: z
    .string()
    .optional()
    .describe('ID of matched alert'),
  matchedAlertDescription: z
    .string()
    .optional()
    .describe('Description of matched alert'),
});

export type ReplyRouterDecisionDTO = z.infer<typeof ReplyRouterDecisionSchema>;

/**
 * Stage 2 (Planner): produce a structured reply plan (facts + requirements + rough draft)
 * that downstream style/voice layers can rewrite without introducing new facts.
 */
export const ReplyPlanSchema = z.object({
  // Critical for debugging & quality: model thinks here first, then submits a plan.
  thoughtProcess: z
    .string()
    .min(1)
    .max(4000)
    .describe('Step-by-step reasoning about what context/tools were needed and the reply angle.'),

  mustAddress: z
    .array(z.string().min(1).max(300))
    .default([])
    .describe('Bullet points of what the reply must cover.'),

  factsToPreserve: z
    .array(
      z.object({
        fact: z.string().min(1).max(500),
        source: z.enum(['thread', 'email', 'memory', 'calendar']),
        confidence: z.number().min(0).max(100),
      }),
    )
    .default([])
    .describe('Critical facts/names/dates/numbers that must be preserved in the final reply.'),

  recommendedTone: z
    .object({
      label: z.string().min(1).max(120),
      constraints: z.string().max(300).optional(),
    })
    .describe('Suggested tone for the eventual reply.'),

  ccSuggestions: z
    .array(
      z.object({
        email: z.string().email(),
        reason: z.string().min(1).max(200),
      }),
    )
    .describe('CC suggestions with rationale.'),

  draft: z
    .string()
    .max(6000)
    .optional()
    .describe('Rough content draft (not styled). Must not add facts not supported by tools/email.'),

  toolUsage: z
    .object({
      calendarUsed: z.boolean(),
      threadUsed: z.boolean(),
      directEmailHistoryUsed: z.boolean(),
      keywordEmailSearchUsed: z.boolean(),
      memorySearchUsed: z.boolean(),
    })
    .optional()
    .default({
      calendarUsed: false,
      threadUsed: false,
      directEmailHistoryUsed: false,
      keywordEmailSearchUsed: false,
      memorySearchUsed: false,
    })
    .describe('Telemetry: which tools were actually used during planning.'),
});

export type ReplyPlanDTO = z.infer<typeof ReplyPlanSchema>;

export const EmailMappingResultSchema = z.object({
  mappingSuggestions: z
    .array(
      z.object({
        email: z.string(),
        suggestedFolderId: z.string().optional(),
        suggestedFolderName: z.string(),
        confidence: z.number(),
        reasoning: z.string(),
        mappingType: z.enum(['EMAIL', 'DOMAIN']).optional(),
        priority: z.enum(['high', 'medium', 'low']).optional(),
        alternativeOptions: z
          .array(
            z.object({
              folderId: z.string(),
              folderName: z.string(),
              confidence: z.number(),
              reasoning: z.string(),
            }),
          )
          .optional(),
      }),
    )
    .default([]),
  bulkMappingOpportunities: z
    .array(
      z.object({
        pattern: z.string(),
        suggestedFolderId: z.string().optional(),
        suggestedFolderName: z.string(),
        confidence: z.number(),
        reasoning: z.string(),
        affectedEmails: z.array(z.string()).default([]),
        mappingType: z.enum(['EMAIL', 'DOMAIN']).optional(),
      }),
    )
    .default([]),
  unmappedEmails: z
    .array(
      z.object({
        email: z.string(),
        reasoning: z.string(),
        suggestedAction: z.string(),
      }),
    )
    .default([]),
  overallStats: z.object({
    totalEmailsAnalyzed: z.number(),
    highConfidenceMappings: z.number(),
    mediumConfidenceMappings: z.number(),
    lowConfidenceMappings: z.number(),
    unmappedCount: z.number(),
  }),
});

// Simplified per-email mapping schema for improved accuracy
export const PerEmailMappingResultSchema = z.object({
  assignments: z
    .array(
      z.object({
        id: z.string().describe('Email message ID for precise identification'),
        folderId: z.string().describe('Target folder ID for this specific email'),
        confidence: z.number().min(0).max(100).describe('Confidence level in this assignment (0-100)'),
        reason: z.string().max(150).describe('Brief reasoning for this folder assignment'),
      }),
    )
    .describe('List of email-to-folder assignments with unique email IDs'),
  unassigned: z
    .array(z.string())
    .describe('Email IDs that could not be confidently assigned to any folder')
    .default([]),
});

export type PerEmailMappingResultDTO = z.infer<typeof PerEmailMappingResultSchema>;

export const FolderGenerationResultSchema = z.object({
  suggestedFolders: z.array(
    z.object({
      name: z.string().max(50).describe('Short, descriptive folder name'),
      description: z.string().max(200).describe('Clear explanation of what emails belong in this folder'),
      metaPrompt: z.string().max(300).describe('Detailed criteria for automatically categorizing emails into this folder'),
      // Color policy: use only main palette; keep hex for UI while allowing LLM to also provide a colorName
      color: z.string().describe('Hex color code for folder UI (e.g., #3B82F6). Must map to allowed main colors.'),
      colorName: z
        .enum(['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'])
        .optional()
        .describe('Name of the main color selected for this folder'),
      importance: z
        .enum(['high', 'medium', 'low'])
        .optional()
        .describe('Relative importance of this folder to the user'),
      icon: z.string().describe('Single emoji representing this folder type'),
      confidence: z.number().min(0).max(100).describe('Confidence that this folder will be useful (0-100)'),
      reasoning: z.string().max(300).describe('Why this folder was suggested based on email patterns'),
      exampleSenders: z.array(z.string()).default([]).describe('Example email addresses that would use this folder'),
      keywordPatterns: z.array(z.string()).default([]).describe('Key terms commonly found in emails for this folder'),
    }),
  ).describe('List of suggested email folders based on usage patterns'),
  overallAnalysis: z.object({
    totalEmailsAnalyzed: z.number().describe('Number of emails analyzed for this suggestion'),
    primaryEmailTypes: z.array(z.string()).describe('Main categories of emails found in the analysis'),
    recommendedApproach: z.string().max(200).describe('Suggested strategy for organizing these emails'),
  }).describe('Summary analysis of email patterns'),
  reasoning: z.string().max(600).describe('Overall explanation of the folder generation approach'),
});

// Re-export calendar analysis schemas for convenience
export {
  CalendarAnalysisResultSchema,
  CalendarAnalysisInputSchema,
  FreeSlotSchema,
  ConflictInfoSchema,
  type CalendarAnalysisResultDTO,
  type CalendarAnalysisInputDTO,
  type FreeSlotDTO,
  type ConflictInfoDTO,
} from '@/lib/ai/schemas/calendarAnalysisSchemas';

// Re-export label analysis schemas for convenience
export {
  LabelAnalysisResultSchema,
  LabelAnalysisInputSchema,
  AvailableLabelSchema,
  CurrentLabelSchema,
  type LabelAnalysisResultDTO,
  type LabelAnalysisInputDTO,
  type AvailableLabelDTO,
  type CurrentLabelDTO,
} from '@/lib/ai/schemas/labelAnalysisSchemas';

// Re-export calendar search schemas for convenience
export {
  CalendarSearchResultSchema,
  CalendarSearchInputSchema,
  MatchedEventSchema,
  type CalendarSearchResultDTO,
  type CalendarSearchInputDTO,
  type MatchedEventDTO,
} from '@/lib/ai/schemas/calendarSearchSchemas';
