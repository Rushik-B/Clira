'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Eye,
  EyeOff,
  PencilLine,
  Plus,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/sidebar/button';
import { Input } from '@/components/ui/sidebar/input';
import { SettingsShell, SettingsSectionCard } from './SettingsShell';
import { useUserSkills, type UserSkillItem } from '@/hooks/useUserSkills';

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

function buildCanonicalSkillPreview(draft: SkillDraft): string {
  const name = draft.name.trim() || 'Untitled Skill';
  const description = draft.description.trim() || 'No description provided.';
  const body = draft.body.trim() || '<empty body>';

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

  useEffect(() => {
    if (activeSkillId && !skills.some((skill) => skill.id === activeSkillId)) {
      setActiveSkillId(null);
      setDraft(EMPTY_DRAFT);
    }
  }, [activeSkillId, skills]);

  const activeSkill = useMemo(
    () => skills.find((skill) => skill.id === activeSkillId) ?? null,
    [activeSkillId, skills],
  );
  const enabledCount = skills.filter((skill) => skill.enabled).length;
  const preview = useMemo(() => buildCanonicalSkillPreview(draft), [draft]);

  const handleSelectSkill = (skill: UserSkillItem) => {
    setActiveSkillId(skill.id);
    setDraft(toDraft(skill));
    setLocalError('');
  };

  const handleCreateNew = () => {
    setActiveSkillId(null);
    setDraft(EMPTY_DRAFT);
    setLocalError('');
  };

  const handleDraftChange = <K extends keyof SkillDraft>(key: K, value: SkillDraft[K]) => {
    setDraft((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const handleSave = async () => {
    setLocalError('');

    try {
      if (activeSkill) {
        const updated = await updateSkill(activeSkill.id, {
          slug: draft.slug.trim() || undefined,
          name: draft.name,
          description: draft.description,
          body: draft.body,
          enabled: draft.enabled,
        });
        setDraft(toDraft(updated));
      } else {
        const created = await createSkill({
          slug: draft.slug.trim() || undefined,
          name: draft.name,
          description: draft.description,
          body: draft.body,
          enabled: draft.enabled,
        });
        setActiveSkillId(created.id);
        setDraft(toDraft(created));
      }
    } catch (saveError) {
      setLocalError(saveError instanceof Error ? saveError.message : 'Failed to save skill.');
    }
  };

  const handleToggleSkill = async (skill: UserSkillItem) => {
    setLocalError('');

    try {
      const updated = await updateSkill(skill.id, {
        enabled: !skill.enabled,
      });
      if (activeSkillId === updated.id) {
        setDraft(toDraft(updated));
      }
    } catch (toggleError) {
      setLocalError(toggleError instanceof Error ? toggleError.message : 'Failed to update skill.');
    }
  };

  const handleArchiveSkill = async (skill: UserSkillItem) => {
    if (!window.confirm(`Archive "${skill.name}"? This removes it from selection and the settings list.`)) {
      return;
    }

    setLocalError('');

    try {
      await archiveSkill(skill.id);
      if (activeSkillId === skill.id) {
        handleCreateNew();
      }
    } catch (archiveError) {
      setLocalError(archiveError instanceof Error ? archiveError.message : 'Failed to archive skill.');
    }
  };

  return (
    <SettingsShell
      title="Skills"
      subtitle="Create user-authored guidance that the Executive Agent can selectively expose for a turn without adding tools or widening permissions."
      icon={Sparkles}
      iconColor="text-amber-300"
      mobileActions={(
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleCreateNew}
          aria-label="Create new skill"
        >
          <Plus className="h-4 w-4" />
        </Button>
      )}
    >
      <SettingsSectionCard
        title="Skill Inventory"
        description="Enabled skills are candidates every turn. They only become active when the Executive Agent explicitly selects them or they are deterministically preselected by exact name."
        icon={<Sparkles className="h-5 w-5" />}
      >
        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-2xl border border-gray-800/70 bg-black/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-white">{skills.length} skills saved</p>
                <p className="text-xs text-gray-400">{enabledCount} currently selectable by the Executive Agent</p>
              </div>
              <Button type="button" variant="outline" onClick={handleCreateNew}>
                <Plus className="h-4 w-4" />
                New skill
              </Button>
            </div>

            <div className="mt-4 space-y-3">
              {loading ? (
                <div className="rounded-xl border border-dashed border-gray-800 px-4 py-6 text-sm text-gray-400">
                  Loading skills…
                </div>
              ) : skills.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-800 px-4 py-6 text-sm text-gray-400">
                  No skills yet. Start with one focused reusable instruction set, such as how to triage investor updates or how to answer vendor check-ins.
                </div>
              ) : (
                skills.map((skill) => {
                  const isActive = skill.id === activeSkillId;

                  return (
                    <article
                      key={skill.id}
                      className={`rounded-2xl border p-4 transition-colors ${
                        isActive
                          ? 'border-amber-500/40 bg-amber-500/10'
                          : 'border-gray-800/80 bg-gray-950/70'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => handleSelectSkill(skill)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-semibold text-white">{skill.name}</p>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                skill.enabled
                                  ? 'bg-emerald-500/15 text-emerald-300'
                                  : 'bg-gray-700/70 text-gray-300'
                              }`}
                            >
                              {skill.enabled ? 'Enabled' : 'Disabled'}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-gray-400">{skill.catalogSummary}</p>
                          <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-gray-500">
                            slug: {skill.slug}
                          </p>
                        </button>

                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => handleToggleSkill(skill)}
                            disabled={saving}
                          >
                            {skill.enabled ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            {skill.enabled ? 'Disable' : 'Enable'}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => handleSelectSkill(skill)}
                          >
                            <PencilLine className="h-4 w-4" />
                            Edit
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => handleArchiveSkill(skill)}
                            disabled={saving}
                          >
                            <Archive className="h-4 w-4" />
                            Archive
                          </Button>
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-800/70 bg-black/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-white">
                  {activeSkill ? `Editing ${activeSkill.name}` : 'Create a new skill'}
                </p>
                <p className="text-xs text-gray-400">
                  Skills are global-only in MVP and remain read-only guidance.
                </p>
              </div>
              {activeSkill ? (
                <Button type="button" variant="outline" size="sm" onClick={handleCreateNew}>
                  <Plus className="h-4 w-4" />
                  New
                </Button>
              ) : null}
            </div>

            <div className="mt-4 space-y-4">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium uppercase tracking-[0.16em] text-gray-400">Name</span>
                <Input
                  value={draft.name}
                  onChange={(event) => handleDraftChange('name', event.target.value)}
                  placeholder="Investor updates"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium uppercase tracking-[0.16em] text-gray-400">Slug</span>
                <Input
                  value={draft.slug}
                  onChange={(event) => handleDraftChange('slug', event.target.value)}
                  placeholder="Optional. Blank derives from the name."
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium uppercase tracking-[0.16em] text-gray-400">Description</span>
                <Input
                  value={draft.description}
                  onChange={(event) => handleDraftChange('description', event.target.value)}
                  placeholder="One compact summary the model can scan in the available-skills catalog."
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium uppercase tracking-[0.16em] text-gray-400">Body</span>
                <textarea
                  value={draft.body}
                  onChange={(event) => handleDraftChange('body', event.target.value)}
                  placeholder={'## Context\n\n## Operating rules\n- ...'}
                  className="min-h-[220px] w-full rounded-xl border border-gray-800 bg-gray-950/80 px-3 py-3 text-sm text-gray-100 outline-none transition-colors placeholder:text-gray-500 focus:border-amber-500/40"
                />
              </label>

              <label className="flex items-center gap-3 rounded-xl border border-gray-800 bg-gray-950/80 px-3 py-3">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) => handleDraftChange('enabled', event.target.checked)}
                  className="h-4 w-4 rounded border-gray-700 bg-black"
                />
                <div>
                  <p className="text-sm font-medium text-white">Enabled</p>
                  <p className="text-xs text-gray-400">
                    Disabled skills stay stored but are hidden from the Executive Agent catalog.
                  </p>
                </div>
              </label>

              {(error || localError) ? (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  {localError || error}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={handleSave} disabled={saving}>
                  {activeSkill ? 'Save changes' : 'Create skill'}
                </Button>
                {activeSkill ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleArchiveSkill(activeSkill)}
                    disabled={saving}
                  >
                    <Archive className="h-4 w-4" />
                    Archive
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard
        title="Canonical Preview"
        description="This is the virtual SKILL.md representation injected into prompts when a skill is selected for a turn."
        icon={<PencilLine className="h-5 w-5" />}
      >
        <pre className="overflow-x-auto rounded-2xl border border-gray-800 bg-gray-950/80 p-4 text-xs leading-6 text-gray-200">
          {preview}
        </pre>
      </SettingsSectionCard>
    </SettingsShell>
  );
};
