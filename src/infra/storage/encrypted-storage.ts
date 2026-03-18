import crypto from 'crypto';
import { localStorage } from './local-storage';
import { getKeyProvider } from '@/infra/security/key-provider';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;    // 96-bit IV — recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag — maximum strength

export interface EncryptedSaveResult {
  path: string;
  wrappedKey: string;
}

/**
 * Storage service for highly sensitive files (CDD identity documents).
 * Each file is encrypted with a fresh random per-file data key (AES-256-GCM).
 * The data key is wrapped by the active KeyProvider (env ENCRYPTION_KEY or AWS KMS).
 *
 * SECURITY:
 * - No plaintext ever touches disk
 * - Each file has its own unique key and IV (no key/IV reuse)
 * - Auth tag prevents tampering (OWASP A02)
 * - Key wrapping prevents key exposure if filesystem is compromised
 *
 * Blob layout on disk: IV(12B) | authTag(16B) | ciphertext(nB)
 */
export const encryptedStorage = {
  /**
   * Encrypt data and save to path.
   * Returns { path, wrappedKey } — caller MUST persist wrappedKey in documents JSON.
   * Without wrappedKey, the file cannot be decrypted.
   */
  async save(filePath: string, data: Buffer): Promise<EncryptedSaveResult> {
    const dataKey = crypto.randomBytes(32); // fresh key per file
    const iv = crypto.randomBytes(IV_LENGTH); // fresh IV per file

    const cipher = crypto.createCipheriv(ALGORITHM, dataKey, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Blob: IV | authTag | ciphertext — all on disk, none plaintext
    const blob = Buffer.concat([iv, authTag, ciphertext]);
    await localStorage.save(filePath, blob);

    // Wrap the data key — never stored plaintext
    const wrappedKey = await getKeyProvider().wrapKey(dataKey);
    return { path: filePath, wrappedKey };
  },

  /**
   * Decrypt a previously saved file.
   * Returns plaintext buffer in memory only — never written to disk.
   * Throws if auth tag verification fails (tampered or corrupt file).
   */
  async read(filePath: string, wrappedKey: string): Promise<Buffer> {
    const blob = await localStorage.read(filePath);

    const iv = blob.subarray(0, IV_LENGTH);
    const authTag = blob.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = blob.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const dataKey = await getKeyProvider().unwrapKey(wrappedKey);

    const decipher = crypto.createDecipheriv(ALGORITHM, dataKey, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    // Throws if auth tag does not match — tampered or wrong key
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  },

  /**
   * Delete the encrypted file from disk.
   * No decryption needed — just remove the blob.
   */
  async delete(filePath: string): Promise<void> {
    await localStorage.delete(filePath);
  },
};
