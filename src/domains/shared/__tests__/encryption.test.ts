import { encrypt, decrypt, encryptIfPresent, decryptIfPresent } from '../encryption';

const TEST_KEY = 'a'.repeat(64);

beforeAll(() => {
  process.env.ENCRYPTION_KEY = TEST_KEY;
});

describe('encryption', () => {
  it('roundtrips plaintext correctly', () => {
    const plaintext = 'my-secret-api-key-12345';
    const encrypted = encrypt(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it('produces unique IVs for the same plaintext', () => {
    const plaintext = 'same-value';
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toBe(b);
    // Both decrypt to same value
    expect(decrypt(a)).toBe(plaintext);
    expect(decrypt(b)).toBe(plaintext);
  });

  it('detects tampered ciphertext', () => {
    const encrypted = encrypt('secret');
    const parts = encrypted.split(':');
    // Tamper with the ciphertext
    parts[2] = parts[2].slice(0, -1) + (parts[2].endsWith('A') ? 'B' : 'A');
    expect(() => decrypt(parts.join(':'))).toThrow();
  });

  it('detects tampered auth tag', () => {
    const encrypted = encrypt('secret');
    const parts = encrypted.split(':');
    // Flip a character in the middle to ensure decoded bytes actually change
    const mid = Math.floor(parts[1].length / 2);
    const ch = parts[1][mid];
    const replacement = ch === 'A' ? 'B' : 'A';
    parts[1] = parts[1].slice(0, mid) + replacement + parts[1].slice(mid + 1);
    expect(() => decrypt(parts.join(':'))).toThrow();
  });

  it('rejects invalid format', () => {
    expect(() => decrypt('not-a-valid-token')).toThrow('Invalid encrypted token format');
  });

  it('throws when ENCRYPTION_KEY is missing', () => {
    const saved = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY must be set');
    process.env.ENCRYPTION_KEY = saved;
  });

  it('throws when ENCRYPTION_KEY is wrong length', () => {
    const saved = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = 'tooshort';
    expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY must be set');
    process.env.ENCRYPTION_KEY = saved;
  });

  describe('encryptIfPresent', () => {
    it('returns null for null input', () => {
      expect(encryptIfPresent(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(encryptIfPresent(undefined)).toBeNull();
    });

    it('encrypts non-null values', () => {
      const result = encryptIfPresent('secret');
      expect(result).not.toBeNull();
      expect(decrypt(result!)).toBe('secret');
    });
  });

  describe('decryptIfPresent', () => {
    it('returns null for null input', () => {
      expect(decryptIfPresent(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(decryptIfPresent(undefined)).toBeNull();
    });

    it('decrypts non-null values', () => {
      const encrypted = encrypt('secret');
      expect(decryptIfPresent(encrypted)).toBe('secret');
    });
  });
});
