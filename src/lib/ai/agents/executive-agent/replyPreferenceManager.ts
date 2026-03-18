import { z } from 'zod';
import { callObject } from '@/lib/ai/callLlm';
import { models } from '@/lib/ai/models';
import { readPromptFile } from '@/lib/prompts';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { gatherMemoryContextForReply } from '@/lib/services/core/replyContextTools';
import {
  compileEffectiveReplyInstructionDoc,
  getActiveReplyInstructionDoc,
  renderReplyInstructionDoc,
  saveReplyInstructionDoc,
} from '@/lib/services/reply-instructions';
import type {
  ReplyInstructionDocMetadata,
  ReplyInstructionRule,
  ReplyInstructionRuleKey,
  ReplyInstructionScope,
  ReplyInstructionTarget,
} from '@/lib/services/reply-instructions/types';
import { replyInstructionRuleKeySchema } from '@/lib/services/reply-instructions/types';
import type { AiTraceContext } from '@/lib/ai/tracing';

const senderScopeSchema = z.object({
  type: z.enum(['global', 'sender']),
  senderReference: z.string().min(1).max(200).optional(),
  senderEmail: z.string().email().optional(),
  senderDisplayName: z.string().min(1).max(200).optional(),
  relationLabel: z.string().min(1).max(120).optional(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1).max(240),
});

const parsedPreferenceRuleSchema = z.object({
  target: z.enum(['planner', 'style']),
  key: replyInstructionRuleKeySchema,
  title: z.string().min(1).max(120),
  instruction: z.string().min(1).max(280),
  rationale: z.string().min(1).max(240).optional(),
});

const replyPreferenceParseSchema = z.object({
  summary: z.string().min(1).max(400),
  needsClarification: z.boolean().default(false),
  clarificationQuestion: z.string().min(1).max(240).optional(),
  scope: senderScopeSchema,
  rules: z.array(parsedPreferenceRuleSchema).min(1),
});

type ParsedPreferenceRule = z.infer<typeof parsedPreferenceRuleSchema>;
type ParsedPreferencePayload = z.infer<typeof replyPreferenceParseSchema>;

type ReplyPreferenceManagerInput = {
  userId: string;
  rawInstruction: string;
  scopeHint?: 'global' | 'sender';
  senderHint?: string;
  abortSignal?: AbortSignal;
  traceContext?: AiTraceContext;
};

type ReplyPreferenceDocUpdate = {
  target: ReplyInstructionTarget;
  scope: ReplyInstructionScope;
  scopeKey: string | null;
  version: number;
  content: string;
  summary: string;
};

export type ReplyPreferenceManagerResult = {
  updated: boolean;
  needsClarification: boolean;
  clarificationQuestion?: string;
  summary: string;
  scope: {
    type: ReplyInstructionScope;
    scopeKey: string | null;
    senderDisplayName?: string;
    relationLabel?: string;
  };
  updates: ReplyPreferenceDocUpdate[];
  effectiveDocs?: Partial<Record<ReplyInstructionTarget, string>>;
};

const PLANNER_KEYS = new Set<ReplyInstructionRuleKey>([
  'calendar_disclosure',
  'cc_policy',
  'clarification_policy',
  'commitment_policy',
  'scheduling_policy',
  'content_focus',
  'content_avoidance',
  'ask_vs_assume',
  'planner_constraint',
  'general_planner',
]);

const STYLE_KEYS = new Set<ReplyInstructionRuleKey>([
  'tone',
  'formality',
  'brevity',
  'ending',
  'signoff',
  'greeting',
  'voice',
  'punctuation',
  'style_constraint',
  'general_style',
]);

function extractPrimaryEmailAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/<([^>]+)>/);
  const candidate = match?.[1] ?? value;
  const normalized = candidate.trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) return null;
  return normalized;
}

function extractDisplayName(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const bracketIndex = trimmed.indexOf('<');
  if (bracketIndex > 0) {
    return trimmed.slice(0, bracketIndex).trim().replace(/^"|"$/g, '') || null;
  }
  if (trimmed.includes('@')) return null;
  return trimmed.replace(/^"|"$/g, '') || null;
}

