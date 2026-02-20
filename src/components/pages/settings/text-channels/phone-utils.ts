import type { CountryOption } from './types';

/**
 * E.164 phone number format regex for client-side validation
 * Matches: +1234567890 (7-15 digits after +)
 */
const E164_REGEX = /^\+[1-9]\d{6,14}$/;

export const DEFAULT_COUNTRY_CODE = 'CA';

export const COUNTRY_OPTIONS: CountryOption[] = [
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
  (a, b) => b.dialCode.length - a.dialCode.length,
);

const getCountryByCode = (code: string) =>
  COUNTRY_OPTIONS.find((option) => option.code === code) ??
  COUNTRY_OPTIONS.find((option) => option.code === DEFAULT_COUNTRY_CODE)!;

export function parseE164Number(value: string | null): {
  countryCode: string;
  nationalNumber: string;
} {
  if (!value) {
    return { countryCode: DEFAULT_COUNTRY_CODE, nationalNumber: '' };
  }

  const digits = value.replace(/\D/g, '');
  if (!digits) {
    return { countryCode: DEFAULT_COUNTRY_CODE, nationalNumber: '' };
  }

  const matchedCountry = COUNTRY_OPTIONS_BY_DIAL.find((option) =>
    digits.startsWith(option.dialCode),
  );

  if (!matchedCountry) {
    return { countryCode: DEFAULT_COUNTRY_CODE, nationalNumber: digits };
  }

  return {
    countryCode: matchedCountry.code,
    nationalNumber: digits.slice(matchedCountry.dialCode.length),
  };
}

export function formatE164Number(
  countryCode: string,
  nationalNumber: string,
): string | null {
  const digitsOnly = nationalNumber.replace(/\D/g, '');
  if (!digitsOnly) return null;
  const country = getCountryByCode(countryCode);
  return `+${country.dialCode}${digitsOnly}`;
}

export function isValidPhoneInput(
  countryCode: string,
  nationalNumber: string,
): boolean {
  const formatted = formatE164Number(countryCode, nationalNumber);
  if (!formatted) return true;
  return E164_REGEX.test(formatted);
}
