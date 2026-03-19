import { z } from 'zod';
import { callObject } from '@/lib/ai/callLlm';
import { getGoogleThinkingProviderOptions, models } from '@/lib/ai/models';
import { logger } from '@/lib/logger';
import {
  CalendarCreatorLlmSchema,
  type CalendarCreatorPlanDTO,
} from '@/lib/ai/schemas/calendarCreatorSchemas';
import { buildCalendarCreatorPrompt, isTimeLow } from './context';
import { mapLlmOutputToPlan } from './normalize';
import type {
  AvailableCalendar,
  CalendarCreatorContext,
  CalendarCreatorCurrentTime,
  ResolvedCalendarEvent,
} from './types';

function createFallbackPlan(reason: string): CalendarCreatorPlanDTO {
  return {
    action: 'clarify',
    confidence: 0,
    requiresConfirmation: false,
    sendUpdates: 'none',
    createMeetLink: false,
    calendarId: 'primary',
    clarifyingQuestions: ['What should I do on your calendar?'],
    userPreviewText: `I couldn't process that calendar change cleanly (${reason}). What should I do on your calendar?`,
  };
}

function formatValidationIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join(' | ');
}

function isAbortLike(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || /deadline exceeded|aborted|abort/i.test(error.message))
  );
}

type RunCalendarCreatorDependencies = {
  currentTime: CalendarCreatorCurrentTime;
  availableCalendars?: AvailableCalendar[];
  resolvedEvents?: ResolvedCalendarEvent[];
  abortSignal?: AbortSignal;
  deadlineAt?: number;
};

export async function runCalendarCreatorAgent(
  params: { request: string },
  dependencies: RunCalendarCreatorDependencies,
): Promise<CalendarCreatorPlanDTO> {
  const context: CalendarCreatorContext = {
    request: params.request,
    currentTime: dependencies.currentTime,
    availableCalendars: dependencies.availableCalendars,
    resolvedEvents: dependencies.resolvedEvents,
    abortSignal: dependencies.abortSignal,
    deadlineAt: dependencies.deadlineAt,
  };

  if (isTimeLow(context.deadlineAt)) {
    logger.warn('[calendarCreatorAgent] Time budget low - returning fallback clarify plan');
    return createFallbackPlan('time budget low');
  }

  const prompt = buildCalendarCreatorPrompt(context);

  try {
    logger.info(`[calendarCreatorAgent] Planning calendar change for request: "${params.request}"`);

    const { object: rawPlan } = await callObject<z.infer<typeof CalendarCreatorLlmSchema>>({
      model: models.flash(),
      system:
        'You are a calendar mutation planning assistant. Return a JSON object that matches the required schema exactly. Never invent events. Break batch work into one item per independent calendar action. Do not write user-facing previews unless the schema asks for it.',
      prompt,
      schema: CalendarCreatorLlmSchema,
      temperature: 0.05,
      abortSignal: context.abortSignal,
      providerOptions: getGoogleThinkingProviderOptions('flash', {
        thinkingBudget: 0,
      }),
      op: 'calendar.creator.plan',
      concurrency: { key: 'calendar.creator.plan', maxConcurrency: 4 },
      retry: { maxAttempts: 2, baseDelayMs: 400 },
    });

    return mapLlmOutputToPlan(rawPlan, context);
  } catch (error) {
    if (isAbortLike(error)) {
      throw error;
    }

    if (error instanceof z.ZodError) {
      logger.warn(
        `[calendarCreatorAgent] Structured planning validation failed: ${formatValidationIssues(error)}`,
      );
      return createFallbackPlan('invalid plan structure');
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[calendarCreatorAgent] Planning failed: ${message}`);
    return createFallbackPlan(message);
  }
}

export type {
  AvailableCalendar,
  CalendarCreatorContext,
  CalendarCreatorCurrentTime,
  ResolvedCalendarEvent,
} from './types';
