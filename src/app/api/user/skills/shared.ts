import { NextResponse } from 'next/server';
import {
  isUserSkillServiceError,
  type UserSkillRecord,
} from '@/lib/services/skills';

export const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
};

export type UserSkillResponsePayload = {
  id: string;
  slug: string;
  name: string;
  description: string;
  body: string;
  enabled: boolean;
  catalogSummary: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function toUserSkillResponse(skill: UserSkillRecord): UserSkillResponsePayload {
  return {
    id: skill.id,
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    body: skill.body,
    enabled: skill.enabled,
    catalogSummary: skill.catalogSummary,
    archivedAt: skill.archivedAt?.toISOString() ?? null,
    createdAt: skill.createdAt.toISOString(),
    updatedAt: skill.updatedAt.toISOString(),
  };
}

export function handleUserSkillRouteError(error: unknown, fallback: {
  message: string;
  code: string;
}) {
  if (isUserSkillServiceError(error)) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        details: error.details ?? null,
      },
      {
        status: error.status,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  return NextResponse.json(
    {
      error: fallback.message,
      code: fallback.code,
    },
    {
      status: 500,
      headers: NO_STORE_HEADERS,
    },
  );
}
