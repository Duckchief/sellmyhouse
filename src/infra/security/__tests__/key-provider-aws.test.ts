import crypto from 'crypto';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-kms', () => ({
  KMSClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  EncryptCommand: jest.fn().mockImplementation((input) => ({ input })),
  DecryptCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

process.env['KMS_KEY_ARN'] = 'arn:aws:kms:ap-southeast-1:123456789:key/test-key';

import { AwsKmsKeyProvider } from '../key-provider-aws';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AwsKmsKeyProvider', () => {
  it('wrapKey calls KMS Encrypt and returns base64 ciphertext', async () => {
    const fakeBlob = Buffer.from('encrypted-blob');
    mockSend.mockResolvedValue({ CiphertextBlob: fakeBlob });

    const provider = new AwsKmsKeyProvider();
    const dataKey = crypto.randomBytes(32);
    const wrapped = await provider.wrapKey(dataKey);

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(wrapped).toBe(fakeBlob.toString('base64'));
  });

  it('unwrapKey calls KMS Decrypt and returns Plaintext as Buffer', async () => {
    const fakeDataKey = crypto.randomBytes(32);
    mockSend.mockResolvedValue({ Plaintext: fakeDataKey });

    const provider = new AwsKmsKeyProvider();
    const wrapped = Buffer.from('some-ciphertext').toString('base64');
    const result = await provider.unwrapKey(wrapped);

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(result).toEqual(fakeDataKey);
  });

  it('throws if KMS_KEY_ARN is not set', () => {
    delete process.env['KMS_KEY_ARN'];
    expect(() => new AwsKmsKeyProvider()).toThrow('KMS_KEY_ARN');
    process.env['KMS_KEY_ARN'] = 'arn:aws:kms:ap-southeast-1:123456789:key/test-key';
  });

  it('wrapKey throws if KMS returns no CiphertextBlob', async () => {
    mockSend.mockResolvedValue({ CiphertextBlob: undefined });
    const provider = new AwsKmsKeyProvider();
    await expect(provider.wrapKey(crypto.randomBytes(32))).rejects.toThrow('Failed to wrap key');
  });

  it('unwrapKey throws if KMS returns no Plaintext', async () => {
    mockSend.mockResolvedValue({ Plaintext: undefined });
    const provider = new AwsKmsKeyProvider();
    await expect(provider.unwrapKey('base64ciphertext')).rejects.toThrow('Failed to unwrap key');
  });
});
