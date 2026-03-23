# Seller Document Upload & Tracking — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow sellers to upload encrypted documents through their dashboard, notify agents in-app, and support download-and-delete with a 7-day auto-purge backstop.

**Architecture:** New `SellerDocument` Prisma model with encrypted storage (AES-256-GCM). Seller uploads via `/seller/documents`, agent downloads via `/agent/sellers/:sellerId/documents/:id/download`. Download triggers hard-delete. Checklist status derived from DB rows (not_uploaded → uploaded → received_by_agent).

**Tech Stack:** Prisma, Express, multer (memory storage), encryptedStorage (AES-256-GCM), ClamAV virus scanning, HTMX partials, Nunjucks templates.

**Design doc:** `docs/plans/2026-03-23-seller-document-upload-design.md`

---

### Task 1: Database Migration — SellerDocument Table

**Files:**
- Create: `prisma/migrations/YYYYMMDDHHMMSS_add_seller_document/migration.sql`
- Modify: `prisma/schema.prisma`

**Step 1: Add SellerDocument model to Prisma schema**

Add after the `DocumentChecklist` model (after line 1145) in `prisma/schema.prisma`:

```prisma
model SellerDocument {
  id           String    @id @default(cuid())
  sellerId     String    @map("seller_id")
  seller       Seller    @relation(fields: [sellerId], references: [id])
  docType      String    @map("doc_type")
  slotIndex    Int?      @map("slot_index")
  path         String
  wrappedKey   String    @map("wrapped_key")
  mimeType     String    @map("mime_type")
  sizeBytes    Int       @map("size_bytes")
  uploadedAt   DateTime  @default(now()) @map("uploaded_at")
  uploadedBy   String    @map("uploaded_by")
  downloadedAt DateTime? @map("downloaded_at")
  downloadedBy String?   @map("downloaded_by")
  deletedAt    DateTime? @map("deleted_at")

  @@index([sellerId, docType])
  @@index([sellerId, deletedAt])
  @@map("seller_documents")
}
```

Add the back-relation to the `Seller` model (after `saleProceeds` line 435):

```prisma
  sellerDocuments       SellerDocument[]
```

**Step 2: Generate migration using shadow DB approach**

Follow the migration pattern from MEMORY.md (shadow DB approach since `prisma migrate dev` is blocked by session table drift):

```bash
PGPASSWORD=smhn_dev psql -U smhn -h localhost -p 5432 -d sellmyhomenow_dev -c "CREATE DATABASE smhn_shadow_tmp;"
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "postgresql://smhn:smhn_dev@localhost:5432/smhn_shadow_tmp" --script
```

Save the generated SQL to `prisma/migrations/YYYYMMDDHHMMSS_add_seller_document/migration.sql`.

```bash
npx prisma migrate deploy
npx prisma generate
PGPASSWORD=smhn_dev psql -U smhn -h localhost -p 5432 -d sellmyhomenow_dev -c "DROP DATABASE smhn_shadow_tmp;"
```

**Step 3: Run existing tests to verify no breakage**

```bash
npm test
```

Expected: All existing tests pass. The new model adds no breaking changes.

**Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add SellerDocument table for encrypted document uploads"
```

---

### Task 2: Types & Constants

**Files:**
- Modify: `src/domains/seller/seller.types.ts`

**Step 1: Add seller document types and constants**

Add at the end of `src/domains/seller/seller.types.ts`:

```typescript
// ─── Seller Document Upload ─────────────────────────────────────────────────

export const SELLER_DOC_TYPES = [
  'nric',
  'marriage_cert',
  'eligibility_letter',
  'otp_scan',
  'eaa',
  'other',
] as const;

export type SellerDocType = (typeof SELLER_DOC_TYPES)[number];

export const SELLER_DOC_MAX_FILES: Record<SellerDocType, number> = {
  nric: 2,
  marriage_cert: 3,
  eligibility_letter: 1,
  otp_scan: 1,
  eaa: 1,
  other: 5,
};

export const SELLER_DOC_MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const SELLER_DOC_ALLOWED_MIMES = ['image/jpeg', 'image/png', 'application/pdf'];

export interface UploadSellerDocumentInput {
  sellerId: string;
  docType: SellerDocType;
  fileBuffer: Buffer;
  mimeType: string;
  originalFilename: string;
  uploadedBy: string;
  uploadedByRole: 'seller' | 'agent';
}

export interface SellerDocumentRecord {
  id: string;
  sellerId: string;
  docType: string;
  slotIndex: number | null;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: Date;
  uploadedBy: string;
  downloadedAt: Date | null;
  downloadedBy: string | null;
  deletedAt: Date | null;
}
```

**Step 2: Update DocumentChecklistItem status type**

Change the `status` type in `DocumentChecklistItem` (line 94) from:

```typescript
status: 'not_uploaded' | 'uploaded' | 'verified';
```

to:

```typescript
status: 'not_uploaded' | 'uploaded' | 'received_by_agent';
```

**Step 3: Commit**

```bash
git add src/domains/seller/seller.types.ts
git commit -m "feat(seller): add seller document upload types and constants"
```

---

### Task 3: Repository Layer

**Files:**
- Create: `src/domains/seller/seller-document.repository.ts`
- Test: `src/domains/seller/__tests__/seller-document.repository.test.ts`

**Step 1: Write failing tests for repository functions**

Create `src/domains/seller/__tests__/seller-document.repository.test.ts`:

```typescript
import * as sellerDocRepo from '../seller-document.repository';

jest.mock('@/infra/database/prisma', () => ({
  prisma: {
    sellerDocument: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
  },
}));

import { prisma } from '@/infra/database/prisma';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => jest.clearAllMocks());

