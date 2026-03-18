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
    return encrypt(dataKey.toString('hex'));
  }

  async unwrapKey(wrapped: string): Promise<Buffer> {
    const hex = decrypt(wrapped);
    return Buffer.from(hex, 'hex');
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _keyProvider: KeyProvider | null = null;

export function getKeyProvider(): KeyProvider {
  if (!_keyProvider) {
    _keyProvider =
      process.env['KEY_PROVIDER'] === 'aws'
        ? (() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { AwsKmsKeyProvider } = require('./key-provider-aws') as {
              AwsKmsKeyProvider: new () => KeyProvider;
            };
            return new AwsKmsKeyProvider();
          })()
        : new EnvKeyProvider();
  }
  return _keyProvider;
}

/** For testing — pass null to reset singleton */
export function setKeyProvider(provider: KeyProvider | null): void {
  _keyProvider = provider;
}
