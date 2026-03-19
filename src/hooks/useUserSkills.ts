'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type UserSkillItem = {
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

type CreateSkillPayload = {
  slug?: string;
  name: string;
  description: string;
  body: string;
  enabled?: boolean;
};

type UpdateSkillPayload = Partial<CreateSkillPayload> & {
  enabled?: boolean;
};

function readErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string') {
    return (data as { error: string }).error;
  }

  return fallback;
}

export function useUserSkills() {
  const [skills, setSkills] = useState<UserSkillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const requestSeqRef = useRef(0);

  const refreshSkills = useCallback(async () => {
    const requestId = ++requestSeqRef.current;
    setLoading((current) => current && requestId === 1);

    try {
      const response = await fetch('/api/user/skills', {
        cache: 'no-store',
      });
      const data = await response.json().catch(() => null);

      if (requestId !== requestSeqRef.current) {
        return;
      }

      if (!response.ok || !data?.success) {
        setError(readErrorMessage(data, 'Failed to load skills.'));
        return;
      }

      setSkills(Array.isArray(data.skills) ? data.skills : []);
      setError('');
    } catch {
      if (requestId !== requestSeqRef.current) {
        return;
      }
      setError('Network error loading skills.');
    } finally {
      if (requestId === requestSeqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refreshSkills();
  }, [refreshSkills]);

  const createSkill = useCallback(async (payload: CreateSkillPayload) => {
    setSaving(true);
    try {
      const response = await fetch('/api/user/skills', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success || !data.skill) {
        throw new Error(readErrorMessage(data, 'Failed to create skill.'));
      }

      setSkills((current) => [data.skill as UserSkillItem, ...current]);
      setError('');
      return data.skill as UserSkillItem;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create skill.';
      setError(message);
      throw error;
    } finally {
      setSaving(false);
    }
  }, []);

  const updateSkill = useCallback(async (skillId: string, payload: UpdateSkillPayload) => {
    setSaving(true);
    try {
      const response = await fetch(`/api/user/skills/${skillId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success || !data.skill) {
        throw new Error(readErrorMessage(data, 'Failed to update skill.'));
      }

      setSkills((current) =>
        current.map((skill) => (skill.id === skillId ? (data.skill as UserSkillItem) : skill)),
      );
      setError('');
      return data.skill as UserSkillItem;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update skill.';
      setError(message);
      throw error;
    } finally {
      setSaving(false);
    }
  }, []);

  const archiveSkill = useCallback(async (skillId: string) => {
    setSaving(true);
    try {
      const response = await fetch(`/api/user/skills/${skillId}`, {
        method: 'DELETE',
      });
      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success || !data.skill) {
        throw new Error(readErrorMessage(data, 'Failed to archive skill.'));
      }

      setSkills((current) => current.filter((skill) => skill.id !== skillId));
      setError('');
      return data.skill as UserSkillItem;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to archive skill.';
      setError(message);
      throw error;
    } finally {
      setSaving(false);
    }
  }, []);

  return {
    skills,
    loading,
    saving,
    error,
    refreshSkills,
    createSkill,
    updateSkill,
    archiveSkill,
  };
}