describe('seller-document.repository', () => {
  describe('create', () => {
    it('creates a seller document record', async () => {
      const input = {
        sellerId: 'seller-1',
        docType: 'nric',
        slotIndex: 0,
        path: 'seller-docs/seller-1/nric-abc.enc',
        wrappedKey: 'base64key',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        uploadedBy: 'seller-1',
      };
      const expected = { id: 'doc-1', ...input, uploadedAt: new Date(), downloadedAt: null, downloadedBy: null, deletedAt: null };
      (mockPrisma.sellerDocument.create as jest.Mock).mockResolvedValue(expected);

      const result = await sellerDocRepo.create(input);

      expect(mockPrisma.sellerDocument.create).toHaveBeenCalledWith({ data: input });
      expect(result).toEqual(expected);
    });
  });

  describe('findActiveBySellerAndDocType', () => {
    it('returns non-deleted documents for seller and docType', async () => {
      const docs = [{ id: 'doc-1', docType: 'nric', deletedAt: null }];
      (mockPrisma.sellerDocument.findMany as jest.Mock).mockResolvedValue(docs);

      const result = await sellerDocRepo.findActiveBySellerAndDocType('seller-1', 'nric');

      expect(mockPrisma.sellerDocument.findMany).toHaveBeenCalledWith({
        where: { sellerId: 'seller-1', docType: 'nric', deletedAt: null },
        orderBy: { slotIndex: 'asc' },
      });
      expect(result).toEqual(docs);
    });
  });

  describe('findActiveBySeller', () => {
    it('returns all non-deleted documents for seller', async () => {
      const docs = [{ id: 'doc-1' }, { id: 'doc-2' }];
      (mockPrisma.sellerDocument.findMany as jest.Mock).mockResolvedValue(docs);

      const result = await sellerDocRepo.findActiveBySeller('seller-1');

      expect(mockPrisma.sellerDocument.findMany).toHaveBeenCalledWith({
        where: { sellerId: 'seller-1', deletedAt: null },
        orderBy: [{ docType: 'asc' }, { slotIndex: 'asc' }],
      });
      expect(result).toEqual(docs);
    });
  });

  describe('findById', () => {
    it('returns a document by id', async () => {
      const doc = { id: 'doc-1', sellerId: 'seller-1' };
      (mockPrisma.sellerDocument.findFirst as jest.Mock).mockResolvedValue(doc);

      const result = await sellerDocRepo.findById('doc-1');

      expect(mockPrisma.sellerDocument.findFirst).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
      });
      expect(result).toEqual(doc);
    });
  });

  describe('countActiveBySellerAndDocType', () => {
    it('counts non-deleted documents', async () => {
      (mockPrisma.sellerDocument.count as jest.Mock).mockResolvedValue(2);

      const result = await sellerDocRepo.countActiveBySellerAndDocType('seller-1', 'nric');

      expect(mockPrisma.sellerDocument.count).toHaveBeenCalledWith({
        where: { sellerId: 'seller-1', docType: 'nric', deletedAt: null },
      });
      expect(result).toBe(2);
    });
  });

  describe('markDownloadedAndDeleted', () => {
    it('sets downloadedAt, downloadedBy, and deletedAt', async () => {
      const now = new Date();
      (mockPrisma.sellerDocument.update as jest.Mock).mockResolvedValue({ id: 'doc-1' });

      await sellerDocRepo.markDownloadedAndDeleted('doc-1', 'agent-1');

      expect(mockPrisma.sellerDocument.update).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: {
          downloadedAt: expect.any(Date),
          downloadedBy: 'agent-1',
          deletedAt: expect.any(Date),
        },
      });
    });
  });

  describe('hardDelete', () => {
    it('deletes the row entirely', async () => {
      (mockPrisma.sellerDocument.delete as jest.Mock).mockResolvedValue({ id: 'doc-1' });

      await sellerDocRepo.hardDelete('doc-1');

      expect(mockPrisma.sellerDocument.delete).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
      });
    });
  });

  describe('markPurged', () => {
    it('sets deletedAt on records older than cutoff', async () => {
      (mockPrisma.sellerDocument.findMany as jest.Mock).mockResolvedValue([
        { id: 'doc-1', path: 'p1', wrappedKey: 'k1' },
      ]);

      const cutoff = new Date();
      const result = await sellerDocRepo.findExpiredUnpurged(cutoff);

      expect(mockPrisma.sellerDocument.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null, uploadedAt: { lt: cutoff } },
        select: { id: true, path: true, wrappedKey: true, sellerId: true },
      });
      expect(result).toEqual([{ id: 'doc-1', path: 'p1', wrappedKey: 'k1' }]);
    });
  });

  describe('findAllBySeller', () => {
    it('returns all documents including deleted for status derivation', async () => {
      const docs = [
        { id: 'doc-1', docType: 'nric', deletedAt: null },
        { id: 'doc-2', docType: 'nric', deletedAt: new Date() },
      ];
      (mockPrisma.sellerDocument.findMany as jest.Mock).mockResolvedValue(docs);

      const result = await sellerDocRepo.findAllBySeller('seller-1');

      expect(mockPrisma.sellerDocument.findMany).toHaveBeenCalledWith({
        where: { sellerId: 'seller-1' },
        orderBy: [{ docType: 'asc' }, { slotIndex: 'asc' }],
      });
      expect(result).toEqual(docs);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx jest src/domains/seller/__tests__/seller-document.repository.test.ts --no-coverage
```

Expected: FAIL — module not found.

**Step 3: Implement repository**

Create `src/domains/seller/seller-document.repository.ts`:

```typescript
import { prisma } from '@/infra/database/prisma';
import type { SellerDocument } from '@prisma/client';

export async function create(data: {
  sellerId: string;
  docType: string;
  slotIndex?: number | null;
  path: string;
  wrappedKey: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
}): Promise<SellerDocument> {
  return prisma.sellerDocument.create({ data });
}

export async function findById(id: string): Promise<SellerDocument | null> {
  return prisma.sellerDocument.findFirst({ where: { id } });
}

export async function findActiveBySeller(sellerId: string): Promise<SellerDocument[]> {
  return prisma.sellerDocument.findMany({
    where: { sellerId, deletedAt: null },
    orderBy: [{ docType: 'asc' }, { slotIndex: 'asc' }],
  });
}

export async function findAllBySeller(sellerId: string): Promise<SellerDocument[]> {
  return prisma.sellerDocument.findMany({
    where: { sellerId },
    orderBy: [{ docType: 'asc' }, { slotIndex: 'asc' }],
  });
}

export async function findActiveBySellerAndDocType(
  sellerId: string,
  docType: string,
): Promise<SellerDocument[]> {
  return prisma.sellerDocument.findMany({
    where: { sellerId, docType, deletedAt: null },
    orderBy: { slotIndex: 'asc' },
  });
}

export async function countActiveBySellerAndDocType(
  sellerId: string,
  docType: string,
): Promise<number> {
  return prisma.sellerDocument.count({
    where: { sellerId, docType, deletedAt: null },
  });
}

export async function markDownloadedAndDeleted(
  id: string,
  downloadedBy: string,
): Promise<SellerDocument> {
  const now = new Date();
  return prisma.sellerDocument.update({
    where: { id },
    data: { downloadedAt: now, downloadedBy, deletedAt: now },
  });
}

export async function markPurged(id: string): Promise<void> {
  await prisma.sellerDocument.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

export async function hardDelete(id: string): Promise<void> {
  await prisma.sellerDocument.delete({ where: { id } });
}

export async function findExpiredUnpurged(
  cutoff: Date,
): Promise<{ id: string; path: string; wrappedKey: string; sellerId: string }[]> {
  return prisma.sellerDocument.findMany({
    where: { deletedAt: null, uploadedAt: { lt: cutoff } },
    select: { id: true, path: true, wrappedKey: true, sellerId: true },
  });
}
```

**Step 4: Run tests to verify they pass**

```bash
npx jest src/domains/seller/__tests__/seller-document.repository.test.ts --no-coverage
```

Expected: All tests PASS.

**Step 5: Commit**

```bash
git add src/domains/seller/seller-document.repository.ts src/domains/seller/__tests__/seller-document.repository.test.ts
git commit -m "feat(seller): add seller document repository with tests"
```

---

### Task 4: Service Layer — Upload

**Files:**
- Create: `src/domains/seller/seller-document.service.ts`
- Test: `src/domains/seller/__tests__/seller-document.service.test.ts`

**Step 1: Write failing tests for uploadSellerDocument**

Create `src/domains/seller/__tests__/seller-document.service.test.ts`:

```typescript
import * as sellerDocService from '../seller-document.service';

jest.mock('@/infra/database/prisma', () => ({
  prisma: { sellerDocument: {} },
}));

jest.mock('../seller-document.repository', () => ({
  create: jest.fn(),
  countActiveBySellerAndDocType: jest.fn(),
  findById: jest.fn(),
  findActiveBySeller: jest.fn(),
  findAllBySeller: jest.fn(),
  markDownloadedAndDeleted: jest.fn(),
  hardDelete: jest.fn(),
  findExpiredUnpurged: jest.fn(),
  markPurged: jest.fn(),
}));

jest.mock('../seller.repository', () => ({
  findById: jest.fn(),
}));

jest.mock('@/infra/storage/encrypted-storage', () => ({
  encryptedStorage: {
    save: jest.fn(),
    read: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('@/infra/security/virus-scanner', () => ({
  scanBuffer: jest.fn().mockResolvedValue({ isClean: true, viruses: [] }),
}));

jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn().mockResolvedValue({ mime: 'image/jpeg' }),
}));

jest.mock('../../shared/audit.service', () => ({
  log: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../notification/notification.service', () => ({
  createInAppNotification: jest.fn().mockResolvedValue(undefined),
}));

import * as sellerDocRepo from '../seller-document.repository';
import * as sellerRepo from '../seller.repository';
import { encryptedStorage } from '@/infra/storage/encrypted-storage';
import { scanBuffer } from '@/infra/security/virus-scanner';
import { fileTypeFromBuffer } from 'file-type';
import * as auditService from '../../shared/audit.service';
import * as notificationService from '../../notification/notification.service';
import type { UploadSellerDocumentInput } from '../seller.types';

const mockSellerDocRepo = sellerDocRepo as jest.Mocked<typeof sellerDocRepo>;
const mockSellerRepo = sellerRepo as jest.Mocked<typeof sellerRepo>;

beforeEach(() => jest.clearAllMocks());

describe('uploadSellerDocument', () => {
  const validInput: UploadSellerDocumentInput = {
    sellerId: 'seller-1',
    docType: 'nric',
    fileBuffer: Buffer.from('fake-file'),
    mimeType: 'image/jpeg',
    originalFilename: 'nric-front.jpg',
    uploadedBy: 'seller-1',
    uploadedByRole: 'seller',
  };

  beforeEach(() => {
    mockSellerRepo.findById.mockResolvedValue({ id: 'seller-1', agentId: 'agent-1' } as any);
    mockSellerDocRepo.countActiveBySellerAndDocType.mockResolvedValue(0);
    (encryptedStorage.save as jest.Mock).mockResolvedValue({
      path: 'seller-docs/seller-1/nric-abc.enc',
      wrappedKey: 'wrapped-key-base64',
    });
    mockSellerDocRepo.create.mockResolvedValue({
      id: 'doc-1',
      sellerId: 'seller-1',
      docType: 'nric',
      slotIndex: 0,
      path: 'seller-docs/seller-1/nric-abc.enc',
      wrappedKey: 'wrapped-key-base64',
      mimeType: 'image/jpeg',
      sizeBytes: 9,
      uploadedAt: new Date(),
      uploadedBy: 'seller-1',
      downloadedAt: null,
      downloadedBy: null,
      deletedAt: null,
    });
  });

  it('encrypts file, saves to DB, notifies agent, and audits', async () => {
    const result = await sellerDocService.uploadSellerDocument(validInput);

    expect(scanBuffer).toHaveBeenCalledWith(validInput.fileBuffer, validInput.originalFilename);
    expect(encryptedStorage.save).toHaveBeenCalledWith(
      expect.stringMatching(/^seller-docs\/seller-1\/nric-.+\.jpg\.enc$/),
      validInput.fileBuffer,
    );
    expect(mockSellerDocRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sellerId: 'seller-1',
        docType: 'nric',
        slotIndex: 0,
        mimeType: 'image/jpeg',
        uploadedBy: 'seller-1',
      }),
    );
    expect(notificationService.createInAppNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientType: 'agent',
        recipientId: 'agent-1',
        templateName: 'seller_document_uploaded',
      }),
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'seller_document.uploaded',
        entityType: 'seller',
        entityId: 'seller-1',
      }),
    );
    expect(result.id).toBe('doc-1');
  });

  it('rejects when file count exceeds max for docType', async () => {
    mockSellerDocRepo.countActiveBySellerAndDocType.mockResolvedValue(2);

    await expect(sellerDocService.uploadSellerDocument(validInput)).rejects.toThrow(
      'Maximum 2 files allowed for nric',
    );
  });

  it('rejects when virus scan fails', async () => {
    (scanBuffer as jest.Mock).mockResolvedValue({ isClean: false, viruses: ['EICAR'] });

    await expect(sellerDocService.uploadSellerDocument(validInput)).rejects.toThrow(
      'File rejected: security scan failed',
    );
  });

  it('rejects when MIME type is invalid', async () => {
    (fileTypeFromBuffer as jest.Mock).mockResolvedValue({ mime: 'text/html' });

    await expect(sellerDocService.uploadSellerDocument(validInput)).rejects.toThrow(
      'File content does not match a valid image or PDF',
    );
  });

  it('rejects invalid docType', async () => {
    const badInput = { ...validInput, docType: 'passport' as any };

    await expect(sellerDocService.uploadSellerDocument(badInput)).rejects.toThrow(
      'Invalid document type',
    );
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx jest src/domains/seller/__tests__/seller-document.service.test.ts --no-coverage
```

Expected: FAIL — module not found.

**Step 3: Implement the upload function**

Create `src/domains/seller/seller-document.service.ts`:

```typescript
import * as path from 'path';
import { createId } from '@paralleldrive/cuid2';
import { fileTypeFromBuffer } from 'file-type';
import * as sellerDocRepo from './seller-document.repository';
import * as sellerRepo from './seller.repository';
import { encryptedStorage } from '@/infra/storage/encrypted-storage';
import { scanBuffer } from '@/infra/security/virus-scanner';
import * as auditService from '../shared/audit.service';
import * as notificationService from '../notification/notification.service';
import { ValidationError, NotFoundError, ForbiddenError } from '../shared/errors';
import {
  SELLER_DOC_TYPES,
  SELLER_DOC_MAX_FILES,
  SELLER_DOC_ALLOWED_MIMES,
  type SellerDocType,
  type UploadSellerDocumentInput,
  type SellerDocumentRecord,
} from './seller.types';
import type { SellerDocument } from '@prisma/client';

export async function uploadSellerDocument(
  input: UploadSellerDocumentInput,
): Promise<SellerDocumentRecord> {
  // Validate docType
  if (!SELLER_DOC_TYPES.includes(input.docType)) {
    throw new ValidationError('Invalid document type');
  }

  // Check file count limit
  const maxFiles = SELLER_DOC_MAX_FILES[input.docType];
  const currentCount = await sellerDocRepo.countActiveBySellerAndDocType(
    input.sellerId,
    input.docType,
  );
  if (currentCount >= maxFiles) {
    throw new ValidationError(`Maximum ${maxFiles} files allowed for ${input.docType}`);
  }

  // Verify MIME from actual bytes
  const detected = await fileTypeFromBuffer(input.fileBuffer);
  if (!detected || !SELLER_DOC_ALLOWED_MIMES.includes(detected.mime)) {
    throw new ValidationError('File content does not match a valid image or PDF');
  }

  // Virus scan — fail-closed
  const scan = await scanBuffer(input.fileBuffer, input.originalFilename);
  if (!scan.isClean) {
    await auditService.log({
      actorType: input.uploadedByRole,
      actorId: input.uploadedBy,
      action: 'seller_document.scan_rejected',
      entityType: 'seller',
      entityId: input.sellerId,
      details: { filename: input.originalFilename, viruses: scan.viruses },
    });
    throw new ValidationError('File rejected: security scan failed');
  }

  // Encrypt + save
  const docId = createId();
  const ext = path.extname(input.originalFilename).toLowerCase() || '.bin';
  const filePath = `seller-docs/${input.sellerId}/${input.docType}-${docId}${ext}.enc`;
  const { path: savedPath, wrappedKey } = await encryptedStorage.save(filePath, input.fileBuffer);

  // Determine slot index
  const slotIndex = maxFiles > 1 ? currentCount : null;

  // Persist to DB
  const doc = await sellerDocRepo.create({
    sellerId: input.sellerId,
    docType: input.docType,
    slotIndex,
    path: savedPath,
    wrappedKey,
    mimeType: detected.mime,
    sizeBytes: input.fileBuffer.length,
    uploadedBy: input.uploadedBy,
  });

  // Notify agent (in-app only)
  const seller = await sellerRepo.findById(input.sellerId);
  if (seller?.agentId) {
    await notificationService.createInAppNotification({
      recipientType: 'agent',
      recipientId: seller.agentId,
      templateName: 'seller_document_uploaded',
      content: `${seller.name} uploaded a document (${input.docType})`,
    });
  }

  // Audit log
  await auditService.log({
    actorType: input.uploadedByRole,
    actorId: input.uploadedBy,
    action: 'seller_document.uploaded',
    entityType: 'seller',
    entityId: input.sellerId,
    details: {
      documentId: doc.id,
      docType: input.docType,
      sizeBytes: doc.sizeBytes,
      uploadedByRole: input.uploadedByRole,
    },
  });

  return doc;
}
```

**Step 4: Run tests to verify they pass**

```bash
npx jest src/domains/seller/__tests__/seller-document.service.test.ts --no-coverage
```

Expected: All tests PASS.

**Step 5: Commit**

```bash
git add src/domains/seller/seller-document.service.ts src/domains/seller/__tests__/seller-document.service.test.ts
git commit -m "feat(seller): add seller document upload service with tests"
```

---

### Task 5: Service Layer — Download, Delete, Purge, Checklist

**Files:**
- Modify: `src/domains/seller/seller-document.service.ts`
- Modify: `src/domains/seller/__tests__/seller-document.service.test.ts`
- Modify: `src/domains/seller/seller.service.ts` (update `getDocumentChecklist`)

**Step 1: Write failing tests for download, delete, and checklist**

Append to `src/domains/seller/__tests__/seller-document.service.test.ts`:

```typescript
describe('downloadAndDeleteSellerDocument', () => {
  const mockDoc = {
    id: 'doc-1',
    sellerId: 'seller-1',
    path: 'seller-docs/seller-1/nric-abc.enc',
    wrappedKey: 'wrapped-key',
    mimeType: 'image/jpeg',
    docType: 'nric',
    deletedAt: null,
    downloadedAt: null,
  };

  it('decrypts file, marks as downloaded+deleted, audits', async () => {
    mockSellerDocRepo.findById.mockResolvedValue(mockDoc as any);
    (encryptedStorage.read as jest.Mock).mockResolvedValue(Buffer.from('decrypted'));
    (encryptedStorage.delete as jest.Mock).mockResolvedValue(undefined);
    mockSellerDocRepo.markDownloadedAndDeleted.mockResolvedValue({} as any);

    const result = await sellerDocService.downloadAndDeleteSellerDocument('doc-1', 'agent-1');

    expect(encryptedStorage.read).toHaveBeenCalledWith(mockDoc.path, mockDoc.wrappedKey);
    expect(encryptedStorage.delete).toHaveBeenCalledWith(mockDoc.path);
    expect(mockSellerDocRepo.markDownloadedAndDeleted).toHaveBeenCalledWith('doc-1', 'agent-1');
    expect(result.buffer).toEqual(Buffer.from('decrypted'));
    expect(result.mimeType).toBe('image/jpeg');
  });

  it('rejects if document not found', async () => {
    mockSellerDocRepo.findById.mockResolvedValue(null);

    await expect(
      sellerDocService.downloadAndDeleteSellerDocument('bad-id', 'agent-1'),
    ).rejects.toThrow('SellerDocument');
  });

  it('rejects if already deleted', async () => {
    mockSellerDocRepo.findById.mockResolvedValue({ ...mockDoc, deletedAt: new Date() } as any);

    await expect(
      sellerDocService.downloadAndDeleteSellerDocument('doc-1', 'agent-1'),
    ).rejects.toThrow('already been deleted');
  });
});

describe('deleteSellerDocumentBySeller', () => {
  const mockDoc = {
    id: 'doc-1',
    sellerId: 'seller-1',
    path: 'seller-docs/seller-1/nric-abc.enc',
    wrappedKey: 'wrapped-key',
    downloadedAt: null,
    deletedAt: null,
  };

  it('deletes file and removes DB row if not yet downloaded', async () => {
    mockSellerDocRepo.findById.mockResolvedValue(mockDoc as any);
    (encryptedStorage.delete as jest.Mock).mockResolvedValue(undefined);
    mockSellerDocRepo.hardDelete.mockResolvedValue(undefined);

    await sellerDocService.deleteSellerDocumentBySeller('doc-1', 'seller-1');

    expect(encryptedStorage.delete).toHaveBeenCalledWith(mockDoc.path);
    expect(mockSellerDocRepo.hardDelete).toHaveBeenCalledWith('doc-1');
  });

  it('rejects if seller does not own document', async () => {
    mockSellerDocRepo.findById.mockResolvedValue({ ...mockDoc, sellerId: 'other' } as any);

    await expect(
      sellerDocService.deleteSellerDocumentBySeller('doc-1', 'seller-1'),
    ).rejects.toThrow();
  });

  it('rejects if already downloaded by agent', async () => {
    mockSellerDocRepo.findById.mockResolvedValue({
      ...mockDoc,
      downloadedAt: new Date(),
    } as any);

    await expect(
      sellerDocService.deleteSellerDocumentBySeller('doc-1', 'seller-1'),
    ).rejects.toThrow('already been received');
  });
});

describe('getDocumentChecklistWithStatus', () => {
  it('derives status from DB records', async () => {
    mockSellerDocRepo.findAllBySeller.mockResolvedValue([
      { docType: 'nric', deletedAt: null } as any,
      { docType: 'eaa', deletedAt: new Date() } as any,
    ]);

    const result = await sellerDocService.getDocumentChecklistWithStatus('seller-1', 'draft');

    const nric = result.find((i) => i.id === 'nric');
    const eaa = result.find((i) => i.id === 'estate-agency-agreement');
    const marriage = result.find((i) => i.id === 'marriage-cert');

    expect(nric?.status).toBe('uploaded');
    expect(eaa?.status).toBe('received_by_agent');
    expect(marriage?.status).toBe('not_uploaded');
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx jest src/domains/seller/__tests__/seller-document.service.test.ts --no-coverage
```

Expected: FAIL — functions not defined.

**Step 3: Implement download, delete, purge, and checklist functions**

Append to `src/domains/seller/seller-document.service.ts`:

```typescript
export async function downloadAndDeleteSellerDocument(
  documentId: string,
  agentId: string,
): Promise<{ buffer: Buffer; mimeType: string; docType: string }> {
  const doc = await sellerDocRepo.findById(documentId);
  if (!doc) throw new NotFoundError('SellerDocument', documentId);
  if (doc.deletedAt) throw new ForbiddenError('This document has already been deleted');

  // Decrypt in memory
  const buffer = await encryptedStorage.read(doc.path, doc.wrappedKey);

  // Hard-delete file from disk
  await encryptedStorage.delete(doc.path);

  // Mark row as downloaded + deleted
  await sellerDocRepo.markDownloadedAndDeleted(documentId, agentId);

  await auditService.log({
    agentId,
    action: 'seller_document.downloaded_and_deleted',
    entityType: 'seller',
    entityId: doc.sellerId,
    details: { documentId, docType: doc.docType },
  });

  return { buffer, mimeType: doc.mimeType, docType: doc.docType };
}

export async function downloadAllAndDeleteSellerDocuments(
  sellerId: string,
  agentId: string,
): Promise<{ files: { buffer: Buffer; filename: string }[]; sellerId: string }> {
  const docs = await sellerDocRepo.findActiveBySeller(sellerId);
  if (docs.length === 0) throw new NotFoundError('SellerDocuments', sellerId);

  const files: { buffer: Buffer; filename: string }[] = [];

  for (const doc of docs) {
    const buffer = await encryptedStorage.read(doc.path, doc.wrappedKey);
    const ext = path.extname(doc.path).replace('.enc', '');
    files.push({ buffer, filename: `${doc.docType}-${doc.id}${ext}` });

    await encryptedStorage.delete(doc.path);
    await sellerDocRepo.markDownloadedAndDeleted(doc.id, agentId);
  }

  await auditService.log({
    agentId,
    action: 'seller_document.bulk_downloaded_and_deleted',
    entityType: 'seller',
    entityId: sellerId,
    details: { documentCount: docs.length, docTypes: docs.map((d) => d.docType) },
  });

  return { files, sellerId };
}

export async function deleteSellerDocumentBySeller(
  documentId: string,
  sellerId: string,
): Promise<void> {
  const doc = await sellerDocRepo.findById(documentId);
  if (!doc) throw new NotFoundError('SellerDocument', documentId);
  if (doc.sellerId !== sellerId) throw new ForbiddenError('You do not own this document');
  if (doc.downloadedAt) throw new ForbiddenError('This document has already been received by your agent');

  await encryptedStorage.delete(doc.path);
  await sellerDocRepo.hardDelete(documentId);

  await auditService.log({
    actorType: 'seller',
    actorId: sellerId,
    action: 'seller_document.deleted_by_seller',
    entityType: 'seller',
    entityId: sellerId,
    details: { documentId, docType: doc.docType },
  });
}

export async function getActiveDocumentsForSeller(
  sellerId: string,
): Promise<SellerDocument[]> {
  return sellerDocRepo.findActiveBySeller(sellerId);
}

// ─── Checklist Status Derivation ─────────────────────────────────────────────

const DOC_TYPE_TO_CHECKLIST_ID: Record<string, string> = {
  nric: 'nric',
  marriage_cert: 'marriage-cert',
  eligibility_letter: 'eligibility-letter',
  otp_scan: 'otp-scan',
  eaa: 'estate-agency-agreement',
};

const CHECKLIST_ID_TO_DOC_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(DOC_TYPE_TO_CHECKLIST_ID).map(([k, v]) => [v, k]),
);

export async function getDocumentChecklistWithStatus(
  sellerId: string,
  propertyStatus: string | null,
): Promise<import('./seller.types').DocumentChecklistItem[]> {
  // Get base checklist (filtered by stage)
  const { getDocumentChecklist } = await import('./seller.service');
  const checklist = getDocumentChecklist(propertyStatus);

  // Get all documents (including deleted) for status derivation
  const allDocs = await sellerDocRepo.findAllBySeller(sellerId);

  // Derive status per checklist item
  return checklist.map((item) => {
    const docType = CHECKLIST_ID_TO_DOC_TYPE[item.id];
    if (!docType) return item; // 'other' has no checklist entry

    const docsForType = allDocs.filter((d) => d.docType === docType);
    if (docsForType.length === 0) return { ...item, status: 'not_uploaded' as const };

    const hasActive = docsForType.some((d) => d.deletedAt === null);
    if (hasActive) return { ...item, status: 'uploaded' as const };

    return { ...item, status: 'received_by_agent' as const };
  });
}

// ─── Auto-Purge (7-day backstop) ────────────────────────────────────────────

export async function purgeExpiredSellerDocuments(retentionDays: number): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  const expired = await sellerDocRepo.findExpiredUnpurged(cutoff);

  for (const doc of expired) {
    try {
      await encryptedStorage.delete(doc.path);
    } catch {
      // File may already be gone — continue with DB cleanup
    }
    await sellerDocRepo.markPurged(doc.id);
  }

  if (expired.length > 0) {
    await auditService.log({
      actorType: 'system',
      action: 'seller_document.auto_purged',
      entityType: 'system',
      entityId: 'seller_document_purge',
      details: { count: expired.length, cutoffDate: cutoff.toISOString() },
    });
  }

  return expired.length;
}
```

**Step 4: Run tests to verify they pass**

```bash
npx jest src/domains/seller/__tests__/seller-document.service.test.ts --no-coverage
```

Expected: All tests PASS.

**Step 5: Commit**

```bash
git add src/domains/seller/seller-document.service.ts src/domains/seller/__tests__/seller-document.service.test.ts
git commit -m "feat(seller): add download, delete, purge, and checklist status derivation"
```

---

### Task 6: Validator

**Files:**
- Create: `src/domains/seller/seller-document.validator.ts`

**Step 1: Create validator**

Create `src/domains/seller/seller-document.validator.ts`:

```typescript
import { body } from 'express-validator';
import { SELLER_DOC_TYPES } from './seller.types';

export const uploadSellerDocumentValidator = [
  body('docType')
    .isString()
    .isIn([...SELLER_DOC_TYPES])
    .withMessage(`docType must be one of: ${SELLER_DOC_TYPES.join(', ')}`),
];
```

**Step 2: Commit**

```bash
git add src/domains/seller/seller-document.validator.ts
git commit -m "feat(seller): add seller document upload validator"
```

---

### Task 7: Seller Upload Routes

**Files:**
- Modify: `src/domains/seller/seller.router.ts`
- Modify: `src/views/partials/seller/document-checklist.njk`

**Step 1: Add multer config and upload/delete routes to seller router**

Add imports at the top of `src/domains/seller/seller.router.ts` (after existing imports):

```typescript
import multer from 'multer';
import * as sellerDocService from './seller-document.service';
import { uploadSellerDocumentValidator } from './seller-document.validator';
import { SELLER_DOC_MAX_SIZE_BYTES, SELLER_DOC_ALLOWED_MIMES } from './seller.types';
```

Add multer config after the `sellerAuth` line (line 25):

```typescript
const sellerDocUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SELLER_DOC_MAX_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (SELLER_DOC_ALLOWED_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new ValidationError('Only JPEG, PNG, and PDF files are allowed'));
    }
  },
});
```

Replace the existing `GET /seller/documents` route (lines 391-404) with the updated version that derives status from DB:

```typescript
// Document checklist (with live status)
sellerRouter.get('/seller/documents', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as AuthenticatedUser;
    const overview = await sellerService.getDashboardOverview(user.id);
    const checklist = await sellerDocService.getDocumentChecklistWithStatus(
      user.id,
      overview.propertyStatus,
    );
    const activeDocuments = await sellerDocService.getActiveDocumentsForSeller(user.id);

    if (req.headers['hx-request']) {
      return res.render('partials/seller/document-checklist', { checklist, activeDocuments });
    }
    res.render('pages/seller/documents', { checklist, activeDocuments });
  } catch (err) {
    next(err);
  }
});
```

Add upload route after the documents GET route:

```typescript
// Upload seller document
sellerRouter.post(
  '/seller/documents',
  sellerDocUpload.single('file'),
  ...uploadSellerDocumentValidator,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      if (!req.file) {
        return next(new ValidationError('No file uploaded'));
      }

      const docType = req.body.docType as string;
      await sellerDocService.uploadSellerDocument({
        sellerId: user.id,
        docType: docType as any,
        fileBuffer: req.file.buffer,
        mimeType: req.file.mimetype,
        originalFilename: req.file.originalname,
        uploadedBy: user.id,
        uploadedByRole: 'seller',
      });

      const overview = await sellerService.getDashboardOverview(user.id);
      const checklist = await sellerDocService.getDocumentChecklistWithStatus(
        user.id,
        overview.propertyStatus,
      );
      const activeDocuments = await sellerDocService.getActiveDocumentsForSeller(user.id);

      res.render('partials/seller/document-checklist', { checklist, activeDocuments });
    } catch (err) {
      next(err);
    }
  },
);

