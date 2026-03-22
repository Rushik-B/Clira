import { beforeEach, describe, expect, test, vi } from 'vitest';
import { NextResponse } from 'next/server';

const {
  requireUserIdMock,
  isUnauthorizedErrorMock,
  createUserSkillMock,
  updateUserSkillMock,
} = vi.hoisted(() => ({
  requireUserIdMock: vi.fn(),
  isUnauthorizedErrorMock: vi.fn(),
  createUserSkillMock: vi.fn(),
  updateUserSkillMock: vi.fn(),
}));

vi.mock('@/app/api/user/settings/shared', () => ({
  requireUserId: requireUserIdMock,
  isUnauthorizedError: isUnauthorizedErrorMock,
  unauthorizedResponse: () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
}));

vi.mock('@/lib/services/skills', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/skills')>();
  return {
    ...actual,
    createUserSkill: createUserSkillMock,
    updateUserSkill: updateUserSkillMock,
  };
});

import * as skillsRoute from '@/app/api/user/skills/route';
import * as skillDetailRoute from '@/app/api/user/skills/[skillId]/route';

describe('user skills routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserIdMock.mockResolvedValue('user-1');
    isUnauthorizedErrorMock.mockReturnValue(false);
  });

  test('unauthorized list access returns 401', async () => {
    requireUserIdMock.mockRejectedValueOnce(new Error('UNAUTHORIZED'));
    isUnauthorizedErrorMock.mockReturnValueOnce(true);

    const response = await skillsRoute.GET();

    expect(response.status).toBe(401);
  });

  test('malformed create payload returns 400 with validation details', async () => {
    const request = new Request('http://localhost/api/user/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', description: '', body: '' }),
    });

    const response = await skillsRoute.POST(request as never);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.code).toBe('user_skill_invalid');
    expect(payload.details).toBeDefined();
  });

  test('create flow returns a stable success shape', async () => {
    createUserSkillMock.mockResolvedValue({
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

    const request = new Request('http://localhost/api/user/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Investor Updates',
        description: 'Handle investor update replies tersely.',
        body: '## Rules\n- Keep it concise.',
      }),
    });

    const response = await skillsRoute.POST(request as never);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload).toMatchObject({
      success: true,
      skill: {
        id: 'skill-1',
        slug: 'investor-updates',
        enabled: true,
      },
    });
  });

  test('update flow returns a stable success shape', async () => {
    updateUserSkillMock.mockResolvedValue({
      id: 'skill-1',
      userId: 'user-1',
      slug: 'investor-updates',
      name: 'Investor Updates',
      description: 'Handle investor update replies tersely.',
      body: '## Rules\n- Keep it concise.',
      enabled: false,
      catalogSummary: 'Handle investor update replies tersely.',
      archivedAt: null,
      createdAt: new Date('2026-03-19T00:00:00.000Z'),
      updatedAt: new Date('2026-03-19T00:00:00.000Z'),
    });

    const request = new Request('http://localhost/api/user/skills/skill-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });

    const response = await skillDetailRoute.PATCH(request as never, {
      params: Promise.resolve({ skillId: 'skill-1' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      success: true,
      skill: {
        id: 'skill-1',
        enabled: false,
      },
    });
  });
});
