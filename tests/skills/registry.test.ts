import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  prismaMock,
  txMock,
  transactionMock,
} = vi.hoisted(() => {
  const tx = {
    userSkill: {
      create: vi.fn(),
      update: vi.fn(),
    },
    actionHistory: {
      create: vi.fn(),
    },
  };

  return {
    prismaMock: {
      userSkill: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      actionHistory: {
        create: vi.fn(),
      },
      $transaction: vi.fn(async (callback) => callback(tx)),
    },
    txMock: tx,
    transactionMock: tx,
  };
});

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}));

import {
  createUserSkill,
  listSelectableSkills,
} from '@/lib/services/skills';

describe('skill registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof transactionMock) => Promise<unknown>) =>
      callback(transactionMock),
    );
  });

  test('creating a valid skill succeeds and writes audit history', async () => {
    txMock.userSkill.create.mockResolvedValue({
      id: 'skill-1',
      userId: 'user-1',
      slug: 'investor-updates',
      name: 'Investor Updates',
      description: 'Handle investor update replies tersely.',
      body: '## Rules\n- Keep it concise.',
      enabled: true,
      catalogSummary: 'Handle investor update replies tersely.',
      archivedAt: null,
      createdAt: new Date('2026-03-19T00:00:00.000Z'),
      updatedAt: new Date('2026-03-19T00:00:00.000Z'),
    });
    txMock.actionHistory.create.mockResolvedValue({});

    const created = await createUserSkill({
      userId: 'user-1',
      name: 'Investor Updates',
      description: 'Handle investor update replies tersely.',
      body: '## Rules\n- Keep it concise.',
    });

    expect(created.slug).toBe('investor-updates');
    expect(txMock.actionHistory.create).toHaveBeenCalledOnce();
  });

  test('duplicate slug for the same user is rejected', async () => {
    prismaMock.$transaction.mockRejectedValue({ code: 'P2002' });

    await expect(
      createUserSkill({
        userId: 'user-1',
        slug: 'investor-updates',
        name: 'Investor Updates',
        description: 'Handle investor update replies tersely.',
        body: '## Rules\n- Keep it concise.',
      }),
    ).rejects.toMatchObject({
      code: 'user_skill_slug_conflict',
      status: 409,
    });
  });

  test('disabled records are excluded from selectable skills', async () => {
    prismaMock.userSkill.findMany.mockResolvedValue([
      {
        id: 'skill-1',
        userId: 'user-1',
        slug: 'investor-updates',
        name: 'Investor Updates',
        description: 'Handle investor update replies tersely.',
        body: '## Rules\n- Keep it concise.',
        enabled: true,
        catalogSummary: 'Handle investor update replies tersely.',
        archivedAt: null,
        createdAt: new Date('2026-03-19T00:00:00.000Z'),
        updatedAt: new Date('2026-03-19T00:00:00.000Z'),
      },
      {
        id: 'skill-2',
        userId: 'user-1',
        slug: 'disabled-skill',
        name: 'Disabled Skill',
        description: 'Hidden from selection.',
        body: 'Body',
        enabled: false,
        catalogSummary: 'Hidden from selection.',
        archivedAt: null,
        createdAt: new Date('2026-03-19T00:00:00.000Z'),
        updatedAt: new Date('2026-03-19T00:00:00.000Z'),
      },
    ]);

    const selectable = await listSelectableSkills('user-1');

    expect(selectable).toEqual([
      {
        id: 'skill-1',
        slug: 'investor-updates',
        name: 'Investor Updates',
        description: 'Handle investor update replies tersely.',
        catalogSummary: 'Handle investor update replies tersely.',
      },
    ]);
  });
});
