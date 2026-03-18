import { z } from 'zod';

export const CALENDAR_CREATOR_MAX_ITEMS = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Calendar Creator Subagent Schemas
//
// The Calendar Creator Subagent converts natural language requests into
// structured, confirm-before-execute calendar mutation plans.
// ─────────────────────────────────────────────────────────────────────────────

const CalendarDateSchema = z
  .object({
    date: z.string().describe('All-day date in YYYY-MM-DD format'),
  })
  .strict();

const CalendarDateTimeSchema = z
  .object({
    dateTime: z.string().describe('ISO date-time string (e.g., 2026-01-20T14:00:00)'),
    timeZone: z.string().describe('IANA timezone (e.g., America/Los_Angeles)'),
  })
  .strict();

export const CalendarEventTimeSchema = z.union([CalendarDateSchema, CalendarDateTimeSchema]);

export const CalendarAttendeeSchema = z
  .object({
    email: z.string().email(),
    displayName: z.string().optional(),
  })
  .strict();

// Allow up to 365 days (525600 min). Google Calendar accepts reminder minutes in this range.
const CALENDAR_REMINDER_MAX_MINUTES = 525_600;

const CalendarReminderOverrideSchema = z
  .object({
    method: z.enum(['email', 'popup']),
    minutes: z.number().int().min(0).max(CALENDAR_REMINDER_MAX_MINUTES),
  })
  .strict();

// Google Calendar API allows at most 5 reminder overrides per event.
export const CALENDAR_REMINDER_MAX_OVERRIDES = 5;

const CalendarRemindersSchema = z
  .object({
    useDefault: z.boolean(),
    overrides: z
      .array(CalendarReminderOverrideSchema)
      .max(CALENDAR_REMINDER_MAX_OVERRIDES)
      .optional(),
  })
  .strict();

export const CalendarEventDraftSchema = z
  .object({
    summary: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    location: z.string().max(300).optional(),
    start: CalendarEventTimeSchema.optional(),
    end: CalendarEventTimeSchema.optional(),
    attendees: z.array(CalendarAttendeeSchema).optional(),
    recurrence: z.array(z.string()).optional(),
    reminders: CalendarRemindersSchema.optional(),
    visibility: z.enum(['default', 'public', 'private']).optional(),
    transparency: z.enum(['opaque', 'transparent']).optional(),
    colorId: z.string().optional(),
    guestsCanModify: z.boolean().optional(),
    guestsCanInviteOthers: z.boolean().optional(),
    guestsCanSeeOtherGuests: z.boolean().optional(),
  })
  .strict();

const CalendarDestinationCalendarIdSchema = z
  .string()
  .min(1)
  .describe(
    'Destination calendar ID for moving an existing event to another calendar. ' +
      'Use this only for calendar moves. Never encode calendar names in location or description.',
  );

const CalendarCreateEventDraftSchema = CalendarEventDraftSchema.extend({
  summary: z.string().min(1).max(200),
  start: CalendarEventTimeSchema,
  end: CalendarEventTimeSchema,
  calendarId: z
    .string()
    .optional()
    .describe(
      'Target calendar ID for this event. Overrides plan-level calendarId. ' +
      'Use this when creating multiple events that belong in different calendars.',
    ),
}).strict();

const CalendarEventPatchSchema = CalendarEventDraftSchema;

const CalendarEventDraftsSchema = z
  .array(CalendarCreateEventDraftSchema)
  .min(1)
  .max(CALENDAR_CREATOR_MAX_ITEMS);

const CalendarTargetByIdSchema = z
  .object({
    calendarId: z.string().optional(),
    eventId: z.string().min(1),
  })
  .strict();

const CalendarLookupRangeSchema = z
  .object({
    startDate: z.string().describe('ISO start date or date-time'),
    endDate: z.string().describe('ISO end date or date-time'),
  })
  .strict();

const CalendarTargetLookupSchema = z
  .object({
    lookupQuery: z.string().min(1).max(400),
    lookupRange: CalendarLookupRangeSchema.optional(),
  })
  .strict();

export const CalendarTargetSchema = z.union([CalendarTargetByIdSchema, CalendarTargetLookupSchema]);
const CalendarTargetsSchema = z
  .array(CalendarTargetSchema)
  .min(1)
  .max(CALENDAR_CREATOR_MAX_ITEMS);
const CalendarEventPatchesSchema = z
  .array(CalendarEventPatchSchema)
  .min(1)
  .max(CALENDAR_CREATOR_MAX_ITEMS);

