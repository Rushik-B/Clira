import { z } from 'zod';

export const CALENDAR_CREATOR_MAX_ITEMS = 100;

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

const CALENDAR_REMINDER_MAX_MINUTES = 525_600;

const CalendarReminderOverrideSchema = z
  .object({
    method: z.enum(['email', 'popup']),
    minutes: z.number().int().min(0).max(CALENDAR_REMINDER_MAX_MINUTES),
  })
  .strict();

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
  userPreviewText: z.string().min(1).max(2400),
};

export const CalendarMutationCreateOpSchema = z
  .object({
    kind: z.literal('create'),
    eventDraft: CalendarCreateEventDraftSchema,
    createMeetLink: z.boolean().optional(),
  })
  .strict();

export const CalendarMutationUpdateOpSchema = z
  .object({
    kind: z.literal('update'),
    target: CalendarTargetSchema,
    eventDraft: CalendarEventPatchSchema,
    destinationCalendarId: CalendarDestinationCalendarIdSchema.optional(),
    createMeetLink: z.boolean().optional(),
  })
  .strict();

export const CalendarMutationDeleteOpSchema = z
  .object({
    kind: z.literal('delete'),
    target: CalendarTargetSchema,
  })
  .strict();

export const CalendarMutationOperationSchema = z.discriminatedUnion('kind', [
  CalendarMutationCreateOpSchema,
  CalendarMutationUpdateOpSchema,
  CalendarMutationDeleteOpSchema,
]);

const CalendarMutationBundlePlanSchema = z
  .object({
    action: z.literal('bundle'),
    requiresConfirmation: z.boolean().default(true),
    ops: z
      .array(CalendarMutationOperationSchema)
      .min(1)
      .max(CALENDAR_CREATOR_MAX_ITEMS),
    ...CalendarCreatorPlanShared,
  })
  .strict();

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
    ops: z.never().optional(),
    ...CalendarCreatorPlanShared,
  })
  .strict();

export const CalendarCreatorPlanBaseSchema = z.discriminatedUnion('action', [
  CalendarMutationBundlePlanSchema,
  CalendarCreatorCreatePlanSchema,
  CalendarCreatorUpdatePlanSchema,
  CalendarCreatorDeletePlanSchema,
  CalendarCreatorClarifyPlanSchema,
]);

export const CalendarCreatorPlanSchema = CalendarCreatorPlanBaseSchema.superRefine((value, ctx) => {
  if (value.action === 'bundle') {
    value.ops.forEach((op, index) => {
      if (op.kind === 'update') {
        const hasMeaningfulPatch = Object.values(op.eventDraft).some((fieldValue) => fieldValue !== undefined);
        if (!hasMeaningfulPatch && !op.destinationCalendarId && !op.createMeetLink) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Update ops require event changes, a destination calendar move, or createMeetLink.',
            path: ['ops', index, 'eventDraft'],
          });
        }
      }
    });

    if (value.requiresConfirmation !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Mutation bundles must set requiresConfirmation=true.',
        path: ['requiresConfirmation'],
      });
    }
    return;
  }

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
      if (!draft) return false;
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

    if (hasBatchTargets && hasBatchDrafts && value.targets!.length !== value.eventDrafts!.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Batch update requires targets and eventDrafts arrays of equal length.',
        path: ['eventDrafts'],
      });
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

const CalendarLlmUpdateItemSchema = z
  .object({
    target: CalendarTargetSchema,
    eventDraft: CalendarEventPatchSchema,
    destinationCalendarId: CalendarDestinationCalendarIdSchema.optional(),
    createMeetLink: z.boolean().optional(),
  })
  .strict();

const CalendarLlmOperationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('create'),
      eventDraft: CalendarCreateEventDraftSchema,
      createMeetLink: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('update'),
      target: CalendarTargetSchema,
      eventDraft: CalendarEventPatchSchema,
      destinationCalendarId: CalendarDestinationCalendarIdSchema.optional(),
      createMeetLink: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('delete'),
      target: CalendarTargetSchema,
    })
    .strict(),
]);

export const CalendarCreatorLlmSchema = z
  .object({
    action: z.enum(['bundle', 'create', 'update', 'delete', 'clarify']),
    confidence: z.number().min(0).max(100).optional(),
    sendUpdates: z.enum(['none', 'all', 'externalOnly']).optional(),
    createMeetLink: z.boolean().optional(),
    calendarId: z.string().optional(),
    ops: z
      .array(CalendarLlmOperationSchema)
      .min(0)
      .max(CALENDAR_CREATOR_MAX_ITEMS)
      .optional(),
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
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === 'bundle' && (!value.ops || value.ops.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Bundle action requires ops.',
        path: ['ops'],
      });
    }
  });

export type CalendarEventDraftDTO = z.infer<typeof CalendarEventDraftSchema>;
export type CalendarTargetDTO = z.infer<typeof CalendarTargetSchema>;
export type CalendarMutationOperationDTO = z.infer<typeof CalendarMutationOperationSchema>;
export type CalendarMutationBundlePlanDTO = z.infer<typeof CalendarMutationBundlePlanSchema>;
export type CalendarCreatorPlanDTO = z.infer<typeof CalendarCreatorPlanSchema>;
