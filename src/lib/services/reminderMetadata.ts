const REMINDER_STAGE_LABELS = new Set([
  'single',
  'start',
  'early',
  'mid',
  'late',
  'final',
  'deadline',
  'dayof',
  'urgent',
]);

export type ReminderDescriptionMetadata = {
  rawDescription: string | null;
  sequenceLabel: string | null;
  escalationStage: string | null;
  planNote: string | null;
};

export function parseReminderDescription(
  description: string | null | undefined,
): ReminderDescriptionMetadata {
  const rawDescription = description?.trim() || null;
  if (!rawDescription) {
    return {
      rawDescription: null,
      sequenceLabel: null,
      escalationStage: null,
      planNote: null,
    };
  }

  const match = rawDescription.match(/^(\d+\/\d+)(?:\s+([a-z][a-z0-9_-]*))?(?:\s+(.*))?$/i);
  if (!match) {
    return {
      rawDescription,
      sequenceLabel: null,
      escalationStage: null,
      planNote: null,
    };
  }

  const sequenceLabel = match[1] ?? null;
  const candidateStage = match[2]?.toLowerCase() ?? null;
  const trailingText = match[3]?.trim() || null;

  if (!candidateStage || !REMINDER_STAGE_LABELS.has(candidateStage)) {
    const planNote = [candidateStage, trailingText].filter(Boolean).join(' ').trim() || null;
    return {
      rawDescription,
      sequenceLabel,
      escalationStage: null,
      planNote,
    };
  }

  return {
    rawDescription,
    sequenceLabel,
    escalationStage: candidateStage,
    planNote: trailingText,
  };
}
