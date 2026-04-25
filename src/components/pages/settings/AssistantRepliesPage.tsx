'use client';

import React, { useState, useEffect } from 'react';
import {
  Users,
  Plus,
  X,
  CheckCircle,
  AlertCircle,
  UserCheck,
  Globe,
  Save,
  Loader2,
  SlidersHorizontal,
  UserX,
  UserPlus,
  Calendar as CalendarIcon,
  CalendarPlus,
} from 'lucide-react';
import { Button } from '@/components/ui/sidebar/button';
import { Input } from '@/components/ui/sidebar/input';
import { SettingsShell, SettingsSectionCard } from './SettingsShell';
import { signIn } from 'next-auth/react';
import { ENHANCED_SCOPES, REQUIRED_SCOPES } from '@/lib/auth/scope-utils';

interface EmailFilterSettings {
  replyScope: 'ALL_SENDERS' | 'CONTACTS_ONLY';
  blockedSenders: string[];
  allowedSenders: string[];
}

interface CalendarSettings {
  calendarTimezone: string;
  calendarTimezoneSource?: string;
  calendarTimezoneDegradedReason?: string | null;
  calendarContextCalendarIds: string[];
}

interface UserCalendar {
  id: string;
  summary: string;
  primary: boolean;
  timeZone?: string;
}

