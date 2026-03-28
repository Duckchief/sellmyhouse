import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const CURRENT_VERSION = 'v1';

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be set (64 hex chars = 32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

function getPreviousKey(): Buffer | null {
  const hex = process.env.ENCRYPTION_KEY_PREVIOUS;
  if (!hex || hex.length !== 64) return null;
  return Buffer.from(hex, 'hex');
}

function encryptWithKey(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const ivB64 = iv.toString('base64url');
  const authTagB64 = authTag.toString('base64url');
  const ciphertextB64 = encrypted.toString('base64url');

  return `${CURRENT_VERSION}:${ivB64}:${authTagB64}:${ciphertextB64}`;
}

function decryptWithKey(iv: Buffer, authTag: Buffer, ciphertext: Buffer, key: Buffer): string {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

export function encrypt(plaintext: string): string {
  return encryptWithKey(plaintext, getKey());
}

export function decrypt(token: string): string {
  const parts = token.split(':');

  let iv: Buffer;
  let authTag: Buffer;
  let ciphertext: Buffer;

  if (parts.length === 4 && parts[0] === CURRENT_VERSION) {
    // Versioned format: v1:iv:authTag:ciphertext
    iv = Buffer.from(parts[1], 'base64url');
    authTag = Buffer.from(parts[2], 'base64url');
    ciphertext = Buffer.from(parts[3], 'base64url');
  } else if (parts.length === 3) {
    // Legacy format: iv:authTag:ciphertext
    iv = Buffer.from(parts[0], 'base64url');
    authTag = Buffer.from(parts[1], 'base64url');
    ciphertext = Buffer.from(parts[2], 'base64url');
  } else {
    throw new Error('Invalid encrypted token format');
  }

  // Try current key first
  try {
    return decryptWithKey(iv, authTag, ciphertext, getKey());
  } catch {
    // Fall through to previous key
  }

  // Try previous key if available
  const previousKey = getPreviousKey();
  if (previousKey) {
    try {
      return decryptWithKey(iv, authTag, ciphertext, previousKey);
    } catch {
      // Fall through to error
    }
  }

  throw new Error('Decryption failed');
}

/**
 * Returns true if the token should be re-encrypted:
 * - Legacy 3-part format (no version prefix)
 * - Encrypted with previous key (current key fails, previous key succeeds)
 */
export function needsReEncryption(token: string): boolean {
  const parts = token.split(':');

  // Legacy format always needs re-encryption
  if (parts.length === 3) return true;

  // Versioned format: check if current key can decrypt it
  if (parts.length === 4 && parts[0] === CURRENT_VERSION) {
    const iv = Buffer.from(parts[1], 'base64url');
    const authTag = Buffer.from(parts[2], 'base64url');
    const ciphertext = Buffer.from(parts[3], 'base64url');
    try {
      decryptWithKey(iv, authTag, ciphertext, getKey());
      return false; // Current key works — no re-encryption needed
    } catch {
      return true; // Current key fails — encrypted with a previous key
    }
  }

  return true; // Unknown format
}

/**
 * Decrypt with whatever key works, re-encrypt with the current key.
 * Returns a fresh v1-prefixed token encrypted with the current ENCRYPTION_KEY.
 */
export function reEncrypt(token: string): string {
  const plaintext = decrypt(token);
  return encrypt(plaintext);
}

export function encryptIfPresent(value: string | null | undefined): string | null {
  if (value == null) return null;
  return encrypt(value);
}

export function decryptIfPresent(value: string | null | undefined): string | null {
  if (value == null) return null;
  return decrypt(value);
}
