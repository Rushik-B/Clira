import type { ConversationMessageDTO } from '@/lib/ai/schemas/executiveAgentSchemas';

export type PendingEmailDraftMetadata = {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractEmailAddress(value: string): string | null {
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0]!.toLowerCase() : null;
}

function normalizeReplySubject(value: string): string {
  let subject = value.trim().toLowerCase();
  while (/^(?:re|fw|fwd):\s*/i.test(subject)) {
    subject = subject.replace(/^(?:re|fw|fwd):\s*/i, '').trim();
  }
  return subject;
}

function draftMatches(params: {
  draft: Pick<PendingEmailDraftMetadata, 'to' | 'subject'>;
  to?: string;
  subject?: string;
}): boolean {
  const to = params.to ? extractEmailAddress(params.to) : null;
  if (to && extractEmailAddress(params.draft.to) !== to) {
    return false;
  }

  const subject = params.subject ? normalizeReplySubject(params.subject) : null;
  if (subject && normalizeReplySubject(params.draft.subject) !== subject) {
    return false;
  }

  return true;
}

function parseDraftPreview(content: string): PendingEmailDraftMetadata | null {
  const toMatch = content.match(/^\s*To:\s*(.+)$/im);
  const subjectMatch = content.match(/^\s*(?:Sub|Subject):\s*(.+)$/im);
  if (!toMatch?.[1] || !subjectMatch?.[1]) {
    return null;
  }

  const to = toMatch[1].trim();
  const subject = subjectMatch[1].trim();
  if (!to || !subject) {
    return null;
  }

  const lines = content.split('\n');
  const subjectLineIndex = lines.findIndex((line) => /^\s*(?:Sub|Subject):\s*/i.test(line));
  const body = subjectLineIndex === -1
    ? ''
    : lines.slice(subjectLineIndex + 1).join('\n').trim();

  return {
    to,
    subject,
    body,
  };
}

function readToolResults(message: ConversationMessageDTO): Array<Record<string, unknown>> {
  const metadata = asRecord(message.metadata);
  const toolResults = metadata?.toolResults;
  return Array.isArray(toolResults)
    ? toolResults.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}

function matchThreadCandidate(params: {
  candidate: Record<string, unknown>;
  draft: Pick<PendingEmailDraftMetadata, 'to' | 'subject'>;
}): string | null {
  const threadId = getString(params.candidate.threadId);
  if (!threadId) return null;

  const from = getString(params.candidate.from);
  const subject = getString(params.candidate.subject);
  if (!from || !subject) return null;

  const senderEmail = extractEmailAddress(from);
  const targetEmail = extractEmailAddress(params.draft.to);
  if (!senderEmail || !targetEmail || senderEmail !== targetEmail) {
    return null;
  }

  if (normalizeReplySubject(subject) !== normalizeReplySubject(params.draft.subject)) {
    return null;
  }

  return threadId;
}

export function findDraftThreadIdInToolResults(params: {
  toolResults: unknown;
  to: string;
  subject: string;
}): string | null {
  if (!Array.isArray(params.toolResults)) return null;

  const draft = { to: params.to, subject: params.subject };

  for (let index = params.toolResults.length - 1; index >= 0; index -= 1) {
    const entry = asRecord(params.toolResults[index]);
    const toolName = getString(entry?.toolName ?? entry?.name ?? entry?.tool);
    const result = asRecord(entry?.result ?? entry?.output);
    if (!toolName || !result) continue;

    if (toolName === 'search_inbox_context') {
      const matches = Array.isArray(result.matches) ? result.matches : [];
      for (const match of matches) {
        const threadId = matchThreadCandidate({
          candidate: asRecord(match) ?? {},
          draft,
        });
        if (threadId) return threadId;
      }
    }

    if (toolName === 'list_inbox_emails') {
      const items = Array.isArray(result.items) ? result.items : [];
      for (const item of items) {
        const threadId = matchThreadCandidate({
          candidate: asRecord(item) ?? {},
          draft,
        });
        if (threadId) return threadId;
      }
    }
  }

  return null;
}

function readPendingDraftFromMetadata(metadata: unknown): PendingEmailDraftMetadata | null {
  const record = asRecord(metadata);
  const pendingDraft = asRecord(record?.pendingEmailDraft);
  if (!pendingDraft) return null;

  const to = getString(pendingDraft.to);
  const subject = getString(pendingDraft.subject);
  const body = getString(pendingDraft.body) ?? '';
  const threadId = getString(pendingDraft.threadId) ?? undefined;

  if (!to || !subject) return null;

  return {
    to,
    subject,
    body,
    threadId,
  };
}

export function findPendingEmailDraftInHistory(params: {
  history: ConversationMessageDTO[];
  to?: string;
  subject?: string;
}): PendingEmailDraftMetadata | null {
  const assistantMessages = params.history
    .filter((message) => message.role === 'ASSISTANT')
    .slice(-10);

  for (let index = assistantMessages.length - 1; index >= 0; index -= 1) {
    const message = assistantMessages[index]!;
    const metadataDraft = readPendingDraftFromMetadata(message.metadata);
    if (metadataDraft && draftMatches({ draft: metadataDraft, to: params.to, subject: params.subject })) {
      return metadataDraft;
    }

    const parsedDraft = parseDraftPreview(message.content ?? '');
    if (!parsedDraft || !draftMatches({ draft: parsedDraft, to: params.to, subject: params.subject })) {
      continue;
    }

    const threadId = findDraftThreadIdInToolResults({
      toolResults: readToolResults(message),
      to: parsedDraft.to,
      subject: parsedDraft.subject,
    });

    return {
      ...parsedDraft,
      ...(threadId ? { threadId } : {}),
    };
  }

  return null;
}

export function extractPendingEmailDraftMetadata(params: {
  response: string;
  toolResults: unknown;
}): PendingEmailDraftMetadata | null {
  const parsedDraft = parseDraftPreview(params.response);
  if (!parsedDraft) return null;

  const threadId = findDraftThreadIdInToolResults({
    toolResults: params.toolResults,
    to: parsedDraft.to,
    subject: parsedDraft.subject,
  });

  return {
    ...parsedDraft,
    ...(threadId ? { threadId } : {}),
  };
}
