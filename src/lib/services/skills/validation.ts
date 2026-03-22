import { marked } from 'marked';
import {
  USER_SKILL_LIMITS,
  UserSkillServiceError,
  type CreateUserSkillInput,
  type UpdateUserSkillInput,
} from './types';

const LEADING_FRONTMATTER_PATTERN = /^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/;

function assertTextField(name: string, value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new UserSkillServiceError(`${name} is required.`, {
      code: 'user_skill_invalid',
      status: 400,
      details: { field: name },
    });
  }

  if (trimmed.length > maxLength) {
    throw new UserSkillServiceError(`${name} exceeds the allowed length.`, {
      code: 'user_skill_invalid',
      status: 400,
      details: { field: name, maxLength },
    });
  }

  return trimmed;
}

export function normalizeSkillSlug(value: string): string {
  const ascii = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  const normalized = ascii
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  if (!normalized) {
    throw new UserSkillServiceError('Skill slug could not be normalized to a valid value.', {
      code: 'user_skill_invalid',
      status: 400,
      details: { field: 'slug' },
    });
  }

  if (normalized.length > USER_SKILL_LIMITS.slugMaxLength) {
    throw new UserSkillServiceError('Skill slug exceeds the allowed length.', {
      code: 'user_skill_invalid',
      status: 400,
      details: {
        field: 'slug',
        maxLength: USER_SKILL_LIMITS.slugMaxLength,
      },
    });
  }

  return normalized;
}

function extractPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function deriveCatalogSummary(params: {
  name: string;
  description: string;
  body: string;
}): string {
  const plainText = extractPlainText(params.body);
  const candidate = params.description || plainText || params.name;
  return candidate.slice(0, USER_SKILL_LIMITS.catalogSummaryMaxLength).trim();
}

export function assertSupportedSkillMarkdown(body: string): string {
  const trimmed = body.trim();

  if (!trimmed) {
    throw new UserSkillServiceError('Skill body is required.', {
      code: 'user_skill_invalid',
      status: 400,
      details: { field: 'body' },
    });
  }

  if (trimmed.length > USER_SKILL_LIMITS.bodyMaxLength) {
    throw new UserSkillServiceError('Skill body exceeds the allowed length.', {
      code: 'user_skill_invalid',
      status: 400,
      details: {
        field: 'body',
        maxLength: USER_SKILL_LIMITS.bodyMaxLength,
      },
    });
  }

  if (LEADING_FRONTMATTER_PATTERN.test(trimmed)) {
    throw new UserSkillServiceError('Frontmatter is not supported for skills in MVP.', {
      code: 'user_skill_unsupported_frontmatter',
      status: 400,
      details: { field: 'body' },
    });
  }

  try {
    marked.lexer(trimmed);
  } catch (error) {
    throw new UserSkillServiceError('Skill body must be valid markdown.', {
      code: 'user_skill_invalid_markdown',
      status: 400,
      details: { field: 'body' },
      cause: error,
    });
  }

  return trimmed;
}

export function normalizeSkillDocumentInput(
  input: Pick<CreateUserSkillInput, 'slug' | 'name' | 'description' | 'body'>,
): {
  slug: string;
  name: string;
  description: string;
  body: string;
  catalogSummary: string;
} {
  const name = assertTextField('name', input.name, USER_SKILL_LIMITS.nameMaxLength);
  const description = assertTextField(
    'description',
    input.description,
    USER_SKILL_LIMITS.descriptionMaxLength,
  );
  const body = assertSupportedSkillMarkdown(input.body);
  const slug = normalizeSkillSlug(input.slug ?? name);
  const catalogSummary = deriveCatalogSummary({ name, description, body });

  return {
    slug,
    name,
    description,
    body,
    catalogSummary,
  };
}

export function normalizeSkillUpdateInput(
  input: Pick<UpdateUserSkillInput, 'slug' | 'name' | 'description' | 'body'>,
  existing: {
    slug: string;
    name: string;
    description: string;
    body: string;
  },
): {
  slug: string;
  name: string;
  description: string;
  body: string;
  catalogSummary: string;
} {
  return normalizeSkillDocumentInput({
    slug: input.slug ?? existing.slug,
    name: input.name ?? existing.name,
    description: input.description ?? existing.description,
    body: input.body ?? existing.body,
  });
}

function escapeFrontmatterValue(value: string): string {
  return JSON.stringify(value);
}

export function renderCanonicalSkillDocument(skill: {
  name: string;
  description: string;
  body: string;
}): string {
  return [
    '---',
    `name: ${escapeFrontmatterValue(skill.name)}`,
    `description: ${escapeFrontmatterValue(skill.description)}`,
    '---',
    '',
    skill.body.trim(),
  ].join('\n');
}
