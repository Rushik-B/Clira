'use client';

import React, { useEffect, useState } from 'react';
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
  MessageSquare,
  Phone,
  Sparkles,
} from '@/components/icons/icons';
import { Button } from '@/components/ui/sidebar/button';
import { Input } from '@/components/ui/sidebar/input';
import { CLIRA_TEXT_NUMBER, WHATSAPP_CTA_URL } from '@/lib/publicConfig';
import { SettingsShell, SettingsSectionCard } from './SettingsShell';

interface TextingSettings {
  whatsappPhoneNumber: string | null;
  whatsappVerified: boolean;
  twilioPhoneNumber: string | null;
  twilioVerified: boolean;
}

interface CountryOption {
  code: string;
  name: string;
  dialCode: string;
}

/**
 * E.164 phone number format regex for client-side validation
 * Matches: +1234567890 (7-15 digits after +)
 */
const E164_REGEX = /^\+[1-9]\d{6,14}$/;
const DEFAULT_COUNTRY_CODE = 'CA';
const COUNTRY_OPTIONS: CountryOption[] = [
  { code: 'CA', name: 'Canada', dialCode: '1' },
  { code: 'US', name: 'United States', dialCode: '1' },
  { code: 'GB', name: 'United Kingdom', dialCode: '44' },
  { code: 'AU', name: 'Australia', dialCode: '61' },
  { code: 'NZ', name: 'New Zealand', dialCode: '64' },
  { code: 'DE', name: 'Germany', dialCode: '49' },
  { code: 'FR', name: 'France', dialCode: '33' },
  { code: 'IN', name: 'India', dialCode: '91' },
  { code: 'MX', name: 'Mexico', dialCode: '52' },
  { code: 'BR', name: 'Brazil', dialCode: '55' },
];
const COUNTRY_OPTIONS_BY_DIAL = [...COUNTRY_OPTIONS].sort(
  (a, b) => b.dialCode.length - a.dialCode.length
);

const getCountryByCode = (code: string) =>
  COUNTRY_OPTIONS.find((option) => option.code === code) ??
  COUNTRY_OPTIONS.find((option) => option.code === DEFAULT_COUNTRY_CODE)!;

const parseE164Number = (value: string | null) => {
  if (!value) {
    return { countryCode: DEFAULT_COUNTRY_CODE, nationalNumber: '' };
  }

  const digits = value.replace(/\D/g, '');
  if (!digits) {
    return { countryCode: DEFAULT_COUNTRY_CODE, nationalNumber: '' };
  }

  const matchedCountry = COUNTRY_OPTIONS_BY_DIAL.find((option) =>
    digits.startsWith(option.dialCode)
  );

  if (!matchedCountry) {
    return { countryCode: DEFAULT_COUNTRY_CODE, nationalNumber: digits };
  }

  return {
    countryCode: matchedCountry.code,
    nationalNumber: digits.slice(matchedCountry.dialCode.length),
  };
};

const formatE164Number = (countryCode: string, nationalNumber: string) => {
  const digitsOnly = nationalNumber.replace(/\D/g, '');
  if (!digitsOnly) return null;
  const country = getCountryByCode(countryCode);
  return `+${country.dialCode}${digitsOnly}`;
};

const isValidPhoneInput = (countryCode: string, nationalNumber: string) => {
  const formatted = formatE164Number(countryCode, nationalNumber);
  if (!formatted) return true;
  return E164_REGEX.test(formatted);
};

/**
 * Texting Integration Settings Page
 * Allows users to configure the number they text from.
 */
