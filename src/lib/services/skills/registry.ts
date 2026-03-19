import { prisma } from '@/lib/prisma';
import { UserSkillServiceError, type CreateUserSkillInput, type UpdateUserSkillInput, type UserSkillRecord } from './types';
import {
  normalizeSkillDocumentInput,
  normalizeSkillUpdateInput,
} from './validation';

type RawUserSkillRecord = {
  id: string;
  userId: string;
  slug: string;
  name: string;
  description: string;
  body: string;
  enabled: boolean;
  catalogSummary: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function mapUserSkillRecord(record: RawUserSkillRecord): UserSkillRecord {
  return {
    id: record.id,
    userId: record.userId,
    slug: record.slug,
    name: record.name,
    description: record.description,
    body: record.body,
    enabled: record.enabled,
    catalogSummary: record.catalogSummary,
    archivedAt: record.archivedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

async function getOwnedSkillOrThrow(userId: string, skillId: string): Promise<UserSkillRecord> {
  const record = await prisma.userSkill.findFirst({
    where: {
      id: skillId,
      userId,
      archivedAt: null,
    },
  });

  if (!record) {
    throw new UserSkillServiceError('Skill not found.', {
      code: 'user_skill_not_found',
      status: 404,
    });
  }

  return mapUserSkillRecord(record as RawUserSkillRecord);
}

export async function listUserSkills(userId: string): Promise<UserSkillRecord[]> {
  const records = await prisma.userSkill.findMany({
    where: {
      userId,
      archivedAt: null,
    },
    orderBy: [
      { updatedAt: 'desc' },
      { createdAt: 'desc' },
    ],
  });

  return records.map((record) => mapUserSkillRecord(record as RawUserSkillRecord));
}

export async function getUserSkillById(params: {
  userId: string;
  skillId: string;
}): Promise<UserSkillRecord> {
  return getOwnedSkillOrThrow(params.userId, params.skillId);
}

export async function createUserSkill(input: CreateUserSkillInput): Promise<UserSkillRecord> {
  const normalized = normalizeSkillDocumentInput(input);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const skill = await tx.userSkill.create({
        data: {
          userId: input.userId,
          slug: normalized.slug,
          name: normalized.name,
          description: normalized.description,
          body: normalized.body,
          enabled: input.enabled ?? true,
          catalogSummary: normalized.catalogSummary,
        },
      });

      await tx.actionHistory.create({
        data: {
          userId: input.userId,
          actionType: 'SETTINGS_CHANGED',
          actionSummary: `Created skill "${normalized.name}"`,
          actionDetails: {
            event: 'user_skill_created',
            skillId: skill.id,
            slug: normalized.slug,
            enabled: skill.enabled,
          },
          metadata: { source: 'user_skills' },
        },
      });

      return skill;
    });

    return mapUserSkillRecord(created as RawUserSkillRecord);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    ) {
      throw new UserSkillServiceError('A skill with this slug already exists.', {
        code: 'user_skill_slug_conflict',
        status: 409,
        details: { slug: normalized.slug },
        cause: error,
      });
    }

    throw error;
  }
}

export async function updateUserSkill(input: UpdateUserSkillInput): Promise<UserSkillRecord> {
  const current = await getOwnedSkillOrThrow(input.userId, input.skillId);
  const normalized = normalizeSkillUpdateInput(input, current);
  const nextEnabled = input.enabled ?? current.enabled;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const skill = await tx.userSkill.update({
        where: { id: current.id },
        data: {
          slug: normalized.slug,
          name: normalized.name,
          description: normalized.description,
          body: normalized.body,
          enabled: nextEnabled,
          catalogSummary: normalized.catalogSummary,
        },
      });

      const event =
        input.enabled != null && input.name == null && input.description == null && input.body == null && input.slug == null
          ? nextEnabled
            ? 'user_skill_enabled'
            : 'user_skill_disabled'
          : 'user_skill_updated';
      const actionSummary =
        event === 'user_skill_enabled'
          ? `Enabled skill "${skill.name}"`
          : event === 'user_skill_disabled'
            ? `Disabled skill "${skill.name}"`
            : `Updated skill "${skill.name}"`;

      await tx.actionHistory.create({
        data: {
          userId: input.userId,
          actionType: 'SETTINGS_CHANGED',
          actionSummary,
          actionDetails: {
            event,
            skillId: skill.id,
            slug: skill.slug,
            enabled: skill.enabled,
          },
          metadata: { source: 'user_skills' },
        },
      });

      return skill;
    });

    return mapUserSkillRecord(updated as RawUserSkillRecord);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    ) {
      throw new UserSkillServiceError('A skill with this slug already exists.', {
        code: 'user_skill_slug_conflict',
        status: 409,
        details: { slug: normalized.slug },
        cause: error,
      });
    }

    throw error;
  }
}

export async function archiveUserSkill(params: {
  userId: string;
  skillId: string;
}): Promise<UserSkillRecord> {
  const current = await getOwnedSkillOrThrow(params.userId, params.skillId);
  const archivedAt = new Date();

  const archived = await prisma.$transaction(async (tx) => {
    const skill = await tx.userSkill.update({
      where: { id: current.id },
      data: {
        enabled: false,
        archivedAt,
      },
    });

    await tx.actionHistory.create({
      data: {
        userId: params.userId,
        actionType: 'SETTINGS_CHANGED',
        actionSummary: `Archived skill "${skill.name}"`,
        actionDetails: {
          event: 'user_skill_archived',
          skillId: skill.id,
          slug: skill.slug,
        },
        metadata: { source: 'user_skills' },
      },
    });

    return skill;
  });

  return mapUserSkillRecord(archived as RawUserSkillRecord);
}
