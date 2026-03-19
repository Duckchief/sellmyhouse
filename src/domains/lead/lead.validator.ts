import type { LeadInput } from './lead.types';

const SG_MOBILE_REGEX = /^[89]\d{7}$/;
const MIN_FORM_TIME_MS = 3000;

export function validateLeadInput(
  input: Omit<LeadInput, 'ipAddress' | 'userAgent'>,
): Record<string, string> | null {
  // Honeypot check — silent rejection
  if (input.honeypot) {
    return { _bot: 'Submission rejected' };
  }

  // Timing check — reject if submitted too fast
  if (input.formLoadedAt && Date.now() - input.formLoadedAt < MIN_FORM_TIME_MS) {
    return { _bot: 'Submission rejected' };
  }

  if (!input.name || !input.name.trim()) {
    return { name: 'Name is required' };
  }

  if (!SG_MOBILE_REGEX.test(input.phone)) {
    return { phone: 'Please enter a valid Singapore mobile number' };
  }

  if (!input.consentService) {
    return { consentService: 'Service consent is required' };
  }

  if (!input.consentHuttonsTransfer) {
    return {
      consentHuttonsTransfer:
        'You must consent to data transfer to Huttons Asia Pte Ltd to proceed',
    };
  }

  return null;
}
