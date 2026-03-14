import { beforeEach, describe, expect, test, vi } from 'vitest';

const llmState = vi.hoisted(() => ({
  parsedResult: null as any,
}));

const dbState = vi.hoisted(() => ({
  docs: [] as Array<Record<string, any>>,
  emails: [] as Array<Record<string, any>>,
  nextId: 1,
}));

const memoryState = vi.hoisted(() => ({
  results: [] as Array<{ id: string; content: string; score: number; metadata?: Record<string, unknown> }>,
}));

function matchesWhere(record: Record<string, any>, where: Record<string, any>): boolean {
  return Object.entries(where).every(([key, value]) => record[key] === value);
}

vi.mock('@/lib/ai/callLlm', () => ({
  callObject: vi.fn(async () => ({ object: llmState.parsedResult })),
}));

vi.mock('@/lib/services/core/replyContextTools', () => ({
  gatherMemoryContextForReply: vi.fn(async () => memoryState.results),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    replyInstructionDoc: {
      findFirst: vi.fn(async ({ where, orderBy }: any) => {
        const candidates = dbState.docs
          .filter((record) => matchesWhere(record, where))
          .sort((left, right) =>
            orderBy?.version === 'desc' ? right.version - left.version : left.version - right.version,
          );
        return candidates[0] ?? null;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const doc of dbState.docs) {
          if (matchesWhere(doc, where)) {
            Object.assign(doc, data);
            count += 1;
          }
        }
        return { count };
      }),
      create: vi.fn(async ({ data }: any) => {
        const created = {
          id: `rid-${dbState.nextId++}`,
          createdAt: new Date('2026-03-14T19:00:00.000Z'),
          updatedAt: new Date('2026-03-14T19:00:00.000Z'),
          ...data,
        };
        dbState.docs.push(created);
        return created;
      }),
    },
    email: {
      findMany: vi.fn(async () => dbState.emails),
    },
  },
}));

const {
  manageReplyPreferences,
} = await import('@/lib/ai/agents/executive-agent/replyPreferenceManager');

const {
  compileEffectiveReplyInstructionDoc,
} = await import('@/lib/services/reply-instructions');