export const AssistantRepliesPage: React.FC = () => {
  const [settings, setSettings] = useState<EmailFilterSettings>({
    replyScope: 'ALL_SENDERS',
    blockedSenders: [],
    allowedSenders: [],
  });
  
  const [saving, setSaving] = useState(false);
  const [newBlockedSender, setNewBlockedSender] = useState('');
  const [newAllowedSender, setNewAllowedSender] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [calendarSettings, setCalendarSettings] = useState<CalendarSettings>({
    calendarTimezone: 'America/Los_Angeles',
    calendarTimezoneSource: 'default',
    calendarTimezoneDegradedReason: null,
    calendarContextCalendarIds: [],
  });
  const [calendars, setCalendars] = useState<UserCalendar[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarSaving, setCalendarSaving] = useState(false);
  const [calendarWriteEnabled, setCalendarWriteEnabled] = useState<boolean | null>(null);
  const [calendarWriteAuthLoading, setCalendarWriteAuthLoading] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await fetch('/api/settings/email-filters');
        const data = await response.json();
        if (data.success) {
          setSettings(data.settings);
        }
      } catch (error) {
        console.error('Error fetching settings:', error);
      }
    };

    fetchSettings();
  }, []);

  useEffect(() => {
    const fetchCalendarSettings = async () => {
      setCalendarLoading(true);
      try {
        const response = await fetch('/api/settings/calendar');
        const data = await response.json();
        if (data.success) {
          setCalendarSettings({
            calendarTimezone: data.settings.calendarTimezone ?? 'America/Los_Angeles',
            calendarTimezoneSource: data.settings.calendarTimezoneSource,
            calendarTimezoneDegradedReason: data.settings.calendarTimezoneDegradedReason,
            calendarContextCalendarIds: data.settings.calendarContextCalendarIds ?? [],
          });
          setCalendars(data.calendars || []);
          setCalendarWriteEnabled(
            typeof data.hasCalendarWriteAccess === 'boolean' ? data.hasCalendarWriteAccess : null,
          );
        }
      } catch (error) {
        console.error('Error fetching calendar settings:', error);
      } finally {
        setCalendarLoading(false);
      }
    };

    fetchCalendarSettings();
  }, []);

  const saveSettings = async () => {
    setSaving(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const response = await fetch('/api/settings/email-filters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });

      const data = await response.json();

      if (data.success) {
        setSuccessMessage('Settings saved successfully!');
        setTimeout(() => setSuccessMessage(''), 3000);
      } else {
        setErrorMessage(data.error || 'Failed to save settings');
      }
    } catch (error) {
      setErrorMessage('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const saveCalendarSettings = async () => {
    setCalendarSaving(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const response = await fetch('/api/settings/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedCalendarIds: calendarSettings.calendarContextCalendarIds,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setSuccessMessage('Calendar settings saved successfully!');
        setTimeout(() => setSuccessMessage(''), 3000);
      } else {
        setErrorMessage(data.error || 'Failed to save calendar settings');
      }
    } catch (error) {
      setErrorMessage('Failed to save calendar settings');
    } finally {
      setCalendarSaving(false);
    }
  };

  const addBlockedSender = () => {
    if (newBlockedSender.trim() && !settings.blockedSenders.includes(newBlockedSender.trim())) {
      setSettings((prev) => ({
        ...prev,
        blockedSenders: [...prev.blockedSenders, newBlockedSender.trim()],
      }));
      setNewBlockedSender('');
    }
  };

  const removeBlockedSender = (sender: string) => {
    setSettings((prev) => ({
      ...prev,
      blockedSenders: prev.blockedSenders.filter((s) => s !== sender),
    }));
  };

  const addAllowedSender = () => {
    if (newAllowedSender.trim() && !settings.allowedSenders.includes(newAllowedSender.trim())) {
      setSettings((prev) => ({
        ...prev,
        allowedSenders: [...prev.allowedSenders, newAllowedSender.trim()],
      }));
      setNewAllowedSender('');
    }
  };

  const removeAllowedSender = (sender: string) => {
    setSettings((prev) => ({
      ...prev,
      allowedSenders: prev.allowedSenders.filter((s) => s !== sender),
    }));
  };

  return (
    <SettingsShell
      title="Assistant & Replies"
      subtitle="Control who  can draft for and who to avoid."
      icon={SlidersHorizontal}
      iconColor="text-purple-400"
    >
      {successMessage && (
        <div className="mb-6">
          <div className="bg-green-500/20 border border-green-500/30 rounded-xl p-4 flex items-center space-x-3">
            <CheckCircle className="w-5 h-5 text-green-400" />
            <span className="text-green-400 font-medium">{successMessage}</span>
          </div>
        </div>
      )}

      {errorMessage && (
        <div className="mb-6">
          <div className="bg-red-500/20 border border-red-500/30 rounded-xl p-4 flex items-center space-x-3">
            <AlertCircle className="w-5 h-5 text-red-400" />
            <span className="text-red-400 font-medium">{errorMessage}</span>
          </div>
        </div>
      )}

      <div className="space-y-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SettingsSectionCard
            title="Reply scope"
            description="Choose who  can auto-draft replies for."
            icon={<Users className="w-5 h-5 text-blue-300" />}
          >
            <div className="space-y-4">
              {(['ALL_SENDERS', 'CONTACTS_ONLY'] as const).map((scope) => (
                <label
                  key={scope}
                  className="flex items-center justify-between bg-gray-900/70 border border-gray-800 rounded-xl px-4 py-3 cursor-pointer transition hover:border-gray-700"
                >
                  <div className="flex items-center space-x-3">
                    <input
                      type="radio"
                      name="replyScope"
                      value={scope}
                      checked={settings.replyScope === scope}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          replyScope: e.target.value as 'ALL_SENDERS' | 'CONTACTS_ONLY',
                        }))
                      }
                      className="w-4 h-4 text-blue-500 bg-gray-800 border-gray-600 focus:ring-blue-500 focus:ring-2"
                    />
                    <div className="flex items-center space-x-2">
                      {scope === 'ALL_SENDERS' ? (
                        <Globe className="w-4 h-4 text-blue-400" />
                      ) : (
                        <UserCheck className="w-4 h-4 text-emerald-400" />
                      )}
                      <span className="text-white font-medium">
                        {scope === 'ALL_SENDERS' ? 'All senders' : 'Contacts only'}
                      </span>
                    </div>
                  </div>
                  <span className="text-xs text-gray-500">
                    {scope === 'ALL_SENDERS' ? 'Default' : 'Stricter'}
                  </span>
                </label>
              ))}
              <p className="text-sm text-gray-400">
                {settings.replyScope === 'ALL_SENDERS'
                  ? 'Best for mature inboxes.  drafts for anyone unless blocked.'
                  : 'Use while onboarding.  sticks to people you’ve already replied to.'}
              </p>
            </div>
          </SettingsSectionCard>

          <SettingsSectionCard
            title="Calendar"
            description="Choose which calendars  uses for context."
            icon={<CalendarIcon className="w-5 h-5 text-blue-300" />}
          >
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-300 mb-2 block">
                  Timezone
                </label>
                <div className="rounded-lg bg-gray-900/80 border border-gray-800 px-3 py-2">
                  <p className="text-sm text-white">{calendarSettings.calendarTimezone}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {calendarSettings.calendarTimezoneSource === 'google_primary_calendar'
                      ? 'Synced from primary Google Calendar'
                      : 'Using cached timezone until Google Calendar is available'}
                  </p>
                </div>
                {calendarSettings.calendarTimezoneDegradedReason && (
                  <p className="mt-2 text-xs text-amber-300">
                    Google Calendar timezone sync is degraded: {calendarSettings.calendarTimezoneDegradedReason}
                  </p>
                )}
              </div>

              <div>
                <label className="text-sm font-medium text-gray-300 mb-2 block">
                  Calendars to use for context
                </label>
                {calendarLoading ? (
                  <div className="flex items-center space-x-2 text-gray-400 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Loading calendars…</span>
                  </div>
                ) : calendars.length === 0 ? (
                  <p className="text-gray-500 text-sm">
                    No calendars found or calendar access is not available yet.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {calendars.map((calendar) => {
                      const checked = calendarSettings.calendarContextCalendarIds.includes(
                        calendar.id,
                      );
                      return (
                        <label
                          key={calendar.id}
                          className="flex items-center justify-between space-x-3 px-3 py-2 rounded-xl bg-gray-900/70 border border-gray-800 hover:border-gray-700 cursor-pointer"
                        >
                          <div className="flex items-center space-x-3">
                            <input
                              type="checkbox"
                              className="w-4 h-4 text-blue-500 bg-gray-900 border-gray-600 focus:ring-blue-500 focus:ring-2"
                              checked={checked}
                              onChange={(e) => {
                                const isChecked = e.target.checked;
                                setCalendarSettings((prev) => {
                                  const current = prev.calendarContextCalendarIds;
                                  if (isChecked) {
                                    if (current.includes(calendar.id)) return prev;
                                    return {
                                      ...prev,
                                      calendarContextCalendarIds: [...current, calendar.id],
                                    };
                                  }
                                  return {
                                    ...prev,
                                    calendarContextCalendarIds: current.filter(
                                      (id) => id !== calendar.id,
                                    ),
                                  };
                                });
                              }}
                            />
                            <div>
                              <p className="text-sm text-white font-medium">
                                {calendar.summary}
                                {calendar.primary && (
                                  <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/40">
                                    Primary
                                  </span>
                                )}
                              </p>
                              {calendar.timeZone && (
                                <p className="text-xs text-gray-500">{calendar.timeZone}</p>
                              )}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
                <p className="mt-2 text-xs text-gray-500">
                   will only consider events from these calendars when answering scheduling
                  emails.
                </p>
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={saveCalendarSettings}
                  disabled={calendarSaving}
                  size="sm"
                  className="inline-flex items-center space-x-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {calendarSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Saving…</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      <span>Save calendar settings</span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          </SettingsSectionCard>

          <SettingsSectionCard
            title="Calendar write access (early test)"
            description="Opt in to enable calendar creation, updates, and deletions."
            icon={<CalendarPlus className="w-5 h-5 text-blue-300" />}
          >
            <div className="space-y-4">
              <p className="text-sm text-gray-400">
                {calendarWriteEnabled === true
                  ? 'Calendar write access is already enabled for your Google account.'
                  : 'This is an early test feature. When enabled, you’ll be redirected to Google to grant calendar write permissions.'}
              </p>
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  className="inline-flex items-center space-x-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl text-sm font-medium cursor-pointer"
                  disabled={calendarWriteEnabled === true || calendarWriteAuthLoading}
                  onClick={async () => {
                    if (calendarWriteEnabled === true || calendarWriteAuthLoading) return;
                    setCalendarWriteAuthLoading(true);
                    try {
                      const callbackUrl = `${window.location.pathname}${window.location.search}`;
                      const scopes = Array.from(
                        new Set([...ENHANCED_SCOPES, REQUIRED_SCOPES.CALENDAR_EVENTS]),
                      ).join(' ');
                      await signIn(
                        'google',
                        { callbackUrl },
                        {
                          scope: scopes,
                          access_type: 'offline',
                          prompt: 'consent',
                          include_granted_scopes: 'true',
                        },
                      );
                    } finally {
                      // Most of the time we’ll redirect away; this is just a safety fallback.
                      setCalendarWriteAuthLoading(false);
                    }
                  }}
                >
                  {calendarWriteEnabled === true ? (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      <span>Calendar write enabled</span>
                    </>
                  ) : calendarWriteAuthLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Redirecting…</span>
                    </>
                  ) : (
                    <span>Enable calendar write access</span>
                  )}
                </Button>
              </div>
            </div>
          </SettingsSectionCard>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SettingsSectionCard
            title="Blocked senders"
            description="Absolute veto— never drafts for them."
            icon={<UserX className="w-5 h-5 text-red-300" />}
          >
            <div className="space-y-4">
              <div className="flex space-x-2">
                <Input
                  type="email"
                  placeholder="email@domain.com"
                  value={newBlockedSender}
                  onChange={(e) => setNewBlockedSender(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addBlockedSender()}
                  className="flex-1"
                />
                <Button onClick={addBlockedSender} size="sm" className="px-3">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <div className="space-y-2">
                {settings.blockedSenders.map((sender, index) => (
                  <div
                    key={`${sender}-${index}`}
                    className="flex items-center justify-between px-4 py-3 bg-gray-900/70 border border-gray-800 rounded-xl"
                  >
                    <span className="text-white text-sm truncate">{sender}</span>
                    <button
                      onClick={() => removeBlockedSender(sender)}
                      className="text-gray-400 hover:text-red-300 transition"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                {settings.blockedSenders.length === 0 && (
                  <div className="text-center py-4 text-gray-500 text-sm">No blocked senders</div>
                )}
              </div>
            </div>
          </SettingsSectionCard>

          <SettingsSectionCard
            title="Allowed senders"
            description="These always bypass filters and get priority."
            icon={<UserPlus className="w-5 h-5 text-emerald-300" />}
          >
            <div className="space-y-4">
              <div className="flex space-x-2">
                <Input
                  type="email"
                  placeholder="email@domain.com"
                  value={newAllowedSender}
                  onChange={(e) => setNewAllowedSender(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addAllowedSender()}
                  className="flex-1"
                />
                <Button onClick={addAllowedSender} size="sm" className="px-3">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <div className="space-y-2">
                {settings.allowedSenders.map((sender, index) => (
                  <div
                    key={`${sender}-${index}`}
                    className="flex items-center justify-between px-4 py-3 bg-gray-900/70 border border-gray-800 rounded-xl"
                  >
                    <span className="text-white text-sm truncate">{sender}</span>
                    <button
                      onClick={() => removeAllowedSender(sender)}
                      className="text-gray-400 hover:text-red-300 transition"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                {settings.allowedSenders.length === 0 && (
                  <div className="text-center py-4 text-gray-500 text-sm">No allowed senders</div>
                )}
              </div>
            </div>
          </SettingsSectionCard>
        </div>

        <div className="flex justify-center pt-4">
          <Button
            onClick={saveSettings}
            disabled={saving}
            size="lg"
            className="px-8 py-3 text-base font-medium bg-purple-600/80 hover:bg-purple-500 border-purple-500 text-white"
          >
            {saving ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-5 h-5" />
                Save Settings
              </>
            )}
          </Button>
        </div>
      </div>
    </SettingsShell>
  );
};