function normalizeComparableText(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function ensureRuleTargetCompatibility(rule: ParsedPreferenceRule): void {
  if (rule.target === 'planner' && !PLANNER_KEYS.has(rule.key)) {
    throw new Error(`Rule key "${rule.key}" is not valid for planner instructions.`);
  }
  if (rule.target === 'style' && !STYLE_KEYS.has(rule.key)) {
    throw new Error(`Rule key "${rule.key}" is not valid for style instructions.`);
  }
}

function mergeRules(
  existingRules: ReplyInstructionRule[],
  nextRules: ParsedPreferenceRule[],
  sourceInstruction: string,
): ReplyInstructionRule[] {
  const merged = new Map(existingRules.map((rule) => [rule.key, rule]));
  const updatedAt = new Date().toISOString();

  for (const rule of nextRules) {
    merged.set(rule.key, {
      key: rule.key,
      title: rule.title,
      instruction: rule.instruction,
      rationale: rule.rationale,
      sourceInstruction,
      updatedAt,
    });
  }

  return [...merged.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function extractEmailsFromText(value: string): string[] {
  return Array.from(
    new Set(
      [...value.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((match) =>
        match[0].toLowerCase(),
      ),
    ),
  );
}

function extractCandidateNamesFromMemory(value: string): string[] {
  const names = new Set<string>();
  for (const match of value.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g)) {
    const candidate = match[1]?.trim();
    if (!candidate) continue;
    if (['User', 'Reply', 'Calendar'].includes(candidate)) continue;
    names.add(candidate);
  }
  return [...names];
}

async function loadSenderCandidates(userId: string): Promise<
  Array<{
    email: string;
    displayName: string | null;
    normalizedName: string;
    frequency: number;
    lastSeenAt: Date;
  }>
> {
  const emails = await prisma.email.findMany({
    where: {
      thread: { userId },
      isSent: false,
    },
    orderBy: { createdAt: 'desc' },
    take: 300,
    select: {
      from: true,
      createdAt: true,
    },
  });

  const map = new Map<
    string,
    {
      email: string;
      displayName: string | null;
      normalizedName: string;
      frequency: number;
      lastSeenAt: Date;
    }
  >();

  for (const email of emails) {
    const address = extractPrimaryEmailAddress(email.from);
    if (!address) continue;

    const displayName = extractDisplayName(email.from);
    const normalizedName = normalizeComparableText(displayName);
    const current = map.get(address);
    if (!current) {
      map.set(address, {
        email: address,
        displayName,
        normalizedName,
        frequency: 1,
        lastSeenAt: email.createdAt,
      });
      continue;
    }

    current.frequency += 1;
    if (email.createdAt > current.lastSeenAt) {
      current.lastSeenAt = email.createdAt;
      current.displayName = displayName ?? current.displayName;
      current.normalizedName = normalizedName || current.normalizedName;
    }
  }

  return [...map.values()].sort((left, right) => {
    if (right.frequency !== left.frequency) return right.frequency - left.frequency;
    return right.lastSeenAt.getTime() - left.lastSeenAt.getTime();
  });
}

async function resolveSenderScope(params: {
  userId: string;
  parsedScope: ParsedPreferencePayload['scope'];
  senderHint?: string;
}): Promise<{
  ok: true;
  scopeKey: string;
  senderDisplayName?: string;
  relationLabel?: string;
} | {
  ok: false;
  clarificationQuestion: string;
}> {
  const directEmail =
    extractPrimaryEmailAddress(params.parsedScope.senderEmail) ||
    extractPrimaryEmailAddress(params.senderHint) ||
    extractPrimaryEmailAddress(params.parsedScope.senderReference);
  if (directEmail) {
      return {
        ok: true,
        scopeKey: directEmail,
        senderDisplayName:
          params.parsedScope.senderDisplayName || extractDisplayName(params.senderHint) || undefined,
        relationLabel: params.parsedScope.relationLabel,
      };
  }

  const senderCandidates = await loadSenderCandidates(params.userId);
  const directReference = normalizeComparableText(
    params.parsedScope.senderDisplayName ||
      params.parsedScope.senderReference ||
      params.senderHint,
  );

  const directMatches = senderCandidates.filter((candidate) => {
    if (!directReference) return false;
    return (
      candidate.normalizedName === directReference ||
      candidate.normalizedName.includes(directReference) ||
      directReference.includes(candidate.normalizedName) ||
      candidate.email.includes(directReference.replace(/\s+/g, ''))
    );
  });

  if (directMatches.length === 1) {
    return {
      ok: true,
      scopeKey: directMatches[0]!.email,
      senderDisplayName: directMatches[0]!.displayName ?? params.parsedScope.senderDisplayName,
      relationLabel: params.parsedScope.relationLabel,
    };
  }

  const memoryQueries = [
    params.parsedScope.senderReference,
    params.parsedScope.senderDisplayName,
    params.parsedScope.relationLabel,
  ].filter((value): value is string => Boolean(value && value.trim()));

  if (memoryQueries.length > 0) {
    const memories = await gatherMemoryContextForReply({
      userId: params.userId,
      query: `reply preference sender resolution ${memoryQueries.join(' ')}`,
      limit: 4,
      threshold: 0.25,
      timeoutMs: 3500,
    });

    const emailMatches = new Set<string>();
    const nameMatches = new Set<string>();

    for (const memory of memories) {
      for (const email of extractEmailsFromText(memory.content)) {
        emailMatches.add(email);
      }
      for (const name of extractCandidateNamesFromMemory(memory.content)) {
        nameMatches.add(name);
      }
    }

    if (emailMatches.size === 1) {
      const email = [...emailMatches][0]!;
      const inboxMatch = senderCandidates.find((candidate) => candidate.email === email);
      return {
        ok: true,
        scopeKey: email,
        senderDisplayName:
          inboxMatch?.displayName ??
          params.parsedScope.senderDisplayName ??
          [...nameMatches][0],
        relationLabel: params.parsedScope.relationLabel,
      };
    }

    const memoryNameMatches = senderCandidates.filter((candidate) =>
      [...nameMatches].some((name) => candidate.normalizedName === normalizeComparableText(name)),
    );

    if (memoryNameMatches.length === 1) {
      return {
        ok: true,
        scopeKey: memoryNameMatches[0]!.email,
        senderDisplayName: memoryNameMatches[0]!.displayName ?? [...nameMatches][0],
        relationLabel: params.parsedScope.relationLabel,
      };
    }
  }

  const referenceLabel =
    params.parsedScope.senderReference ||
    params.parsedScope.senderDisplayName ||
    params.parsedScope.relationLabel ||
    'that sender';
  return {
    ok: false,
    clarificationQuestion: `I can save that preference, but I need the exact sender email or name for ${referenceLabel}.`,
  };
}

async function parseReplyPreferences(
  input: ReplyPreferenceManagerInput,
): Promise<ParsedPreferencePayload> {
  const template = readPromptFile('executive-agent/replyPreferenceManager.md');
  const hintBlock = [
    input.scopeHint ? `Scope hint: ${input.scopeHint}` : null,
    input.senderHint ? `Sender hint: ${input.senderHint}` : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n');
  const prompt = template
    .replace('{userInstruction}', input.rawInstruction.trim())
    .concat(hintBlock ? `\n\nAdditional hints:\n${hintBlock}` : '');

  const { object } = await callObject<ParsedPreferencePayload>({
    model: models.flash(),
    system:
      'You normalize reply preference instructions into structured JSON for Clira. Return JSON only.',
    prompt,
    schema: replyPreferenceParseSchema,
    temperature: 0,
    op: 'reply.preferences.parse',
    concurrency: { key: 'reply.preferences', maxConcurrency: 2 },
    retry: { maxAttempts: 2, baseDelayMs: 400 },
    abortSignal: input.abortSignal,
    traceContext: input.traceContext,
  });

  for (const rule of object.rules) {
    ensureRuleTargetCompatibility(rule);
  }

  return object;
}

export async function manageReplyPreferences(
  input: ReplyPreferenceManagerInput,
): Promise<ReplyPreferenceManagerResult> {
  const parsed = await parseReplyPreferences(input);

  if (parsed.needsClarification && parsed.clarificationQuestion) {
    return {
      updated: false,
      needsClarification: true,
      clarificationQuestion: parsed.clarificationQuestion,
      summary: parsed.summary,
      scope: {
        type: parsed.scope.type,
        scopeKey: null,
      },
      updates: [],
    };
  }

  let scopeKey: string | null = null;
  let senderDisplayName = parsed.scope.senderDisplayName;
  let relationLabel = parsed.scope.relationLabel;

  if (parsed.scope.type === 'sender') {
    const resolvedScope = await resolveSenderScope({
      userId: input.userId,
      parsedScope: parsed.scope,
      senderHint: input.senderHint,
    });

    if (!resolvedScope.ok) {
      return {
        updated: false,
        needsClarification: true,
        clarificationQuestion: resolvedScope.clarificationQuestion,
        summary: parsed.summary,
        scope: {
          type: 'sender',
          scopeKey: null,
          senderDisplayName,
          relationLabel,
        },
        updates: [],
      };
    }

    scopeKey = resolvedScope.scopeKey;
    senderDisplayName = resolvedScope.senderDisplayName ?? senderDisplayName;
    relationLabel = resolvedScope.relationLabel ?? relationLabel;
  }

  const scope = parsed.scope.type;
  const rulesByTarget = new Map<ReplyInstructionTarget, ParsedPreferenceRule[]>();
  for (const rule of parsed.rules) {
    const bucket = rulesByTarget.get(rule.target) ?? [];
    bucket.push(rule);
    rulesByTarget.set(rule.target, bucket);
  }

  const updates: ReplyPreferenceDocUpdate[] = [];
  const effectiveDocs: Partial<Record<ReplyInstructionTarget, string>> = {};
  let hasMutation = false;

  for (const [target, nextRules] of rulesByTarget.entries()) {
    const currentDoc = await getActiveReplyInstructionDoc({
      userId: input.userId,
      target,
      scope,
      scopeKey,
    });

    const mergedRules = mergeRules(
      currentDoc?.metadata.rules ?? [],
      nextRules,
      input.rawInstruction.trim(),
    );

    const metadata: ReplyInstructionDocMetadata = {
      version: 1,
      summary: parsed.summary,
      senderDisplayName: senderDisplayName ?? undefined,
      relationLabel: relationLabel ?? undefined,
      resolvedFrom:
        parsed.scope.senderReference || parsed.scope.senderDisplayName || parsed.scope.senderEmail,
      rules: mergedRules,
    };

    const content = renderReplyInstructionDoc({
      target,
      scope,
      scopeKey,
      metadata,
    });

    if (currentDoc?.content === content) {
      logger.info('[replyPreferences] no-op update skipped', {
        userId: input.userId,
        target,
        scope,
        scopeKey,
      });
      updates.push({
        target,
        scope,
        scopeKey,
        version: currentDoc.version,
        content: currentDoc.content,
        summary: metadata.summary,
      });
      effectiveDocs[target] = await compileEffectiveReplyInstructionDoc({
        userId: input.userId,
        target,
        senderEmail: scope === 'sender' ? scopeKey : undefined,
      });
      continue;
    }

    const saved = await saveReplyInstructionDoc({
      userId: input.userId,
      target,
      scope,
      scopeKey,
      content,
      metadata,
    });
    hasMutation = true;

    updates.push({
      target,
      scope,
      scopeKey: saved.scopeKey,
      version: saved.version,
      content: saved.content,
      summary: saved.metadata.summary,
    });

    effectiveDocs[target] = await compileEffectiveReplyInstructionDoc({
      userId: input.userId,
      target,
      senderEmail: scope === 'sender' ? scopeKey : undefined,
    });
  }

  return {
    updated: hasMutation,
    needsClarification: false,
    summary: parsed.summary,
    scope: {
      type: scope,
      scopeKey,
      senderDisplayName: senderDisplayName ?? undefined,
      relationLabel: relationLabel ?? undefined,
    },
    updates,
    effectiveDocs,
  };
}
