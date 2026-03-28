import {
  encrypt,
  decrypt,
  encryptIfPresent,
  decryptIfPresent,
  needsReEncryption,
  reEncrypt,
} from '../encryption';

const TEST_KEY = 'a'.repeat(64);
const PREVIOUS_KEY = 'b'.repeat(64);

beforeAll(() => {
  process.env.ENCRYPTION_KEY = TEST_KEY;
  delete process.env.ENCRYPTION_KEY_PREVIOUS;
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
    // v1:iv:authTag:ciphertext — tamper with ciphertext (index 3)
    parts[3] = parts[3].slice(0, -1) + (parts[3].endsWith('A') ? 'B' : 'A');
    expect(() => decrypt(parts.join(':'))).toThrow();
  });

  it('detects tampered auth tag', () => {
    const encrypted = encrypt('secret');
    const parts = encrypted.split(':');
    // v1:iv:authTag:ciphertext — tamper with authTag (index 2)
    const mid = Math.floor(parts[2].length / 2);
    const ch = parts[2][mid];
    const replacement = ch === 'A' ? 'B' : 'A';
    parts[2] = parts[2].slice(0, mid) + replacement + parts[2].slice(mid + 1);
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

  // ─── Key Rotation ──────────────────────────────────────

  describe('versioned format', () => {
    it('encrypt produces v1: prefixed token with 4 colon-separated parts', () => {
      const token = encrypt('test-data');
      expect(token.startsWith('v1:')).toBe(true);
      expect(token.split(':').length).toBe(4);
    });

    it('decrypt handles versioned v1: format', () => {
      const token = encrypt('versioned-secret');
      expect(decrypt(token)).toBe('versioned-secret');
    });

    it('decrypt handles legacy 3-part format (backward compat)', () => {
      // Simulate a legacy token: encrypt with current key but strip v1: prefix
      const token = encrypt('legacy-secret');
      const legacyToken = token.replace(/^v1:/, '');
      expect(legacyToken.split(':').length).toBe(3);
      expect(decrypt(legacyToken)).toBe('legacy-secret');
    });
  });

  describe('key rotation', () => {
    afterEach(() => {
      process.env.ENCRYPTION_KEY = TEST_KEY;
      delete process.env.ENCRYPTION_KEY_PREVIOUS;
    });

    it('decrypts with previous key when current key fails', () => {
      // Encrypt with key A
      process.env.ENCRYPTION_KEY = TEST_KEY;
      const token = encrypt('rotate-me');

      // Rotate: B becomes current, A becomes previous
      process.env.ENCRYPTION_KEY = PREVIOUS_KEY;
      process.env.ENCRYPTION_KEY_PREVIOUS = TEST_KEY;

      expect(decrypt(token)).toBe('rotate-me');
    });

    it('throws when neither current nor previous key can decrypt', () => {
      process.env.ENCRYPTION_KEY = TEST_KEY;
      const token = encrypt('no-luck');

      // Set totally different keys
      process.env.ENCRYPTION_KEY = 'c'.repeat(64);
      process.env.ENCRYPTION_KEY_PREVIOUS = 'd'.repeat(64);

      expect(() => decrypt(token)).toThrow();
    });
  });

  describe('needsReEncryption', () => {
    afterEach(() => {
      process.env.ENCRYPTION_KEY = TEST_KEY;
      delete process.env.ENCRYPTION_KEY_PREVIOUS;
    });

    it('returns true for legacy 3-part format', () => {
      const token = encrypt('test');
      const legacyToken = token.replace(/^v1:/, '');
      expect(needsReEncryption(legacyToken)).toBe(true);
    });

    it('returns true for token encrypted with previous key', () => {
      process.env.ENCRYPTION_KEY = TEST_KEY;
      const token = encrypt('old-key-data');

      // Rotate keys
      process.env.ENCRYPTION_KEY = PREVIOUS_KEY;
      process.env.ENCRYPTION_KEY_PREVIOUS = TEST_KEY;

      expect(needsReEncryption(token)).toBe(true);
    });

    it('returns false for token encrypted with current key', () => {
      const token = encrypt('current');
      expect(needsReEncryption(token)).toBe(false);
    });
  });

  describe('reEncrypt', () => {
    afterEach(() => {
      process.env.ENCRYPTION_KEY = TEST_KEY;
      delete process.env.ENCRYPTION_KEY_PREVIOUS;
    });

    it('re-encrypts legacy token with current key', () => {
      const token = encrypt('re-encrypt-me');
      const legacyToken = token.replace(/^v1:/, '');

      const newToken = reEncrypt(legacyToken);
      expect(newToken.startsWith('v1:')).toBe(true);
      expect(decrypt(newToken)).toBe('re-encrypt-me');
    });

    it('re-encrypts token from previous key with current key', () => {
      process.env.ENCRYPTION_KEY = TEST_KEY;
      const oldToken = encrypt('rotate-data');

      // Rotate keys
      process.env.ENCRYPTION_KEY = PREVIOUS_KEY;
      process.env.ENCRYPTION_KEY_PREVIOUS = TEST_KEY;

      const newToken = reEncrypt(oldToken);
      expect(newToken.startsWith('v1:')).toBe(true);
      expect(decrypt(newToken)).toBe('rotate-data');

      // Verify new token works without the previous key
      delete process.env.ENCRYPTION_KEY_PREVIOUS;
      expect(decrypt(newToken)).toBe('rotate-data');
    });
  });
});