const CalendarCreatorPlanShared = {
  confidence: z.number().min(0).max(100),
  sendUpdates: z.enum(['none', 'all', 'externalOnly']).default('none'),
  createMeetLink: z.boolean().default(false),
  calendarId: z.string().optional().default('primary'),
  userPreviewText: z.string().min(1).max(1200),
};

const CalendarCreatorCreatePlanSchema = z
  .object({
    action: z.literal('create'),
    requiresConfirmation: z.boolean().default(true),
    eventDraft: CalendarCreateEventDraftSchema.optional(),
    eventDrafts: CalendarEventDraftsSchema.optional(),
    target: z.never().optional(),
    targets: z.never().optional(),
    clarifyingQuestions: z.never().optional(),
    ...CalendarCreatorPlanShared,
  })
  .strict();

const CalendarCreatorUpdatePlanSchema = z
  .object({
    action: z.literal('update'),
    requiresConfirmation: z.boolean().default(true),
    target: CalendarTargetSchema.optional(),
    targets: CalendarTargetsSchema.optional(),
    eventDraft: CalendarEventPatchSchema.optional(),
    eventDrafts: CalendarEventPatchesSchema.optional(),
    destinationCalendarId: CalendarDestinationCalendarIdSchema.optional(),
    destinationCalendarIds: z
      .array(CalendarDestinationCalendarIdSchema.optional())
      .min(1)
      .max(CALENDAR_CREATOR_MAX_ITEMS)
      .optional(),
    clarifyingQuestions: z.never().optional(),
    ...CalendarCreatorPlanShared,
  })
  .strict();

const CalendarCreatorDeletePlanSchema = z
  .object({
    action: z.literal('delete'),
    requiresConfirmation: z.boolean().default(true),
    target: CalendarTargetSchema.optional(),
    targets: CalendarTargetsSchema.optional(),
    eventDraft: z.never().optional(),
    eventDrafts: z.never().optional(),
    clarifyingQuestions: z.never().optional(),
    ...CalendarCreatorPlanShared,
  })
  .strict();

const CalendarCreatorClarifyPlanSchema = z
  .object({
    action: z.literal('clarify'),
    requiresConfirmation: z.boolean().default(false),
    clarifyingQuestions: z.array(z.string().min(1).max(200)).min(1).max(3),
    target: z.never().optional(),
    targets: z.never().optional(),
    eventDraft: z.never().optional(),
    eventDrafts: z.never().optional(),
    ...CalendarCreatorPlanShared,
  })
  .strict();

export const CalendarCreatorPlanBaseSchema = z.discriminatedUnion('action', [
  CalendarCreatorCreatePlanSchema,
  CalendarCreatorUpdatePlanSchema,
  CalendarCreatorDeletePlanSchema,
  CalendarCreatorClarifyPlanSchema,
]);

