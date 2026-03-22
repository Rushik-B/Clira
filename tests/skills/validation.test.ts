import { describe, expect, test } from 'vitest';
import {
  normalizeSkillDocumentInput,
  normalizeSkillSlug,
  renderCanonicalSkillDocument,
} from '@/lib/services/skills';

describe('skill validation', () => {
  test('normalizes a valid skill document', () => {
    const normalized = normalizeSkillDocumentInput({
      name: 'Investor Updates',
      description: 'Handle investor update replies tersely.',
      body: '## Rules\n- Keep it concise.\n- Lead with the delta.',
    });

    expect(normalized.slug).toBe('investor-updates');
    expect(normalized.catalogSummary).toBe('Handle investor update replies tersely.');
  });

  test('rejects unsupported frontmatter in the body', () => {
    expect(() =>
      normalizeSkillDocumentInput({
        name: 'Investor Updates',
        description: 'Handle investor update replies tersely.',
        body: '---\nname: Broken\n---\nBody',
      }),
    ).toThrow(/Frontmatter is not supported/i);
  });

  test('rejects an oversized body', () => {
    expect(() =>
      normalizeSkillDocumentInput({
        name: 'Investor Updates',
        description: 'Handle investor update replies tersely.',
        body: 'a'.repeat(12_001),
      }),
    ).toThrow(/exceeds the allowed length/i);
  });

  test('slug normalization strips punctuation and spacing', () => {
    expect(normalizeSkillSlug('  ACME / Investor   Updates  ')).toBe('acme-investor-updates');
  });

  test('renders the canonical SKILL.md shape', () => {
    expect(
      renderCanonicalSkillDocument({
        name: 'Investor Updates',
        description: 'Handle investor update replies tersely.',
        body: '## Rules\n- Keep it concise.',
      }),
    ).toContain('description: "Handle investor update replies tersely."');
  });
});
