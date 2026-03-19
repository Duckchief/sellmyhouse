/**
 * Masks NRIC last-4 for display.
 * "567A" → "SXXXX567A"
 */
export function maskNric(last4: string): string {
  if (!last4 || last4.length < 4) return 'SXXXXINVALID';
  return `SXXXX${last4}`;
}

/**
 * Validates that a stored last-4 NRIC string matches the expected format:
 * exactly 3 digits followed by 1 uppercase letter.
 */
export function validateNricLast4(value: string): boolean {
  return /^\d{3}[A-Z]$/.test(value);
}

/**
 * Masks a phone number, showing only the last 4 digits.
 * "91234567" → "****4567"
 * "1234"     → "1234"  (≤4 chars: nothing to mask)
 * "12"       → "**"    (<4 chars: mask all)
 * ""         → "****"
 */
export function maskPhone(phone: string): string {
  if (!phone) return '****';
  if (phone.length < 4) return '*'.repeat(phone.length);
  const prefix = phone.slice(0, -4);
  const suffix = phone.slice(-4);
  return (prefix.length > 0 ? '****' : '') + suffix;
}

/**
 * Masks an email address, keeping the first char of the local part and the domain.
 * "john@example.com" → "j***@example.com"
 */
export function maskEmail(email: string): string {
  const atIdx = email.indexOf('@');
  if (atIdx < 0) return '***';
  return email[0] + '***' + email.slice(atIdx);
}