export const CalendarCreatorPlanSchema = CalendarCreatorPlanBaseSchema.superRefine((value, ctx) => {
  if (value.action === 'create') {
    const hasSingleDraft = value.eventDraft !== undefined;
    const hasBatchDrafts = value.eventDrafts !== undefined;

    if (hasSingleDraft && hasBatchDrafts) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Create actions must provide only one of eventDraft or eventDrafts.',
        path: ['eventDrafts'],
      });
      return;
    }

    if (!hasSingleDraft && !hasBatchDrafts) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Create actions require eventDraft or eventDrafts.',
        path: ['eventDraft'],
      });
      return;
    }
  }

  if (value.action === 'update') {
    const hasSingleTarget = value.target !== undefined;
    const hasBatchTargets = value.targets !== undefined;
    const hasSingleDraft = value.eventDraft !== undefined;
    const hasBatchDrafts = value.eventDrafts !== undefined;
    const hasMeaningfulPatch = (draft: z.infer<typeof CalendarEventPatchSchema> | undefined) => {
      if (!draft) {
        return false;
      }

      return Object.values(draft).some((fieldValue) => fieldValue !== undefined);
    };

    if (hasSingleTarget === hasBatchTargets) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Update actions must provide exactly one of target or targets.',
        path: ['target'],
      });
    }

    if (hasSingleDraft === hasBatchDrafts) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Update actions must provide exactly one of eventDraft or eventDrafts.',
        path: ['eventDraft'],
      });
    }

    if (hasBatchTargets && hasBatchDrafts) {
      if (value.targets!.length !== value.eventDrafts!.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Batch update requires targets and eventDrafts arrays of equal length.',
          path: ['eventDrafts'],
        });
      }
    }

    if (hasSingleTarget && value.destinationCalendarIds !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Single-target update must not provide destinationCalendarIds.',
        path: ['destinationCalendarIds'],
      });
    }

    if (hasBatchTargets && value.destinationCalendarId !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Batch update must not provide destinationCalendarId.',
        path: ['destinationCalendarId'],
      });
    }

    if (
      hasBatchTargets &&
      value.destinationCalendarIds !== undefined &&
      value.destinationCalendarIds.length !== value.targets!.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Batch update requires destinationCalendarIds to match targets length when provided.',
        path: ['destinationCalendarIds'],
      });
    }

    if ((hasSingleTarget && hasBatchDrafts) || (hasBatchTargets && hasSingleDraft)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Do not mix single-target and batch update fields.',
        path: ['targets'],
      });
    }

    if (hasSingleTarget) {
      const hasDestination = value.destinationCalendarId !== undefined;
      if (!hasMeaningfulPatch(value.eventDraft) && !hasDestination && !value.createMeetLink) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Update actions require event changes, a destination calendar move, or createMeetLink.',
          path: ['eventDraft'],
        });
      }
    }

    if (hasBatchTargets) {
      const drafts = value.eventDrafts ?? [];
      const destinations = value.destinationCalendarIds ?? [];

      value.targets!.forEach((_, index) => {
        const hasDestination = destinations[index] !== undefined;
        if (!hasMeaningfulPatch(drafts[index]) && !hasDestination && !value.createMeetLink) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'Each batch update item requires event changes, a destination calendar move, or createMeetLink.',
            path: ['eventDrafts', index],
          });
        }
      });
    }
  }

  if (value.action === 'delete') {
    const hasSingleTarget = value.target !== undefined;
    const hasBatchTargets = value.targets !== undefined;

    if (hasSingleTarget === hasBatchTargets) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Delete actions must provide exactly one of target or targets.',
        path: ['target'],
      });
    }
  }

  if (value.action === 'clarify' && value.requiresConfirmation !== false) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Clarify actions must set requiresConfirmation=false.',
      path: ['requiresConfirmation'],
    });
    return;
  }

  if (value.action !== 'clarify' && value.requiresConfirmation !== true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Mutation actions must set requiresConfirmation=true.',
      path: ['requiresConfirmation'],
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Flat LLM Schema
//
// A simplified, single-object schema for Gemini structured output.
// The discriminated union above produces JSON Schema with oneOf + { "not": {} }
// + additionalProperties:false, which causes Gemini to hang during constrained
// decoding. This flat schema keeps one canonical payload shape per action.
//
// Canonical action payloads:
// - create  -> createItems[]
// - update  -> updateItems[{ target, eventDraft }]
// - delete  -> deleteTargets[]
// - clarify -> clarifyingQuestions[]
//
// The agent deterministically maps this canonical shape into the strict
// CalendarCreatorPlanSchema (single vs batch variants) after generation.
// ─────────────────────────────────────────────────────────────────────────────

const CalendarLlmUpdateItemSchema = z
  .object({
    target: CalendarTargetSchema,
    eventDraft: CalendarEventPatchSchema,
    destinationCalendarId: CalendarDestinationCalendarIdSchema.optional(),
  })
  .strict();

// Allow min(0) for action arrays so model output that includes empty "other action"
// keys (e.g. updateItems: [] for action create) still validates; mapping ignores them.
export const CalendarCreatorLlmSchema = z
  .object({
    action: z.enum(['create', 'update', 'delete', 'clarify']),
    confidence: z.number().min(0).max(100).optional(),
    sendUpdates: z.enum(['none', 'all', 'externalOnly']).optional(),
    createMeetLink: z.boolean().optional(),
    calendarId: z.string().optional(),
    userPreviewText: z.string().min(1).max(1200).optional(),
    createItems: z
      .array(CalendarCreateEventDraftSchema)
      .min(0)
      .max(CALENDAR_CREATOR_MAX_ITEMS)
      .optional(),
    updateItems: z
      .array(CalendarLlmUpdateItemSchema)
      .min(0)
      .max(CALENDAR_CREATOR_MAX_ITEMS)
      .optional(),
    deleteTargets: z
      .array(CalendarTargetSchema)
      .min(0)
      .max(CALENDAR_CREATOR_MAX_ITEMS)
      .optional(),
    clarifyingQuestions: z.array(z.string().min(1).max(200)).min(0).max(3).optional(),
  })
  .strict();

export type CalendarEventDraftDTO = z.infer<typeof CalendarEventDraftSchema>;
export type CalendarCreatorPlanDTO = z.infer<typeof CalendarCreatorPlanSchema>;
export type CalendarTargetDTO = z.infer<typeof CalendarTargetSchema>;