describe('reply preference manager', () => {
  beforeEach(() => {
    dbState.docs = [];
    dbState.emails = [];
    dbState.nextId = 1;
    memoryState.results = [];
    llmState.parsedResult = null;
  });

  test('writes a global style rule', async () => {
    llmState.parsedResult = {
      summary: 'Keep replies shorter by default.',
      needsClarification: false,
      scope: {
        type: 'global',
        confidence: 0.98,
        rationale: 'Applies to all replies.',
      },
      rules: [
        {
          target: 'style',
          key: 'brevity',
          title: 'Brevity',
          instruction: 'Keep replies shorter by default.',
        },
      ],
    };

    const result = await manageReplyPreferences({
      userId: 'user-1',
      rawInstruction: 'keep replies shorter by default',
    });

    expect(result.updated).toBe(true);
    expect(result.scope.type).toBe('global');
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]?.target).toBe('style');
    expect(dbState.docs).toHaveLength(1);
    expect(dbState.docs[0]?.content).toContain('Keep replies shorter by default.');
  });

  test('writes a sender-specific style rule after resolving the sender', async () => {
    dbState.emails = [
      {
        from: 'Linda Chen <mom@example.com>',
        createdAt: new Date('2026-03-13T18:00:00.000Z'),
      },
    ];
    memoryState.results = [
      {
        id: 'mem-1',
        content: "Linda Chen is the user's mom.",
        score: 0.92,
      },
    ];
    llmState.parsedResult = {
      summary: 'Reply to mom informally and end with "love you".',
      needsClarification: false,
      scope: {
        type: 'sender',
        senderReference: 'my mom',
        relationLabel: 'mom',
        confidence: 0.95,
        rationale: 'The user named a specific sender relationship.',
      },
      rules: [
        {
          target: 'style',
          key: 'tone',
          title: 'Tone',
          instruction: 'Use an informal, warm tone.',
        },
        {
          target: 'style',
          key: 'ending',
          title: 'Ending',
          instruction: 'End with "love you".',
        },
      ],
    };

    const result = await manageReplyPreferences({
      userId: 'user-1',
      rawInstruction: 'always reply to my mom informally and end with love you',
    });

    expect(result.updated).toBe(true);
    expect(result.scope.scopeKey).toBe('mom@example.com');
    expect(result.updates[0]?.scope).toBe('sender');
    expect(dbState.docs[0]?.scopeKey).toBe('mom@example.com');
    expect(dbState.docs[0]?.content).toContain('End with "love you".');
  });

  test('writes a planner-only rule', async () => {
    llmState.parsedResult = {
      summary: 'Do not volunteer calendar times unless asked.',
      needsClarification: false,
      scope: {
        type: 'global',
        confidence: 0.96,
        rationale: 'Applies to all planning output.',
      },
      rules: [
        {
          target: 'planner',
          key: 'calendar_disclosure',
          title: 'Calendar Disclosure',
          instruction: 'Never volunteer calendar times unless the user explicitly asks.',
        },
      ],
    };

    const result = await manageReplyPreferences({
      userId: 'user-1',
      rawInstruction: 'never volunteer calendar times unless I ask',
    });

    expect(result.updated).toBe(true);
    expect(result.updates[0]?.target).toBe('planner');
    expect(dbState.docs[0]?.content).toContain('Never volunteer calendar times unless the user explicitly asks.');
  });

  test('splits one instruction across planner and style docs', async () => {
    llmState.parsedResult = {
      summary: 'Ask for missing details and keep the tone informal.',
      needsClarification: false,
      scope: {
        type: 'global',
        confidence: 0.94,
        rationale: 'Two explicit global reply preferences.',
      },
      rules: [
        {
          target: 'planner',
          key: 'ask_vs_assume',
          title: 'Ask vs Assume',
          instruction: 'Ask the sender for missing details instead of assuming them.',
        },
        {
          target: 'style',
          key: 'tone',
          title: 'Tone',
          instruction: 'Use an informal tone.',
        },
      ],
    };

    const result = await manageReplyPreferences({
      userId: 'user-1',
      rawInstruction: 'be informal, and if details are missing ask instead of assuming',
    });

    expect(result.updated).toBe(true);
    expect(result.updates.map((update) => update.target).sort()).toEqual(['planner', 'style']);
    expect(dbState.docs).toHaveLength(2);
  });

  test('canonically rewrites conflicting rules so the newest explicit rule wins', async () => {
    llmState.parsedResult = {
      summary: 'Use an informal tone.',
      needsClarification: false,
      scope: {
        type: 'global',
        confidence: 0.96,
        rationale: 'Applies to all replies.',
      },
      rules: [
        {
          target: 'style',
          key: 'tone',
          title: 'Tone',
          instruction: 'Use an informal tone.',
        },
      ],
    };

    await manageReplyPreferences({
      userId: 'user-1',
      rawInstruction: 'always be informal',
    });

    llmState.parsedResult = {
      summary: 'Use a formal tone.',
      needsClarification: false,
      scope: {
        type: 'global',
        confidence: 0.96,
        rationale: 'Applies to all replies.',
      },
      rules: [
        {
          target: 'style',
          key: 'tone',
          title: 'Tone',
          instruction: 'Use a formal tone.',
        },
      ],
    };

    const result = await manageReplyPreferences({
      userId: 'user-1',
      rawInstruction: 'actually make replies formal',
    });

    const activeDocs = dbState.docs.filter((doc) => doc.isActive);
    expect(result.updated).toBe(true);
    expect(activeDocs).toHaveLength(1);
    expect(activeDocs[0]?.version).toBe(2);
    expect(activeDocs[0]?.metadata.rules).toHaveLength(1);
    expect(activeDocs[0]?.metadata.rules[0]?.instruction).toBe('Use a formal tone.');
  });

  test('returns clarification and does not write when sender resolution is ambiguous', async () => {
    llmState.parsedResult = {
      summary: 'Reply to manager formally.',
      needsClarification: false,
      scope: {
        type: 'sender',
        senderReference: 'my manager',
        relationLabel: 'manager',
        confidence: 0.88,
        rationale: 'The user named a sender relationship.',
      },
      rules: [
        {
          target: 'style',
          key: 'formality',
          title: 'Formality',
          instruction: 'Use a formal tone.',
        },
      ],
    };

    const result = await manageReplyPreferences({
      userId: 'user-1',
      rawInstruction: 'always reply to my manager formally',
    });

    expect(result.updated).toBe(false);
    expect(result.needsClarification).toBe(true);
    expect(dbState.docs).toHaveLength(0);
  });

  test('compiles sender-specific overrides only for the matching sender', async () => {
    dbState.docs = [
      {
        id: 'rid-1',
        userId: 'user-1',
        target: 'style',
        scope: 'global',
        scopeKey: null,
        content: 'Global style rule.',
        version: 1,
        isActive: true,
        metadata: {
          version: 1,
          summary: 'Global',
          rules: [],
        },
        createdAt: new Date('2026-03-14T19:00:00.000Z'),
        updatedAt: new Date('2026-03-14T19:00:00.000Z'),
      },
      {
        id: 'rid-2',
        userId: 'user-1',
        target: 'style',
        scope: 'sender',
        scopeKey: 'mom@example.com',
        content: 'Sender-specific style rule.',
        version: 1,
        isActive: true,
        metadata: {
          version: 1,
          summary: 'Mom',
          senderDisplayName: 'Mom',
          rules: [],
        },
        createdAt: new Date('2026-03-14T19:00:00.000Z'),
        updatedAt: new Date('2026-03-14T19:00:00.000Z'),
      },
    ];

    const matching = await compileEffectiveReplyInstructionDoc({
      userId: 'user-1',
      target: 'style',
      senderEmail: 'mom@example.com',
    });
    const nonMatching = await compileEffectiveReplyInstructionDoc({
      userId: 'user-1',
      target: 'style',
      senderEmail: 'other@example.com',
    });

    expect(matching).toContain('Sender-specific style rule.');
    expect(nonMatching).not.toContain('Sender-specific style rule.');
  });
});
