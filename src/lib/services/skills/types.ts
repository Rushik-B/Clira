import { z } from 'zod';

export const USER_SKILL_LIMITS = {
  slugMaxLength: 80,
  nameMaxLength: 120,
  descriptionMaxLength: 280,
  bodyMaxLength: 12_000,
  catalogSummaryMaxLength: 220,
  maxSelectableSkills: 3,
  maxAvailableCatalogSkills: 16,
  maxAvailableCatalogChars: 2_400,
  maxSelectedSkillCharsTotal: 4_800,
  maxSelectedSkillCharsPerSkill: 1_800,
} as const;

export const skillCreateSchema = z.object({
  slug: z.string().min(1).max(USER_SKILL_LIMITS.slugMaxLength).optional(),
  name: z.string().trim().min(1).max(USER_SKILL_LIMITS.nameMaxLength),
  description: z.string().trim().min(1).max(USER_SKILL_LIMITS.descriptionMaxLength),
  body: z.string().min(1).max(USER_SKILL_LIMITS.bodyMaxLength),
  enabled: z.boolean().optional(),
});

export const skillUpdateSchema = z.object({
  slug: z.string().min(1).max(USER_SKILL_LIMITS.slugMaxLength).optional(),
  name: z.string().trim().min(1).max(USER_SKILL_LIMITS.nameMaxLength).optional(),
  description: z.string().trim().min(1).max(USER_SKILL_LIMITS.descriptionMaxLength).optional(),
  body: z.string().min(1).max(USER_SKILL_LIMITS.bodyMaxLength).optional(),
  enabled: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one skill field must be provided.',
});

export type CreateUserSkillInput = z.infer<typeof skillCreateSchema> & {
  userId: string;
};

export type UpdateUserSkillInput = z.infer<typeof skillUpdateSchema> & {
  userId: string;
  skillId: string;
};

export type UserSkillRecord = {
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

export type SelectableSkill = {
  id: string;
  slug: string;
  name: string;
  description: string;
  catalogSummary: string;
};

export type SkillExposure = {
  selectedSkillIds: string[];
  selectedSkills: UserSkillRecord[];
  availableSkills: SelectableSkill[];
  unavailableSkillIds: string[];
};

export type SkillPromptDegradation = {
  code:
    | 'catalog_count_truncated'
    | 'catalog_char_budget_exceeded'
    | 'selected_count_truncated'
    | 'selected_body_truncated';
  message: string;
  affectedSkillIds?: string[];
  droppedCount?: number;
};

export type SkillPromptCompilation = {
  availableSkillLines: string[];
  selectedSkillFragments: string[];
  reminderLines: string[];
  degradedSummaryLines: string[];
  metadata: {
    availableSkillCount: number;
    selectedSkillIds: string[];
    degradations: SkillPromptDegradation[];
  };
};

export class UserSkillServiceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    message: string,
    options: {
      code: string;
      status: number;
      details?: unknown;
      cause?: unknown;
    },
  ) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'UserSkillServiceError';
    this.code = options.code;
    this.status = options.status;
    this.details = options.details;
  }
}

export function isUserSkillServiceError(error: unknown): error is UserSkillServiceError {
  return error instanceof UserSkillServiceError;
}
