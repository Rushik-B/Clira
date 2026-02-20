import { readPromptFile } from '@/lib/prompts';
import { callObject } from '@/lib/ai/callLlm';
import { models } from '@/lib/ai/models';
import { logger } from '@/lib/logger';
import {
  LabelAnalysisResultSchema,
  type LabelAnalysisResultDTO,
  type LabelAnalysisInputDTO,
  type LabelAnalysisDependencies,
  type AvailableLabelDTO,
} from '@/lib/ai/schemas/labelAnalysisSchemas';

// ─────────────────────────────────────────────────────────────────────────────
// Label Analysis Subagent
//
// A specialized LLM that analyzes email content and recommends custom labels
// to apply based on each label's metaPrompt criteria.
//
// Benefits:
// 1. Offloads label classification from Planner (reduces context bloat)
// 2. Specialized prompt for label matching (higher accuracy)
// 3. Compresses label analysis into a single label selection
// 4. Planner receives a compact label decision for logs/debugging
//
// Safety Features:
// - Append-only (never removes existing labels)
// - Autonomy level gating at tool layer
// ─────────────────────────────────────────────────────────────────────────────

const NONE_LABEL = '(none)';

/**
 * Context passed to the Label Analysis Subagent.
 */
export type LabelAnalysisContext = {
  /** Input parameters from the Planner */
  params: LabelAnalysisInputDTO;

  /** Dependencies injected by the Planner */
  dependencies: LabelAnalysisDependencies;
};

/**
 * Builds the prompt for the Label Analysis Subagent by populating
 * the template with the provided context.
 */
function buildLabelAnalysisPrompt(
  context: LabelAnalysisContext,
  availableLabels: AvailableLabelDTO[],
): string {
  const template = readPromptFile('core-processing/labelAnalysisPrompt.md');

  // Format current labels as a readable list
  const currentLabelsText =
    context.dependencies.currentLabels.length > 0
      ? context.dependencies.currentLabels
          .map((label) => `- ${label.name} (${label.isSystemLabel ? 'System' : 'Custom'})`)
          .join('\n')
      : '(None)';

  // Format available labels as detailed list with metaPrompts
  const availableLabelsText =
    availableLabels.length > 0
      ? availableLabels
          .map(
            (label) =>
              `- ID: ${label.id}\n  Name: ${label.name}\n  Gmail ID: ${label.gmailLabelId}\n  Classification Criteria: ${label.metaPrompt}\n  Color: ${label.color || 'None'}`,
          )
          .join('\n\n')
      : '(No custom labels available)';

  return template
    .replace('{fromEmail}', context.dependencies.emailContext.from)
    .replace('{subject}', context.dependencies.emailContext.subject)
    .replace('{body}', context.dependencies.emailContext.body)
    .replace('{currentLabels}', currentLabelsText)
    .replace('{availableLabels}', availableLabelsText);
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase();
}

function resolveLabelSelection(
  selectedLabel: string,
  candidates: AvailableLabelDTO[],
): AvailableLabelDTO | null {
  const normalized = normalizeLabel(selectedLabel);
  if (
    normalized.length === 0 ||
    normalized === 'none' ||
    normalized === '(none)' ||
    normalized === 'n/a'
  ) {
    return null;
  }

  return (
    candidates.find((label) => {
      const name = normalizeLabel(label.name);
      const gmailId = normalizeLabel(label.gmailLabelId);
      const id = normalizeLabel(label.id);
      return normalized === name || normalized === gmailId || normalized === id;
    }) ?? null
  );
}

/**
 * Creates a fallback result when the subagent fails or cannot proceed.
 */
function createFallbackResult(reason: string): LabelAnalysisResultDTO {
  return {
    label: NONE_LABEL,
    reasoning: `Label analysis unavailable: ${reason}`,
  };
}

/**
 * Runs the core label analysis using the LLM.
 *
 * This function handles:
 * 1. Fast-fail paths (no labels, all already applied)
 * 2. LLM-based label classification
 * 3. Post-processing (resolve to a single valid label)
 *
 * @param context - The full context including email data and available labels
 * @returns Structured label analysis result
 */
async function analyzeLabelingForEmail(
  context: LabelAnalysisContext,
): Promise<LabelAnalysisResultDTO> {
  // Fast-path 1: No custom labels available
  if (context.dependencies.availableLabels.length === 0) {
    logger.info('[labelSubagent] No custom labels available for classification');
    return {
      label: NONE_LABEL,
      reasoning: 'No custom labels configured by user',
    };
  }

  // Fast-path 2: All candidate labels already applied
  const currentLabelIds = new Set(context.params.currentLabelIds);
  const candidateLabels = context.dependencies.availableLabels.filter(
    (label) => !currentLabelIds.has(label.gmailLabelId),
  );

  if (candidateLabels.length === 0) {
    logger.info('[labelSubagent] All relevant labels already applied to email');
    return {
      label: NONE_LABEL,
      reasoning: 'All relevant labels already applied to this email',
    };
  }

  // Build the prompt and call the LLM
  const prompt = buildLabelAnalysisPrompt(context, candidateLabels);

  try {
    logger.info(
      `[labelSubagent] Analyzing labels: ${candidateLabels.length} candidate labels, ` +
        `email from="${context.params.emailFrom}", subject="${context.params.emailSubject.slice(0, 50)}..."`,
    );

    const { object: result } = await callObject<LabelAnalysisResultDTO>({
      model: models.flash(),
      system:
        'You are an email label classification specialist. Analyze the email content and match it against available label criteria. Return structured JSON matching the required schema. Be selective and precise.',
      prompt,
      schema: LabelAnalysisResultSchema,
      temperature: 0.3, // Balanced temperature for consistent yet nuanced classification
      op: 'label.analysis',
      concurrency: { key: 'label.analysis', maxConcurrency: 4 },
      retry: { maxAttempts: 2, baseDelayMs: 500 },
    });

    const resolved = resolveLabelSelection(result.label, candidateLabels);

    if (!resolved) {
      logger.warn(`[labelSubagent] Model returned unknown label: "${result.label}"`);
      return {
        label: NONE_LABEL,
        reasoning: result.reasoning
          ? `No valid label selected. Model reasoning: ${result.reasoning}`
          : `No valid label selected. Model label="${result.label}"`,
      };
    }

    logger.info(
      `[labelSubagent] Analysis complete: label="${resolved.name}" gmailLabelId="${resolved.gmailLabelId}"`,
    );

    return {
      label: resolved.name,
      reasoning: result.reasoning,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[labelSubagent] Analysis failed: ${message}`);
    return createFallbackResult(message);
  }
}

/**
 * Main entry point for the Label Analysis Subagent.
 *
 * This is the simplified interface that the Planner calls. It handles:
 * 1. Context building from params and dependencies
 * 2. Running the analysis
 * 3. Returning structured results
 *
 * @param params - Parameters from the Planner's analyze_labels tool call
 * @param dependencies - Dependencies injected by the Planner
 * @returns Label analysis result with recommended labels
 */
export async function runLabelAnalysis(
  params: LabelAnalysisInputDTO,
  dependencies: LabelAnalysisDependencies,
): Promise<LabelAnalysisResultDTO> {
  const context: LabelAnalysisContext = {
    params,
    dependencies,
  };

  return analyzeLabelingForEmail(context);
}
