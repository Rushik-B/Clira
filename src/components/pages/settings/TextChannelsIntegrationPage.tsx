'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Copy,
  Loader2,
  Save,
} from 'lucide-react';
import {
  Check,
  CircleCheck,
  ClearIcon,
  ExclamationCircle,
  Phone,
  Sparkles,
} from '@/components/icons/icons';
import { Button } from '@/components/ui/sidebar/button';
import { Input } from '@/components/ui/sidebar/input';
import { CLIRA_TEXT_NUMBER, WHATSAPP_CTA_URL } from '@/lib/publicConfig';
import type { TextChannelsSettingsSnapshot } from '@/lib/services/textChannelsSettings';
import { SettingsShell, SettingsSectionCard } from './SettingsShell';
import {
  COUNTRY_OPTIONS,
  DEFAULT_COUNTRY_CODE,
  formatE164Number,
  isValidPhoneInput,
  parseE164Number,
} from './text-channels/phone-utils';
import type {
  NotificationDeliveryChannel,
  TelegramHealthState,
  TelegramLinkSettings,
  TelegramPendingPairingRequest,
  TelegramSettingsState,
  TextingSettings,
} from './text-channels/types';

const WhatsAppOfficialIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <path
      fill="currentColor"
      d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.272-.099-.47-.148-.669.149-.197.297-.767.967-.94 1.166-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.297-.497.099-.198.05-.372-.025-.52-.074-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01a1.093 1.093 0 0 0-.793.372c-.272.298-1.04 1.016-1.04 2.48 0 1.463 1.065 2.877 1.213 3.075.149.198 2.095 3.2 5.076 4.487.709.306 1.261.489 1.692.626.71.226 1.357.194 1.868.117.569-.085 1.758-.719 2.006-1.413.248-.694.248-1.29.173-1.414-.074-.124-.272-.198-.57-.347M12.067 2.004c-5.514 0-9.996 4.482-9.996 9.996a9.95 9.95 0 0 0 1.349 4.998L2 22l5.144-1.35a9.955 9.955 0 0 0 4.922 1.267h.004c5.512 0 9.995-4.483 9.995-9.996 0-2.671-1.04-5.182-2.927-7.069a9.93 9.93 0 0 0-7.07-2.848m0 18.23h-.003a8.28 8.28 0 0 1-4.218-1.154l-.302-.179-3.052.8.815-2.976-.196-.306a8.26 8.26 0 0 1-1.272-4.417c.002-4.56 3.713-8.27 8.273-8.27 2.21 0 4.287.86 5.849 2.421a8.226 8.226 0 0 1 2.418 5.85c-.002 4.56-3.714 8.27-8.272 8.27"
    />
  </svg>
);

const TelegramOfficialIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <path
      fill="currentColor"
      d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0m5.885 8.184-1.97 9.285c-.149.658-.538.818-1.087.51l-3.01-2.22-1.452 1.397c-.16.16-.295.295-.604.295l.213-3.054 5.562-5.024c.242-.213-.053-.333-.373-.12l-6.871 4.327-2.959-.924c-.644-.203-.657-.644.135-.953l11.57-4.458c.538-.196 1.006.128.83.939"
    />
  </svg>
);

/**
 * Text Channel Integration Settings Page
 * Configures SMS, WhatsApp, and Telegram messaging channels.
 */
interface TextChannelsIntegrationPageProps {
  initialSettings?: TextChannelsSettingsSnapshot | null;
}

interface TelegramLiveSettingsResponse {
  success: boolean;
  settings?: {
    telegramConfigured: boolean;
    telegramEnabled: boolean;
    botUsername: string | null;
    links: TelegramLinkSettings[];
    pendingPairingRequests: TelegramPendingPairingRequest[];
    health: TelegramHealthState | null;
  };
  error?: string;
}

