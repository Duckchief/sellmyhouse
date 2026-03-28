/**
 * Masks NRIC last-4 for display.
 * "567A" → "XXXX567A"
 * M57: We only store the last 4 chars, so the prefix letter (S/T/F/G/M) is unknown.
 */
export function maskNric(last4: string): string {
  if (!last4 || last4.length < 4) return 'XXXXINVALID';
  return `XXXX${last4}`;
}

/**
 * Validates that a stored last-4 NRIC string matches the expected format:
 * exactly 3 digits followed by 1 uppercase letter.
 */
export function validateNricLast4(value: string): boolean {
  return /^\d{3}[A-Z]$/.test(value);
}

/**
 * Masks a phone number, showing only the last 2 digits for short phones.
 * "91234567" → "****4567"
 * "1234"     → "**34"   (L29: ≤4 chars mask all but last 2)
 * "12"       → "**12"
 * ""         → "****"
 */
export function maskPhone(phone: string): string {
  if (!phone) return '****';
  if (phone.length <= 4) return '**' + phone.slice(-2);
  const suffix = phone.slice(-4);
  return '****' + suffix;
}

/**
 * Masks an email address, keeping the first char of the local part and the domain.
 * "john@example.com" → "j***@example.com"
 * "a@b.com"          → "***@b.com"  (L38: single-char local fully masked)
 */
export function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return '***';
  const [local, domain] = email.split('@');
  if (local.length <= 1) return '***@' + domain;
  return local[0] + '***@' + domain;
}
