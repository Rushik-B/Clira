import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  isUnauthorizedError,
  requireUserId,
  unauthorizedResponse,
} from '@/app/api/user/settings/shared';
import {
  archiveUserSkill,
  getUserSkillById,
  skillUpdateSchema,
  updateUserSkill,
} from '@/lib/services/skills';
import {
  handleUserSkillRouteError,
  NO_STORE_HEADERS,
  toUserSkillResponse,
} from '../shared';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ skillId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { skillId } = await context.params;
    const skill = await getUserSkillById({ userId, skillId });

    return NextResponse.json(
      {
        success: true,
        skill: toUserSkillResponse(skill),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return unauthorizedResponse();
    }

    return handleUserSkillRouteError(error, {
      message: 'Failed to load skill.',
      code: 'user_skill_get_failed',
    });
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ skillId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { skillId } = await context.params;
    const body = skillUpdateSchema.parse(await request.json());
    const skill = await updateUserSkill({
      userId,
      skillId,
      ...body,
    });

    return NextResponse.json(
      {
        success: true,
        skill: toUserSkillResponse(skill),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return unauthorizedResponse();
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Invalid skill payload.',
          code: 'user_skill_invalid',
          details: error.flatten(),
        },
        {
          status: 400,
          headers: NO_STORE_HEADERS,
        },
      );
    }

    return handleUserSkillRouteError(error, {
      message: 'Failed to update skill.',
      code: 'user_skill_update_failed',
    });
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ skillId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { skillId } = await context.params;
    const skill = await archiveUserSkill({ userId, skillId });

    return NextResponse.json(
      {
        success: true,
        skill: toUserSkillResponse(skill),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return unauthorizedResponse();
    }

    return handleUserSkillRouteError(error, {
      message: 'Failed to archive skill.',
      code: 'user_skill_archive_failed',
    });
  }
}