function getInitialTextChannelsState(initialSettings: TextChannelsSettingsSnapshot | null) {
  if (!initialSettings) {
    return {
      settings: {
        whatsappPhoneNumber: null,
        whatsappVerified: false,
        twilioPhoneNumber: null,
        twilioVerified: false,
      } satisfies TextingSettings,
      telegramSettings: {
        telegramConfigured: false,
        telegramEnabled: false,
        botUsername: null,
        links: [],
        pendingPairingRequests: [],
        health: null,
      } satisfies TelegramSettingsState,
      notificationDeliveryChannel: 'BOTH' as NotificationDeliveryChannel,
      smsCountryCode: DEFAULT_COUNTRY_CODE,
      smsNumberInput: '',
      whatsappCountryCode: DEFAULT_COUNTRY_CODE,
      whatsappNumberInput: '',
      initialErrorMessage: 'Failed to load texting settings.',
    };
  }

  const settings: TextingSettings = {
    whatsappPhoneNumber: initialSettings.whatsappPhoneNumber || null,
    whatsappVerified: !!initialSettings.whatsappVerified,
    twilioPhoneNumber: initialSettings.twilioPhoneNumber || null,
    twilioVerified: !!initialSettings.twilioVerified,
  };

  const selectedDeliveryChannel: NotificationDeliveryChannel =
    initialSettings.notificationDeliveryChannel === 'WHATSAPP' ||
    initialSettings.notificationDeliveryChannel === 'TELEGRAM'
      ? initialSettings.notificationDeliveryChannel
      : 'BOTH';

  const parsedWhatsApp = parseE164Number(settings.whatsappPhoneNumber, DEFAULT_COUNTRY_CODE);
  const parsedSms = parseE164Number(settings.twilioPhoneNumber, DEFAULT_COUNTRY_CODE);

  return {
    settings,
    telegramSettings: {
      telegramConfigured: !!initialSettings.telegramConfigured,
      telegramEnabled: !!initialSettings.telegramEnabled,
      botUsername: initialSettings.botUsername ?? null,
      links: Array.isArray(initialSettings.links) ? initialSettings.links : [],
      pendingPairingRequests: Array.isArray(initialSettings.pendingPairingRequests)
        ? initialSettings.pendingPairingRequests
        : [],
      health: (initialSettings.telegramHealth ?? null) as TelegramHealthState | null,
    } satisfies TelegramSettingsState,
    notificationDeliveryChannel: selectedDeliveryChannel,
    smsCountryCode: parsedSms.countryCode,
    smsNumberInput: parsedSms.nationalNumber,
    whatsappCountryCode: parsedWhatsApp.countryCode,
    whatsappNumberInput: parsedWhatsApp.nationalNumber,
    initialErrorMessage: '',
  };
}