export const WhatsAppIntegrationPage: React.FC = () => {
  const [settings, setSettings] = useState<TextingSettings>({
    whatsappPhoneNumber: null,
    whatsappVerified: false,
    twilioPhoneNumber: null,
    twilioVerified: false,
  });
  const [smsCountryCode, setSmsCountryCode] = useState(DEFAULT_COUNTRY_CODE);
  const [smsNumberInput, setSmsNumberInput] = useState('');
  const [whatsappCountryCode, setWhatsappCountryCode] = useState(DEFAULT_COUNTRY_CODE);
  const [whatsappNumberInput, setWhatsappNumberInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [smsSaving, setSmsSaving] = useState(false);
  const [whatsappSaving, setWhatsappSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  // Fetch current settings on mount
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const [whatsappResponse, smsResponse] = await Promise.all([
          fetch('/api/settings/whatsapp'),
          fetch('/api/settings/twilio'),
        ]);

        const whatsappData = await whatsappResponse.json();
        const smsData = await smsResponse.json();

        if (!whatsappResponse.ok || !whatsappData.success) {
          throw new Error('Failed to load WhatsApp settings');
        }

        if (!smsResponse.ok || !smsData.success) {
          throw new Error('Failed to load SMS settings');
        }

        const nextSettings: TextingSettings = {
          whatsappPhoneNumber: whatsappData.settings.whatsappPhoneNumber || null,
          whatsappVerified: !!whatsappData.settings.whatsappVerified,
          twilioPhoneNumber: smsData.settings.twilioPhoneNumber || null,
          twilioVerified: !!smsData.settings.twilioVerified,
        };

        setSettings(nextSettings);

        const parsedWhatsApp = parseE164Number(nextSettings.whatsappPhoneNumber);
        setWhatsappCountryCode(parsedWhatsApp.countryCode);
        setWhatsappNumberInput(parsedWhatsApp.nationalNumber);

        const parsedSms = parseE164Number(nextSettings.twilioPhoneNumber);
        setSmsCountryCode(parsedSms.countryCode);
        setSmsNumberInput(parsedSms.nationalNumber);
      } catch (error) {
        console.error('Error fetching texting settings:', error);
        setErrorMessage('Failed to load texting settings');
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, []);

  const smsE164 = formatE164Number(smsCountryCode, smsNumberInput);
  const whatsappE164 = formatE164Number(whatsappCountryCode, whatsappNumberInput);
  const smsInputHasError =
    smsNumberInput.trim() !== '' && !isValidPhoneInput(smsCountryCode, smsNumberInput);
  const whatsappInputHasError =
    whatsappNumberInput.trim() !== '' &&
    !isValidPhoneInput(whatsappCountryCode, whatsappNumberInput);
  const hasSmsChanges = (smsE164 || null) !== settings.twilioPhoneNumber;
  const hasWhatsAppChanges = (whatsappE164 || null) !== settings.whatsappPhoneNumber;
  const isSmsConnected = !!settings.twilioPhoneNumber;
  const isWhatsAppConnected = !!settings.whatsappPhoneNumber;
  const hasWhatsAppCtaLink = WHATSAPP_CTA_URL.trim().length > 0;
  const hasTextNumber = CLIRA_TEXT_NUMBER.trim().length > 0;
  const copyLabel =
    copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Copy failed' : 'Copy';

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

  return (
    <SettingsShell
      title="Text Clira"
      subtitle="Send SMS or WhatsApp messages to your assistant for fast drafts and quick actions."
      icon={MessageSquare}
      iconColor="text-emerald-400"
    >
      {/* Success Message */}
      {successMessage && (
        <div className="mb-6">
          <div className="bg-emerald-500/15 border border-emerald-500/30 rounded-xl p-4 flex items-start justify-between gap-4">
            <div className="flex items-start space-x-3">
              <CircleCheck className="w-5 h-5 text-emerald-400" />
              <span className="text-emerald-200 font-medium">{successMessage}</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSuccessMessage('')}
              className="cursor-pointer text-emerald-200/80 hover:text-emerald-100"
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* Error Message */}
      {errorMessage && (
        <div className="mb-6">
          <div className="bg-red-500/15 border border-red-500/30 rounded-xl p-4 flex items-start justify-between gap-4">
            <div className="flex items-start space-x-3">
              <ExclamationCircle className="w-5 h-5 text-red-400" />
              <span className="text-red-200 font-medium">{errorMessage}</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setErrorMessage('')}
              className="cursor-pointer text-red-200/80 hover:text-red-100"
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-8">
        <SettingsSectionCard
          title="Message Clira"
          description="Fastest way to start: open WhatsApp and send a message."
          icon={<Sparkles className="w-5 h-5 text-emerald-300" />}
          className="relative overflow-hidden"
        >
          <div className="absolute -top-24 -right-16 h-56 w-56 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-28 -left-20 h-56 w-56 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />
          <div className="relative space-y-5">
            <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-gray-950/80 to-black px-5 py-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <p className="text-base font-semibold text-white">
                    Open WhatsApp and message Clira
                  </p>
                  <p className="text-sm text-gray-300">
                    This opens a chat and prompts you to send your first message.
                  </p>
                </div>
                {hasWhatsAppCtaLink ? (
                  <Button
                    asChild
                    size="lg"
                    className="cursor-pointer h-12 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white px-6"
                  >
                    <a href={WHATSAPP_CTA_URL} target="_blank" rel="noreferrer">
                      <MessageSquare className="w-4 h-4" />
                      Message on WhatsApp
                    </a>
                  </Button>
                ) : (
                  <Button
                    size="lg"
                    disabled
                    className="h-12 rounded-xl bg-gray-700 text-gray-300 px-6 cursor-not-allowed"
                  >
                    <MessageSquare className="w-4 h-4" />
                    WhatsApp link not configured
                  </Button>
                )}
              </div>

              <div className="mt-4 rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-xs text-gray-300">
                <p className="font-semibold text-white">Try this opener:</p>
                <p className="mt-1 text-gray-400">
                  "Draft a reply to the client about the updated timeline."
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-black/30 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-gray-300">Prefer SMS?</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                    <span className="text-lg sm:text-xl font-semibold text-white font-mono tracking-tight">
                    {hasTextNumber ? CLIRA_TEXT_NUMBER : 'Text number not configured'}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCopyNumber}
                    onBlur={() => setCopyState('idle')}
                    onMouseLeave={() => setCopyState('idle')}
                    className="cursor-pointer border-white/15 text-gray-200 hover:bg-white/10"
                  >
                    {copyState === 'copied' ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                    <span>{copyLabel}</span>
                  </Button>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  SMS works after you add your number below.
                </p>
              </div>
            </div>
          </div>
        </SettingsSectionCard>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SettingsSectionCard
            title="SMS Number"
            description="This is the number you text from on SMS or iMessage."
            icon={<Phone className="w-5 h-5 text-emerald-300" />}
          >
            {loading ? (
              <div className="flex items-center space-x-2 text-gray-400 text-sm py-4">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Loading settings…</span>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-4">
                  <div>
                    <label className="text-sm font-medium text-gray-300 mb-2 block">
                      Country
                    </label>
                    <select
                      value={smsCountryCode}
                      onChange={(event) => setSmsCountryCode(event.target.value)}
                      className="w-full h-10 rounded-md border border-gray-800 bg-black/40 px-3 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/50"
                    >
                      {COUNTRY_OPTIONS.map((option) => (
                        <option key={option.code} value={option.code}>
                          {option.name} (+{option.dialCode})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-300 mb-2 block">
                      Phone number
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        type="tel"
                        placeholder="(555) 123-4567"
                        value={smsNumberInput}
                        onChange={(e) => setSmsNumberInput(e.target.value)}
                        className={`flex-1 bg-black/40 border-gray-800 focus:ring-emerald-500/40 focus:border-emerald-500/50 placeholder:text-gray-500 ${
                          smsInputHasError ? 'border-red-500 focus:ring-red-500' : ''
                        }`}
                      />
                      {isSmsConnected && (
                        <Button
                          onClick={handleClearSms}
                          variant="outline"
                          size="sm"
                          className="cursor-pointer px-3 text-red-400 border-red-500/30 hover:bg-red-500/10"
                          disabled={smsSaving}
                        >
                          <ClearIcon className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                    {smsInputHasError && (
                      <p className="mt-2 text-xs text-red-400">
                        Invalid number. Check the digits and country.
                      </p>
                    )}
                    <p className="mt-2 text-xs text-gray-500">
                      Add the mobile number you use to text. Country code is handled for you.
                    </p>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={handleSaveSms}
                    disabled={smsSaving || !hasSmsChanges || smsInputHasError}
                    size="sm"
                    className="cursor-pointer inline-flex items-center space-x-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {smsSaving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Saving…</span>
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        <span>Save</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </SettingsSectionCard>

          <SettingsSectionCard
            title="WhatsApp Number"
            description="Optional: save the number you use on WhatsApp so we can match incoming messages."
            icon={<MessageSquare className="w-5 h-5 text-emerald-300" />}
          >
            {loading ? (
              <div className="flex items-center space-x-2 text-gray-400 text-sm py-4">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Loading settings…</span>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-4">
                  <div>
                    <label className="text-sm font-medium text-gray-300 mb-2 block">
                      Country
                    </label>
                    <select
                      value={whatsappCountryCode}
                      onChange={(event) => setWhatsappCountryCode(event.target.value)}
                      className="w-full h-10 rounded-md border border-gray-800 bg-black/40 px-3 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/50"
                    >
                      {COUNTRY_OPTIONS.map((option) => (
                        <option key={option.code} value={option.code}>
                          {option.name} (+{option.dialCode})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-300 mb-2 block">
                      Phone number
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        type="tel"
                        placeholder="(555) 123-4567"
                        value={whatsappNumberInput}
                        onChange={(e) => setWhatsappNumberInput(e.target.value)}
                        className={`flex-1 bg-black/40 border-gray-800 focus:ring-emerald-500/40 focus:border-emerald-500/50 placeholder:text-gray-500 ${
                          whatsappInputHasError ? 'border-red-500 focus:ring-red-500' : ''
                        }`}
                      />
                      {isWhatsAppConnected && (
                        <Button
                          onClick={handleClearWhatsApp}
                          variant="outline"
                          size="sm"
                          className="cursor-pointer px-3 text-red-400 border-red-500/30 hover:bg-red-500/10"
                          disabled={whatsappSaving}
                        >
                          <ClearIcon className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                    {whatsappInputHasError && (
                      <p className="mt-2 text-xs text-red-400">
                        Invalid number. Check the digits and country.
                      </p>
                    )}
                    <p className="mt-2 text-xs text-gray-500">
                      Add the number you use on WhatsApp. Country code is handled for you.
                    </p>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={handleSaveWhatsApp}
                    disabled={whatsappSaving || !hasWhatsAppChanges || whatsappInputHasError}
                    size="sm"
                    className="cursor-pointer inline-flex items-center space-x-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {whatsappSaving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Saving…</span>
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        <span>Save</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </SettingsSectionCard>
        </div>
      </div>
    </SettingsShell>
  );
};
