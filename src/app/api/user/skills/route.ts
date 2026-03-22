import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  isUnauthorizedError,
  requireUserId,
  unauthorizedResponse,
} from '@/app/api/user/settings/shared';
import {
  createUserSkill,
  listUserSkills,
  skillCreateSchema,
} from '@/lib/services/skills';
import {
  handleUserSkillRouteError,
  NO_STORE_HEADERS,
  toUserSkillResponse,
} from './shared';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const userId = await requireUserId();
    const skills = await listUserSkills(userId);

    return NextResponse.json(
      {
        success: true,
        skills: skills.map(toUserSkillResponse),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return unauthorizedResponse();
    }

    return handleUserSkillRouteError(error, {
      message: 'Failed to load skills.',
      code: 'user_skills_list_failed',
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = skillCreateSchema.parse(await request.json());
    const skill = await createUserSkill({
      userId,
      ...body,
    });

    return NextResponse.json(
      {
        success: true,
        skill: toUserSkillResponse(skill),
      },
      {
        status: 201,
        headers: NO_STORE_HEADERS,
      },
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
      message: 'Failed to create skill.',
      code: 'user_skill_create_failed',
    });
  }
}
