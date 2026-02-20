import { z } from 'zod';

/**
 * Label Analysis Schemas
 *
 * Type-safe schemas for the label classification subagent.
 * Follows the calendar analysis subagent pattern for consistency.
 */

// ============================================================================
// Input Schema - From Planner to Subagent
// ============================================================================

export const LabelAnalysisInputSchema = z.object({
  emailSubject: z.string().max(500),
  emailBody: z.string().max(4000),
  emailFrom: z.string(), // Not enforcing .email() to handle "Name <email>" format
  currentLabelIds: z.array(z.string()),
});

export type LabelAnalysisInputDTO = z.infer<typeof LabelAnalysisInputSchema>;

// ============================================================================
// Output Schema - From Subagent to Planner
// ============================================================================

export const LabelAnalysisResultSchema = z.object({
  label: z.string().max(120),
  reasoning: z.string().max(300).optional(),
  permissionDenied: z.boolean().optional(),
});

export type LabelAnalysisResultDTO = z.infer<typeof LabelAnalysisResultSchema>;

// ============================================================================
// Available Label (with metaPrompt)
// ============================================================================

export const AvailableLabelSchema = z.object({
  id: z.string(),
  gmailLabelId: z.string(),
  name: z.string(),
  metaPrompt: z.string(),
  color: z.string().optional(),
});

export type AvailableLabelDTO = z.infer<typeof AvailableLabelSchema>;

// ============================================================================
// Current Label on Email
// ============================================================================

export const CurrentLabelSchema = z.object({
  gmailLabelId: z.string(),
  name: z.string(),
  isSystemLabel: z.boolean(),
});

export type CurrentLabelDTO = z.infer<typeof CurrentLabelSchema>;

// ============================================================================
// Dependencies Injected by Planner
// ============================================================================

export const LabelAnalysisDependenciesSchema = z.object({
  availableLabels: z.array(AvailableLabelSchema),
  currentLabels: z.array(CurrentLabelSchema),
  emailContext: z.object({
    subject: z.string(),
    body: z.string().max(4000),
    from: z.string(),
  }),
});

export type LabelAnalysisDependencies = z.infer<typeof LabelAnalysisDependenciesSchema>;
