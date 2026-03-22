import {
  USER_SKILL_LIMITS,
  type SelectableSkill,
  type SkillExposure,
  type UserSkillRecord,
} from './types';
import { listUserSkills } from './registry';

function toSelectableSkill(skill: UserSkillRecord): SelectableSkill {
  return {
    id: skill.id,
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    catalogSummary: skill.catalogSummary,
  };
}

export async function listSelectableSkills(userId: string): Promise<SelectableSkill[]> {
  const skills = await listUserSkills(userId);
  return skills
    .filter((skill) => skill.enabled && !skill.archivedAt)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(toSelectableSkill);
}

export async function resolveSkillExposure(params: {
  userId: string;
  selectedSkillIds: readonly string[];
}): Promise<SkillExposure> {
  const skills = await listUserSkills(params.userId);
  const selectableSkills = skills
    .filter((skill) => skill.enabled && !skill.archivedAt)
    .sort((left, right) => left.name.localeCompare(right.name));
  const selectableById = new Map(selectableSkills.map((skill) => [skill.id, skill]));
  const uniqueSelectedIds = Array.from(new Set(params.selectedSkillIds)).slice(
    0,
    USER_SKILL_LIMITS.maxSelectableSkills,
  );

  const selectedSkills = uniqueSelectedIds
    .map((skillId) => selectableById.get(skillId) ?? null)
    .filter((skill): skill is UserSkillRecord => Boolean(skill));

  return {
    selectedSkillIds: selectedSkills.map((skill) => skill.id),
    selectedSkills,
    availableSkills: selectableSkills.map(toSelectableSkill),
    unavailableSkillIds: uniqueSelectedIds.filter((skillId) => !selectableById.has(skillId)),
  };
}