export const TextChannelsIntegrationPage: React.FC<TextChannelsIntegrationPageProps> = ({
  initialSettings = null,
}) => {
  const initialState = getInitialTextChannelsState(initialSettings);
  const [settings, setSettings] = useState<TextingSettings>(initialState.settings);
  const [telegramSettings, setTelegramSettings] = useState<TelegramSettingsState>(
    initialState.telegramSettings,
  );
  const [notificationDeliveryChannel, setNotificationDeliveryChannel] =
    useState<NotificationDeliveryChannel>(initialState.notificationDeliveryChannel);
  const [savedNotificationDeliveryChannel, setSavedNotificationDeliveryChannel] =
    useState<NotificationDeliveryChannel>(initialState.notificationDeliveryChannel);
  const [pairingCodeInput, setPairingCodeInput] = useState('');
  const [smsCountryCode, setSmsCountryCode] = useState(initialState.smsCountryCode);
  const [smsNumberInput, setSmsNumberInput] = useState(initialState.smsNumberInput);
  const [whatsappCountryCode, setWhatsappCountryCode] = useState(
    initialState.whatsappCountryCode,
  );
  const [whatsappNumberInput, setWhatsappNumberInput] = useState(
    initialState.whatsappNumberInput,
  );
  const [smsSaving, setSmsSaving] = useState(false);
  const [whatsappSaving, setWhatsappSaving] = useState(false);
  const [deliveryChannelSaving, setDeliveryChannelSaving] = useState(false);
  const [telegramPairingSaving, setTelegramPairingSaving] = useState(false);
  const [telegramUnlinking, setTelegramUnlinking] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState(initialState.initialErrorMessage);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const telegramLiveSyncInFlightRef = useRef(false);
  const loading = false;

  const smsE164 = formatE164Number(smsCountryCode, smsNumberInput);
  const whatsappE164 = formatE164Number(whatsappCountryCode, whatsappNumberInput);
  const smsInputHasError =
    smsNumberInput.trim() !== '' && !isValidPhoneInput(smsCountryCode, smsNumberInput);
  const whatsappInputHasError =
    whatsappNumberInput.trim() !== '' &&
    !isValidPhoneInput(whatsappCountryCode, whatsappNumberInput);
  const hasSmsChanges = (smsE164 || null) !== settings.twilioPhoneNumber;
  const hasWhatsAppChanges = (whatsappE164 || null) !== settings.whatsappPhoneNumber;
  const hasDeliveryChannelChanges =
    notificationDeliveryChannel !== savedNotificationDeliveryChannel;
  const activeTelegramLink = telegramSettings.links[0] ?? null;
  const hasTelegramLink = Boolean(activeTelegramLink);
  const pendingPairingRequests = telegramSettings.pendingPairingRequests;
  const telegramHealth = telegramSettings.health;
  const isTelegramWorkerConnected = !!telegramHealth?.workerConnected;
  const telegramLastUpdateLabel = telegramHealth?.lastUpdateAt
    ? new Date(telegramHealth.lastUpdateAt).toLocaleString()
    : 'No updates seen yet';
  const normalizedPairingCodeInput = pairingCodeInput
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  const isSmsConnected = !!settings.twilioPhoneNumber;
  const isWhatsAppConnected = !!settings.whatsappPhoneNumber;
  const hasWhatsAppCtaLink = WHATSAPP_CTA_URL.trim().length > 0;
  const hasTextNumber = CLIRA_TEXT_NUMBER.trim().length > 0;
  const copyLabel =
    copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Copy failed' : 'Copy';
  const connectedChannelsCount =
    Number(isSmsConnected) + Number(isWhatsAppConnected) + Number(hasTelegramLink);
  const deliveryChannelLabel =
    notificationDeliveryChannel === 'WHATSAPP'
      ? 'WhatsApp only'
      : notificationDeliveryChannel === 'TELEGRAM'
        ? 'Telegram only'
        : 'WhatsApp + Telegram';
  const hasAnyUnsavedChange =
    hasSmsChanges || hasWhatsAppChanges || hasDeliveryChannelChanges || pairingCodeInput.length > 0;
  const shouldPollTelegramLiveState =
    telegramSettings.telegramConfigured ||
    telegramSettings.pendingPairingRequests.length > 0 ||
    telegramSettings.links.length > 0;

  const applyTelegramLiveSettings = useCallback(
    (nextSettings: NonNullable<TelegramLiveSettingsResponse['settings']>) => {
      const hasBotUsername = Object.prototype.hasOwnProperty.call(
        nextSettings,
        'botUsername',
      );

      setTelegramSettings((prev) => ({
        ...prev,
        telegramConfigured: nextSettings.telegramConfigured,
        telegramEnabled: nextSettings.telegramEnabled,
        botUsername: hasBotUsername ? nextSettings.botUsername : prev.botUsername,
        links: Array.isArray(nextSettings.links) ? nextSettings.links : prev.links,
        pendingPairingRequests: Array.isArray(nextSettings.pendingPairingRequests)
          ? nextSettings.pendingPairingRequests
          : prev.pendingPairingRequests,
        health: nextSettings.health ?? prev.health,
      }));
    },
    [],
  );

  useEffect(() => {
    if (!shouldPollTelegramLiveState) return;

    let active = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let abortController: AbortController | null = null;

    const syncTelegramLiveSettings = async () => {
      if (!active || telegramLiveSyncInFlightRef.current) return;
      telegramLiveSyncInFlightRef.current = true;

      abortController?.abort();
      abortController = new AbortController();

      try {
        const response = await fetch('/api/settings/telegram?view=live', {
          method: 'GET',
          cache: 'no-store',
          signal: abortController.signal,
        });

        const data = (await response.json()) as TelegramLiveSettingsResponse;
        if (!active || !response.ok || !data.success || !data.settings) return;

        applyTelegramLiveSettings(data.settings);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        console.error('Failed to sync Telegram live settings:', error);
      } finally {
        telegramLiveSyncInFlightRef.current = false;
      }
    };

    const stopPolling = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      abortController?.abort();
      abortController = null;
      telegramLiveSyncInFlightRef.current = false;
    };

    const startPolling = () => {
      if (intervalId || document.hidden) return;
      void syncTelegramLiveSettings();
      intervalId = setInterval(() => {
        void syncTelegramLiveSettings();
      }, 1500);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopPolling();
        return;
      }
      startPolling();
    };

    startPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      active = false;
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [applyTelegramLiveSettings, shouldPollTelegramLiveState]);

  const handleCopyNumber = async () => {
    if (!hasTextNumber) {
      setCopyState('error');
      return;
    }
    try {
      await navigator.clipboard.writeText(CLIRA_TEXT_NUMBER);
      setCopyState('copied');
    } catch (error) {
      console.error('Error copying Clira number:', error);
      setCopyState('error');
    }
  };

  const updateSmsSettings = async (
    phoneNumber: string | null,
    options?: { suppressSuccess?: boolean }
  ) => {
    setSmsSaving(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const response = await fetch('/api/settings/twilio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ twilioPhoneNumber: phoneNumber }),
      });

      const data = await response.json();

      if (data.success) {
        setSettings((prev) => ({
          ...prev,
          twilioPhoneNumber: data.settings.twilioPhoneNumber,
          twilioVerified: data.settings.twilioVerified,
        }));
        if (!options?.suppressSuccess) {
          setSuccessMessage(
            phoneNumber ? 'SMS number saved successfully.' : 'SMS number cleared.'
          );
        }
        return true;
      } else {
        setErrorMessage(data.error || 'Failed to save SMS number');
        return false;
      }
    } catch (error) {
      console.error('Error saving SMS settings:', error);
      setErrorMessage('Failed to save SMS number');
      return false;
    } finally {
      setSmsSaving(false);
    }
  };

  const updateWhatsAppSettings = async (
    phoneNumber: string | null,
    options?: { suppressSuccess?: boolean }
  ) => {
    setWhatsappSaving(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const response = await fetch('/api/settings/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ whatsappPhoneNumber: phoneNumber }),
      });

      const data = await response.json();

      if (data.success) {
        setSettings((prev) => ({
          ...prev,
          whatsappPhoneNumber: data.settings.whatsappPhoneNumber,
          whatsappVerified: data.settings.whatsappVerified,
        }));
        if (!options?.suppressSuccess) {
          setSuccessMessage(
            phoneNumber ? 'WhatsApp number saved successfully.' : 'WhatsApp number cleared.'
          );
        }
        return true;
      } else {
        setErrorMessage(data.error || 'Failed to save WhatsApp number');
        return false;
      }
    } catch (error) {
      console.error('Error saving WhatsApp settings:', error);
      setErrorMessage('Failed to save WhatsApp number');
      return false;
    } finally {
      setWhatsappSaving(false);
    }
  };

  const handleSaveSms = async () => {
    setErrorMessage('');
    setSuccessMessage('');
    if (!isValidPhoneInput(smsCountryCode, smsNumberInput)) {
      setErrorMessage('Invalid SMS number format. Enter a valid phone number.');
      return;
    }

    if (!hasSmsChanges) return;

    const nextSms = smsE164 || null;
    await updateSmsSettings(nextSms);
  };

  const handleSaveWhatsApp = async () => {
    setErrorMessage('');
    setSuccessMessage('');
    if (!isValidPhoneInput(whatsappCountryCode, whatsappNumberInput)) {
      setErrorMessage('Invalid WhatsApp number format. Enter a valid phone number.');
      return;
    }

    if (!hasWhatsAppChanges) return;

    const nextWhatsApp = whatsappE164 || null;
    await updateWhatsAppSettings(nextWhatsApp);
  };

  const handleClearSms = async () => {
    setSmsNumberInput('');
    await updateSmsSettings(null);
  };

  const handleClearWhatsApp = async () => {
    setWhatsappNumberInput('');
    await updateWhatsAppSettings(null);
  };

  const handleSaveDeliveryChannelPreference = async () => {
    if (!hasDeliveryChannelChanges) return;

    setDeliveryChannelSaving(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const response = await fetch('/api/settings/messaging-channels', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notificationDeliveryChannel,
        }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        setErrorMessage(data.error || 'Failed to save reminder delivery channel');
        return;
      }

      const savedChannel: NotificationDeliveryChannel =
        data.settings?.notificationDeliveryChannel === 'WHATSAPP' ||
        data.settings?.notificationDeliveryChannel === 'TELEGRAM'
          ? data.settings.notificationDeliveryChannel
          : 'BOTH';

      setNotificationDeliveryChannel(savedChannel);
      setSavedNotificationDeliveryChannel(savedChannel);
      setSuccessMessage('Reminder and alert delivery channel updated.');
    } catch (error) {
      console.error('Error saving messaging channel preference:', error);
      setErrorMessage('Failed to save reminder delivery channel');
    } finally {
      setDeliveryChannelSaving(false);
    }
  };

  const approveTelegramPairingCode = async (rawPairingCode: string) => {
    const normalizedPairingCode = rawPairingCode
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '');
    setTelegramPairingSaving(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const response = await fetch('/api/settings/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairingCode: normalizedPairingCode,
        }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        setErrorMessage(data.error || 'Failed to link Telegram account');
        return;
      }

      const nextLink = data.link as TelegramLinkSettings;
      setTelegramSettings((prev) => {
        const remaining = prev.links.filter((link) => link.id !== nextLink.id);
        return {
          ...prev,
          links: [nextLink, ...remaining],
          pendingPairingRequests: prev.pendingPairingRequests.filter(
            (request) => request.pairingCode !== normalizedPairingCode,
          ),
        };
      });
      setPairingCodeInput('');
      setSuccessMessage('Telegram account linked successfully.');
    } catch (error) {
      console.error('Error linking Telegram account:', error);
      setErrorMessage('Failed to link Telegram account');
    } finally {
      setTelegramPairingSaving(false);
    }
  };

  const handleApproveTelegramPairingCode = async () => {
    if (normalizedPairingCodeInput.length !== 8) {
      setErrorMessage('Pairing code must be 8 characters.');
      return;
    }

    await approveTelegramPairingCode(normalizedPairingCodeInput);
  };

  const handleApprovePendingPairingRequest = async (request: TelegramPendingPairingRequest) => {
    await approveTelegramPairingCode(request.pairingCode);
  };

  const handleUnlinkTelegram = async () => {
    if (!activeTelegramLink) return;

    setTelegramUnlinking(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const response = await fetch('/api/settings/telegram', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkId: activeTelegramLink.id }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        setErrorMessage(data.error || 'Failed to unlink Telegram account');
        return;
      }

      setTelegramSettings((prev) => ({
        ...prev,
        links: prev.links.filter((link) => link.id !== activeTelegramLink.id),
      }));
      setSuccessMessage('Telegram account unlinked.');
    } catch (error) {
      console.error('Error unlinking Telegram account:', error);
      setErrorMessage('Failed to unlink Telegram account');
    } finally {
      setTelegramUnlinking(false);
    }
  };

  return (
    <SettingsShell
      title="Text Clira"
      subtitle="Set up the channels you text from and choose where alerts are delivered."
      icon={WhatsAppOfficialIcon}
      iconColor="text-emerald-400"
    >
      {successMessage && (
        <div className="mb-6">
          <div className="flex items-start justify-between gap-4 rounded-xl border border-emerald-500/30 bg-emerald-500/15 p-4">
            <div className="flex items-start gap-3">
              <CircleCheck className="h-5 w-5 text-emerald-400" />
              <span className="font-medium text-emerald-200">{successMessage}</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSuccessMessage('')}
              className="cursor-pointer text-emerald-200/80 hover:text-emerald-100 active:scale-[0.98]"
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {errorMessage && (
        <div className="mb-6">
          <div className="flex items-start justify-between gap-4 rounded-xl border border-red-500/30 bg-red-500/15 p-4">
            <div className="flex items-start gap-3">
              <ExclamationCircle className="h-5 w-5 text-red-400" />
              <span className="font-medium text-red-200">{errorMessage}</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setErrorMessage('')}
              className="cursor-pointer text-red-200/80 hover:text-red-100 active:scale-[0.98]"
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-6">
        <SettingsSectionCard
          title="Quick start"
          description="Message Clira in one tap, and quickly verify which channels are ready."
          icon={<Sparkles className="h-5 w-5 text-emerald-300" />}
          className="relative overflow-hidden"
        >
          <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-emerald-500/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-24 h-56 w-56 rounded-full bg-cyan-500/10 blur-3xl" />

          <div className="relative space-y-4">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.35fr_1fr]">
              <div className="rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 via-gray-950/80 to-black px-5 py-5">
                <p className="text-sm font-medium text-emerald-200">Primary path</p>
                <h4 className="mt-1 text-base font-semibold text-white">Open WhatsApp to message Clira</h4>
                <p className="mt-1 text-sm text-gray-300">
                  Fastest way to send requests, drafts, or quick command messages.
                </p>
                <div className="mt-4">
                  {hasWhatsAppCtaLink ? (
                    <Button
                      asChild
                      size="lg"
                      className="h-11 cursor-pointer rounded-xl bg-emerald-600 px-5 text-white hover:bg-emerald-500 active:scale-[0.98]"
                    >
                      <a href={WHATSAPP_CTA_URL} target="_blank" rel="noreferrer">
                        <WhatsAppOfficialIcon className="h-4 w-4" />
                        Message on WhatsApp
                      </a>
                    </Button>
                  ) : (
                    <Button
                      size="lg"
                      disabled
                      className="h-11 cursor-not-allowed rounded-xl bg-gray-700 px-5 text-gray-300"
                    >
                      <WhatsAppOfficialIcon className="h-4 w-4" />
                      WhatsApp link unavailable
                    </Button>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/30 px-5 py-5">
                <p className="text-sm font-medium text-gray-200">SMS fallback</p>
                <p className="mt-1 text-xs text-gray-400">Text this number from your saved phone line.</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-lg font-semibold tracking-tight text-white sm:text-xl">
                    {hasTextNumber ? CLIRA_TEXT_NUMBER : 'Text number not configured'}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCopyNumber}
                    onBlur={() => setCopyState('idle')}
                    onMouseLeave={() => setCopyState('idle')}
                    className="cursor-pointer border-white/15 text-gray-200 hover:bg-white/10 active:scale-[0.98]"
                  >
                    {copyState === 'copied' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    <span>{copyLabel}</span>
                  </Button>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/25 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-400">Connection health</p>
                  <p className="mt-1 text-sm text-gray-200">
                    {loading
                      ? 'Checking your channels...'
                      : `${connectedChannelsCount}/3 channels currently connected`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={`rounded-full border px-3 py-1 ${
                      isSmsConnected
                        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                        : 'border-gray-700 bg-gray-900/60 text-gray-400'
                    }`}
                  >
                    SMS
                  </span>
                  <span
                    className={`rounded-full border px-3 py-1 ${
                      isWhatsAppConnected
                        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                        : 'border-gray-700 bg-gray-900/60 text-gray-400'
                    }`}
                  >
                    WhatsApp
                  </span>
                  <span
                    className={`rounded-full border px-3 py-1 ${
                      hasTelegramLink
                        ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200'
                        : 'border-gray-700 bg-gray-900/60 text-gray-400'
                    }`}
                  >
                    Telegram
                  </span>
                </div>
              </div>
            </div>
          </div>
        </SettingsSectionCard>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SettingsSectionCard
            title="SMS sender number"
            description="Use the mobile number you text from on SMS or iMessage."
            icon={<Phone className="h-5 w-5 text-emerald-300" />}
          >
            {loading ? (
              <div className="space-y-3 py-1">
                <div className="h-10 w-full animate-pulse rounded-md bg-white/5" />
                <div className="h-10 w-full animate-pulse rounded-md bg-white/5" />
                <div className="ml-auto h-9 w-24 animate-pulse rounded-xl bg-white/5" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-gray-300">
                  Status:{' '}
                  <span className={isSmsConnected ? 'text-emerald-300' : 'text-gray-400'}>
                    {isSmsConnected ? 'Connected' : 'Not connected'}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[160px_1fr]">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-300">Country</label>
                    <select
                      value={smsCountryCode}
                      onChange={(event) => setSmsCountryCode(event.target.value)}
                      className="h-10 w-full rounded-md border border-gray-800 bg-black/40 px-3 text-sm text-gray-200 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                    >
                      {COUNTRY_OPTIONS.map((option) => (
                        <option key={option.code} value={option.code}>
                          {option.name} (+{option.dialCode})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-300">Phone number</label>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        type="tel"
                        placeholder="(555) 123-4567"
                        value={smsNumberInput}
                        onChange={(e) => setSmsNumberInput(e.target.value)}
                        className={`flex-1 border-gray-800 bg-black/40 placeholder:text-gray-500 focus:border-emerald-500/50 focus:ring-emerald-500/40 ${
                          smsInputHasError ? 'border-red-500 focus:ring-red-500' : ''
                        }`}
                      />
                      {isSmsConnected && (
                        <Button
                          onClick={handleClearSms}
                          variant="outline"
                          size="sm"
                          className="cursor-pointer border-red-500/30 px-3 text-red-400 hover:bg-red-500/10 active:scale-[0.98]"
                          disabled={smsSaving}
                        >
                          <ClearIcon className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    {smsInputHasError && (
                      <p className="text-xs text-red-400">Invalid number. Check digits and country.</p>
                    )}
                    <p className="text-xs text-gray-500">Country code is automatically normalized.</p>
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button
                    onClick={handleSaveSms}
                    disabled={smsSaving || !hasSmsChanges || smsInputHasError}
                    size="sm"
                    className="cursor-pointer rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {smsSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4" />
                        <span>Save</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </SettingsSectionCard>

          <SettingsSectionCard
            title="WhatsApp sender number"
            description="Optional, but recommended to match incoming WhatsApp requests."
            icon={<WhatsAppOfficialIcon className="h-5 w-5 text-[#25D366]" />}
          >
            {loading ? (
              <div className="space-y-3 py-1">
                <div className="h-10 w-full animate-pulse rounded-md bg-white/5" />
                <div className="h-10 w-full animate-pulse rounded-md bg-white/5" />
                <div className="ml-auto h-9 w-24 animate-pulse rounded-xl bg-white/5" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-gray-300">
                  Status:{' '}
                  <span className={isWhatsAppConnected ? 'text-emerald-300' : 'text-gray-400'}>
                    {isWhatsAppConnected ? 'Connected' : 'Not connected'}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[160px_1fr]">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-300">Country</label>
                    <select
                      value={whatsappCountryCode}
                      onChange={(event) => setWhatsappCountryCode(event.target.value)}
                      className="h-10 w-full rounded-md border border-gray-800 bg-black/40 px-3 text-sm text-gray-200 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                    >
                      {COUNTRY_OPTIONS.map((option) => (
                        <option key={option.code} value={option.code}>
                          {option.name} (+{option.dialCode})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-300">Phone number</label>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        type="tel"
                        placeholder="(555) 123-4567"
                        value={whatsappNumberInput}
                        onChange={(e) => setWhatsappNumberInput(e.target.value)}
                        className={`flex-1 border-gray-800 bg-black/40 placeholder:text-gray-500 focus:border-emerald-500/50 focus:ring-emerald-500/40 ${
                          whatsappInputHasError ? 'border-red-500 focus:ring-red-500' : ''
                        }`}
                      />
                      {isWhatsAppConnected && (
                        <Button
                          onClick={handleClearWhatsApp}
                          variant="outline"
                          size="sm"
                          className="cursor-pointer border-red-500/30 px-3 text-red-400 hover:bg-red-500/10 active:scale-[0.98]"
                          disabled={whatsappSaving}
                        >
                          <ClearIcon className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    {whatsappInputHasError && (
                      <p className="text-xs text-red-400">Invalid number. Check digits and country.</p>
                    )}
                    <p className="text-xs text-gray-500">Country code is automatically normalized.</p>
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button
                    onClick={handleSaveWhatsApp}
                    disabled={whatsappSaving || !hasWhatsAppChanges || whatsappInputHasError}
                    size="sm"
                    className="cursor-pointer rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {whatsappSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4" />
                        <span>Save</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </SettingsSectionCard>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_1fr]">
          <SettingsSectionCard
            title="Alerts delivery"
            description="Choose where reminders and alert notifications are delivered."
            icon={<Sparkles className="h-5 w-5 text-emerald-300" />}
          >
            {loading ? (
              <div className="space-y-3 py-1">
                <div className="h-10 w-full animate-pulse rounded-md bg-white/5" />
                <div className="h-9 w-24 animate-pulse rounded-xl bg-white/5" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-gray-300">
                  Active channel: <span className="text-emerald-200">{deliveryChannelLabel}</span>
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">Delivery channel</label>
                  <select
                    value={notificationDeliveryChannel}
                    onChange={(event) =>
                      setNotificationDeliveryChannel(event.target.value as NotificationDeliveryChannel)
                    }
                    className="h-10 w-full rounded-md border border-gray-800 bg-black/40 px-3 text-sm text-gray-200 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                  >
                    <option value="BOTH">WhatsApp + Telegram (Default)</option>
                    <option value="WHATSAPP">WhatsApp only</option>
                    <option value="TELEGRAM">Telegram only</option>
                  </select>
                  <p className="text-xs text-gray-500">
                    If the selected channel is unavailable, delivery is skipped and logged in action history.
                  </p>
                </div>
                <div className="flex justify-end">
                  <Button
                    onClick={handleSaveDeliveryChannelPreference}
                    disabled={deliveryChannelSaving || !hasDeliveryChannelChanges}
                    size="sm"
                    className="cursor-pointer rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deliveryChannelSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4" />
                        <span>Save</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </SettingsSectionCard>

          <SettingsSectionCard
            title="Telegram link"
            description="Admin enables the bot once for this server. Each user links their own account with a pairing code."
            icon={<TelegramOfficialIcon className="h-5 w-5 text-[#229ED9]" />}
          >
            {loading ? (
              <div className="space-y-3 py-1">
                <div className="h-10 w-full animate-pulse rounded-md bg-white/5" />
                <div className="h-10 w-full animate-pulse rounded-md bg-white/5" />
                <div className="h-9 w-40 animate-pulse rounded-xl bg-white/5" />
              </div>
            ) : (
              <div className="space-y-4">
                {!telegramSettings.telegramConfigured ? (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                    <p className="font-medium text-amber-50">Telegram is not enabled on this server yet.</p>
                    <p className="mt-1 text-amber-100/90">
                      This page does not create the bot or store the bot token. A server admin must configure Telegram once, then users can link their own accounts here.
                    </p>
                    <div className="mt-3 space-y-1 text-xs text-amber-100/80">
                      <p>1. Create a bot with BotFather and copy the bot token.</p>
                      <p>2. Set <span className="font-mono text-amber-50">TELEGRAM_BOT_TOKEN</span> on the server.</p>
                      <p>3. Restart the worker, then come back here to pair your Telegram account.</p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                    <p className="text-sm text-gray-300">
                      Bot status:{' '}
                      <span className="font-semibold text-white">
                        {telegramSettings.telegramEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {telegramSettings.botUsername
                        ? `Bot username: @${telegramSettings.botUsername}`
                        : 'Bot username unavailable'}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-400">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            isTelegramWorkerConnected ? 'bg-emerald-400' : 'bg-red-400'
                          }`}
                        />
                        Worker {isTelegramWorkerConnected ? 'connected' : 'disconnected'}
                      </span>
                      <span>Last update: {telegramLastUpdateLabel}</span>
                    </div>
                  </div>
                )}

                <div className="rounded-xl border border-white/10 bg-black/25 px-4 py-3">
                  <p className="text-sm font-medium text-white">How Telegram setup works</p>
                  <div className="mt-2 space-y-1 text-sm text-gray-400">
                    <p>1. A server admin enables the Telegram bot once for this Clira deployment.</p>
                    <p>2. You DM the bot from your own Telegram account.</p>
                    <p>3. The bot sends you an 8-character pairing code to paste here.</p>
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-black/25 px-4 py-3">
                  <p className="text-sm font-medium text-white">Linked account</p>
                  {hasTelegramLink ? (
                    <>
                      <p className="mt-1 text-sm text-gray-300">
                        {activeTelegramLink?.telegramUsername
                          ? `@${activeTelegramLink.telegramUsername}`
                          : activeTelegramLink?.telegramFirstName || 'Telegram account'}
                      </p>
                      <p className="text-xs text-gray-500">Chat ID: {activeTelegramLink?.chatId}</p>
                    </>
                  ) : (
                    <p className="mt-1 text-sm text-gray-400">No linked Telegram account yet.</p>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">Pairing code</label>
                  <Input
                    type="text"
                    placeholder="ABCD1234"
                    value={pairingCodeInput}
                    maxLength={16}
                    onChange={(event) => setPairingCodeInput(event.target.value.toUpperCase())}
                    className="border-gray-800 bg-black/40 font-mono tracking-[0.2em] placeholder:text-gray-500 focus:border-cyan-500/50 focus:ring-cyan-500/40"
                  />
                  <p className="text-xs text-gray-500">
                    DM the bot first, then paste the code exactly as shown.
                  </p>
                </div>

                <div className="rounded-xl border border-white/10 bg-black/25 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-white">Pending pairing requests</p>
                    <p className="text-xs text-gray-500">{pendingPairingRequests.length} pending</p>
                  </div>
                  {pendingPairingRequests.length === 0 ? (
                    <p className="mt-2 text-sm text-gray-400">No pending Telegram pairing requests.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {pendingPairingRequests.map((request) => (
                        <div
                          key={request.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/35 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm text-gray-200">
                              {request.telegramUsername
                                ? `@${request.telegramUsername}`
                                : request.telegramFirstName || 'Telegram user'}
                            </p>
                            <p className="mt-0.5 text-xs text-gray-500">
                              Code: <span className="font-mono tracking-[0.15em]">{request.pairingCode}</span>
                            </p>
                            <p className="mt-0.5 text-xs text-gray-500">
                              Expires: {new Date(request.expiresAt).toLocaleString()}
                            </p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => handleApprovePendingPairingRequest(request)}
                            disabled={telegramPairingSaving || !telegramSettings.telegramConfigured}
                            className="cursor-pointer rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {telegramPairingSaving ? 'Approving...' : 'Approve'}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    onClick={handleApproveTelegramPairingCode}
                    disabled={
                      telegramPairingSaving ||
                      normalizedPairingCodeInput.length !== 8 ||
                      !telegramSettings.telegramConfigured
                    }
                    size="sm"
                    className="cursor-pointer rounded-xl bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {telegramPairingSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Linking...</span>
                      </>
                    ) : (
                      <span>Link Telegram</span>
                    )}
                  </Button>
                  <Button
                    onClick={handleUnlinkTelegram}
                    disabled={telegramUnlinking || !hasTelegramLink}
                    variant="outline"
                    size="sm"
                    className="cursor-pointer border-red-500/30 text-red-300 hover:bg-red-500/10 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {telegramUnlinking ? 'Unlinking...' : 'Unlink'}
                  </Button>
                </div>
              </div>
            )}
          </SettingsSectionCard>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-xs text-gray-400">
          {hasAnyUnsavedChange
            ? 'You have pending edits. Save each section to apply changes.'
            : 'All channel settings are up to date.'}
        </div>
      </div>
    </SettingsShell>
  );
};
