import { z } from 'zod';
import { readPromptFile } from '@/lib/prompts';
import { callObject } from '@/lib/ai/callLlm';
import { models } from '@/lib/ai/models';
import { logger } from '@/lib/logger';
import {
  CalendarCreatorPlanSchema,
  CalendarCreatorLlmSchema,
  type CalendarCreatorPlanDTO,
} from '@/lib/ai/schemas/calendarCreatorSchemas';

// ─────────────────────────────────────────────────────────────────────────────
// Calendar Creator Subagent
//
// A specialized LLM that converts user requests into safe, confirm-before-execute
// calendar mutation plans (create/update/delete/clarify).
// ─────────────────────────────────────────────────────────────────────────────

export type AvailableCalendar = {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
};

export type CalendarCreatorContext = {
  request: string;
  currentTime: {
    utcNow: string;
    userTimezone: string;
    userLocalNow: string;
    dayOfWeek: string;
  };
  availableCalendars?: AvailableCalendar[];
  resolvedEvents?: Array<{
    eventId: string;
    calendarId: string;
    name: string;
    start: string;
    end: string;
  }>;
  abortSignal?: AbortSignal;
  deadlineAt?: number;
};

const EARLY_EXIT_BUFFER_MS = 3_000;

function isTimeLow(deadlineAt?: number, bufferMs = EARLY_EXIT_BUFFER_MS): boolean {
  return typeof deadlineAt === 'number' && deadlineAt - Date.now() < bufferMs;
}

function formatAvailableCalendars(calendars?: AvailableCalendar[]): string {
  if (!calendars || calendars.length === 0) {
    return '(No calendar list available — default to "primary")';
  }

  return calendars
    .map((cal) => {
      const primaryTag = cal.primary ? ' [PRIMARY]' : '';
      return `- id: "${cal.id}" | name: "${cal.summary}"${primaryTag}`;
    })
    .join('\n');
}

function formatResolvedEvents(
  events?: Array<{ eventId: string; calendarId: string; name: string; start: string; end: string }>,
): string {
  if (!events || events.length === 0) {
    return '(No pre-resolved events available)';
  }

  return events
    .map((event) => `- eventId: "${event.eventId}" | calendarId: "${event.calendarId}" | name: "${event.name}" | start: "${event.start}" | end: "${event.end}"`)
    .join('\n');
}

function buildCalendarCreatorPrompt(context: CalendarCreatorContext): string {
  const template = readPromptFile('core-processing/calendarCreatorPrompt.md');

  return template
    .replace('{utcNow}', context.currentTime.utcNow)
    .replace('{userTimezone}', context.currentTime.userTimezone)
    .replace('{userLocalNow}', context.currentTime.userLocalNow)
    .replace('{dayOfWeek}', context.currentTime.dayOfWeek)
    .replace('{userRequest}', context.request)
    .replace('{availableCalendars}', formatAvailableCalendars(context.availableCalendars))
    .replace('{resolvedEvents}', formatResolvedEvents(context.resolvedEvents));
}

function createFallbackPlan(reason: string): CalendarCreatorPlanDTO {
  return {
    action: 'clarify',
    confidence: 0,
    requiresConfirmation: false,
    sendUpdates: 'none',
    createMeetLink: false,
    calendarId: 'primary',
    clarifyingQuestions: ['What should I do on your calendar?'],
    userPreviewText: `I couldn't process that request (${reason}). What calendar change should I make?`,
  };
}

type LlmPlanOutput = z.infer<typeof CalendarCreatorLlmSchema>;

function formatValidationIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join(' | ');
}