// Delete seller document (before agent download)
sellerRouter.delete(
  '/seller/documents/:documentId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      await sellerDocService.deleteSellerDocumentBySeller(req.params['documentId'] as string, user.id);

      const overview = await sellerService.getDashboardOverview(user.id);
      const checklist = await sellerDocService.getDocumentChecklistWithStatus(
        user.id,
        overview.propertyStatus,
      );
      const activeDocuments = await sellerDocService.getActiveDocumentsForSeller(user.id);

      res.render('partials/seller/document-checklist', { checklist, activeDocuments });
    } catch (err) {
      next(err);
    }
  },
);
```

**Step 2: Update the document-checklist template**

Replace the full content of `src/views/partials/seller/document-checklist.njk`:

```njk
{% if checklist.length == 0 %}
<div class="p-6 text-center text-gray-500">
  {{ "No documents required at this stage" | t }}
</div>
{% else %}
<ul class="divide-y divide-gray-200" id="document-checklist">
  {% for item in checklist %}
  <li class="p-4">
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-3">
        <div class="w-6 h-6 rounded flex items-center justify-center
          {% if item.status == 'received_by_agent' %}bg-green-100 text-green-600
          {% elif item.status == 'uploaded' %}bg-blue-100 text-blue-600
          {% else %}bg-gray-100 text-gray-400{% endif %}">
          {% if item.status == 'received_by_agent' %}&#10003;
          {% elif item.status == 'uploaded' %}&uarr;
          {% else %}&middot;{% endif %}
        </div>
        <div>
          <p class="text-sm font-medium text-gray-900">
            {{ item.label | t }}
            {% if item.required %}<span class="text-red-500">*</span>{% endif %}
          </p>
          <p class="text-xs text-gray-500">{{ item.description | t }}</p>
        </div>
      </div>
      <span class="text-xs font-medium px-2 py-1 rounded
        {% if item.status == 'received_by_agent' %}bg-green-100 text-green-700
        {% elif item.status == 'uploaded' %}bg-blue-100 text-blue-700
        {% else %}bg-gray-100 text-gray-500{% endif %}">
        {% if item.status == 'received_by_agent' %}{{ "Received by Agent" | t }}
        {% elif item.status == 'uploaded' %}{{ "Uploaded" | t }}
        {% else %}{{ "Not Uploaded" | t }}{% endif %}
      </span>
    </div>

    {# Show uploaded files for this item #}
    {% set docTypeMap = {
      'nric': 'nric',
      'marriage-cert': 'marriage_cert',
      'eligibility-letter': 'eligibility_letter',
      'otp-scan': 'otp_scan',
      'estate-agency-agreement': 'eaa'
    } %}
    {% set dbDocType = docTypeMap[item.id] %}
    {% if activeDocuments %}
      {% for doc in activeDocuments %}
        {% if doc.docType == dbDocType %}
        <div class="ml-9 mb-1 flex items-center justify-between text-xs text-gray-500 bg-gray-50 rounded px-3 py-2">
          <span>{{ doc.mimeType }} &middot; {{ (doc.sizeBytes / 1024) | round }}KB &middot; {{ doc.uploadedAt | dateformat }}</span>
          <button
            hx-delete="/seller/documents/{{ doc.id }}"
            hx-target="#document-checklist"
            hx-swap="outerHTML"
            hx-confirm="{{ 'Are you sure you want to remove this file?' | t }}"
            class="text-red-500 hover:text-red-700 text-xs font-medium">
            {{ "Remove" | t }}
          </button>
        </div>
        {% endif %}
      {% endfor %}
    {% endif %}

    {# Upload area — show if status is not_uploaded or uploaded (can add more files) #}
    {% if item.status != 'received_by_agent' %}
    <div class="ml-9 mt-2">
      <form hx-post="/seller/documents"
            hx-target="#document-checklist"
            hx-swap="outerHTML"
            hx-encoding="multipart/form-data"
            class="flex items-center gap-2">
        <input type="hidden" name="docType" value="{{ dbDocType }}">
        <input type="file"
               name="file"
               accept="image/jpeg,image/png,application/pdf"
               class="text-xs text-gray-500 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100">
        <button type="submit"
                class="text-xs font-medium px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700">
          {{ "Upload" | t }}
        </button>
      </form>
    </div>
    {% endif %}
  </li>
  {% endfor %}
</ul>
{% endif %}
```

**Step 3: Run full test suite to check for breakage**

```bash
npm test
```

Expected: All tests pass (existing document checklist tests may need updating if they assert on old template content).

**Step 4: Commit**

```bash
git add src/domains/seller/seller.router.ts src/views/partials/seller/document-checklist.njk src/domains/seller/seller-document.validator.ts
git commit -m "feat(seller): add seller document upload/delete routes and updated checklist template"
```

---

### Task 8: Agent Download Routes

**Files:**
- Modify: `src/domains/agent/agent.router.ts`

**Step 1: Add download routes to agent router**

Add imports at the top of `src/domains/agent/agent.router.ts`:

```typescript
import * as sellerDocService from '../seller/seller-document.service';
import archiver from 'archiver';
```

Add routes after the existing seller-related routes (after the case flags routes):

```typescript
// GET /agent/sellers/:id/documents — View seller's uploaded documents
agentRouter.get(
  '/agent/sellers/:id/documents',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sellerId = req.params['id'] as string;
      const agentId = (req.user as AuthenticatedUser).id;

      // Verify agent owns this seller
      const seller = await sellerService.getSellerDetail(sellerId);
      if (!seller) return next(new NotFoundError('Seller', sellerId));
      if (seller.agentId !== agentId && (req.user as AuthenticatedUser).role !== 'admin') {
        return next(new ForbiddenError('You are not assigned to this seller'));
      }

      const documents = await sellerDocService.getActiveDocumentsForSeller(sellerId);

      if (req.headers['hx-request']) {
        return res.render('partials/agent/seller-documents', { documents, seller });
      }
      res.render('pages/agent/seller-documents', { documents, seller });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/sellers/:id/documents/:documentId/download — Download and delete single document
agentRouter.post(
  '/agent/sellers/:id/documents/:documentId/download',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sellerId = req.params['id'] as string;
      const documentId = req.params['documentId'] as string;
      const agentId = (req.user as AuthenticatedUser).id;

      // Verify agent owns this seller
      const seller = await sellerService.getSellerDetail(sellerId);
      if (!seller) return next(new NotFoundError('Seller', sellerId));
      if (seller.agentId !== agentId && (req.user as AuthenticatedUser).role !== 'admin') {
        return next(new ForbiddenError('You are not assigned to this seller'));
      }

      const { buffer, mimeType, docType } = await sellerDocService.downloadAndDeleteSellerDocument(
        documentId,
        agentId,
      );

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${docType}-${documentId}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/sellers/:id/documents/download-all — Download all as ZIP and delete
agentRouter.post(
  '/agent/sellers/:id/documents/download-all',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sellerId = req.params['id'] as string;
      const agentId = (req.user as AuthenticatedUser).id;

      // Verify agent owns this seller
      const seller = await sellerService.getSellerDetail(sellerId);
      if (!seller) return next(new NotFoundError('Seller', sellerId));
      if (seller.agentId !== agentId && (req.user as AuthenticatedUser).role !== 'admin') {
        return next(new ForbiddenError('You are not assigned to this seller'));
      }

      const { files } = await sellerDocService.downloadAllAndDeleteSellerDocuments(
        sellerId,
        agentId,
      );

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="seller-documents-${sellerId}.zip"`,
      );
      res.setHeader('Cache-Control', 'no-store');

      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.pipe(res);
      for (const file of files) {
        archive.append(file.buffer, { name: file.filename });
      }
      await archive.finalize();
    } catch (err) {
      next(err);
    }
  },
);
```

**Step 2: Verify agent router imports are correct**

Check that `sellerService`, `NotFoundError`, `ForbiddenError`, and `AuthenticatedUser` are already imported in the agent router. If `archiver` is not installed:

```bash
npm install archiver && npm install -D @types/archiver
```

**Step 3: Run tests**

```bash
npm test
```

Expected: All tests pass.

**Step 4: Commit**

```bash
git add src/domains/agent/agent.router.ts package.json package-lock.json
git commit -m "feat(agent): add seller document download routes with ZIP support"
```

---

### Task 9: Agent-Side Templates

**Files:**
- Create: `src/views/pages/agent/seller-documents.njk`
- Create: `src/views/partials/agent/seller-documents.njk`

**Step 1: Create the agent documents page**

Create `src/views/pages/agent/seller-documents.njk`:

```njk
{% extends "layouts/agent.njk" %}

{% block title %}{{ "Documents" | t }} — {{ seller.name }} — SellMyHomeNow.sg{% endblock %}

{% block content %}
{% set pageTitle = seller.name + " — Documents" %}
{% include "partials/shared/page-header.njk" %}

<div class="card">
  {% include "partials/agent/seller-documents.njk" %}
</div>
{% endblock %}
```

**Step 2: Create the agent documents partial**

Create `src/views/partials/agent/seller-documents.njk`:

```njk
{% if documents.length == 0 %}
<div class="p-6 text-center text-gray-500">
  {{ "No documents uploaded by this seller yet" | t }}
</div>
{% else %}
<div class="p-4">
  <div class="flex justify-between items-center mb-4">
    <h3 class="text-sm font-medium text-gray-900">{{ "Uploaded Documents" | t }}</h3>
    <form method="POST" action="/agent/sellers/{{ seller.id }}/documents/download-all">
      <button type="submit"
              class="text-xs font-medium px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700">
        {{ "Download All & Delete" | t }}
      </button>
    </form>
  </div>

  <ul class="divide-y divide-gray-200">
    {% for doc in documents %}
    <li class="py-3 flex items-center justify-between">
      <div>
        <p class="text-sm font-medium text-gray-900">{{ doc.docType }}</p>
        <p class="text-xs text-gray-500">
          {{ doc.mimeType }} &middot; {{ (doc.sizeBytes / 1024) | round }}KB &middot; {{ doc.uploadedAt | dateformat }}
        </p>
      </div>
      <form method="POST" action="/agent/sellers/{{ seller.id }}/documents/{{ doc.id }}/download">
        <button type="submit"
                class="text-xs font-medium px-3 py-1.5 rounded bg-green-600 text-white hover:bg-green-700">
          {{ "Download & Delete" | t }}
        </button>
      </form>
    </li>
    {% endfor %}
  </ul>
</div>
{% endif %}
```

**Step 3: Commit**

```bash
git add src/views/pages/agent/seller-documents.njk src/views/partials/agent/seller-documents.njk
git commit -m "feat(agent): add seller document download templates"
```

---

### Task 10: Add Notification Template Name

**Files:**
- Modify: `src/domains/notification/notification.types.ts`

**Step 1: Add `seller_document_uploaded` to the NotificationTemplateName union**

Add `'seller_document_uploaded'` to the `NotificationTemplateName` type (after `'testimonial_reissued'` line 31):

```typescript
  | 'seller_document_uploaded'
```

**Step 2: Commit**

```bash
git add src/domains/notification/notification.types.ts
git commit -m "feat(notification): add seller_document_uploaded template name"
```

---

### Task 11: Wire Auto-Purge into Existing Retention Cron

**Files:**
- Check: the existing retention/purge cron job file
- Modify: add `sellerDocService.purgeExpiredSellerDocuments(retentionDays)` call

**Step 1: Find the existing purge cron**

Search for where `purgeSensitiveDocs` or `scanRetention` is called. This is typically in a cron or scheduled task file.

**Step 2: Add seller document purge call**

After the existing sensitive document purge call, add:

```typescript
import * as sellerDocService from '../domains/seller/seller-document.service';
import * as settingsService from '../domains/shared/settings.service';

// Inside the cron handler:
const retentionDays = await settingsService.getNumber('sensitive_doc_retention_days', 7);
const purgedCount = await sellerDocService.purgeExpiredSellerDocuments(retentionDays);
logger.info({ purgedCount }, 'Seller document auto-purge complete');
```

**Step 3: Run tests**

```bash
npm test
```

**Step 4: Commit**

```bash
git add <modified-cron-file>
git commit -m "feat(cron): wire seller document auto-purge into retention cron"
```

---

### Task 12: Update Compliance Repository — collectSellerFilePaths

**Files:**
- Modify: `src/domains/compliance/compliance.repository.ts`

**Step 1: Update `collectSellerFilePaths` to include seller documents**

Find the `collectSellerFilePaths` function and add seller document paths to the collection. After the existing path collection logic, add:

```typescript
import { prisma } from '@/infra/database/prisma';

// Inside collectSellerFilePaths, after existing path collection:
const sellerDocs = await prisma.sellerDocument.findMany({
  where: { sellerId, deletedAt: null },
  select: { path: true },
});
for (const doc of sellerDocs) {
  paths.push(doc.path);
}
```

This ensures hard-delete on account deletion includes seller-uploaded documents.

**Step 2: Run tests**

```bash
npm test
```

**Step 3: Commit**

```bash
git add src/domains/compliance/compliance.repository.ts
git commit -m "fix(compliance): include seller documents in collectSellerFilePaths"
```

---

### Task 13: Full Test Suite Verification

**Step 1: Run unit tests**

```bash
npm test
```

Expected: All tests pass.

**Step 2: Run integration tests**

```bash
npm run test:integration
```

Expected: All tests pass.

**Step 3: Manual smoke test**

1. Log in as a seller (Gregory Peck)
2. Navigate to `/seller/documents`
3. Verify checklist shows with upload areas
4. Upload a JPEG to NRIC — verify status changes to "Uploaded"
5. Delete the upload — verify status reverts to "Not Uploaded"
6. Upload again, then log in as the assigned agent
7. Navigate to `/agent/sellers/:id/documents`
8. Download the document — verify file downloads and status shows "Received by Agent" for the seller

**Step 4: Commit any test fixes**

```bash
git add -A
git commit -m "test: fix any broken tests after seller document feature"
```
