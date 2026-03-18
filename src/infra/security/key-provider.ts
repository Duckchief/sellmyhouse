import { encrypt, decrypt } from '@/domains/shared/encryption';

/**
 * KeyProvider wraps and unwraps per-file data keys using a master key.
 * EnvKeyProvider uses ENCRYPTION_KEY env var (AES-256-GCM via shared encryption.ts).
 * AwsKmsKeyProvider uses AWS KMS (separate file).
 * Swap via KEY_PROVIDER=env|aws env var at startup. Never hardcode keys.
 */
export interface KeyProvider {
  wrapKey(dataKey: Buffer): Promise<string>;
  unwrapKey(wrapped: string): Promise<Buffer>;
}

/**
 * Uses the existing ENCRYPTION_KEY env var (never hardcoded).
 * Converts data key to hex string, then encrypts with shared encrypt().
 */
export class EnvKeyProvider implements KeyProvider {
  async wrapKey(dataKey: Buffer): Promise<string> {
    try {
      return encrypt(dataKey.toString('hex'));
    } catch {
      throw new Error('Failed to wrap key');
    }
  }

  async unwrapKey(wrapped: string): Promise<Buffer> {
    try {
      const hex = decrypt(wrapped);
      return Buffer.from(hex, 'hex');
    } catch {
      throw new Error('Failed to unwrap key');
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _keyProvider: KeyProvider | null = null;

export function getKeyProvider(): KeyProvider {
  if (!_keyProvider) {
    if (process.env['KEY_PROVIDER'] === 'aws') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require('./key-provider-aws') as { AwsKmsKeyProvider?: new () => KeyProvider };
        if (!mod.AwsKmsKeyProvider) throw new Error('AwsKmsKeyProvider not exported');
        _keyProvider = new mod.AwsKmsKeyProvider();
      } catch (err) {
        throw new Error(`Failed to load AwsKmsKeyProvider: ${String(err)}`);
      }
    } else {
      const hex = process.env['ENCRYPTION_KEY'];
      if (!hex || hex.length !== 64) {
        throw new Error('ENCRYPTION_KEY must be set (64 hex chars = 32 bytes)');
      }
      _keyProvider = new EnvKeyProvider();
    }
  }
  return _keyProvider;
}

/** For testing — pass null to reset singleton */
export function setKeyProvider(provider: KeyProvider | null): void {
  _keyProvider = provider;
}