function mapLlmOutputToPlan(raw: LlmPlanOutput): CalendarCreatorPlanDTO {
  const shared = {
    confidence: raw.confidence ?? 70,
    sendUpdates: raw.sendUpdates ?? 'none',
    createMeetLink: raw.createMeetLink ?? false,
    calendarId: raw.calendarId ?? 'primary',
    userPreviewText: raw.userPreviewText,
  };

  switch (raw.action) {
    case 'create': {
      const drafts = raw.createItems ?? [];
      if (drafts.length === 0) {
        return {
          action: 'clarify',
          confidence: shared.confidence,
          requiresConfirmation: false,
          sendUpdates: shared.sendUpdates,
          createMeetLink: shared.createMeetLink,
          calendarId: shared.calendarId,
          clarifyingQuestions: ['What event should I create?'],
          userPreviewText: 'I need the event details before I can create it.',
        };
      }

      return {
        action: 'create',
        requiresConfirmation: true,
        ...shared,
        ...(drafts.length === 1 ? { eventDraft: drafts[0] } : { eventDrafts: drafts }),
      };
    }
    case 'update': {
      const updates = raw.updateItems ?? [];
      if (updates.length === 0) {
        return {
          action: 'clarify',
          confidence: shared.confidence,
          requiresConfirmation: false,
          sendUpdates: shared.sendUpdates,
          createMeetLink: shared.createMeetLink,
          calendarId: shared.calendarId,
          clarifyingQuestions: ['Which event should I update, and what should change?'],
          userPreviewText: 'I need the exact event and changes before I can update it.',
        };
      }

      const targets = updates.map((item) => item.target);
      const drafts = updates.map((item) => item.eventDraft);

      if (updates.length === 1) {
        return {
          action: 'update',
          requiresConfirmation: true,
          ...shared,
          target: targets[0],
          eventDraft: drafts[0],
        };
      }

      return {
        action: 'update',
        requiresConfirmation: true,
        ...shared,
        targets,
        eventDrafts: drafts,
      };
    }
    case 'delete': {
      const targets = raw.deleteTargets ?? [];
      if (targets.length === 0) {
        return {
          action: 'clarify',
          confidence: shared.confidence,
          requiresConfirmation: false,
          sendUpdates: shared.sendUpdates,
          createMeetLink: shared.createMeetLink,
          calendarId: shared.calendarId,
          clarifyingQuestions: ['Which event should I delete?'],
          userPreviewText: 'I need to know which event to delete.',
        };
      }

      return {
        action: 'delete',
        requiresConfirmation: true,
        ...shared,
        ...(targets.length === 1 ? { target: targets[0] } : { targets }),
      };
    }
    case 'clarify': {
      const questions = raw.clarifyingQuestions?.length
        ? raw.clarifyingQuestions
        : ['What should I do on your calendar?'];
      return {
        action: 'clarify',
        requiresConfirmation: false,
        ...shared,
        clarifyingQuestions: questions,
      };
    }
  }
}

export async function runCalendarCreatorAgent(
  params: { request: string },
  dependencies: {
    currentTime: {
      utcNow: string;
      userTimezone: string;
      userLocalNow: string;
      dayOfWeek: string;
    };
    availableCalendars?: AvailableCalendar[];
    resolvedEvents?: Array<{
      eventId: string;
      calendarId: string;
      name: string;
      start: string;
      end: string;
    }>;
    abortSignal?: AbortSignal;
    deadlineAt?: number;
  },
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

    // Use the canonical flat LLM schema (createItems/updateItems/deleteTargets).
    const { object: rawPlan } = await callObject<LlmPlanOutput>({
      model: models.flash(),
      system:
        'You are a calendar mutation planning assistant. Return a JSON object that matches the required schema exactly. Never invent events. Use canonical payload keys: createItems for create, updateItems for update, deleteTargets for delete, clarifyingQuestions for clarify.',
      prompt,
      schema: CalendarCreatorLlmSchema,
      temperature: 0.15,
      abortSignal: context.abortSignal,
      op: 'calendar.creator',
      concurrency: { key: 'calendar.creator', maxConcurrency: 4 },
      retry: { maxAttempts: 2, baseDelayMs: 500 },
    });

    // Deterministic canonical→plan mapping, then strict validation.
    const mappedPlan = mapLlmOutputToPlan(rawPlan);
    const validated = CalendarCreatorPlanSchema.safeParse(mappedPlan);
    if (!validated.success) {
      const diagnostics = {
        action: rawPlan.action,
        createItems: rawPlan.createItems?.length ?? 0,
        updateItems: rawPlan.updateItems?.length ?? 0,
        deleteTargets: rawPlan.deleteTargets?.length ?? 0,
        clarifyingQuestions: rawPlan.clarifyingQuestions?.length ?? 0,
      };
      logger.warn(
        `[calendarCreatorAgent] Plan validation failed after canonical mapping: ${formatValidationIssues(validated.error)} | diagnostics=${JSON.stringify(diagnostics)}`,
      );
      return createFallbackPlan('invalid plan structure');
    }

    return validated.data;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[calendarCreatorAgent] Planning failed: ${message}`);
    return createFallbackPlan(message);
  }
}
