import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import type {
  ReplyInstructionDocMetadata,
  ReplyInstructionDocRecord,
  ReplyInstructionRule,
  ReplyInstructionRuleKey,
  ReplyInstructionScope,
  ReplyInstructionTarget,
  SaveReplyInstructionDocInput,
} from './types';
import { replyInstructionDocMetadataSchema } from './types';

const STYLE_SECTION_ORDER: Array<{
  title: string;
  keys: ReplyInstructionRuleKey[];
}> = [
  { title: 'Tone', keys: ['tone', 'formality', 'voice'] },
  { title: 'Length And Structure', keys: ['brevity', 'greeting', 'ending', 'signoff'] },
  { title: 'Style Constraints', keys: ['punctuation', 'style_constraint', 'general_style'] },
];

const PLANNER_SECTION_ORDER: Array<{
  title: string;
  keys: ReplyInstructionRuleKey[];
}> = [
  { title: 'Planning Priorities', keys: ['content_focus', 'content_avoidance', 'general_planner'] },
  { title: 'Decision Rules', keys: ['clarification_policy', 'ask_vs_assume', 'commitment_policy'] },
  { title: 'Scheduling And Coordination', keys: ['calendar_disclosure', 'scheduling_policy', 'cc_policy'] },
  { title: 'Constraints', keys: ['planner_constraint'] },
];

function normalizeScopeKey(scope: ReplyInstructionScope, scopeKey?: string | null): string | null {
  if (scope === 'global') return null;
  return scopeKey?.trim().toLowerCase() || null;
}

export function resolveReplyInstructionSenderEmail(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const match = value.match(/<([^>]+)>/);
  const candidate = match?.[1] ?? value;
  const normalized = candidate.trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) return null;
  return normalized;
}

function parseDocMetadata(metadata: unknown): ReplyInstructionDocMetadata {
  const parsed = replyInstructionDocMetadataSchema.safeParse(metadata);
  if (parsed.success) return parsed.data;

  logger.warn('[replyInstructions] invalid metadata; falling back to empty rule set', {
    issues: parsed.error.issues.map((issue) => issue.message),
  });
  return {
    version: 1,
    summary: 'Reply instruction doc metadata was invalid and was reset.',
    rules: [],
  };
}

