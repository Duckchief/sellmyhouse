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
