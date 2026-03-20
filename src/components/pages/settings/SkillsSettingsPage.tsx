'use client';

import React, { useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Archive,
  Eye,
  EyeOff,
  PencilLine,
  Plus,
  Sparkles,
  FileCode2,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/sidebar/button';
import { Input } from '@/components/ui/sidebar/input';
import { SettingsShell } from './SettingsShell';
import { useUserSkills, type UserSkillItem } from '@/hooks/useUserSkills';
import { cn } from '@/lib/utils';

type SkillDraft = {
  slug: string;
  name: string;
  description: string;
  body: string;
  enabled: boolean;
};

const EMPTY_DRAFT: SkillDraft = {
  slug: '',
  name: '',
  description: '',
  body: '',
  enabled: true,
};

const FIELD_LIMITS = {
  name: 120,
  slug: 80,
  description: 280,
  body: 12_000,
} as const;

const LEADING_FRONTMATTER_RE = /^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/;

type FieldErrors = Partial<Record<'name' | 'slug' | 'description' | 'body', string>>;

function validateDraft(draft: SkillDraft): FieldErrors {
  const errors: FieldErrors = {};
  const name = draft.name.trim();
  const description = draft.description.trim();
  const body = draft.body.trim().replace(LEADING_FRONTMATTER_RE, '').trim();
  const slug = draft.slug.trim();

  if (!name) errors.name = 'Name is required.';
  else if (name.length > FIELD_LIMITS.name)
    errors.name = `Must be under ${FIELD_LIMITS.name} characters.`;

  if (!description) errors.description = 'Description is required.';
  else if (description.length > FIELD_LIMITS.description)
    errors.description = `Must be under ${FIELD_LIMITS.description} characters.`;

  if (!body) errors.body = 'Body is required.';
  else if (body.length > FIELD_LIMITS.body)
    errors.body = `Must be under ${FIELD_LIMITS.body.toLocaleString()} characters.`;

  if (slug && slug.length > FIELD_LIMITS.slug)
    errors.slug = `Must be under ${FIELD_LIMITS.slug} characters.`;

  return errors;
}

function buildCanonicalSkillPreview(draft: SkillDraft): string {
  const name = draft.name.trim() || 'Untitled Skill';
  const description = draft.description.trim() || 'No description provided.';
  const rawBody = draft.body.trim();
  const body =
    (rawBody ? rawBody.replace(LEADING_FRONTMATTER_RE, '').trim() : '') ||
    '<empty body>';

  return [
    '---',
    `name: ${JSON.stringify(name)}`,
    `description: ${JSON.stringify(description)}`,
    '---',
    '',
    body,
  ].join('\n');
}

function toDraft(skill: UserSkillItem): SkillDraft {
  return {
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    body: skill.body,
    enabled: skill.enabled,
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function GradientSectionCard({
  title,
  subtitle,
  icon,
  accentFrom = 'from-amber-500/30',
  accentVia = 'via-amber-400/10',
  accentTo = 'to-transparent',
  children,
}: {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  accentFrom?: string;
  accentVia?: string;
  accentTo?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="relative"
    >
      <div
        className={cn(
          'rounded-2xl p-px bg-gradient-to-b',
          accentFrom,
          accentVia,
          accentTo,
        )}
      >
        <div className="rounded-[15px] bg-gray-950/90 backdrop-blur-sm">
          <header className="flex items-center gap-4 px-6 pt-6 pb-4">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-white/[0.07] to-white/[0.02] ring-1 ring-white/[0.06]">
              {icon}
            </div>
            <div className="min-w-0">
              <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-white">
                {title}
              </h3>
              {subtitle && (
                <p className="mt-0.5 text-[13px] leading-relaxed text-gray-400">
                  {subtitle}
                </p>
              )}
            </div>
          </header>

          <div className="px-6 pb-6">{children}</div>
        </div>
      </div>
    </motion.section>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500 mb-2">
      {children}
    </span>
  );
}

function CharCount({ value, max }: { value: string; max: number }) {
  const len = value.trim().length;
  const isOver = len > max;
  const isNear = len > max * 0.9;
  return (
    <span
      className={cn(
        'text-[11px] tabular-nums transition-colors',
        isOver
          ? 'text-red-400'
          : isNear
            ? 'text-amber-400/80'
            : 'text-gray-600',
      )}
    >
      {len.toLocaleString()}/{max.toLocaleString()}
    </span>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1.5 text-[12px] text-red-400">{message}</p>
  );
}

function StyledInput({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  return (
    <Input
      className={cn(
        'h-10 rounded-xl bg-black dark:bg-black border-white/[0.08] shadow-none text-[13px] text-white',
        'placeholder:text-gray-500 transition-all duration-200',
        'focus:border-white/20 focus:ring-2 focus:ring-white/[0.06]',
        'hover:border-white/15',
        className,
      )}
      {...props}
    />
  );
}

function StyledTextarea({
  className,
  ...props
}: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-xl border border-white/[0.08] bg-black px-3.5 py-3 shadow-none text-[13px] text-white',
        'placeholder:text-gray-500 transition-all duration-200 outline-none resize-none',
        'focus:border-white/20 focus:ring-2 focus:ring-white/[0.06]',
        'hover:border-white/15',
        'leading-relaxed',
        className,
      )}
      {...props}
    />
  );
}

function SkillCard({
  skill,
  isActive,
  saving,
  onSelect,
  onToggle,
  onArchive,
  index,
}: {
  skill: UserSkillItem;
  isActive: boolean;
  saving: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onArchive: () => void;
  index: number;
}) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.04, ease: 'easeOut' }}
      layout
      className="relative"
    >
      <div
        className={cn(
          'rounded-xl p-px transition-all duration-300',
          isActive
            ? 'bg-gradient-to-br from-amber-500/35 via-amber-400/15 to-amber-600/20'
            : 'bg-gradient-to-br from-gray-800/60 via-gray-800/30 to-gray-800/40 hover:from-gray-700/60 hover:via-gray-700/30 hover:to-gray-700/40',
        )}
      >
        <div
          className={cn(
            'rounded-[11px] p-4 transition-colors duration-300',
            isActive ? 'bg-gray-950/95' : 'bg-gray-950/80',
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <button
              type="button"
              onClick={onSelect}
              className="min-w-0 flex-1 text-left"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold text-white">
                  {skill.name}
                </p>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide ring-1 ring-inset',
                    skill.enabled
                      ? 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20'
                      : 'bg-gray-800/50 text-gray-500 ring-gray-700/40',
                  )}
                >
                  {skill.enabled ? 'Active' : 'Off'}
                </span>
              </div>
              <p className="mt-1.5 text-[12px] leading-relaxed text-gray-400 line-clamp-2">
                {skill.catalogSummary}
              </p>
              <p className="mt-2 font-mono text-[10px] tracking-wide text-gray-600">
                {skill.slug}
              </p>
            </button>

            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={onToggle}
                disabled={saving}
                className={cn(
                  'flex size-8 items-center justify-center rounded-lg transition-all duration-200 disabled:opacity-40 cursor-pointer',
                  'text-gray-500 hover:text-white hover:bg-white/[0.06]',
                )}
                title={skill.enabled ? 'Disable' : 'Enable'}
              >
                {skill.enabled ? (
                  <EyeOff className="size-3.5" />
                ) : (
                  <Eye className="size-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={onSelect}
                className="flex size-8 items-center justify-center rounded-lg text-gray-500 transition-all duration-200 hover:text-white hover:bg-white/[0.06] cursor-pointer"
                title="Edit"
              >
                <PencilLine className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={onArchive}
                disabled={saving}
                className="flex size-8 items-center justify-center rounded-lg text-gray-500 transition-all duration-200 hover:text-red-400 hover:bg-red-500/[0.06] disabled:opacity-40 cursor-pointer"
                title="Archive"
              >
                <Archive className="size-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </motion.article>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export const SkillsSettingsPage: React.FC = () => {
  const {
    skills,
    loading,
    saving,
    error,
    createSkill,
    updateSkill,
    archiveSkill,
  } = useUserSkills();
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SkillDraft>(EMPTY_DRAFT);
  const [localError, setLocalError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const activeSkill = useMemo(
    () => skills.find((skill) => skill.id === activeSkillId) ?? null,
    [activeSkillId, skills],
  );
  const enabledCount = skills.filter((skill) => skill.enabled).length;
  const preview = useMemo(() => buildCanonicalSkillPreview(draft), [draft]);

  const handleSelectSkill = useCallback(
    (skill: UserSkillItem) => {
      setActiveSkillId(skill.id);
      setDraft(toDraft(skill));
      setLocalError('');
      setFieldErrors({});
    },
    [],
  );

  const handleCreateNew = useCallback(() => {
    setActiveSkillId(null);
    setDraft(EMPTY_DRAFT);
    setLocalError('');
    setFieldErrors({});
  }, []);

  const handleDraftChange = useCallback(
    <K extends keyof SkillDraft>(key: K, value: SkillDraft[K]) => {
      setDraft((current) => ({ ...current, [key]: value }));
      setFieldErrors((current) => {
        if (!(key in current)) return current;
        const next = { ...current };
        delete next[key as keyof FieldErrors];
        return next;
      });
    },
    [],
  );

  const handleSave = useCallback(async () => {
    setLocalError('');

    // Auto-strip any leading YAML frontmatter the user may have pasted
    const cleanBody = draft.body
      .trim()
      .replace(LEADING_FRONTMATTER_RE, '')
      .trim();
    const cleanDraft = { ...draft, body: cleanBody };

    // Client-side validation
    const errors = validateDraft(cleanDraft);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    // Update the textarea if frontmatter was stripped
    if (cleanBody !== draft.body.trim()) {
      setDraft((current) => ({ ...current, body: cleanBody }));
    }

    try {
      if (activeSkill) {
        const updated = await updateSkill(activeSkill.id, {
          slug: cleanDraft.slug.trim() || undefined,
          name: cleanDraft.name,
          description: cleanDraft.description,
          body: cleanDraft.body,
          enabled: cleanDraft.enabled,
        });
        setDraft(toDraft(updated));
      } else {
        const created = await createSkill({
          slug: cleanDraft.slug.trim() || undefined,
          name: cleanDraft.name,
          description: cleanDraft.description,
          body: cleanDraft.body,
          enabled: cleanDraft.enabled,
        });
        setActiveSkillId(created.id);
        setDraft(toDraft(created));
      }
    } catch (saveError) {
      setLocalError(
        saveError instanceof Error ? saveError.message : 'Failed to save skill.',
      );
    }
  }, [activeSkill, draft, updateSkill, createSkill]);

  const handleToggleSkill = useCallback(
    async (skill: UserSkillItem) => {
      setLocalError('');
      try {
        const updated = await updateSkill(skill.id, {
          enabled: !skill.enabled,
        });
        if (activeSkillId === updated.id) {
          setDraft(toDraft(updated));
        }
      } catch (toggleError) {
        setLocalError(
          toggleError instanceof Error
            ? toggleError.message
            : 'Failed to update skill.',
        );
      }
    },
    [activeSkillId, updateSkill],
  );

  const handleArchiveSkill = useCallback(
    async (skill: UserSkillItem) => {
      if (
        !window.confirm(
          `Archive "${skill.name}"? This removes it from selection and the settings list.`,
        )
      ) {
        return;
      }
      setLocalError('');
      try {
        await archiveSkill(skill.id);
        if (activeSkillId === skill.id) {
          handleCreateNew();
        }
      } catch (archiveError) {
        setLocalError(
          archiveError instanceof Error
            ? archiveError.message
            : 'Failed to archive skill.',
        );
      }
    },
    [activeSkillId, archiveSkill, handleCreateNew],
  );

  return (
    <SettingsShell
      title="Skills"
      subtitle="Create user-authored guidance that the Executive Agent can selectively expose for a turn without adding tools or widening permissions."
      icon={Sparkles}
      iconColor="text-amber-300"
      mobileActions={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleCreateNew}
          aria-label="Create new skill"
        >
          <Plus className="size-4" />
        </Button>
      }
    >
      <GradientSectionCard
        title="Skill Inventory"
        subtitle="Enabled skills are candidates every turn — active only when the Executive Agent selects them or they match by exact name."
        icon={<Sparkles className="size-5 text-amber-400" />}
      >
        <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          {/* Left column — skill list */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <p className="text-sm font-medium text-gray-200">
                  {skills.length} skill{skills.length !== 1 ? 's' : ''}{' '}
                  <span className="text-gray-500">saved</span>
                </p>
                <p className="mt-0.5 text-[12px] text-gray-500">
                  {enabledCount} selectable by the Executive Agent
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCreateNew}
                className="rounded-lg border-white/[0.08] bg-transparent text-gray-300 hover:bg-white/[0.05] hover:text-white hover:border-white/15 transition-all duration-200 cursor-pointer"
              >
                <Plus className="size-3.5" />
                New skill
              </Button>
            </div>

            <div className="flex flex-col gap-2.5">
              {loading ? (
                <div className="flex items-center justify-center gap-2.5 rounded-xl border border-dashed border-gray-800/60 py-10">
                  <Loader2 className="size-4 animate-spin text-gray-600" />
                  <span className="text-sm text-gray-500">Loading skills…</span>
                </div>
              ) : skills.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-800/60 px-5 py-10 text-center">
                  <Sparkles className="mx-auto mb-3 size-8 text-gray-700" />
                  <p className="text-sm text-gray-400">No skills yet</p>
                  <p className="mt-1 text-[12px] text-gray-600">
                    Start with one focused instruction set — like how to triage
                    investor updates.
                  </p>
                </div>
              ) : (
                <AnimatePresence mode="popLayout">
                  {skills.map((skill, index) => (
                    <SkillCard
                      key={skill.id}
                      skill={skill}
                      isActive={skill.id === activeSkillId}
                      saving={saving}
                      onSelect={() => handleSelectSkill(skill)}
                      onToggle={() => {
                        void handleToggleSkill(skill);
                      }}
                      onArchive={() => {
                        void handleArchiveSkill(skill);
                      }}
                      index={index}
                    />
                  ))}
                </AnimatePresence>
              )}
            </div>
          </div>

          {/* Right column — editor */}
          <div>
            <div className="rounded-xl bg-gradient-to-b from-gray-800/40 to-gray-800/20 p-px">
              <div className="rounded-[11px] bg-gray-950/70 p-5">
                <div className="flex items-center justify-between gap-3 mb-5">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {activeSkill
                        ? `Editing ${activeSkill.name}`
                        : 'Create a new skill'}
                    </p>
                    <p className="mt-0.5 text-[12px] text-gray-500">
                      Global scope · read-only guidance for the agent
                    </p>
                  </div>
                  {activeSkill && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleCreateNew}
                      className="text-gray-400 hover:text-white hover:bg-white/[0.05] cursor-pointer"
                    >
                      <Plus className="size-3.5" />
                      New
                    </Button>
                  )}
                </div>

                <div className="flex flex-col gap-4">
                  <label className="block">
                    <div className="flex items-baseline justify-between gap-2">
                      <FieldLabel>
                        Name{' '}
                        <span className="text-red-400/70 normal-case">*</span>
                      </FieldLabel>
                      <CharCount
                        value={draft.name}
                        max={FIELD_LIMITS.name}
                      />
                    </div>
                    <StyledInput
                      value={draft.name}
                      onChange={(e) =>
                        handleDraftChange('name', e.target.value)
                      }
                      placeholder="e.g. Canvas Week Plan"
                      aria-invalid={!!fieldErrors.name}
                    />
                    <FieldError message={fieldErrors.name} />
                  </label>

                  <label className="block">
                    <div className="flex items-baseline justify-between gap-2">
                      <FieldLabel>Slug</FieldLabel>
                      <CharCount
                        value={draft.slug}
                        max={FIELD_LIMITS.slug}
                      />
                    </div>
                    <StyledInput
                      value={draft.slug}
                      onChange={(e) =>
                        handleDraftChange('slug', e.target.value)
                      }
                      placeholder="Auto-derived from name if blank"
                      aria-invalid={!!fieldErrors.slug}
                    />
                    <FieldError message={fieldErrors.slug} />
                  </label>

                  <label className="block">
                    <div className="flex items-baseline justify-between gap-2">
                      <FieldLabel>
                        Description{' '}
                        <span className="text-red-400/70 normal-case">*</span>
                      </FieldLabel>
                      <CharCount
                        value={draft.description}
                        max={FIELD_LIMITS.description}
                      />
                    </div>
                    <StyledInput
                      value={draft.description}
                      onChange={(e) =>
                        handleDraftChange('description', e.target.value)
                      }
                      placeholder="Short summary shown in the skill catalog"
                      aria-invalid={!!fieldErrors.description}
                    />
                    <FieldError message={fieldErrors.description} />
                  </label>

                  <div>
                    <div className="flex items-baseline justify-between gap-2">
                      <FieldLabel>
                        Body{' '}
                        <span className="text-red-400/70 normal-case">*</span>
                      </FieldLabel>
                      <CharCount
                        value={draft.body}
                        max={FIELD_LIMITS.body}
                      />
                    </div>
                    <StyledTextarea
                      value={draft.body}
                      onChange={(e) =>
                        handleDraftChange('body', e.target.value)
                      }
                      placeholder={
                        '## Context\n\nDescribe what this skill does…\n\n## Operating rules\n- Rule one\n- Rule two'
                      }
                      className="min-h-[200px]"
                      aria-invalid={!!fieldErrors.body}
                    />
                    <FieldError message={fieldErrors.body} />
                    <p className="mt-1.5 text-[11px] text-gray-600">
                      Markdown only — do not include YAML frontmatter (
                      <code className="text-[10px]">---</code>). Metadata is
                      added automatically.
                    </p>
                  </div>

                  <label className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-black px-4 py-3 transition-all duration-200 hover:border-white/15 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(e) =>
                        handleDraftChange('enabled', e.target.checked)
                      }
                      className="size-4 rounded border-gray-700 bg-transparent accent-white"
                    />
                    <div>
                      <p className="text-[13px] font-medium text-gray-200">
                        Enabled
                      </p>
                      <p className="text-[11px] text-gray-500">
                        Disabled skills stay stored but are hidden from the
                        catalog.
                      </p>
                    </div>
                  </label>

                  <AnimatePresence>
                    {(error || localError) && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="rounded-xl border border-red-500/20 bg-red-500/[0.06] px-4 py-2.5 text-[13px] text-red-300">
                          {localError || error}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="flex flex-wrap items-center gap-2.5 pt-1">
                    <Button
                      type="button"
                      onClick={() => {
                        void handleSave();
                      }}
                      disabled={saving}
                      className="rounded-xl bg-white px-5 text-[13px] font-semibold text-gray-950 shadow-lg shadow-white/[0.06] transition-all duration-200 hover:bg-gray-100 disabled:opacity-50 cursor-pointer"
                    >
                      {saving && (
                        <Loader2 className="size-3.5 animate-spin" />
                      )}
                      {activeSkill ? 'Save changes' : 'Create skill'}
                    </Button>
                    {activeSkill && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          void handleArchiveSkill(activeSkill);
                        }}
                        disabled={saving}
                        className="text-gray-500 hover:text-red-400 cursor-pointer"
                      >
                        <Archive className="size-3.5" />
                        Archive
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </GradientSectionCard>

      {/* Canonical Preview */}
      <GradientSectionCard
        title="Canonical Preview"
        subtitle="Auto-generated SKILL.md injected into prompts when a skill is selected. You only write the body — metadata is wrapped automatically."
        icon={<FileCode2 className="size-5 text-amber-400/70" />}
        accentFrom="from-gray-700/30"
        accentVia="via-gray-800/20"
        accentTo="to-gray-800/10"
      >
        <div className="rounded-xl bg-gradient-to-b from-gray-800/30 to-gray-800/15 p-px">
          <pre className="rounded-[11px] bg-gray-950/60 p-5 text-[12px] leading-[1.8] text-gray-300 font-mono overflow-x-auto">
            {preview}
          </pre>
        </div>
      </GradientSectionCard>
    </SettingsShell>
  );
};
