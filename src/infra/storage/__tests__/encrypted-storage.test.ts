import crypto from 'crypto';
import { setKeyProvider } from '@/infra/security/key-provider';
import type { KeyProvider } from '@/infra/security/key-provider';

jest.mock('../local-storage', () => ({
  localStorage: {
    save: jest.fn(),
    read: jest.fn(),
    delete: jest.fn(),
    exists: jest.fn(),
  },
}));

import { localStorage } from '../local-storage';
import { encryptedStorage } from '../encrypted-storage';

const mockLocal = localStorage as jest.Mocked<typeof localStorage>;

// Identity stub: wrappedKey is the key as hex — no real encryption needed in tests
const stubKeyProvider: KeyProvider = {
  wrapKey: async (k) => k.toString('hex'),
  unwrapKey: async (s) => Buffer.from(s, 'hex'),
};

beforeEach(() => {
  jest.clearAllMocks();
  setKeyProvider(stubKeyProvider);
});

describe('encryptedStorage.save + read', () => {
  it('round-trips plaintext — decrypted output equals original input', async () => {
    const plaintext = Buffer.from('NRIC: S1234567A');
    let capturedBlob: Buffer = Buffer.alloc(0);

    mockLocal.save.mockImplementation(async (p, blob) => {
      capturedBlob = blob as Buffer;
      return p;
    });
    mockLocal.read.mockImplementation(async () => capturedBlob);

    const { path, wrappedKey } = await encryptedStorage.save('cdd/test/nric.enc', plaintext);
    const result = await encryptedStorage.read(path, wrappedKey);

    expect(result).toEqual(plaintext);
  });

  it('generates a unique IV for each save (first 12 bytes differ)', async () => {
    const plaintext = Buffer.from('same content');
    const blobs: Buffer[] = [];

    mockLocal.save.mockImplementation(async (p, blob) => {
      blobs.push(blob as Buffer);
      return p;
    });

    await encryptedStorage.save('cdd/1/a.enc', plaintext);
    await encryptedStorage.save('cdd/1/b.enc', plaintext);

    expect(blobs.length).toBe(2);
    const iv1 = blobs[0]!.subarray(0, 12);
    const iv2 = blobs[1]!.subarray(0, 12);
    expect(iv1).not.toEqual(iv2);
  });

  it('throws on decryption with wrong data key (auth tag mismatch)', async () => {
    const plaintext = Buffer.from('sensitive');
    let capturedBlob: Buffer = Buffer.alloc(0);

    mockLocal.save.mockImplementation(async (p, blob) => {
      capturedBlob = blob as Buffer;
      return p;
    });
    mockLocal.read.mockImplementation(async () => capturedBlob);

    const { path } = await encryptedStorage.save('cdd/test/nric.enc', plaintext);
    const wrongWrappedKey = crypto.randomBytes(32).toString('hex');

    await expect(encryptedStorage.read(path, wrongWrappedKey)).rejects.toThrow();
  });

  it('stored blob is NOT plaintext — does not contain original content', async () => {
    const plaintext = Buffer.from('NRIC: S1234567A');
    let capturedBlob: Buffer = Buffer.alloc(0);

    mockLocal.save.mockImplementation(async (p, blob) => {
      capturedBlob = blob as Buffer;
      return p;
    });

    await encryptedStorage.save('cdd/test/nric.enc', plaintext);
    expect(capturedBlob.includes(plaintext)).toBe(false);
  });
});

describe('encryptedStorage.delete', () => {
  it('delegates to localStorage.delete', async () => {
    mockLocal.delete.mockResolvedValue(undefined);
    await encryptedStorage.delete('cdd/test/nric.enc');
    expect(mockLocal.delete).toHaveBeenCalledWith('cdd/test/nric.enc');
  });
});
