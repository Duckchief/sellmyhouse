import { maskNric, validateNricLast4, maskPhone, maskEmail } from './nric';

describe('maskNric', () => {
  it('masks a 4-char last-4 NRIC to XXXX format (no prefix — prefix is unknown)', () => {
    expect(maskNric('567A')).toBe('XXXX567A');
  });
  it('works with lowercase letters in last char', () => {
    expect(maskNric('567a')).toBe('XXXX567a');
  });
  it('handles exactly 4 characters', () => {
    expect(maskNric('123B')).toBe('XXXX123B');
  });
  it('returns INVALID for empty string', () => {
    expect(maskNric('')).toBe('XXXXINVALID');
  });
  it('returns INVALID for string shorter than 4 chars', () => {
    expect(maskNric('12')).toBe('XXXXINVALID');
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
  it('masks phone of exactly 4 chars showing only last 2 (L29)', () => {
    expect(maskPhone('1234')).toBe('**34');
  });
  it('masks phone shorter than 4 chars showing only last 2 (L29)', () => {
    expect(maskPhone('12')).toBe('**12');
  });
  it('masks single-char phone', () => {
    expect(maskPhone('9')).toBe('**9');
  });
});

describe('maskEmail', () => {
  it('masks local part keeping first char, replaces rest with ***, keeps domain', () => {
    expect(maskEmail('john@example.com')).toBe('j***@example.com');
  });
  it('masks single-char local part fully (L38)', () => {
    expect(maskEmail('a@b.com')).toBe('***@b.com');
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
