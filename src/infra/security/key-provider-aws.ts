import { KMSClient, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms';
import type { KeyProvider } from './key-provider';

/**
 * Wraps/unwraps per-file data keys using AWS KMS (ap-southeast-1 — Singapore).
 * KMS_KEY_ARN env var must be set. Selected via KEY_PROVIDER=aws at startup.
 * The KMS master key never leaves AWS — only the encrypted data key blob is stored locally.
 * Fail-closed: any KMS error throws, never falls back to plaintext.
 */
export class AwsKmsKeyProvider implements KeyProvider {
  private readonly client: KMSClient;
  private readonly keyArn: string;

  constructor() {
    const arn = process.env['KMS_KEY_ARN'];
    if (!arn) throw new Error('KMS_KEY_ARN env var is required for AwsKmsKeyProvider');
    this.keyArn = arn;
    this.client = new KMSClient({ region: 'ap-southeast-1' });
  }

  async wrapKey(dataKey: Buffer): Promise<string> {
    try {
      const response = await this.client.send(
        new EncryptCommand({ KeyId: this.keyArn, Plaintext: dataKey }),
      );
      if (!response.CiphertextBlob) throw new Error('no CiphertextBlob');
      return Buffer.from(response.CiphertextBlob).toString('base64');
    } catch (err) {
      throw new Error('Failed to wrap key', { cause: err });
    }
  }

  async unwrapKey(wrapped: string): Promise<Buffer> {
    try {
      const response = await this.client.send(
        new DecryptCommand({
          KeyId: this.keyArn,
          CiphertextBlob: Buffer.from(wrapped, 'base64'),
        }),
      );
      if (!response.Plaintext) throw new Error('no Plaintext');
      return Buffer.from(response.Plaintext);
    } catch (err) {
      throw new Error('Failed to unwrap key', { cause: err });
    }
  }
}
