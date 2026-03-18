# CDD Document Upload Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement hardened CDD document upload/download/delete with per-file AES-256-GCM envelope encryption and a swappable KeyProvider (env var → AWS KMS).

**Architecture:** Two new infrastructure files (`key-provider.ts`, `encrypted-storage.ts`) plus additions to the `compliance` domain (types, validator, repository, service, router). Files are encrypted before touching disk; per-file data keys are wrapped by a master `KeyProvider`. The `documents` JSON field on `CddRecord` stores path + wrapped key + metadata per document. No schema migration required.

**Tech Stack:** Node.js crypto (built-in), `@aws-sdk/client-kms` (new dep), multer (existing), clamscan (existing), `@paralleldrive/cuid2` (existing), express-validator (existing).

**Spec:** `docs/superpowers/specs/2026-03-18-cdd-document-upload-design.md`

---

## Chunk 1: Infrastructure — KeyProvider + encryptedStorage

### Task 1: KeyProvider interface + EnvKeyProvider

**Files:**
- Create: `src/infra/security/key-provider.ts`
- Create: `src/infra/security/__tests__/key-provider.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/infra/security/__tests__/key-provider.test.ts
import crypto from 'crypto';

// Set ENCRYPTION_KEY before importing the module
process.env['ENCRYPTION_KEY'] = crypto.randomBytes(32).toString('hex');

import { EnvKeyProvider, setKeyProvider, getKeyProvider } from '../key-provider';

beforeEach(() => {
  // Reset to a fresh instance each test
  setKeyProvider(null);
});

describe('EnvKeyProvider', () => {
  it('wrapKey then unwrapKey round-trips a 32-byte data key', async () => {
    const provider = new EnvKeyProvider();
    const dataKey = crypto.randomBytes(32);
    const wrapped = await provider.wrapKey(dataKey);
    const unwrapped = await provider.unwrapKey(wrapped);
    expect(unwrapped).toEqual(dataKey);
  });

  it('wrapKey returns a non-empty string', async () => {
    const provider = new EnvKeyProvider();
    const wrapped = await provider.wrapKey(crypto.randomBytes(32));
    expect(typeof wrapped).toBe('string');
    expect(wrapped.length).toBeGreaterThan(0);
  });

  it('unwrapKey with wrong token throws', async () => {
    const provider = new EnvKeyProvider();
    await expect(provider.unwrapKey('bad:token:here')).rejects.toThrow();
  });
});

describe('getKeyProvider / setKeyProvider', () => {
  it('returns EnvKeyProvider by default (KEY_PROVIDER not set)', () => {
    delete process.env['KEY_PROVIDER'];
    const provider = getKeyProvider();
    expect(provider).toBeInstanceOf(EnvKeyProvider);
  });

  it('setKeyProvider(null) resets singleton so next call re-creates it', () => {
    const stub = { wrapKey: jest.fn(), unwrapKey: jest.fn() };
    setKeyProvider(stub);
    expect(getKeyProvider()).toBe(stub);
    setKeyProvider(null);
    expect(getKeyProvider()).toBeInstanceOf(EnvKeyProvider);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest src/infra/security/__tests__/key-provider.test.ts --no-coverage
```
Expected: FAIL — `Cannot find module '../key-provider'`

- [ ] **Step 3: Implement KeyProvider interface + EnvKeyProvider**

