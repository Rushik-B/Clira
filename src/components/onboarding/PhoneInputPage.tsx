'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowRight, ArrowLeft } from 'lucide-react';
import { SparklesCore } from '@/components/ui/sparkles';
import { Button } from '@/components/ui/sidebar/button';
import { motion } from 'motion/react';

const SparklesBackground = React.memo(function SparklesBackground() {
  return (
    <SparklesCore
      className="absolute inset-0"
      background="transparent"
      particleColor="#ffffff"
      minSize={0.6}
      maxSize={1.8}
      speed={1.8}
      particleDensity={60}
    />
  );
});

// WhatsApp icon component
const WhatsAppIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 48 48"
    className={className}
  >
    <path
      fill="currentColor"
      d="M4.868,43.303l2.694-9.835C5.9,30.59,5.026,27.324,5.027,23.979C5.032,13.514,13.548,5,24.014,5c5.079,0.002,9.845,1.979,13.43,5.566c3.584,3.588,5.558,8.356,5.556,13.428c-0.004,10.465-8.522,18.98-18.986,18.98c-0.001,0,0,0,0,0h-0.008c-3.177-0.001-6.3-0.798-9.073-2.311L4.868,43.303z"
    />
    <path
      fill="#40c351"
      d="M35.176,12.832c-2.98-2.982-6.941-4.625-11.157-4.626c-8.704,0-15.783,7.076-15.787,15.774c-0.001,2.981,0.833,5.883,2.413,8.396l0.376,0.597l-1.595,5.821l5.973-1.566l0.577,0.342c2.422,1.438,5.2,2.198,8.032,2.199h0.006c8.698,0,15.777-7.077,15.78-15.776C39.795,19.778,38.156,15.814,35.176,12.832z"
    />
    <path
      fill="#fff"
      fillRule="evenodd"
      d="M19.268,16.045c-0.355-0.79-0.729-0.806-1.068-0.82c-0.277-0.012-0.593-0.011-0.909-0.011c-0.316,0-0.83,0.119-1.265,0.594c-0.435,0.475-1.661,1.622-1.661,3.956c0,2.334,1.7,4.59,1.937,4.906c0.237,0.316,3.282,5.259,8.104,7.161c4.007,1.58,4.823,1.266,5.693,1.187c0.87-0.079,2.807-1.147,3.202-2.255c0.395-1.108,0.395-2.057,0.277-2.255c-0.119-0.198-0.435-0.316-0.909-0.554s-2.807-1.385-3.242-1.543c-0.435-0.158-0.751-0.237-1.068,0.238c-0.316,0.474-1.225,1.543-1.502,1.859c-0.277,0.317-0.554,0.357-1.028,0.119c-0.474-0.238-2.002-0.738-3.815-2.354c-1.41-1.257-2.362-2.81-2.639-3.285c-0.277-0.474-0.03-0.731,0.208-0.968c0.213-0.213,0.474-0.554,0.712-0.831c0.237-0.277,0.316-0.475,0.474-0.791c0.158-0.317,0.079-0.594-0.04-0.831C20.612,19.329,19.69,16.983,19.268,16.045z"
      clipRule="evenodd"
    />
  </svg>
);

interface PhoneInputPageProps {
  onNext: (phoneNumber: string | null) => void;
  onBack: () => void;
  onSkip: () => void;
}

// Common country codes for quick selection
const COUNTRY_CODES = [
  { code: '+1', country: 'US/CA', flag: '🇺🇸' },
  { code: '+44', country: 'UK', flag: '🇬🇧' },
  { code: '+91', country: 'IN', flag: '🇮🇳' },
  { code: '+61', country: 'AU', flag: '🇦🇺' },
  { code: '+49', country: 'DE', flag: '🇩🇪' },
  { code: '+33', country: 'FR', flag: '🇫🇷' },
  { code: '+81', country: 'JP', flag: '🇯🇵' },
  { code: '+86', country: 'CN', flag: '🇨🇳' },
] as const;