function mapDocRecord(record: {
  id: string;
  userId: string;
  target: string;
  scope: string;
  scopeKey: string | null;
  content: string;
  version: number;
  isActive: boolean;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): ReplyInstructionDocRecord {
  return {
    id: record.id,
    userId: record.userId,
    target: record.target as ReplyInstructionTarget,
    scope: record.scope as ReplyInstructionScope,
    scopeKey: record.scopeKey,
    content: record.content,
    version: record.version,
    isActive: record.isActive,
    metadata: parseDocMetadata(record.metadata),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function renderRuleLines(rules: ReplyInstructionRule[]): string[] {
  return rules.map((rule) => `- ${rule.instruction}`);
}

function renderScopedDocHeader(params: {
  target: ReplyInstructionTarget;
  scope: ReplyInstructionScope;
  scopeKey: string | null;
  metadata: ReplyInstructionDocMetadata;
}): string[] {
  const lines = [
    params.target === 'planner'
      ? 'Explicit planner instructions. Treat these as direct user-authored operating rules.'
      : 'Explicit style instructions. Treat these as direct user-authored voice and phrasing rules.',
  ];

  if (params.scope === 'global') {
    lines.push('Applies to all replies.');
  } else {
    const recipient = params.metadata.senderDisplayName
      ? `${params.metadata.senderDisplayName} <${params.scopeKey}>`
      : params.scopeKey ?? 'this sender';
    lines.push(`Applies only when replying to ${recipient}.`);
    if (params.metadata.relationLabel) {
      lines.push(`Relation hint: ${params.metadata.relationLabel}.`);
    }
  }

  return lines;
}

function renderSectionedRules(params: {
  target: ReplyInstructionTarget;
  rules: ReplyInstructionRule[];
}): string {
  const sections = params.target === 'planner' ? PLANNER_SECTION_ORDER : STYLE_SECTION_ORDER;
  const remaining = new Map(params.rules.map((rule) => [rule.key, rule]));
  const chunks: string[] = [];

  for (const section of sections) {
    const sectionRules = section.keys
      .map((key) => remaining.get(key))
      .filter((rule): rule is ReplyInstructionRule => Boolean(rule));

    if (sectionRules.length === 0) continue;
    for (const rule of sectionRules) {
      remaining.delete(rule.key);
    }

    chunks.push(`## ${section.title}`);
    chunks.push(...renderRuleLines(sectionRules));
    chunks.push('');
  }

  const leftoverRules = [...remaining.values()];
  if (leftoverRules.length > 0) {
    chunks.push('## Additional Rules');
    chunks.push(...renderRuleLines(leftoverRules));
    chunks.push('');
  }

  return chunks.join('\n').trim();
}

export function renderReplyInstructionDoc(params: {
  target: ReplyInstructionTarget;
  scope: ReplyInstructionScope;
  scopeKey: string | null;
  metadata: ReplyInstructionDocMetadata;
}): string {
  const lines = [
    ...renderScopedDocHeader(params),
    '',
    renderSectionedRules({
      target: params.target,
      rules: params.metadata.rules,
    }),
  ];

  return lines.filter((line, index, arr) => !(line === '' && arr[index - 1] === '')).join('\n').trim();
}

export async function getActiveReplyInstructionDoc(params: {
  userId: string;
  target: ReplyInstructionTarget;
  scope: ReplyInstructionScope;
  scopeKey?: string | null;
}): Promise<ReplyInstructionDocRecord | null> {
  const record = await prisma.replyInstructionDoc.findFirst({
    where: {
      userId: params.userId,
      target: params.target,
      scope: params.scope,
      scopeKey: normalizeScopeKey(params.scope, params.scopeKey),
      isActive: true,
    },
    orderBy: { version: 'desc' },
  });

  return record ? mapDocRecord(record) : null;
}

export async function saveReplyInstructionDoc(
  input: SaveReplyInstructionDocInput,
): Promise<ReplyInstructionDocRecord> {
  const scopeKey = normalizeScopeKey(input.scope, input.scopeKey);

  const current = await prisma.replyInstructionDoc.findFirst({
    where: {
      userId: input.userId,
      target: input.target,
      scope: input.scope,
      scopeKey,
    },
    orderBy: { version: 'desc' },
  });

  const nextVersion = (current?.version ?? 0) + 1;

  await prisma.replyInstructionDoc.updateMany({
    where: {
      userId: input.userId,
      target: input.target,
      scope: input.scope,
      scopeKey,
      isActive: true,
    },
    data: { isActive: false },
  });

  const saved = await prisma.replyInstructionDoc.create({
    data: {
      userId: input.userId,
      target: input.target,
      scope: input.scope,
      scopeKey,
      content: input.content,
      version: nextVersion,
      isActive: true,
      metadata: input.metadata,
    },
  });

  return mapDocRecord(saved);
}

export async function compileEffectiveReplyInstructionDoc(params: {
  userId: string;
  target: ReplyInstructionTarget;
  senderEmail?: string | null;
}): Promise<string> {
  const senderEmail = params.senderEmail?.trim().toLowerCase() || null;
  const [globalDoc, senderDoc] = await Promise.all([
    getActiveReplyInstructionDoc({
      userId: params.userId,
      target: params.target,
      scope: 'global',
    }),
    senderEmail
      ? getActiveReplyInstructionDoc({
          userId: params.userId,
          target: params.target,
          scope: 'sender',
          scopeKey: senderEmail,
        })
      : Promise.resolve(null),
  ]);

  if (!globalDoc && !senderDoc) {
    return 'No explicit user-managed reply instructions are stored for this agent.';
  }

  const sections: string[] = [];

  if (globalDoc) {
    sections.push('## Global Instructions');
    sections.push(globalDoc.content);
  }

  if (senderDoc) {
    sections.push(
      `## Sender-Specific Override (${senderDoc.metadata.senderDisplayName ? `${senderDoc.metadata.senderDisplayName} <${senderEmail}>` : senderEmail})`,
    );
    sections.push(
      'These instructions override the global instructions when they conflict for this sender.',
    );
    sections.push(senderDoc.content);
  }

  return sections.join('\n\n').trim();
}

export async function listActiveReplyInstructionDocs(params: {
  userId: string;
  target?: ReplyInstructionTarget;
  senderEmail?: string | null;
}): Promise<ReplyInstructionDocRecord[]> {
  const senderEmail = params.senderEmail?.trim().toLowerCase() || null;

  const records = await prisma.replyInstructionDoc.findMany({
    where: {
      userId: params.userId,
      isActive: true,
      ...(params.target ? { target: params.target } : {}),
      ...(senderEmail
        ? {
            OR: [
              { scope: 'global' },
              { scope: 'sender', scopeKey: senderEmail },
            ],
          }
        : {}),
    },
    orderBy: [
      { target: 'asc' },
      { scope: 'asc' },
      { version: 'desc' },
    ],
  });

  return records.map(mapDocRecord);
}

export async function readReplyInstructionOverview(params: {
  userId: string;
  target?: ReplyInstructionTarget;
  senderEmail?: string | null;
}): Promise<{
  docs: Array<{
    id: string;
    target: ReplyInstructionTarget;
    scope: ReplyInstructionScope;
    scopeKey: string | null;
    version: number;
    summary: string;
    senderDisplayName?: string;
    relationLabel?: string;
    content: string;
    ruleCount: number;
    rules: ReplyInstructionRule[];
  }>;
  effectiveDocs: Partial<Record<ReplyInstructionTarget, string>>;
}> {
  const senderEmail = params.senderEmail?.trim().toLowerCase() || null;
  const docs = await listActiveReplyInstructionDocs({
    userId: params.userId,
    target: params.target,
    senderEmail,
  });

  const targets: ReplyInstructionTarget[] = params.target
    ? [params.target]
    : ['planner', 'style'];

  const effectiveEntries = await Promise.all(
    targets.map(async (target) => [
      target,
      await compileEffectiveReplyInstructionDoc({
        userId: params.userId,
        target,
        senderEmail,
      }),
    ] as const),
  );

  return {
    docs: docs.map((doc) => ({
      id: doc.id,
      target: doc.target,
      scope: doc.scope,
      scopeKey: doc.scopeKey,
      version: doc.version,
      summary: doc.metadata.summary,
      senderDisplayName: doc.metadata.senderDisplayName,
      relationLabel: doc.metadata.relationLabel,
      content: doc.content,
      ruleCount: doc.metadata.rules.length,
      rules: doc.metadata.rules,
    })),
    effectiveDocs: Object.fromEntries(effectiveEntries),
  };
}
