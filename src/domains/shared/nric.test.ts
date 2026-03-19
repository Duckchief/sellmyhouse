import { maskNric, validateNricLast4, maskPhone, maskEmail } from './nric';

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

describe('maskPhone', () => {
  it('masks all but last 4 digits', () => {
    expect(maskPhone('91234567')).toBe('****4567');
  });
  it('masks an 8-digit Singapore number', () => {
    expect(maskPhone('98765432')).toBe('****5432');
  });
  it('returns **** for empty string', () => {
    expect(maskPhone('')).toBe('****');
  });
  it('shows only last 4 when phone is exactly 4 chars', () => {
    expect(maskPhone('1234')).toBe('1234');
  });
  it('masks correctly when phone is shorter than 4 chars', () => {
    expect(maskPhone('12')).toBe('**');
  });
});

describe('maskEmail', () => {
  it('masks local part keeping first char, replaces rest with ***, keeps domain', () => {
    expect(maskEmail('john@example.com')).toBe('j***@example.com');
  });
  it('handles single-char local part', () => {
    expect(maskEmail('a@b.com')).toBe('a***@b.com');
  });
  it('masks longer local part to j***', () => {
    expect(maskEmail('johndoe@test.sg')).toBe('j***@test.sg');
  });
  it('returns *** for string with no @ sign', () => {
    expect(maskEmail('invalidemail')).toBe('***');
  });
  it('returns *** for empty string', () => {
    expect(maskEmail('')).toBe('***');
  });
});