export const PhoneInputPage: React.FC<PhoneInputPageProps> = ({
  onNext,
  onBack,
  onSkip,
}) => {
  const [showContent, setShowContent] = useState(false);
  const [countryCode, setCountryCode] = useState('+1');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const countrySelectRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setShowContent(true);
    // Auto-focus the input after animation
    const timer = setTimeout(() => inputRef.current?.focus(), 500);
    return () => clearTimeout(timer);
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showCountryDropdown) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (countrySelectRef.current && !countrySelectRef.current.contains(e.target as Node)) {
        setShowCountryDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showCountryDropdown]);

  // Format phone number as user types (US format for display)
  const formatPhoneDisplay = (value: string): string => {
    const digits = value.replace(/\D/g, '');
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 15);
    setPhoneNumber(raw);
    setError(null);
  };

  const getFullE164 = useCallback((): string => {
    return `${countryCode}${phoneNumber}`;
  }, [countryCode, phoneNumber]);

  const validatePhone = (): boolean => {
    if (!phoneNumber) return true; // Allow empty (skip)
    const fullNumber = getFullE164();
    // E.164: + followed by 7-15 digits
    return /^\+[1-9]\d{6,14}$/.test(fullNumber);
  };

  const handleSubmit = async () => {
    if (!validatePhone()) {
      setError('Please enter a valid phone number');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Only save if phone number is provided — save to both SMS (Twilio) and WhatsApp
      if (phoneNumber) {
        const e164 = getFullE164();
        const [twilioRes, whatsappRes] = await Promise.all([
          fetch('/api/settings/twilio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ twilioPhoneNumber: e164 }),
          }),
          fetch('/api/settings/whatsapp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ whatsappPhoneNumber: e164 }),
          }),
        ]);

        if (!twilioRes.ok) {
          const data = await twilioRes.json();
          throw new Error(data.error || 'Failed to save SMS number');
        }
        if (!whatsappRes.ok) {
          const data = await whatsappRes.json();
          throw new Error(data.error || 'Failed to save WhatsApp number');
        }
      }

      onNext(phoneNumber ? getFullE164() : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isSubmitting) {
      handleSubmit();
    }
  };

  const selectedCountry = COUNTRY_CODES.find(c => c.code === countryCode) || COUNTRY_CODES[0];

  return (
    <div className="relative min-h-screen w-full bg-black overflow-hidden">
      <SparklesBackground />

      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center text-center px-6">
        {/* Back button */}
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: showContent ? 0.7 : 0 }}
          transition={{ duration: 0.5, delay: 0.8 }}
          onClick={onBack}
          className="absolute top-6 left-6 text-white/70 hover:text-white transition-colors flex items-center gap-2 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm">Back</span>
        </motion.button>

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: showContent ? 1 : 0, y: showContent ? 0 : 20 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="mb-8"
        >
          <div className="flex items-center justify-center mb-4">
            <div className="p-3 rounded-2xl bg-white/10 backdrop-blur-sm">
              <WhatsAppIcon className="w-8 h-8 text-green-400" />
            </div>
          </div>
          <h1 className="text-4xl sm:text-5xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white/90 via-blue-100/90 to-blue-200/80 drop-shadow-[0_0_14px_rgba(59,130,246,0.18)]">
            Connect Your Number
          </h1>
          <p className="mt-3 text-white/70 text-lg max-w-md mx-auto">
            Chat with Clira via WhatsApp or SMS to draft emails, check your calendar, and manage your inbox on the go
          </p>
        </motion.div>

        {/* Phone input */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: showContent ? 1 : 0, y: showContent ? 0 : 20 }}
          transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
          className="w-full max-w-sm"
        >
          <div className="relative flex items-center bg-white/10 backdrop-blur-md rounded-2xl border border-white/20 focus-within:border-blue-400/50 transition-colors">
            {/* Country code selector */}
            <div ref={countrySelectRef} className="relative">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowCountryDropdown(!showCountryDropdown);
                }}
                className="flex items-center gap-1.5 px-4 py-4 text-white hover:bg-white/10 transition-colors cursor-pointer border-r border-white/10"
                aria-label="Select country code"
                aria-expanded={showCountryDropdown}
              >
                <span className="text-lg">{selectedCountry.flag}</span>
                <span className="text-white/90 font-medium">{countryCode}</span>
                <svg
                  className={`w-4 h-4 text-white/50 transition-transform ${showCountryDropdown ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Dropdown (rendered outside the overflow-hidden container via positioning) */}
              {showCountryDropdown && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.15 }}
                  className="absolute top-full right-0 mt-2 w-48 bg-zinc-900/98 backdrop-blur-xl rounded-xl border border-white/20 shadow-2xl overflow-hidden z-[1000]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="max-h-64 overflow-y-auto">
                    {COUNTRY_CODES.map((country) => (
                      <button
                        key={country.code}
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setCountryCode(country.code);
                          setShowCountryDropdown(false);
                          requestAnimationFrame(() => inputRef.current?.focus());
                        }}
                        className={`w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-white/10 transition-colors cursor-pointer ${
                          country.code === countryCode ? 'bg-white/10' : ''
                        }`}
                        aria-label={`Select ${country.country} ${country.code}`}
                      >
                        <span className="text-lg">{country.flag}</span>
                        <span className="text-white/90 font-medium">{country.code}</span>
                        <span className="text-white/50 text-sm ml-auto">{country.country}</span>
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </div>

            {/* Phone input */}
            <input
              ref={inputRef}
              type="tel"
              value={formatPhoneDisplay(phoneNumber)}
              onChange={handlePhoneChange}
              onKeyDown={handleKeyDown}
              placeholder="(555) 123-4567"
              className="flex-1 bg-transparent px-4 py-4 text-white text-lg placeholder:text-white/30 focus:outline-none"
              autoComplete="tel-national"
            />
          </div>

          {/* Error message */}
          {error && (
            <motion.p
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-3 text-red-400 text-sm"
            >
              {error}
            </motion.p>
          )}

          {/* Privacy note */}
          <p className="mt-4 text-white/40 text-xs">
            Optional — you can skip this and set it up later in settings
          </p>
        </motion.div>

        {/* Action buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: showContent ? 1 : 0, y: showContent ? 0 : 20 }}
          transition={{ duration: 0.8, ease: 'easeOut', delay: 0.4 }}
          className="mt-8 flex flex-col items-center gap-4"
        >
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            size="lg"
            className="relative group h-14 rounded-2xl bg-white px-10 text-black hover:bg-white/90 border border-white/10 shadow-lg shadow-white/25 hover:shadow-white/40 text-lg cursor-pointer transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="font-semibold">
              {isSubmitting ? 'Saving...' : phoneNumber ? 'Continue' : 'Continue'}
            </span>
            <ArrowRight className="w-5 h-5" />
          </Button>

          <button
            type="button"
            onClick={onSkip}
            disabled={isSubmitting}
            className="text-white/50 hover:text-white/70 text-sm transition-colors cursor-pointer disabled:opacity-50"
          >
            Skip for now
          </button>
        </motion.div>
      </div>
    </div>
  );
};
