import { maskNric, validateNricLast4 } from './nric';

describe('maskNric', () => {
  it('masks a 4-char last-4 NRIC to SXXXX format', () => {
    expect(maskNric('567A')).toBe('SXXXX567A');
  });
  it('works with lowercase letters in last char (uppercase output)', () => {
    expect(maskNric('567a')).toBe('SXXXX567a');
  });
  it('handles exactly 4 characters', () => {
    expect(maskNric('123B')).toBe('SXXXX123B');
  });
  it('returns INVALID for empty string', () => {
    expect(maskNric('')).toBe('SXXXXINVALID');
  });
  it('returns INVALID for string shorter than 4 chars', () => {
    expect(maskNric('12')).toBe('SXXXXINVALID');
  });
});

describe('validateNricLast4', () => {
  it('accepts 3 digits followed by 1 uppercase letter', () => {
    expect(validateNricLast4('567A')).toBe(true);
    expect(validateNricLast4('000Z')).toBe(true);
  });
  it('rejects lowercase letter at end', () => {
    expect(validateNricLast4('567a')).toBe(false);
  });
  it('rejects all digits', () => {
    expect(validateNricLast4('5678')).toBe(false);
  });
  it('rejects wrong length', () => {
    expect(validateNricLast4('56A')).toBe(false);
    expect(validateNricLast4('5678A')).toBe(false);
  });
  it('rejects empty string', () => {
    expect(validateNricLast4('')).toBe(false);
  });
});