```typescript
// src/infra/security/key-provider.ts
import { encrypt, decrypt } from '@/domains/shared/encryption';

/**
 * KeyProvider wraps and unwraps per-file data keys using a master key.
 * EnvKeyProvider uses ENCRYPTION_KEY env var (AES-256-GCM via shared encryption.ts).
 * AwsKmsKeyProvider uses AWS KMS (Task 2).
 * Swap via KEY_PROVIDER=env|aws env var at startup.
 */
export interface KeyProvider {
  wrapKey(dataKey: Buffer): Promise<string>;
  unwrapKey(wrapped: string): Promise<Buffer>;
}

/**
 * Uses the existing ENCRYPTION_KEY env var.
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
        ? // AwsKmsKeyProvider loaded lazily to avoid import errors when aws-sdk not installed
          (() => {
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest src/infra/security/__tests__/key-provider.test.ts --no-coverage
```
Expected: PASS (3 suites, 5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/infra/security/key-provider.ts src/infra/security/__tests__/key-provider.test.ts
git commit -m "feat: add KeyProvider interface and EnvKeyProvider"
```

---

### Task 2: AwsKmsKeyProvider

**Files:**
- Create: `src/infra/security/key-provider-aws.ts`
- Create: `src/infra/security/__tests__/key-provider-aws.test.ts`

- [ ] **Step 1: Install AWS SDK**

```bash
npm install @aws-sdk/client-kms
npm install --save-dev @types/node
```

Expected: `@aws-sdk/client-kms` appears in `package.json` dependencies.

- [ ] **Step 2: Write the failing tests**

```typescript
// src/infra/security/__tests__/key-provider-aws.test.ts
import crypto from 'crypto';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-kms', () => ({
  KMSClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  EncryptCommand: jest.fn().mockImplementation((input) => ({ input })),
  DecryptCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

// Set required env before import
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
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx jest src/infra/security/__tests__/key-provider-aws.test.ts --no-coverage
```
Expected: FAIL — `Cannot find module '../key-provider-aws'`

- [ ] **Step 4: Implement AwsKmsKeyProvider**

```typescript
// src/infra/security/key-provider-aws.ts
import { KMSClient, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms';
import type { KeyProvider } from './key-provider';

/**
 * Wraps/unwraps data keys using AWS KMS (ap-southeast-1).
 * KMS_KEY_ARN env var must be set. KEY_PROVIDER=aws env var selects this provider.
 * The KMS key never leaves AWS — only the encrypted data key blob is stored locally.
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
    const response = await this.client.send(
      new EncryptCommand({
        KeyId: this.keyArn,
        Plaintext: dataKey,
      }),
    );
    if (!response.CiphertextBlob) throw new Error('KMS Encrypt returned no CiphertextBlob');
    return Buffer.from(response.CiphertextBlob).toString('base64');
  }

  async unwrapKey(wrapped: string): Promise<Buffer> {
    const response = await this.client.send(
      new DecryptCommand({
        KeyId: this.keyArn,
        CiphertextBlob: Buffer.from(wrapped, 'base64'),
      }),
    );
    if (!response.Plaintext) throw new Error('KMS Decrypt returned no Plaintext');
    return Buffer.from(response.Plaintext);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx jest src/infra/security/__tests__/key-provider-aws.test.ts --no-coverage
```
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/infra/security/key-provider-aws.ts src/infra/security/__tests__/key-provider-aws.test.ts package.json package-lock.json
git commit -m "feat: add AwsKmsKeyProvider for envelope encryption via AWS KMS ap-southeast-1"
```

---

### Task 3: encryptedStorage

**Files:**
- Create: `src/infra/storage/encrypted-storage.ts`
- Create: `src/infra/storage/__tests__/encrypted-storage.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/infra/storage/__tests__/encrypted-storage.test.ts
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

// Identity stub: wrappedKey is the key as hex — no real encryption
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
    // Wrap a different random key — will fail auth tag check
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest src/infra/storage/__tests__/encrypted-storage.test.ts --no-coverage
```
Expected: FAIL — `Cannot find module '../encrypted-storage'`

- [ ] **Step 3: Implement encryptedStorage**

```typescript
// src/infra/storage/encrypted-storage.ts
import crypto from 'crypto';
import { localStorage } from './local-storage';
import { getKeyProvider } from '@/infra/security/key-provider';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export interface EncryptedSaveResult {
  path: string;
  wrappedKey: string;
}

/**
 * Storage service for highly sensitive files (CDD documents).
 * Each file is encrypted with a fresh random data key (AES-256-GCM).
 * The data key is wrapped by the active KeyProvider (env or AWS KMS).
 * No plaintext ever touches disk.
 *
 * Blob layout on disk: IV(12B) | authTag(16B) | ciphertext(nB)
 */
export const encryptedStorage = {
  /**
   * Encrypt data and save to path. Returns path + wrappedKey.
   * Caller must persist wrappedKey alongside path (in documents JSON).
   */
  async save(filePath: string, data: Buffer): Promise<EncryptedSaveResult> {
    const dataKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, dataKey, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Blob: IV | authTag | ciphertext
    const blob = Buffer.concat([iv, authTag, ciphertext]);
    await localStorage.save(filePath, blob);

    const wrappedKey = await getKeyProvider().wrapKey(dataKey);
    return { path: filePath, wrappedKey };
  },

  /**
   * Decrypt a previously saved file. Returns plaintext buffer in memory only.
   * wrappedKey must match the one returned by save().
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

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  },

  /**
   * Delete the encrypted file. No decryption needed.
   */
  async delete(filePath: string): Promise<void> {
    await localStorage.delete(filePath);
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest src/infra/storage/__tests__/encrypted-storage.test.ts --no-coverage
```
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/infra/storage/encrypted-storage.ts src/infra/storage/__tests__/encrypted-storage.test.ts
git commit -m "feat: add encryptedStorage — per-file AES-256-GCM with envelope key wrapping"
```

---

## Chunk 2: Domain Layer — Types, Validator, Repository

### Task 4: CddDocumentType enum + CddDocument type

**Files:**
- Modify: `src/domains/compliance/compliance.types.ts`

- [ ] **Step 1: Add types** — append to the end of `src/domains/compliance/compliance.types.ts`

```typescript
// ─── CDD Document Upload ──────────────────────────────────────────────────────

export const CDD_DOCUMENT_TYPES = [
  'nric',
  'passport',
  'work_pass',
  'proof_of_address',
  'source_of_funds',
  'acra_bizfile',
  'death_certificate',
  'will',
  'letters_of_administration',
  'grant_of_probate',
  'hdb_transmission_approval',
  'other',
] as const;

export type CddDocumentType = (typeof CDD_DOCUMENT_TYPES)[number];

/**
 * One entry in the CddRecord.documents JSON array.
 * path + wrappedKey are required to decrypt the .enc file.
 * wrappedKey is the per-file data key encrypted by the active KeyProvider.
 */
export interface CddDocument {
  id: string;
  docType: CddDocumentType;
  label: string | null; // required when docType === 'other'
  path: string;         // relative: cdd/{cddRecordId}/{docType}-{uuid}.enc
  wrappedKey: string;   // base64 — data key encrypted by master key
  mimeType: string;
  sizeBytes: number;    // plaintext size (for UI display)
  uploadedAt: string;   // ISO timestamp
  uploadedByAgentId: string;
}

export interface UploadCddDocumentInput {
  cddRecordId: string;
  agentId: string;
  isAdmin: boolean;
  fileBuffer: Buffer;
  originalFilename: string;
  mimeType: string;
  docType: CddDocumentType;
  label?: string;
}

export interface DownloadCddDocumentInput {
  cddRecordId: string;
  documentId: string;
  agentId: string;
  isAdmin: boolean;
}

export interface DeleteCddDocumentInput {
  cddRecordId: string;
  documentId: string;
  agentId: string;
  isAdmin: boolean;
}
```

- [ ] **Step 2: Run existing compliance tests to verify no regressions**

```bash
npx jest src/domains/compliance --no-coverage
```
Expected: PASS — all existing tests unchanged

- [ ] **Step 3: Commit**

```bash
git add src/domains/compliance/compliance.types.ts
git commit -m "feat: add CddDocumentType enum and CddDocument types"
```

---

### Task 5: uploadCddDocument validator

**Files:**
- Modify: `src/domains/compliance/compliance.validator.ts`

- [ ] **Step 1: Add validator** — append to `src/domains/compliance/compliance.validator.ts`

```typescript
import { CDD_DOCUMENT_TYPES } from './compliance.types';

export const uploadCddDocumentValidator = [
  body('docType')
    .isIn([...CDD_DOCUMENT_TYPES])
    .withMessage(`docType must be one of: ${CDD_DOCUMENT_TYPES.join(', ')}`),
  body('label')
    .if(body('docType').equals('other'))
    .notEmpty()
    .withMessage('label is required when docType is "other"')
    .isLength({ max: 100 })
    .withMessage('label must be 100 characters or fewer'),
];
```

Note: Add the `CDD_DOCUMENT_TYPES` import at the top of the file alongside the existing `body` import if not already present. The `body` import from `express-validator` is already at line 1.

- [ ] **Step 2: Run existing compliance tests to verify no regressions**

```bash
npx jest src/domains/compliance --no-coverage
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/domains/compliance/compliance.validator.ts
git commit -m "feat: add uploadCddDocumentValidator with docType enum and label rule"
```

---

### Task 6: Repository additions

**Files:**
- Modify: `src/domains/compliance/compliance.repository.ts`
- Modify: `src/domains/compliance/__tests__/compliance.repository.test.ts`

- [ ] **Step 1: Write failing tests** — add to `src/domains/compliance/__tests__/compliance.repository.test.ts`

```typescript
// Add these imports at the top of the existing test file:
// import type { CddDocument } from '../compliance.types';

describe('CDD document repository functions', () => {
  const mockCddRecordId = 'cdd-record-1';
  const mockDoc: CddDocument = {
    id: 'doc-1',
    docType: 'nric',
    label: null,
    path: 'cdd/cdd-record-1/nric-doc-1.enc',
    wrappedKey: 'wrapped-key-base64',
    mimeType: 'image/jpeg',
    sizeBytes: 12345,
    uploadedAt: '2026-03-18T00:00:00.000Z',
    uploadedByAgentId: 'agent-1',
  };

  describe('findCddRecordById', () => {
    it('returns record when found', async () => {
      mockPrisma.cddRecord.findUnique.mockResolvedValue({
        id: mockCddRecordId,
        verifiedByAgentId: 'agent-1',
        documents: [],
      } as unknown as CddRecord);

      const result = await complianceRepo.findCddRecordById(mockCddRecordId);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(mockCddRecordId);
    });

    it('returns null when not found', async () => {
      mockPrisma.cddRecord.findUnique.mockResolvedValue(null);
      const result = await complianceRepo.findCddRecordById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('addCddDocument', () => {
    it('appends document to existing documents array', async () => {
      mockPrisma.cddRecord.findUnique.mockResolvedValue({
        documents: [],
      } as unknown as CddRecord);
      mockPrisma.cddRecord.update.mockResolvedValue({} as unknown as CddRecord);

      await complianceRepo.addCddDocument(mockCddRecordId, mockDoc);

      expect(mockPrisma.cddRecord.update).toHaveBeenCalledWith({
        where: { id: mockCddRecordId },
        data: { documents: [mockDoc] },
      });
    });
  });

  describe('removeCddDocument', () => {
    it('removes document by id and returns its path', async () => {
      mockPrisma.cddRecord.findUnique.mockResolvedValue({
        documents: [mockDoc],
      } as unknown as CddRecord);
      mockPrisma.cddRecord.update.mockResolvedValue({} as unknown as CddRecord);

      const path = await complianceRepo.removeCddDocument(mockCddRecordId, 'doc-1');
      expect(path).toBe(mockDoc.path);
      expect(mockPrisma.cddRecord.update).toHaveBeenCalledWith({
        where: { id: mockCddRecordId },
        data: { documents: [] },
      });
    });

    it('returns null when document id not found', async () => {
      mockPrisma.cddRecord.findUnique.mockResolvedValue({
        documents: [mockDoc],
      } as unknown as CddRecord);

      const path = await complianceRepo.removeCddDocument(mockCddRecordId, 'nonexistent');
      expect(path).toBeNull();
      expect(mockPrisma.cddRecord.update).not.toHaveBeenCalled();
    });
  });

  describe('findCddRecordWithDocument', () => {
    it('returns verifiedByAgentId and matching document', async () => {
      mockPrisma.cddRecord.findUnique.mockResolvedValue({
        verifiedByAgentId: 'agent-1',
        documents: [mockDoc],
      } as unknown as CddRecord);

      const result = await complianceRepo.findCddRecordWithDocument(mockCddRecordId, 'doc-1');
      expect(result?.verifiedByAgentId).toBe('agent-1');
      expect(result?.document?.id).toBe('doc-1');
    });

    it('returns document as null when documentId not found', async () => {
      mockPrisma.cddRecord.findUnique.mockResolvedValue({
        verifiedByAgentId: 'agent-1',
        documents: [mockDoc],
      } as unknown as CddRecord);

      const result = await complianceRepo.findCddRecordWithDocument(mockCddRecordId, 'missing');
      expect(result?.document).toBeNull();
    });

    it('returns null when CDD record not found', async () => {
      mockPrisma.cddRecord.findUnique.mockResolvedValue(null);
      const result = await complianceRepo.findCddRecordWithDocument('none', 'doc-1');
      expect(result).toBeNull();
    });
  });
});
```

**Important — extend the Prisma mock:** The existing `jest.mock('@/infra/database/prisma', ...)` block in `compliance.repository.test.ts` declares `cddRecord` with only `create`, `updateMany`, `findFirst`, `update`, and `delete`. The new functions call `findUnique` and (in Task 13) `findMany`. Before adding the new tests, extend the mock to add these methods:

```typescript
// In the jest.mock('@/infra/database/prisma', ...) factory, add to cddRecord:
findUnique: jest.fn(),
findMany: jest.fn(),
```

And add them to the `mockPrisma` typed reference at the top of the file. Also import `CddRecord` from `../compliance.types` if not already imported.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest src/domains/compliance/__tests__/compliance.repository.test.ts --no-coverage
```
Expected: FAIL — `complianceRepo.findCddRecordById is not a function`

- [ ] **Step 3: Add repository functions** — append to `src/domains/compliance/compliance.repository.ts`

Also add this import at the top of the file (alongside existing Prisma imports):
```typescript
import type { CddDocument } from './compliance.types';
```

Then append these functions before the final closing:

```typescript
// ─── CDD Document Management ──────────────────────────────────────────────────

export async function findCddRecordById(id: string): Promise<CddRecord | null> {
  return prisma.cddRecord.findUnique({
    where: { id },
  }) as unknown as Promise<CddRecord | null>;
}

export async function addCddDocument(cddRecordId: string, doc: CddDocument): Promise<void> {
  const record = await prisma.cddRecord.findUnique({
    where: { id: cddRecordId },
    select: { documents: true },
  });
  const existing = (record?.documents as CddDocument[]) ?? [];
  await prisma.cddRecord.update({
    where: { id: cddRecordId },
    data: { documents: [...existing, doc] as Prisma.InputJsonValue },
  });
}

export async function removeCddDocument(
  cddRecordId: string,
  documentId: string,
): Promise<string | null> {
  const record = await prisma.cddRecord.findUnique({
    where: { id: cddRecordId },
    select: { documents: true },
  });
  const existing = (record?.documents as CddDocument[]) ?? [];
  const target = existing.find((d) => d.id === documentId);
  if (!target) return null;

  await prisma.cddRecord.update({
    where: { id: cddRecordId },
    data: { documents: existing.filter((d) => d.id !== documentId) as Prisma.InputJsonValue },
  });
  return target.path;
}

export async function findCddRecordWithDocument(
  cddRecordId: string,
  documentId: string,
): Promise<{ verifiedByAgentId: string; document: CddDocument | null } | null> {
  const record = await prisma.cddRecord.findUnique({
    where: { id: cddRecordId },
    select: { verifiedByAgentId: true, documents: true },
  });
  if (!record) return null;
  const docs = (record.documents as CddDocument[]) ?? [];
  return {
    verifiedByAgentId: record.verifiedByAgentId,
    document: docs.find((d) => d.id === documentId) ?? null,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest src/domains/compliance/__tests__/compliance.repository.test.ts --no-coverage
```
Expected: PASS — all tests including new ones

- [ ] **Step 5: Commit**

```bash
git add src/domains/compliance/compliance.repository.ts src/domains/compliance/__tests__/compliance.repository.test.ts
git commit -m "feat: add CDD document repository functions (findById, add, remove, findWithDocument)"
```

---

## Chunk 3: Service Layer

### Task 7: uploadCddDocument service function

**Files:**
- Modify: `src/domains/compliance/compliance.service.ts`
- Modify: `src/domains/compliance/__tests__/compliance.service.test.ts`

- [ ] **Step 1: Write failing tests** — add to the compliance service test file

First, add these to the top-level mocks section of the test file:

```typescript
// Add alongside existing mocks at top of compliance.service.test.ts:
jest.mock('@/infra/storage/encrypted-storage', () => ({
  encryptedStorage: {
    save: jest.fn(),
    read: jest.fn(),
    delete: jest.fn(),
  },
}));
jest.mock('@/infra/security/virus-scanner', () => ({
  scanBuffer: jest.fn(),
}));

import { encryptedStorage } from '@/infra/storage/encrypted-storage';
import { scanBuffer } from '@/infra/security/virus-scanner';
const mockEncryptedStorage = encryptedStorage as jest.Mocked<typeof encryptedStorage>;
const mockScanBuffer = scanBuffer as jest.MockedFunction<typeof scanBuffer>;
```

Then add the test suite:

```typescript
describe('uploadCddDocument', () => {
  const baseInput = {
    cddRecordId: 'cdd-1',
    agentId: 'agent-1',
    isAdmin: false,
    fileBuffer: Buffer.from('fake-nric-image'),
    originalFilename: 'nric.jpg',
    mimeType: 'image/jpeg',
    docType: 'nric' as const,
  };

  it('encrypts, saves, appends document, and writes audit log', async () => {
    mockRepo.findCddRecordById.mockResolvedValue({
      id: 'cdd-1',
      verifiedByAgentId: 'agent-1',
      documents: [],
    } as unknown as CddRecord);
    mockScanBuffer.mockResolvedValue({ isClean: true, viruses: [] });
    mockEncryptedStorage.save.mockResolvedValue({
      path: 'cdd/cdd-1/nric-doc123.enc',
      wrappedKey: 'wrapped-key',
    });
    mockRepo.addCddDocument.mockResolvedValue(undefined);
    mockAudit.log.mockResolvedValue(undefined);

    const result = await complianceService.uploadCddDocument(baseInput);

    expect(mockScanBuffer).toHaveBeenCalledWith(baseInput.fileBuffer, baseInput.originalFilename);
    expect(mockEncryptedStorage.save).toHaveBeenCalled();
    expect(mockRepo.addCddDocument).toHaveBeenCalled();
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cdd.document_uploaded' }),
    );
    expect(result.docType).toBe('nric');
    expect(result.uploadedByAgentId).toBe('agent-1');
  });

  it('throws ValidationError when virus detected', async () => {
    mockRepo.findCddRecordById.mockResolvedValue({
      id: 'cdd-1',
      verifiedByAgentId: 'agent-1',
      documents: [],
    } as unknown as CddRecord);
    mockScanBuffer.mockResolvedValue({ isClean: false, viruses: ['EICAR-Test-Signature'] });
    mockAudit.log.mockResolvedValue(undefined);

    await expect(complianceService.uploadCddDocument(baseInput)).rejects.toThrow('security scan');
    expect(mockEncryptedStorage.save).not.toHaveBeenCalled();
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cdd.document_scan_rejected' }),
    );
  });

  it('throws ValidationError when document limit (5) exceeded', async () => {
    const docs = Array.from({ length: 5 }, (_, i) => ({ id: `doc-${i}` }));
    mockRepo.findCddRecordById.mockResolvedValue({
      id: 'cdd-1',
      verifiedByAgentId: 'agent-1',
      documents: docs,
    } as unknown as CddRecord);

    await expect(complianceService.uploadCddDocument(baseInput)).rejects.toThrow('Maximum 5');
    expect(mockScanBuffer).not.toHaveBeenCalled();
  });

  it('throws ForbiddenError when agent does not own the CDD record', async () => {
    mockRepo.findCddRecordById.mockResolvedValue({
      id: 'cdd-1',
      verifiedByAgentId: 'other-agent',
      documents: [],
    } as unknown as CddRecord);

    await expect(
      complianceService.uploadCddDocument({ ...baseInput, agentId: 'agent-1', isAdmin: false }),
    ).rejects.toThrow('not authorised');
  });

  it('allows admin to upload regardless of ownership', async () => {
    mockRepo.findCddRecordById.mockResolvedValue({
      id: 'cdd-1',
      verifiedByAgentId: 'other-agent',
      documents: [],
    } as unknown as CddRecord);
    mockScanBuffer.mockResolvedValue({ isClean: true, viruses: [] });
    mockEncryptedStorage.save.mockResolvedValue({ path: 'cdd/cdd-1/nric.enc', wrappedKey: 'k' });
    mockRepo.addCddDocument.mockResolvedValue(undefined);
    mockAudit.log.mockResolvedValue(undefined);

    await expect(
      complianceService.uploadCddDocument({ ...baseInput, isAdmin: true }),
    ).resolves.not.toThrow();
  });

  it('throws NotFoundError when CDD record does not exist', async () => {
    mockRepo.findCddRecordById.mockResolvedValue(null);
    await expect(complianceService.uploadCddDocument(baseInput)).rejects.toThrow('CddRecord');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest src/domains/compliance/__tests__/compliance.service.test.ts --no-coverage -t "uploadCddDocument"
```
Expected: FAIL — `complianceService.uploadCddDocument is not a function`

- [ ] **Step 3: Implement uploadCddDocument** — add to `src/domains/compliance/compliance.service.ts`

Add these imports at the top of the file (alongside existing imports):
```typescript
import path from 'path';
import { createId } from '@paralleldrive/cuid2';
import { encryptedStorage } from '@/infra/storage/encrypted-storage';
import { scanBuffer } from '@/infra/security/virus-scanner';
import type {
  CddDocument,
  CddDocumentType,
  UploadCddDocumentInput,
  DownloadCddDocumentInput,
  DeleteCddDocumentInput,
} from './compliance.types';
```

Then append the service functions (before the end of the file):

```typescript
// ─── CDD Document Upload ──────────────────────────────────────────────────────

const MAX_CDD_DOCUMENTS = 5;

function assertCddOwnership(
  verifiedByAgentId: string,
  agentId: string,
  isAdmin: boolean,
): void {
  if (!isAdmin && verifiedByAgentId !== agentId) {
    throw new ForbiddenError('You are not authorised to access this CDD record');
  }
}

export async function uploadCddDocument(input: UploadCddDocumentInput): Promise<CddDocument> {
  const record = await complianceRepo.findCddRecordById(input.cddRecordId);
  if (!record) throw new NotFoundError('CddRecord', input.cddRecordId);

  assertCddOwnership(record.verifiedByAgentId, input.agentId, input.isAdmin);

  const existing = (record.documents as CddDocument[]) ?? [];
  if (existing.length >= MAX_CDD_DOCUMENTS) {
    throw new ValidationError(`Maximum ${MAX_CDD_DOCUMENTS} documents per CDD record`);
  }

  // Virus scan — fail-closed in production
  const scan = await scanBuffer(input.fileBuffer, input.originalFilename);
  if (!scan.isClean) {
    await auditService.log({
      agentId: input.agentId,
      action: 'cdd.document_scan_rejected',
      entityType: 'cdd_record',
      entityId: input.cddRecordId,
      details: { filename: input.originalFilename, viruses: scan.viruses },
    });
    throw new ValidationError('File rejected: security scan failed');
  }

  // Encrypt + save — UUID filename prevents enumeration
  const docId = createId();
  const ext = path.extname(input.originalFilename).toLowerCase() || '.bin';
  const filePath = `cdd/${input.cddRecordId}/${input.docType}-${docId}${ext}.enc`;

  const { path: savedPath, wrappedKey } = await encryptedStorage.save(filePath, input.fileBuffer);

  const doc: CddDocument = {
    id: docId,
    docType: input.docType as CddDocumentType,
    label: input.label ?? null,
    path: savedPath,
    wrappedKey,
    mimeType: input.mimeType,
    sizeBytes: input.fileBuffer.length,
    uploadedAt: new Date().toISOString(),
    uploadedByAgentId: input.agentId,
  };

  await complianceRepo.addCddDocument(input.cddRecordId, doc);

  await auditService.log({
    agentId: input.agentId,
    action: 'cdd.document_uploaded',
    entityType: 'cdd_record',
    entityId: input.cddRecordId,
    details: { docType: input.docType, sizeBytes: input.fileBuffer.length },
  });

  return doc;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest src/domains/compliance/__tests__/compliance.service.test.ts --no-coverage -t "uploadCddDocument"
```
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/domains/compliance/compliance.service.ts src/domains/compliance/__tests__/compliance.service.test.ts
git commit -m "feat: implement uploadCddDocument service — scan, encrypt, audit"
```

---

### Task 8: downloadCddDocument service function

**Files:**
- Modify: `src/domains/compliance/compliance.service.ts`
- Modify: `src/domains/compliance/__tests__/compliance.service.test.ts`

- [ ] **Step 1: Write failing tests** — add to compliance service test file

```typescript
describe('downloadCddDocument', () => {
  const mockDoc: CddDocument = {
    id: 'doc-1',
    docType: 'nric',
    label: null,
    path: 'cdd/cdd-1/nric-doc1.enc',
    wrappedKey: 'wrapped-key',
    mimeType: 'image/jpeg',
    sizeBytes: 5000,
    uploadedAt: '2026-03-18T00:00:00.000Z',
    uploadedByAgentId: 'agent-1',
  };

  it('decrypts and returns buffer with document metadata', async () => {
    mockRepo.findCddRecordWithDocument.mockResolvedValue({
      verifiedByAgentId: 'agent-1',
      document: mockDoc,
    });
    const decryptedBuffer = Buffer.from('decrypted-nric-image');
    mockEncryptedStorage.read.mockResolvedValue(decryptedBuffer);
    mockAudit.log.mockResolvedValue(undefined);

    const result = await complianceService.downloadCddDocument({
      cddRecordId: 'cdd-1',
      documentId: 'doc-1',
      agentId: 'agent-1',
      isAdmin: false,
    });

    expect(mockEncryptedStorage.read).toHaveBeenCalledWith(mockDoc.path, mockDoc.wrappedKey);
    expect(result.buffer).toEqual(decryptedBuffer);
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.docType).toBe('nric');
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cdd.document_downloaded' }),
    );
  });

  it('throws ForbiddenError when agent does not own the record', async () => {
    mockRepo.findCddRecordWithDocument.mockResolvedValue({
      verifiedByAgentId: 'other-agent',
      document: mockDoc,
    });

    await expect(
      complianceService.downloadCddDocument({
        cddRecordId: 'cdd-1',
        documentId: 'doc-1',
        agentId: 'agent-1',
        isAdmin: false,
      }),
    ).rejects.toThrow('not authorised');
  });

  it('throws NotFoundError when document entry does not exist', async () => {
    mockRepo.findCddRecordWithDocument.mockResolvedValue({
      verifiedByAgentId: 'agent-1',
      document: null,
    });

    await expect(
      complianceService.downloadCddDocument({
        cddRecordId: 'cdd-1',
        documentId: 'missing',
        agentId: 'agent-1',
        isAdmin: false,
      }),
    ).rejects.toThrow('CddDocument');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest src/domains/compliance/__tests__/compliance.service.test.ts --no-coverage -t "downloadCddDocument"
```
Expected: FAIL

- [ ] **Step 3: Implement downloadCddDocument** — append to `compliance.service.ts`

```typescript
export async function downloadCddDocument(
  input: DownloadCddDocumentInput,
): Promise<{ buffer: Buffer; mimeType: string; docType: CddDocumentType; filePath: string }> {
  const result = await complianceRepo.findCddRecordWithDocument(
    input.cddRecordId,
    input.documentId,
  );
  if (!result) throw new NotFoundError('CddRecord', input.cddRecordId);

  assertCddOwnership(result.verifiedByAgentId, input.agentId, input.isAdmin);

  const doc = result.document;
  if (!doc) throw new NotFoundError('CddDocument', input.documentId);

  const buffer = await encryptedStorage.read(doc.path, doc.wrappedKey);

  await auditService.log({
    agentId: input.agentId,
    action: 'cdd.document_downloaded',
    entityType: 'cdd_record',
    entityId: input.cddRecordId,
    details: { documentId: input.documentId, docType: doc.docType },
  });

  return { buffer, mimeType: doc.mimeType, docType: doc.docType as CddDocumentType, filePath: doc.path };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest src/domains/compliance/__tests__/compliance.service.test.ts --no-coverage -t "downloadCddDocument"
```
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/domains/compliance/compliance.service.ts src/domains/compliance/__tests__/compliance.service.test.ts
git commit -m "feat: implement downloadCddDocument service — decrypt and audit"
```

---

### Task 9: deleteCddDocument service function

**Files:**
- Modify: `src/domains/compliance/compliance.service.ts`
- Modify: `src/domains/compliance/__tests__/compliance.service.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe('deleteCddDocument', () => {
  it('deletes encrypted file, removes from JSON, and audits', async () => {
    mockRepo.findCddRecordWithDocument.mockResolvedValue({
      verifiedByAgentId: 'agent-1',
      document: {
        id: 'doc-1',
        docType: 'nric',
        path: 'cdd/cdd-1/nric-doc1.enc',
        wrappedKey: 'wrapped',
        label: null,
        mimeType: 'image/jpeg',
        sizeBytes: 5000,
        uploadedAt: '2026-03-18T00:00:00.000Z',
        uploadedByAgentId: 'agent-1',
      },
    });
    mockEncryptedStorage.delete.mockResolvedValue(undefined);
    mockRepo.removeCddDocument.mockResolvedValue('cdd/cdd-1/nric-doc1.enc');
    mockAudit.log.mockResolvedValue(undefined);

    await complianceService.deleteCddDocument({
      cddRecordId: 'cdd-1',
      documentId: 'doc-1',
      agentId: 'agent-1',
      isAdmin: false,
    });

    expect(mockEncryptedStorage.delete).toHaveBeenCalledWith('cdd/cdd-1/nric-doc1.enc');
    expect(mockRepo.removeCddDocument).toHaveBeenCalledWith('cdd-1', 'doc-1');
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cdd.document_deleted' }),
    );
  });

  it('throws ForbiddenError when agent does not own record', async () => {
    mockRepo.findCddRecordWithDocument.mockResolvedValue({
      verifiedByAgentId: 'other-agent',
      document: { id: 'doc-1', path: 'cdd/cdd-1/nric.enc', wrappedKey: 'k' },
    });

    await expect(
      complianceService.deleteCddDocument({
        cddRecordId: 'cdd-1',
        documentId: 'doc-1',
        agentId: 'agent-1',
        isAdmin: false,
      }),
    ).rejects.toThrow('not authorised');

    expect(mockEncryptedStorage.delete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest src/domains/compliance/__tests__/compliance.service.test.ts --no-coverage -t "deleteCddDocument"
```
Expected: FAIL

- [ ] **Step 3: Implement deleteCddDocument** — append to `compliance.service.ts`

```typescript
export async function deleteCddDocument(input: DeleteCddDocumentInput): Promise<void> {
  const result = await complianceRepo.findCddRecordWithDocument(
    input.cddRecordId,
    input.documentId,
  );
  if (!result) throw new NotFoundError('CddRecord', input.cddRecordId);

  assertCddOwnership(result.verifiedByAgentId, input.agentId, input.isAdmin);

  const doc = result.document;
  if (!doc) throw new NotFoundError('CddDocument', input.documentId);

  // Path traversal guard before deletion
  const uploadsRoot = path.resolve(process.env['UPLOADS_DIR'] ?? 'uploads');
  const resolved = path.resolve(uploadsRoot, doc.path);
  if (!resolved.startsWith(uploadsRoot + path.sep)) {
    throw new ForbiddenError('File path is outside the allowed uploads directory');
  }

  // Hard delete: remove file first, then clear from DB
  await encryptedStorage.delete(doc.path);
  await complianceRepo.removeCddDocument(input.cddRecordId, input.documentId);

  await auditService.log({
    agentId: input.agentId,
    action: 'cdd.document_deleted',
    entityType: 'cdd_record',
    entityId: input.cddRecordId,
    details: { documentId: input.documentId, docType: doc.docType },
  });
}
```

- [ ] **Step 4: Run all compliance service tests to verify no regressions**

```bash
npx jest src/domains/compliance/__tests__/compliance.service.test.ts --no-coverage
```
Expected: PASS — all tests

- [ ] **Step 5: Commit**

```bash
git add src/domains/compliance/compliance.service.ts src/domains/compliance/__tests__/compliance.service.test.ts
git commit -m "feat: implement deleteCddDocument service — hard delete enc file and audit"
```

---

## Chunk 4: Router

### Task 10–12: Three CDD document routes

**Files:**
- Modify: `src/domains/compliance/compliance.router.ts`
- Modify: `src/domains/compliance/__tests__/compliance.router.test.ts`

- [ ] **Step 1: Write failing router tests** — add to `compliance.router.test.ts`

First ensure these service mocks are declared (the existing mockService already covers the compliance service):
```typescript
// The existing mockService already covers complianceService.
// Add these method references to the existing mock:
// mockService.uploadCddDocument, mockService.downloadCddDocument, mockService.deleteCddDocument
```

Add the test suites:

```typescript
describe('POST /agent/cdd-records/:cddRecordId/documents', () => {
  it('returns 200 with document on successful upload', async () => {
    mockService.uploadCddDocument.mockResolvedValue({
      id: 'doc-1',
      docType: 'nric',
      label: null,
      path: 'cdd/cdd-1/nric-doc1.enc',
      wrappedKey: 'wrapped',
      mimeType: 'image/jpeg',
      sizeBytes: 5000,
      uploadedAt: '2026-03-18T00:00:00.000Z',
      uploadedByAgentId: 'agent-1',
    });

    const res = await request(createTestApp({ id: 'agent-1', role: 'agent' }))
      .post('/agent/cdd-records/cdd-1/documents')
      .attach('file', Buffer.from('fake-image'), { filename: 'nric.jpg', contentType: 'image/jpeg' })
      .field('docType', 'nric');

    expect(res.status).toBe(200);
    expect(res.body.docType).toBe('nric');
  });

  it('returns 400 when docType is invalid', async () => {
    const res = await request(createTestApp({ id: 'agent-1', role: 'agent' }))
      .post('/agent/cdd-records/cdd-1/documents')
      .attach('file', Buffer.from('fake'), { filename: 'nric.jpg', contentType: 'image/jpeg' })
      .field('docType', 'invalid-type');

    expect(res.status).toBe(400);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(createTestApp())
      .post('/agent/cdd-records/cdd-1/documents')
      .attach('file', Buffer.from('fake'), { filename: 'nric.jpg', contentType: 'image/jpeg' })
      .field('docType', 'nric');

    expect(res.status).toBe(401);
  });

  it('returns 403 when role is seller', async () => {
    const res = await request(createTestApp({ id: 'seller-1', role: 'seller' }))
      .post('/agent/cdd-records/cdd-1/documents')
      .attach('file', Buffer.from('fake'), { filename: 'nric.jpg', contentType: 'image/jpeg' })
      .field('docType', 'nric');

    expect(res.status).toBe(403);
  });
});

describe('DELETE /agent/cdd-records/:cddRecordId/documents/:documentId', () => {
  it('returns 204 on successful delete', async () => {
    mockService.deleteCddDocument.mockResolvedValue(undefined);

    const res = await request(createTestApp({ id: 'agent-1', role: 'agent' }))
      .delete('/agent/cdd-records/cdd-1/documents/doc-1');

    expect(res.status).toBe(204);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(createTestApp())
      .delete('/agent/cdd-records/cdd-1/documents/doc-1');
    expect(res.status).toBe(401);
  });
});

describe('POST /agent/cdd-records/:cddRecordId/documents/:documentId/download', () => {
  it('returns file buffer with correct Content-Type and no-store cache', async () => {
    const fakeBuffer = Buffer.from('decrypted-nric');
    mockService.downloadCddDocument.mockResolvedValue({
      buffer: fakeBuffer,
      mimeType: 'image/jpeg',
      docType: 'nric',
    });

    const res = await request(createTestApp({ id: 'agent-1', role: 'agent' }))
      .post('/agent/cdd-records/cdd-1/documents/doc-1/download');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-disposition']).toContain('attachment');
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(createTestApp())
      .post('/agent/cdd-records/cdd-1/documents/doc-1/download');
    expect(res.status).toBe(401);
  });
});
```

Note: `createTestApp()` with no argument should return an app with no authenticated user (existing pattern — check how the existing router tests handle the unauthenticated case and follow the same pattern).

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest src/domains/compliance/__tests__/compliance.router.test.ts --no-coverage -t "cdd-records"
```
Expected: FAIL — routes don't exist yet

- [ ] **Step 3: Add multer import and three routes** — add to `src/domains/compliance/compliance.router.ts`

Add these imports at the top alongside existing imports:
```typescript
import multer from 'multer';
import * as complianceService from './compliance.service';
import { uploadCddDocumentValidator } from './compliance.validator';
import type { CddDocumentType } from './compliance.types';
```

Add the multer instance near the top (after the existing `const UPLOADS_ROOT` line):
```typescript
const cddUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and PDF files are allowed for CDD documents'));
    }
  },
});
```

Then append the three routes before the end of the file:

```typescript
// ─── CDD Document Upload / Download / Delete ──────────────────────────────────

// POST /agent/cdd-records/:cddRecordId/documents — upload a CDD document
complianceRouter.post(
  '/agent/cdd-records/:cddRecordId/documents',
  ...agentAuth,
  cddUpload.single('file'),
  uploadCddDocumentValidator,
  async (req: Request, res: Response, next: NextFunction) => {
    if (extractValidationErrors(req, next)) return;
    try {
      if (!req.file) return next(new ValidationError('No file uploaded'));

      const agentId = getAgentId(req);
      const isAdmin = (req.user as { role: string }).role === 'admin';
      const cddRecordId = req.params['cddRecordId'] as string;
      const { docType, label } = req.body as { docType: string; label?: string };

      const doc = await complianceService.uploadCddDocument({
        cddRecordId,
        agentId,
        isAdmin,
        fileBuffer: req.file.buffer,
        originalFilename: req.file.originalname,
        mimeType: req.file.mimetype,
        docType: docType as CddDocumentType,
        label,
      });

      return res.status(200).json({
        id: doc.id,
        docType: doc.docType,
        label: doc.label,
        mimeType: doc.mimeType,
        sizeBytes: doc.sizeBytes,
        uploadedAt: doc.uploadedAt,
      });
    } catch (err) {
      return next(err);
    }
  },
);

// DELETE /agent/cdd-records/:cddRecordId/documents/:documentId — hard delete a document
complianceRouter.delete(
  '/agent/cdd-records/:cddRecordId/documents/:documentId',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const agentId = getAgentId(req);
      const isAdmin = (req.user as { role: string }).role === 'admin';
      const { cddRecordId, documentId } = req.params as {
        cddRecordId: string;
        documentId: string;
      };

      // deleteCddDocument resolves file path from DB — assertInUploadsRoot is called inside the service
      // via encryptedStorage.delete → localStorage.delete which is path-safe, but we guard here too
      await complianceService.deleteCddDocument({ cddRecordId, documentId, agentId, isAdmin });
      return res.status(204).send();
    } catch (err) {
      return next(err);
    }
  },
);

// POST /agent/cdd-records/:cddRecordId/documents/:documentId/download — decrypt and stream
complianceRouter.post(
  '/agent/cdd-records/:cddRecordId/documents/:documentId/download',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const agentId = getAgentId(req);
      const isAdmin = (req.user as { role: string }).role === 'admin';
      const { cddRecordId, documentId } = req.params as {
        cddRecordId: string;
        documentId: string;
      };

      const { buffer, mimeType, docType, filePath } = await complianceService.downloadCddDocument({
        cddRecordId,
        documentId,
        agentId,
        isAdmin,
      });

      // Path traversal guard — doc.path came from DB but verify it stays in uploads root
      assertInUploadsRoot(path.resolve(UPLOADS_ROOT, filePath));

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="cdd-${docType}-${documentId}"`);
      res.setHeader('Cache-Control', 'no-store');
      return res.send(buffer);
    } catch (err) {
      return next(err);
    }
  },
);
```

- [ ] **Step 4: Run router tests to verify they pass**

```bash
npx jest src/domains/compliance/__tests__/compliance.router.test.ts --no-coverage
```
Expected: PASS — all tests including new ones

- [ ] **Step 5: Run full compliance suite to verify no regressions**

```bash
npx jest src/domains/compliance --no-coverage
```
Expected: PASS — all tests

- [ ] **Step 6: Commit**

```bash
git add src/domains/compliance/compliance.router.ts src/domains/compliance/__tests__/compliance.router.test.ts
git commit -m "feat: add CDD document upload/download/delete routes with agentAuth + 2FA"
```

---

## Chunk 5: Wire-up + Retention Integration

### Task 13: Extend collectSellerFilePaths for CDD documents

**Files:**
- Modify: `src/domains/compliance/compliance.repository.ts`
- Modify: `src/domains/compliance/__tests__/compliance.repository.test.ts`

- [ ] **Step 1: Write failing test** — add to repository test file

```typescript
describe('collectSellerFilePaths — CDD documents', () => {
  it('includes .enc file paths from seller CDD records', async () => {
    const cddDocs = [
      { path: 'cdd/cdd-1/nric-doc1.jpg.enc', wrappedKey: 'k1' },
      { path: 'cdd/cdd-1/passport-doc2.pdf.enc', wrappedKey: 'k2' },
    ];

    // Mock the property query (returns no photos)
    mockPrisma.property.findMany.mockResolvedValue([]);
    // Mock OTP query (returns no paths)
    mockPrisma.otp.findMany.mockResolvedValue([]);
    // Mock invoice query (returns no paths)
    mockPrisma.commissionInvoice.findMany.mockResolvedValue([]);
    // Mock CDD query
    mockPrisma.cddRecord.findMany.mockResolvedValue([
      { id: 'cdd-1', documents: cddDocs },
    ] as unknown as CddRecord[]);

    const paths = await complianceRepo.collectSellerFilePaths('seller-1');

    expect(paths).toContain('cdd/cdd-1/nric-doc1.jpg.enc');
    expect(paths).toContain('cdd/cdd-1/passport-doc2.pdf.enc');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest src/domains/compliance/__tests__/compliance.repository.test.ts --no-coverage -t "collectSellerFilePaths"
```
Expected: FAIL — CDD paths not returned

- [ ] **Step 3: Extend collectSellerFilePaths** — in `compliance.repository.ts`, add CDD document path collection to the existing `collectSellerFilePaths` function, after the commission invoice section:

```typescript
  // 4. CDD document .enc files (seller CDD records only)
  const cddRecords = await prisma.cddRecord.findMany({
    where: { subjectType: SubjectType.seller, subjectId: sellerId },
    select: { documents: true },
  });
  for (const cdd of cddRecords) {
    const docs = (cdd.documents as { path?: string }[] | null) ?? [];
    for (const doc of docs) {
      if (doc.path) paths.push(doc.path);
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest src/domains/compliance/__tests__/compliance.repository.test.ts --no-coverage -t "collectSellerFilePaths"
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domains/compliance/compliance.repository.ts src/domains/compliance/__tests__/compliance.repository.test.ts
git commit -m "feat: include CDD .enc file paths in collectSellerFilePaths for PDPA hard delete"
```

---

### Task 14: Include CDD file paths in retention scan flagging

**Files:**
- Modify: `src/domains/compliance/compliance.service.ts`
- Modify: `src/domains/compliance/__tests__/compliance.service.test.ts`

The existing `executeHardDelete` for `cdd_documents` already reads `details.filePaths` to delete files. We need the `scanRetention` flagging call to populate `details.filePaths` from the `documents` JSON.

- [ ] **Step 1: Write failing test** — add to compliance service test file

```typescript
describe('scanRetention — CDD documents with filePaths in details', () => {
  it('includes filePaths from documents JSON in flagged deletion request details', async () => {
    // Minimal mock setup — just enough to reach CDD section
    mockRepo.findLeadsForRetention.mockResolvedValue([]);
    mockRepo.findServiceWithdrawnForDeletion.mockResolvedValue([]);
    mockRepo.findTransactionsForRetention.mockResolvedValue([]);
    mockRepo.findConsentRecordsForDeletion.mockResolvedValue([]);
    mockRepo.findStaleCorrectionRequests.mockResolvedValue([]);
    mockRepo.findVerifiedViewersForRetention.mockResolvedValue([]);
    mockRepo.findBuyersForRetention.mockResolvedValue([]);
    mockSettings.getNumber.mockResolvedValue(12); // lead_retention_months etc.

    const cddDocs = [
      { path: 'cdd/cdd-1/nric-doc1.jpg.enc', id: 'doc-1', docType: 'nric' },
    ];
    mockRepo.findCddRecordsForRetention.mockResolvedValue([
      { id: 'cdd-1', subjectId: 'seller-1', documents: cddDocs, verifiedAt: new Date('2020-01-01') },
    ]);
    mockRepo.findExistingDeletionRequest.mockResolvedValue(null);
    mockRepo.createDeletionRequest.mockResolvedValue({ id: 'dr-1' } as DataDeletionRequest);

    await complianceService.scanRetention();

    expect(mockRepo.createDeletionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: 'cdd_documents',
        targetId: 'cdd-1',
        details: expect.objectContaining({
          filePaths: ['cdd/cdd-1/nric-doc1.jpg.enc'],
        }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest src/domains/compliance/__tests__/compliance.service.test.ts --no-coverage -t "scanRetention.*CDD"
```
Expected: FAIL — `details` does not contain `filePaths`

- [ ] **Step 3: Update the CDD retention flagging call in `scanRetention`**

Find the existing `flagIfNew` call for `cdd_documents` in `compliance.service.ts` (~line 432–445) and update the `details` argument to include file paths:

```typescript
  // Replace the existing flagIfNew call for CDD:
  for (const cdd of oldCddRecords) {
    const docs = (cdd.documents as { path?: string }[] | null) ?? [];
    const filePaths = docs.map((d) => d.path).filter((p): p is string => !!p);

    await flagIfNew(
      'cdd_documents',
      cdd.id,
      'CDD documents > 5 years old',
      'cdd_5_year',
      'flagged',
      {
        subjectId: cdd.subjectId,
        verifiedAt: cdd.verifiedAt,
        filePaths,
      },
    );
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest src/domains/compliance/__tests__/compliance.service.test.ts --no-coverage
```
Expected: PASS — all tests

- [ ] **Step 5: Commit**

```bash
git add src/domains/compliance/compliance.service.ts src/domains/compliance/__tests__/compliance.service.test.ts
git commit -m "feat: include CDD enc file paths in retention scan flagging details for hard delete"
```

---

### Task 15: Log active KeyProvider at server startup

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Add KeyProvider initialization log** — in `src/server.ts`, after the `initVirusScanner()` call, add:

```typescript
import { getKeyProvider } from './infra/security/key-provider';

// Log active key provider at startup (env or aws)
try {
  getKeyProvider(); // initializes singleton + validates config
  logger.info({ keyProvider: process.env['KEY_PROVIDER'] ?? 'env' }, 'KeyProvider initialized');
} catch (err) {
  logger.error({ err }, 'KeyProvider initialization failed — CDD document encryption unavailable');
  process.exit(1);
}
```

- [ ] **Step 2: Run full test suite**

```bash
npm test
```
Expected: PASS — all existing tests plus new tests pass

- [ ] **Step 3: Commit**

```bash
git add src/server.ts
git commit -m "feat: initialize and log KeyProvider at server startup; exit on failure"
```

---

### Task 16: Final verification

- [ ] **Step 1: Run full test suite**

```bash
npm test
```
Expected: All suites pass, no regressions

- [ ] **Step 2: Run integration tests**

```bash
npm run test:integration
```
Expected: PASS

- [ ] **Step 3: Check TypeScript compiles cleanly**

```bash
npm run build
```
Expected: No TypeScript errors

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: CDD document upload complete — encrypted storage, KeyProvider, routes, retention integration"
```
