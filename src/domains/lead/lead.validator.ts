import type { LeadInput } from './lead.types';

const SG_MOBILE_REGEX = /^[89]\d{7}$/;
const LOOSE_PHONE_REGEX = /^\d{7,15}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_FORM_TIME_MS = 3000;

const VALID_COUNTRY_CODES = [
  '+65',
  '+60',
  '+62',
  '+66',
  '+63',
  '+84',
  '+95',
  '+855',
  '+856',
  '+673',
];

export function validateLeadInput(
  input: Omit<LeadInput, 'ipAddress' | 'userAgent'>,
): Record<string, string> | null {
  if (input.honeypot) {
    return { _bot: 'Submission rejected' };
  }

  if (input.formLoadedAt && Date.now() - input.formLoadedAt < MIN_FORM_TIME_MS) {
    return { _bot: 'Submission rejected' };
  }

  if (!input.name || !input.name.trim()) {
    return { name: 'Name is required' };
  }

  if (!input.email || !input.email.trim()) {
    return { email: 'Email is required' };
  }

  if (!EMAIL_REGEX.test(input.email.trim())) {
    return { email: 'Please enter a valid email address' };
  }

  if (!VALID_COUNTRY_CODES.includes(input.countryCode)) {
    return { countryCode: 'Please select a valid country' };
  }

  if (input.countryCode === '+65') {
    if (!SG_MOBILE_REGEX.test(input.nationalNumber)) {
      return {
        nationalNumber:
          'Please enter a valid Singapore mobile number (starts with 8 or 9, 8 digits)',
      };
    }
  } else {
    if (!LOOSE_PHONE_REGEX.test(input.nationalNumber)) {
      return { nationalNumber: 'Please enter a valid phone number (7-15 digits)' };
    }
  }

  if (!input.consentService) {
    return { consentService: 'Service consent is required' };
  }

  return null;
}
