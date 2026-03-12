# Phase 4 SP2: Transaction Domain — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full transaction lifecycle: OTP physical tracking (7-step state machine with file uploads), commission invoice storage and distribution, HDB application tracking, completion handling, and post-completion cron sequence.

**Architecture:** New `transaction` domain (types → repository → service → router → validator → jobs). All DB access through the repository layer. Jobs registered in `src/server.ts` following the `viewing.jobs.ts` pattern. File uploads use multer in-memory storage, validated and written via the `localStorage` singleton (`src/infra/storage/local-storage.ts`).

**Tech Stack:** TypeScript, Express, Prisma, Nunjucks/HTMX, Jest (unit + integration), multer (file upload), node-cron via `registerJob`, notification service (DNC-aware), settings service.

**Spec:** `docs/superpowers/specs/2026-03-11-phase-4-transaction-management-design.md` (Sections 4–6)

**SP2 dependency note:** SP1 must be complete before SP2. SP1 adds `offer_ai_analysis_enabled` and `otp_exercise_days` to the seed and fixes `commission_gst_rate` → `gst_rate`. SP2 reads `commission_amount`, `gst_rate`, and `otp_exercise_days` from SystemSetting — use key `gst_rate` (NOT `commission_gst_rate`).

**Run tests after each section:** `npm test` (unit), `npm run test:integration` (integration)

---

## Chunk 1: Schema Migration + Types + Repository

### Task 1: Schema migration — OTP scanned copy fields

**Files:**
- Modify: `prisma/schema.prisma`
- Run: `npm run db:migrate`

The `Otp` model currently has a single `scannedCopyPath` field. SP2 replaces it with two separate fields (seller's signed copy + returned original), matching the two distinct upload steps.

- [ ] **Step 1: Update Otp model in schema**

In `prisma/schema.prisma`, find the `model Otp` block. Replace:
```prisma
  scannedCopyPath       String?   @map("scanned_copy_path")
```

With:
```prisma
  scannedCopyPathSeller   String?   @map("scanned_copy_path_seller")
  scannedCopyPathReturned String?   @map("scanned_copy_path_returned")
```

The `scannedCopyDeletedAt` field stays unchanged.

- [ ] **Step 2: Run migration**

```bash
npm run db:migrate
```

Name the migration: `replace_otp_scanned_copy_path_with_two_fields`

Expected: migration created and applied with no errors.

- [ ] **Step 3: Verify Prisma client regenerated**

```bash
npx prisma generate
```

Expected: `✔ Generated Prisma Client` with no errors.

- [ ] **Step 4: Run existing tests to confirm nothing broke**

```bash
npm test
```

Expected: all existing tests pass. Any test that referenced `scannedCopyPath` directly may need updating — search with:
```bash
grep -rn "scannedCopyPath" src/ tests/
```

Fix any references found.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): replace single otp scannedCopyPath with seller + returned fields"
```

---

### Task 2: Transaction types and state machine constants

**Files:**
- Create: `src/domains/transaction/transaction.types.ts`

- [ ] **Step 1: Create transaction types file**

```typescript
// src/domains/transaction/transaction.types.ts
import type { TransactionStatus, OtpStatus, InvoiceStatus } from '@prisma/client';

export type { TransactionStatus, OtpStatus, InvoiceStatus };

// OTP strict sequential transitions — only one valid next state per current state
// null means terminal (no further transitions allowed)
export const OTP_TRANSITIONS: Record<OtpStatus, OtpStatus | null> = {
  prepared: 'sent_to_seller',
  sent_to_seller: 'signed_by_seller',
  signed_by_seller: 'returned',
  returned: 'issued_to_buyer',
  issued_to_buyer: 'exercised',
  exercised: null,
  expired: null,
};

// Transaction status progression
// fallen_through can be reached from any non-terminal status
export const TRANSACTION_STATUS_ORDER: TransactionStatus[] = [
  'option_issued',
  'option_exercised',
  'completing',
  'completed',
];

export interface CreateTransactionInput {
  propertyId: string;
  sellerId: string;
  agreedPrice: number;
  optionFee?: number;
  optionDate?: Date;
  agentId: string;
}

export interface CreateOtpInput {
  transactionId: string;
  hdbSerialNumber: string;
  agentId: string;
}

export interface AdvanceOtpInput {
  transactionId: string;
  notes?: string;
  issuedAt?: Date; // optional past date for issued_to_buyer transition; defaults to new Date()
  agentId: string;
}

export interface UploadOtpScanInput {
  transactionId: string;
  scanType: 'seller' | 'returned';
  fileBuffer: Buffer;
  originalFilename: string;
  agentId: string;
}

export interface UploadInvoiceInput {
  transactionId: string;
  fileBuffer: Buffer;
  originalFilename: string;
  invoiceNumber: string;
  agentId: string;
}
```

- [ ] **Step 2: Run TypeScript compilation to verify**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/domains/transaction/transaction.types.ts
git commit -m "feat(transaction): add transaction types and state machine constants"
```

---

### Task 3: Transaction repository + factory

**Files:**
- Create: `src/domains/transaction/transaction.repository.ts`
- Create: `src/domains/transaction/__tests__/transaction.repository.test.ts`
- Modify: `tests/fixtures/factory.ts`

- [ ] **Step 1: Write the failing repository test**

Create `src/domains/transaction/__tests__/transaction.repository.test.ts`:

```typescript
// src/domains/transaction/__tests__/transaction.repository.test.ts
import { factory } from '../../../tests/fixtures/factory';
import { testPrisma } from '../../../tests/helpers/prisma';
import * as txRepo from '../transaction.repository';
import { createId } from '@paralleldrive/cuid2';

describe('transaction.repository', () => {
  let agentId: string;
  let sellerId: string;
  let propertyId: string;
  let transactionId: string;

  beforeEach(async () => {
    await testPrisma.otp.deleteMany();
    await testPrisma.commissionInvoice.deleteMany();
    await testPrisma.transaction.deleteMany();
    await testPrisma.property.deleteMany();
    await testPrisma.seller.deleteMany();
    await testPrisma.agent.deleteMany();

    const agent = await factory.agent();
    agentId = agent.id;
    const seller = await factory.seller({ agentId });
    sellerId = seller.id;
    const property = await factory.property({ sellerId });
    propertyId = property.id;
    const tx = await factory.transaction({ propertyId, sellerId, agreedPrice: 600000 });
    transactionId = tx.id;
  });

  describe('createTransaction', () => {
    it('creates a transaction record', async () => {
      const id = createId();
      const tx = await txRepo.createTransaction({
        id,
        propertyId,
        sellerId,
        agreedPrice: 650000,
      });
      expect(tx.id).toBe(id);
      expect(tx.status).toBe('option_issued');
    });
  });

  describe('findById', () => {
    it('returns transaction with otp and invoice', async () => {
      const tx = await txRepo.findById(transactionId);
      expect(tx?.id).toBe(transactionId);
    });

    it('returns null for unknown id', async () => {
      const tx = await txRepo.findById('nonexistent');
      expect(tx).toBeNull();
    });
  });

  describe('updateTransactionStatus', () => {
    it('updates status and sets completionDate when transitioning to completed', async () => {
      const updated = await txRepo.updateTransactionStatus(transactionId, 'completed', new Date());
      expect(updated.status).toBe('completed');
      expect(updated.completionDate).not.toBeNull();
    });
  });

  describe('createOtp', () => {
    it('creates an OTP record linked to transaction', async () => {
      const otp = await txRepo.createOtp({
        id: createId(),
        transactionId,
        hdbSerialNumber: 'SN-001',
      });
      expect(otp.transactionId).toBe(transactionId);
      expect(otp.status).toBe('prepared');
    });
  });

  describe('findOtpByTransactionId', () => {
    it('returns null when no OTP exists', async () => {
      const otp = await txRepo.findOtpByTransactionId(transactionId);
      expect(otp).toBeNull();
    });
  });

  describe('updateOtpStatus', () => {
    it('advances OTP status', async () => {
      const otp = await factory.otp({ transactionId });
      const updated = await txRepo.updateOtpStatus(otp.id, 'sent_to_seller');
      expect(updated.status).toBe('sent_to_seller');
    });
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm run test:integration -- --testPathPattern="transaction.repository" --runInBand
```

Expected: FAIL — module not found, factory.transaction/otp missing.

- [ ] **Step 3: Add factory methods**

In `tests/fixtures/factory.ts`, add:

```typescript
  async transaction(overrides: {
    propertyId: string;
    sellerId: string;
    agreedPrice?: number;
    status?: 'option_issued' | 'option_exercised' | 'completing' | 'completed' | 'fallen_through';
    completionDate?: Date;
    exerciseDeadline?: Date;
  }) {
    return testPrisma.transaction.create({
      data: {
        id: createId(),
        propertyId: overrides.propertyId,
        sellerId: overrides.sellerId,
        agreedPrice: overrides.agreedPrice ?? 600000,
        status: overrides.status ?? 'option_issued',
        completionDate: overrides.completionDate ?? null,
        exerciseDeadline: overrides.exerciseDeadline ?? null,
      },
    });
  },

  async otp(overrides: {
    transactionId: string;
    hdbSerialNumber?: string;
    status?: 'prepared' | 'sent_to_seller' | 'signed_by_seller' | 'returned' | 'issued_to_buyer' | 'exercised' | 'expired';
    issuedAt?: Date;
    agentReviewedAt?: Date;
    scannedCopyPathSeller?: string;
    scannedCopyPathReturned?: string;
  }) {
    return testPrisma.otp.create({
      data: {
        id: createId(),
        transactionId: overrides.transactionId,
        hdbSerialNumber: overrides.hdbSerialNumber ?? 'SN-001',
        status: overrides.status ?? 'prepared',
        issuedAt: overrides.issuedAt ?? null,
        agentReviewedAt: overrides.agentReviewedAt ?? null,
        scannedCopyPathSeller: overrides.scannedCopyPathSeller ?? null,
        scannedCopyPathReturned: overrides.scannedCopyPathReturned ?? null,
      },
    });
  },

  async commissionInvoice(overrides: {
    transactionId: string;
    status?: 'pending_upload' | 'uploaded' | 'sent_to_client' | 'paid';
    invoiceFilePath?: string;
    invoiceNumber?: string;
    amount?: number;
    gstAmount?: number;
    totalAmount?: number;
  }) {
    return testPrisma.commissionInvoice.create({
      data: {
        id: createId(),
        transactionId: overrides.transactionId,
        status: overrides.status ?? 'pending_upload',
        invoiceFilePath: overrides.invoiceFilePath ?? null,
        invoiceNumber: overrides.invoiceNumber ?? null,
        amount: overrides.amount ?? 1499,
        gstAmount: overrides.gstAmount ?? 134.91,
        totalAmount: overrides.totalAmount ?? 1633.91,
      },
    });
  },
```

- [ ] **Step 4: Create transaction repository**

Create `src/domains/transaction/transaction.repository.ts`:

```typescript
// src/domains/transaction/transaction.repository.ts
import { prisma } from '@/infra/database/prisma';
import { createId } from '@paralleldrive/cuid2';
import type { TransactionStatus, OtpStatus } from '@prisma/client';

interface CreateTransactionData {
  id?: string;
  propertyId: string;
  sellerId: string;
  agreedPrice: number;
  optionFee?: number | null;
  optionDate?: Date | null;
}

interface CreateOtpData {
  id?: string;
  transactionId: string;
  hdbSerialNumber: string;
}

export async function createTransaction(data: CreateTransactionData) {
  return prisma.transaction.create({
    data: {
      id: data.id ?? createId(),
      propertyId: data.propertyId,
      sellerId: data.sellerId,
      agreedPrice: data.agreedPrice,
      optionFee: data.optionFee ?? null,
      optionDate: data.optionDate ?? null,
    },
  });
}

export async function findById(id: string) {
  return prisma.transaction.findUnique({
    where: { id },
    include: { otp: true, commissionInvoice: true },
  });
}

export async function findByPropertyId(propertyId: string) {
  return prisma.transaction.findFirst({
    where: { propertyId },
    orderBy: { createdAt: 'desc' },
    include: { otp: true, commissionInvoice: true },
  });
}

export async function updateTransactionStatus(
  id: string,
  status: TransactionStatus,
  completionDate?: Date | null,
) {
  return prisma.transaction.update({
    where: { id },
    data: {
      status,
      ...(completionDate !== undefined ? { completionDate } : {}),
    },
  });
}

export async function updateHdbTracking(
  id: string,
  data: { hdbApplicationStatus?: string; hdbAppointmentDate?: Date | null },
) {
  return prisma.transaction.update({
    where: { id },
    data: {
      hdbApplicationStatus: data.hdbApplicationStatus,
      hdbAppointmentDate: data.hdbAppointmentDate,
    },
  });
}

export async function updateExerciseDeadline(id: string, exerciseDeadline: Date) {
  return prisma.transaction.update({
    where: { id },
    data: { exerciseDeadline },
  });
}

export async function createOtp(data: CreateOtpData) {
  return prisma.otp.create({
    data: {
      id: data.id ?? createId(),
      transactionId: data.transactionId,
      hdbSerialNumber: data.hdbSerialNumber,
    },
  });
}

export async function findOtpByTransactionId(transactionId: string) {
  return prisma.otp.findUnique({ where: { transactionId } });
}

export async function updateOtpStatus(id: string, status: OtpStatus, extra?: {
  issuedAt?: Date;
  exercisedAt?: Date;
  expiredAt?: Date;
}) {
  return prisma.otp.update({
    where: { id },
    data: {
      status,
      ...(extra?.issuedAt ? { issuedAt: extra.issuedAt } : {}),
      ...(extra?.exercisedAt ? { exercisedAt: extra.exercisedAt } : {}),
      ...(extra?.expiredAt ? { expiredAt: extra.expiredAt } : {}),
    },
  });
}

export async function updateOtpReview(id: string, reviewedAt: Date, notes?: string) {
  return prisma.otp.update({
    where: { id },
    data: { agentReviewedAt: reviewedAt, agentReviewNotes: notes ?? null },
  });
}

export async function updateOtpScanPath(
  id: string,
  scanType: 'seller' | 'returned',
  path: string,
) {
  const field = scanType === 'seller' ? 'scannedCopyPathSeller' : 'scannedCopyPathReturned';
  return prisma.otp.update({ where: { id }, data: { [field]: path } });
}

export async function createCommissionInvoice(data: {
  id?: string;
  transactionId: string;
  invoiceFilePath: string;
  invoiceNumber: string;
  amount: number;
  gstAmount: number;
  totalAmount: number;
}) {
  return prisma.commissionInvoice.create({
    data: {
      id: data.id ?? createId(),
      transactionId: data.transactionId,
      invoiceFilePath: data.invoiceFilePath,
      invoiceNumber: data.invoiceNumber,
      amount: data.amount,
      gstAmount: data.gstAmount,
      totalAmount: data.totalAmount,
      status: 'uploaded',
      uploadedAt: new Date(),
    },
  });
}

export async function findInvoiceByTransactionId(transactionId: string) {
  return prisma.commissionInvoice.findUnique({ where: { transactionId } });
}

export async function updateInvoiceStatus(
  id: string,
  status: 'sent_to_client' | 'paid',
  extra?: { sentAt?: Date; sentVia?: string; paidAt?: Date },
) {
  return prisma.commissionInvoice.update({
    where: { id },
    data: {
      status,
      ...(extra?.sentAt ? { sentAt: extra.sentAt } : {}),
      ...(extra?.sentVia ? { sentVia: extra.sentVia } : {}),
      ...(extra?.paidAt ? { paidAt: extra.paidAt } : {}),
    },
  });
}

// ── Cron queries ──────────────────────────────────────────────────────────────

/** Returns all OTPs with status issued_to_buyer for reminder checking */
export async function findOtpsIssuedToBuyer() {
  return prisma.otp.findMany({
    where: { status: 'issued_to_buyer' },
    include: { transaction: { include: { seller: true } } },
  });
}

/** Returns transactions completed on a specific date */
export async function findTransactionsCompletedOn(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return prisma.transaction.findMany({
    where: {
      status: 'completed',
      completionDate: { gte: start, lte: end },
    },
    include: { seller: true },
  });
}

/** Returns transactions where completionDate was exactly N days ago */
export async function findTransactionsCompletedDaysAgo(daysAgo: number) {
  const target = new Date();
  target.setDate(target.getDate() - daysAgo);
  return findTransactionsCompletedOn(target);
}

/** Deduplication check: returns existing notification or null */
export async function findExistingNotification(templateName: string, recipientId: string) {
  return prisma.notification.findFirst({ where: { templateName, recipientId } });
}
```

- [ ] **Step 5: Run the repository test**

```bash
npm run test:integration -- --testPathPattern="transaction.repository" --runInBand
```

Expected: all tests pass.

- [ ] **Step 6: Run full test suite**

```bash
npm test && npm run test:integration -- --runInBand
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/domains/transaction/transaction.repository.ts src/domains/transaction/__tests__/transaction.repository.test.ts tests/fixtures/factory.ts
git commit -m "feat(transaction): add transaction repository with OTP, invoice, and cron queries"
```

---

## Chunk 2: Transaction Service — Core Logic, OTP, Invoice

### Task 4: Transaction service — core + OTP lifecycle

**Files:**
- Create: `src/domains/transaction/transaction.service.ts`
- Create: `src/domains/transaction/__tests__/transaction.service.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create `src/domains/transaction/__tests__/transaction.service.test.ts`:

```typescript
// src/domains/transaction/__tests__/transaction.service.test.ts
import * as txService from '../transaction.service';
import * as txRepo from '../transaction.repository';
import * as settingsService from '@/domains/shared/settings.service';
import * as notificationService from '@/domains/notification/notification.service';
import * as auditService from '@/domains/shared/audit.service';
import * as portalService from '@/domains/property/portal.service';
import { ValidationError, NotFoundError, ConflictError } from '@/domains/shared/errors';

jest.mock('../transaction.repository');
jest.mock('@/domains/shared/settings.service');
jest.mock('@/domains/notification/notification.service');
jest.mock('@/domains/shared/audit.service');
jest.mock('@/domains/property/portal.service');
jest.mock('@/infra/storage/local-storage', () => ({
  localStorage: {
    save: jest.fn().mockResolvedValue('invoices/tx-1/invoice-abc.pdf'),
    read: jest.fn().mockResolvedValue(Buffer.from('')),
    delete: jest.fn().mockResolvedValue(undefined),
    exists: jest.fn().mockResolvedValue(true),
  },
}));

const mockTxRepo = jest.mocked(txRepo);
const mockSettings = jest.mocked(settingsService);
const mockNotification = jest.mocked(notificationService);
const mockAudit = jest.mocked(auditService);
const mockPortalService = jest.mocked(portalService);

function makeTransaction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx-1',
    propertyId: 'property-1',
    sellerId: 'seller-1',
    agreedPrice: '600000',
    status: 'option_issued' as const,
    completionDate: null,
    exerciseDeadline: null,
    otp: null,
    commissionInvoice: null,
    ...overrides,
  };
}

function makeOtp(overrides: Record<string, unknown> = {}) {
  return {
    id: 'otp-1',
    transactionId: 'tx-1',
    hdbSerialNumber: 'SN-001',
    status: 'prepared' as const,
    issuedAt: null,
    agentReviewedAt: null,
    scannedCopyPathSeller: null,
    scannedCopyPathReturned: null,
    ...overrides,
  };
}

describe('transaction.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAudit.log.mockResolvedValue(undefined as never);
    mockNotification.send.mockResolvedValue(undefined as never);
    mockSettings.getNumber.mockResolvedValue(21); // otp_exercise_days default
    mockSettings.get.mockResolvedValue('anthropic');
  });

  describe('createTransaction', () => {
    it('creates a transaction record', async () => {
      const tx = makeTransaction();
      mockTxRepo.createTransaction.mockResolvedValue(tx as never);

      const result = await txService.createTransaction({
        propertyId: 'property-1',
        sellerId: 'seller-1',
        agreedPrice: 600000,
        agentId: 'agent-1',
      });

      expect(mockTxRepo.createTransaction).toHaveBeenCalledTimes(1);
      expect(result.id).toBe('tx-1');
    });
  });

  describe('createOtp', () => {
    it('creates OTP record', async () => {
      const tx = makeTransaction();
      const otp = makeOtp();
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockTxRepo.findOtpByTransactionId.mockResolvedValue(null);
      mockTxRepo.createOtp.mockResolvedValue(otp as never);

      await txService.createOtp({
        transactionId: 'tx-1',
        hdbSerialNumber: 'SN-001',
        agentId: 'agent-1',
      });

      expect(mockTxRepo.createOtp).toHaveBeenCalledTimes(1);
    });

    it('throws ConflictError if OTP already exists for transaction', async () => {
      const tx = makeTransaction();
      const existingOtp = makeOtp();
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockTxRepo.findOtpByTransactionId.mockResolvedValue(existingOtp as never);

      await expect(
        txService.createOtp({ transactionId: 'tx-1', hdbSerialNumber: 'SN-001', agentId: 'agent-1' }),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('advanceOtp', () => {
    it('advances OTP to next status (prepared → sent_to_seller)', async () => {
      const tx = makeTransaction();
      const otp = makeOtp({ status: 'prepared' });
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockTxRepo.findOtpByTransactionId.mockResolvedValue(otp as never);
      mockTxRepo.updateOtpStatus.mockResolvedValue({ ...otp, status: 'sent_to_seller' } as never);

      await txService.advanceOtp({ transactionId: 'tx-1', agentId: 'agent-1' });

      expect(mockTxRepo.updateOtpStatus).toHaveBeenCalledWith('otp-1', 'sent_to_seller', expect.any(Object));
    });

    it('throws ValidationError when trying to advance from terminal state', async () => {
      const tx = makeTransaction();
      const otp = makeOtp({ status: 'exercised' });
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockTxRepo.findOtpByTransactionId.mockResolvedValue(otp as never);

      await expect(
        txService.advanceOtp({ transactionId: 'tx-1', agentId: 'agent-1' }),
      ).rejects.toThrow(ValidationError);
    });

    it('blocks issued_to_buyer transition without agent review', async () => {
      const tx = makeTransaction();
      const otp = makeOtp({ status: 'returned', agentReviewedAt: null });
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockTxRepo.findOtpByTransactionId.mockResolvedValue(otp as never);

      await expect(
        txService.advanceOtp({ transactionId: 'tx-1', agentId: 'agent-1' }),
      ).rejects.toThrow(ValidationError);
    });

    it('sets exerciseDeadline when advancing to issued_to_buyer', async () => {
      const tx = makeTransaction();
      const otp = makeOtp({
        status: 'returned',
        agentReviewedAt: new Date(), // agent has reviewed
      });
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockTxRepo.findOtpByTransactionId.mockResolvedValue(otp as never);
      mockTxRepo.updateOtpStatus.mockResolvedValue({ ...otp, status: 'issued_to_buyer', issuedAt: new Date() } as never);
      mockTxRepo.updateExerciseDeadline.mockResolvedValue(tx as never);
      mockSettings.getNumber.mockResolvedValue(21);

      await txService.advanceOtp({ transactionId: 'tx-1', agentId: 'agent-1' });

      expect(mockTxRepo.updateExerciseDeadline).toHaveBeenCalledTimes(1);
    });
  });

  describe('advanceTransactionStatus', () => {
    it('sets completionDate automatically on transition to completed', async () => {
      const tx = makeTransaction({ status: 'completing' });
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockTxRepo.updateTransactionStatus.mockResolvedValue({ ...tx, status: 'completed', completionDate: new Date() } as never);

      await txService.advanceTransactionStatus({ transactionId: 'tx-1', status: 'completed', agentId: 'agent-1' });

      expect(mockTxRepo.updateTransactionStatus).toHaveBeenCalledWith(
        'tx-1',
        'completed',
        expect.any(Date), // completionDate auto-set
      );
    });

    it('triggers fallen-through cascade when status is fallen_through', async () => {
      const tx = makeTransaction({ status: 'option_issued' });
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockTxRepo.updateTransactionStatus.mockResolvedValue({ ...tx, status: 'fallen_through' } as never);
      mockPortalService.expirePortalListings.mockResolvedValue({ count: 3 } as never);

      await txService.advanceTransactionStatus({ transactionId: 'tx-1', status: 'fallen_through', agentId: 'agent-1' });

      expect(mockPortalService.expirePortalListings).toHaveBeenCalledWith('property-1');
    });
  });

  describe('uploadInvoice', () => {
    it('reads commission amounts from SystemSetting, not schema defaults', async () => {
      const tx = makeTransaction();
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockTxRepo.findInvoiceByTransactionId.mockResolvedValue(null);
      mockSettings.getNumber.mockImplementation(async (key: string) => {
        if (key === 'commission_amount') return 1499;
        if (key === 'gst_rate') return 0.09;
        return 0;
      });
      mockTxRepo.createCommissionInvoice.mockResolvedValue({
        id: 'inv-1',
        amount: '1499',
        gstAmount: '134.91',
        totalAmount: '1633.91',
        status: 'uploaded',
      } as never);

      await txService.uploadInvoice({
        transactionId: 'tx-1',
        fileBuffer: Buffer.from('fake-pdf'),
        originalFilename: 'invoice.pdf',
        invoiceNumber: 'INV-001',
        agentId: 'agent-1',
      });

      // Verify amounts come from SystemSetting
      expect(mockSettings.getNumber).toHaveBeenCalledWith('commission_amount', expect.any(Number));
      expect(mockSettings.getNumber).toHaveBeenCalledWith('gst_rate', expect.any(Number));
      expect(mockTxRepo.createCommissionInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 1499,
          gstAmount: expect.any(Number),
          totalAmount: expect.any(Number),
        }),
      );
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
npm test -- --testPathPattern="transaction.service"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create LocalStorage stub check**

Check how the existing photo service uses local storage:
```bash
grep -n "LocalStorage\|localStorage\|writeFile\|saveFile" src/domains/property/photo.service.ts | head -20
```
```bash
grep -n "export" src/infra/storage/local-storage.ts | head -10
```

Note the `localStorage` singleton API (`save(filePath, buffer): Promise<string>`, `read(filePath): Promise<Buffer>`) — use the same pattern in the transaction service for OTP scans and invoice PDFs. Import the singleton: `import { localStorage } from '@/infra/storage/local-storage'` — do NOT use `new LocalStorage()`.

- [ ] **Step 4: Create transaction service**

Create `src/domains/transaction/transaction.service.ts`:

```typescript
// src/domains/transaction/transaction.service.ts
import { createId } from '@paralleldrive/cuid2';
import * as txRepo from './transaction.repository';
import * as settingsService from '@/domains/shared/settings.service';
import * as notificationService from '@/domains/notification/notification.service';
import * as auditService from '@/domains/shared/audit.service';
import * as portalService from '@/domains/property/portal.service';
import { localStorage } from '@/infra/storage/local-storage';
import { NotFoundError, ValidationError, ConflictError } from '@/domains/shared/errors';
import { OTP_TRANSITIONS } from './transaction.types';
import type { CreateTransactionInput, CreateOtpInput, AdvanceOtpInput, UploadOtpScanInput, UploadInvoiceInput } from './transaction.types';
import path from 'path';

// ── Transaction ────────────────────────────────────────────────────────────────

export async function createTransaction(input: CreateTransactionInput) {
  const tx = await txRepo.createTransaction({
    id: createId(),
    propertyId: input.propertyId,
    sellerId: input.sellerId,
    agreedPrice: input.agreedPrice,
    optionFee: input.optionFee ?? null,
    optionDate: input.optionDate ?? null,
  });

  await auditService.log({
    agentId: input.agentId,
    action: 'transaction.created',
    entityType: 'transaction',
    entityId: tx.id,
    details: { propertyId: input.propertyId, agreedPrice: input.agreedPrice },
  });

  return tx;
}

export async function getTransaction(transactionId: string) {
  const tx = await txRepo.findById(transactionId);
  if (!tx) throw new NotFoundError('Transaction', transactionId);
  return tx;
}

export async function advanceTransactionStatus(input: {
  transactionId: string;
  status: 'option_exercised' | 'completing' | 'completed' | 'fallen_through';
  agentId: string;
}) {
  const tx = await txRepo.findById(input.transactionId);
  if (!tx) throw new NotFoundError('Transaction', input.transactionId);

  const completionDate = input.status === 'completed' ? new Date() : null;

  const updated = await txRepo.updateTransactionStatus(
    input.transactionId,
    input.status,
    completionDate !== null ? completionDate : undefined,
  );

  if (input.status === 'fallen_through') {
    await handleFallenThrough(tx.propertyId, input.transactionId, input.agentId);
  }

  await auditService.log({
    agentId: input.agentId,
    action: 'transaction.status_changed',
    entityType: 'transaction',
    entityId: input.transactionId,
    details: { newStatus: input.status },
  });

  return updated;
}

async function handleFallenThrough(propertyId: string, transactionId: string, agentId: string) {
  // Expire active OTP and portal listings; revert property + listing to draft
  const otp = await txRepo.findOtpByTransactionId(transactionId);
  if (otp && (otp.status !== 'exercised' && otp.status !== 'expired')) {
    await txRepo.updateOtpStatus(otp.id, 'expired', { expiredAt: new Date() });
  }

  await portalService.expirePortalListings(propertyId);

  // Alert agent to manually delist from live portals
  await notificationService.send({
    recipientType: 'agent',
    recipientId: agentId,
    templateName: 'transaction_update',
    templateData: {
      address: propertyId,
      status: 'fallen_through — please delist manually from live portals',
    },
  }, agentId);
}

export async function updateHdbTracking(input: {
  transactionId: string;
  hdbApplicationStatus?: string;
  hdbAppointmentDate?: Date | null;
  agentId: string;
}) {
  const tx = await txRepo.findById(input.transactionId);
  if (!tx) throw new NotFoundError('Transaction', input.transactionId);

  const updated = await txRepo.updateHdbTracking(input.transactionId, {
    hdbApplicationStatus: input.hdbApplicationStatus,
    hdbAppointmentDate: input.hdbAppointmentDate,
  });

  await auditService.log({
    agentId: input.agentId,
    action: 'transaction.hdb_updated',
    entityType: 'transaction',
    entityId: input.transactionId,
    details: { hdbApplicationStatus: input.hdbApplicationStatus },
  });

  return updated;
}

// ── OTP ────────────────────────────────────────────────────────────────────────

export async function createOtp(input: CreateOtpInput) {
  const tx = await txRepo.findById(input.transactionId);
  if (!tx) throw new NotFoundError('Transaction', input.transactionId);

  const existing = await txRepo.findOtpByTransactionId(input.transactionId);
  if (existing) throw new ConflictError('OTP already exists for this transaction');

  const otp = await txRepo.createOtp({
    id: createId(),
    transactionId: input.transactionId,
    hdbSerialNumber: input.hdbSerialNumber,
  });

  await auditService.log({
    agentId: input.agentId,
    action: 'otp.created',
    entityType: 'otp',
    entityId: otp.id,
    details: { transactionId: input.transactionId },
  });

  return otp;
}

export async function advanceOtp(input: AdvanceOtpInput) {
  const tx = await txRepo.findById(input.transactionId);
  if (!tx) throw new NotFoundError('Transaction', input.transactionId);

  const otp = await txRepo.findOtpByTransactionId(input.transactionId);
  if (!otp) throw new NotFoundError('OTP', input.transactionId);

  const nextStatus = OTP_TRANSITIONS[otp.status];
  if (!nextStatus) {
    throw new ValidationError(`OTP status '${otp.status}' is terminal — cannot advance further`);
  }

  // Gate: issued_to_buyer requires agent review first
  if (nextStatus === 'issued_to_buyer' && !otp.agentReviewedAt) {
    throw new ValidationError('Agent must review OTP before issuing to buyer');
  }

  const issuedAt = nextStatus === 'issued_to_buyer' ? (input.issuedAt ?? new Date()) : undefined;
  const exercisedAt = nextStatus === 'exercised' ? new Date() : undefined;

  const updated = await txRepo.updateOtpStatus(otp.id, nextStatus, { issuedAt, exercisedAt });

  // Set exercise deadline on transaction when OTP issued to buyer
  if (nextStatus === 'issued_to_buyer' && issuedAt) {
    const exerciseDays = await settingsService.getNumber('otp_exercise_days', 21);
    const deadline = new Date(issuedAt);
    deadline.setDate(deadline.getDate() + exerciseDays);
    await txRepo.updateExerciseDeadline(input.transactionId, deadline);
  }

  await auditService.log({
    agentId: input.agentId,
    action: 'otp.advanced',
    entityType: 'otp',
    entityId: otp.id,
    details: { from: otp.status, to: nextStatus, notes: input.notes },
  });

  return updated;
}

export async function markOtpReviewed(input: { transactionId: string; notes?: string; agentId: string }) {
  const otp = await txRepo.findOtpByTransactionId(input.transactionId);
  if (!otp) throw new NotFoundError('OTP', input.transactionId);

  const updated = await txRepo.updateOtpReview(otp.id, new Date(), input.notes);

  await auditService.log({
    agentId: input.agentId,
    action: 'otp.reviewed',
    entityType: 'otp',
    entityId: otp.id,
    details: {},
  });

  return updated;
}

export async function uploadOtpScan(input: UploadOtpScanInput) {
  const otp = await txRepo.findOtpByTransactionId(input.transactionId);
  if (!otp) throw new NotFoundError('OTP', input.transactionId);

  // Validate: only pdf/jpg/jpeg/png, max 10MB
  const ext = path.extname(input.originalFilename).toLowerCase();
  if (!['.pdf', '.jpg', '.jpeg', '.png'].includes(ext)) {
    throw new ValidationError('File must be PDF, JPG, JPEG, or PNG');
  }
  if (input.fileBuffer.length > 10 * 1024 * 1024) {
    throw new ValidationError('File must be 10MB or smaller');
  }

  // Use UUID-based filename to prevent path traversal — never use originalFilename as stored name
  const storedFilename = `${input.scanType}-${createId()}${ext}`;
  const storedPath = await localStorage.save(
    `otp/${input.transactionId}/${storedFilename}`,
    input.fileBuffer,
  );

  const updated = await txRepo.updateOtpScanPath(otp.id, input.scanType, storedPath);

  await auditService.log({
    agentId: input.agentId,
    action: 'otp.scan_uploaded',
    entityType: 'otp',
    entityId: otp.id,
    details: { scanType: input.scanType },
  });

  return updated;
}

// ── Commission Invoice ─────────────────────────────────────────────────────────

export async function uploadInvoice(input: UploadInvoiceInput) {
  const tx = await txRepo.findById(input.transactionId);
  if (!tx) throw new NotFoundError('Transaction', input.transactionId);

  const existing = await txRepo.findInvoiceByTransactionId(input.transactionId);
  if (existing) throw new ConflictError('Invoice already exists for this transaction');

  // Validate: only pdf, max 10MB
  const ext = path.extname(input.originalFilename).toLowerCase();
  if (ext !== '.pdf') throw new ValidationError('Invoice must be a PDF file');
  if (input.fileBuffer.length > 10 * 1024 * 1024) throw new ValidationError('File must be 10MB or smaller');

  const storedFilename = `invoice-${createId()}.pdf`;
  const storedPath = await localStorage.save(
    `invoices/${input.transactionId}/${storedFilename}`,
    input.fileBuffer,
  );

  // Always read amounts from SystemSetting — never rely on schema defaults
  const commissionAmount = await settingsService.getNumber('commission_amount', 1499);
  const gstRate = await settingsService.getNumber('gst_rate', 0.09);
  const gstAmount = Math.round(commissionAmount * gstRate * 100) / 100;
  const totalAmount = commissionAmount + gstAmount;

  const invoice = await txRepo.createCommissionInvoice({
    transactionId: input.transactionId,
    invoiceFilePath: storedPath,
    invoiceNumber: input.invoiceNumber,
    amount: commissionAmount,
    gstAmount,
    totalAmount,
  });

  await auditService.log({
    agentId: input.agentId,
    action: 'invoice.uploaded',
    entityType: 'transaction',
    entityId: input.transactionId,
    details: { invoiceNumber: input.invoiceNumber },
  });

  return invoice;
}

export async function sendInvoice(input: { transactionId: string; sellerId: string; agentId: string }) {
  const invoice = await txRepo.findInvoiceByTransactionId(input.transactionId);
  if (!invoice) throw new NotFoundError('CommissionInvoice', input.transactionId);

  await notificationService.send({
    recipientType: 'seller',
    recipientId: input.sellerId,
    templateName: 'invoice_uploaded',
    templateData: { address: input.transactionId },
  }, input.agentId);

  const updated = await txRepo.updateInvoiceStatus(invoice.id, 'sent_to_client', {
    sentAt: new Date(),
    sentVia: 'notification',
  });

  await auditService.log({
    agentId: input.agentId,
    action: 'invoice.sent',
    entityType: 'transaction',
    entityId: input.transactionId,
    details: {},
  });

  return updated;
}

export async function markInvoicePaid(input: { transactionId: string; agentId: string }) {
  const invoice = await txRepo.findInvoiceByTransactionId(input.transactionId);
  if (!invoice) throw new NotFoundError('CommissionInvoice', input.transactionId);

  const updated = await txRepo.updateInvoiceStatus(invoice.id, 'paid', { paidAt: new Date() });

  await auditService.log({
    agentId: input.agentId,
    action: 'invoice.paid',
    entityType: 'transaction',
    entityId: input.transactionId,
    details: {},
  });

  return updated;
}
```

- [ ] **Step 5: Check localStorage API**

Run this to confirm the `localStorage.save` method signature:
```bash
grep -n "async save\|save(" src/infra/storage/local-storage.ts | head -5
```

If the method name or signature differs from `save(relativePath: string, buffer: Buffer): Promise<string>`, adjust the two `localStorage.save()` calls in `uploadOtpScan` and `uploadInvoice` accordingly.

- [ ] **Step 6: Run unit tests**

```bash
npm test -- --testPathPattern="transaction.service"
```

Expected: all tests pass.

- [ ] **Step 7: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/domains/transaction/transaction.service.ts src/domains/transaction/__tests__/transaction.service.test.ts
git commit -m "feat(transaction): add transaction service with OTP lifecycle, invoice upload, and fallen-through cascade"
```

---

### Task 5: Transaction validator and router

**Files:**
- Create: `src/domains/transaction/transaction.validator.ts`
- Create: `src/domains/transaction/transaction.router.ts`
- Create: `src/domains/transaction/__tests__/transaction.router.test.ts`

- [ ] **Step 1: Write the failing router test**

**Pattern note:** Router tests use a local `createTestApp()` that injects `req.user` directly via middleware — do NOT use `createApp()` or session cookies. See `src/domains/offer/__tests__/offer.router.test.ts` for the established pattern.

Create `src/domains/transaction/__tests__/transaction.router.test.ts`:

```typescript
// src/domains/transaction/__tests__/transaction.router.test.ts
import express from 'express';
import request from 'supertest';
import { transactionRouter } from '../transaction.router';
import * as txService from '../transaction.service';

jest.mock('../transaction.service');
jest.mock('express-rate-limit', () => () => (_req: unknown, _res: unknown, next: () => void) => next());
jest.mock('multer', () => {
  const fn = () => ({
    single: () => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
      req.file = { buffer: Buffer.from('fake'), originalname: 'test.pdf', size: 1024 };
      next();
    },
  });
  fn.memoryStorage = () => ({});
  return fn;
});

const mockTxService = jest.mocked(txService);

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    Object.assign(req, {
      isAuthenticated: () => true,
      user: {
        id: 'agent-1',
        role: 'agent',
        name: 'Test Agent',
        email: 'agent@test.com',
        twoFactorEnabled: true,
        twoFactorVerified: true,
      },
    });
    next();
  });
  app.use((_req, res, next) => {
    res.render = ((_view: string, _data?: unknown) => {
      res.json({ rendered: true });
    }) as never;
    next();
  });
  app.use(transactionRouter);
  return app;
}

function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx-1',
    propertyId: 'property-1',
    sellerId: 'seller-1',
    agreedPrice: '600000',
    status: 'option_issued',
    otp: null,
    commissionInvoice: null,
    ...overrides,
  };
}

describe('transaction.router', () => {
  let app: express.Application;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /agent/transactions', () => {
    it('creates transaction and returns 201', async () => {
      mockTxService.createTransaction.mockResolvedValue(makeTx() as never);

      const res = await request(app)
        .post('/agent/transactions')
        .send({ propertyId: 'property-1', sellerId: 'seller-1', agreedPrice: '600000' });

      expect(res.status).toBe(201);
    });

    it('returns 400 for missing required fields', async () => {
      const res = await request(app)
        .post('/agent/transactions')
        .send({ propertyId: 'property-1' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /agent/transactions/:id', () => {
    it('returns 200 with transaction', async () => {
      mockTxService.getTransaction.mockResolvedValue(makeTx() as never);

      const res = await request(app).get('/agent/transactions/tx-1');

      expect(res.status).toBe(200);
    });
  });

  describe('PATCH /agent/transactions/:id/status', () => {
    it('advances transaction status', async () => {
      mockTxService.advanceTransactionStatus.mockResolvedValue(makeTx({ status: 'option_exercised' }) as never);

      const res = await request(app)
        .patch('/agent/transactions/tx-1/status')
        .send({ status: 'option_exercised' });

      expect(res.status).toBe(200);
    });
  });

  describe('POST /agent/transactions/:id/otp', () => {
    it('creates OTP record', async () => {
      mockTxService.createOtp.mockResolvedValue({} as never);

      const res = await request(app)
        .post('/agent/transactions/tx-1/otp')
        .send({ hdbSerialNumber: 'SN-001' });

      expect(res.status).toBe(201);
    });
  });

  describe('POST /agent/transactions/:id/otp/advance', () => {
    it('advances OTP', async () => {
      mockTxService.advanceOtp.mockResolvedValue({} as never);

      const res = await request(app)
        .post('/agent/transactions/tx-1/otp/advance')
        .send({});

      expect(res.status).toBe(200);
    });
  });

  describe('POST /agent/transactions/:id/invoice/upload', () => {
    it('uploads invoice PDF', async () => {
      mockTxService.uploadInvoice.mockResolvedValue({} as never);

      const res = await request(app)
        .post('/agent/transactions/tx-1/invoice/upload')
        .field('invoiceNumber', 'INV-001')
        .attach('invoice', Buffer.from('fake-pdf'), 'invoice.pdf');

      expect(res.status).toBe(201);
    });
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
npm test -- --testPathPattern="transaction.router"
```

Expected: FAIL.

- [ ] **Step 3: Create transaction validator**

Create `src/domains/transaction/transaction.validator.ts`:

```typescript
// src/domains/transaction/transaction.validator.ts
import { body, param } from 'express-validator';

export const validateCreateTransaction = [
  body('propertyId').notEmpty().withMessage('propertyId is required'),
  body('sellerId').notEmpty().withMessage('sellerId is required'),
  body('agreedPrice').notEmpty().isNumeric().withMessage('agreedPrice must be a number'),
];

export const validateAdvanceStatus = [
  param('id').notEmpty().withMessage('transactionId is required'),
  body('status')
    .notEmpty()
    .isIn(['option_exercised', 'completing', 'completed', 'fallen_through'])
    .withMessage('status must be a valid transaction status'),
];

export const validateCreateOtp = [
  param('id').notEmpty().withMessage('transactionId is required'),
  body('hdbSerialNumber').notEmpty().withMessage('hdbSerialNumber is required'),
];

export const validateUploadInvoice = [
  param('id').notEmpty().withMessage('transactionId is required'),
  body('invoiceNumber').notEmpty().withMessage('invoiceNumber is required'),
];

export const validateUpdateHdb = [
  param('id').notEmpty().withMessage('transactionId is required'),
];

export const validateSendInvoice = [
  param('id').notEmpty().withMessage('transactionId is required'),
  body('sellerId').notEmpty().withMessage('sellerId is required'),
];
```

- [ ] **Step 4: Create transaction router**

Create `src/domains/transaction/transaction.router.ts`:

```typescript
// src/domains/transaction/transaction.router.ts
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { validationResult } from 'express-validator';
import * as txService from './transaction.service';
import {
  validateCreateTransaction,
  validateAdvanceStatus,
  validateCreateOtp,
  validateUploadInvoice,
  validateUpdateHdb,
  validateSendInvoice,
} from './transaction.validator';
import { requireAuth, requireRole, requireTwoFactor } from '@/infra/http/middleware/require-auth';
import { localStorage } from '@/infra/storage/local-storage';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';

export const transactionRouter = Router();

const agentAuth = [requireAuth(), requireRole('agent', 'admin'), requireTwoFactor()];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// POST /agent/transactions — create transaction
transactionRouter.post(
  '/agent/transactions',
  ...agentAuth,
  ...validateCreateTransaction,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const user = req.user as AuthenticatedUser;
      const tx = await txService.createTransaction({
        propertyId: req.body.propertyId as string,
        sellerId: req.body.sellerId as string,
        agreedPrice: Number(req.body.agreedPrice),
        optionFee: req.body.optionFee ? Number(req.body.optionFee) : undefined,
        optionDate: req.body.optionDate ? new Date(req.body.optionDate as string) : undefined,
        agentId: user.id,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/transaction-row', { tx });
      }
      res.status(201).json({ tx });
    } catch (err) {
      next(err);
    }
  },
);

// GET /agent/transactions/:id — transaction detail
transactionRouter.get(
  '/agent/transactions/:id',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tx = await txService.getTransaction(req.params['id'] as string);

      if (req.headers['hx-request']) {
        return res.render('partials/agent/transaction-detail', { tx });
      }
      res.render('pages/agent/transaction', { tx });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /agent/transactions/:id/status — advance transaction status
transactionRouter.patch(
  '/agent/transactions/:id/status',
  ...agentAuth,
  ...validateAdvanceStatus,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const user = req.user as AuthenticatedUser;
      const tx = await txService.advanceTransactionStatus({
        transactionId: req.params['id'] as string,
        status: req.body.status as 'option_exercised' | 'completing' | 'completed' | 'fallen_through',
        agentId: user.id,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/transaction-detail', { tx });
      }
      res.json({ tx });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /agent/transactions/:id/hdb — update HDB tracking
transactionRouter.patch(
  '/agent/transactions/:id/hdb',
  ...agentAuth,
  ...validateUpdateHdb,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const user = req.user as AuthenticatedUser;
      const tx = await txService.updateHdbTracking({
        transactionId: req.params['id'] as string,
        hdbApplicationStatus: req.body.hdbApplicationStatus as string | undefined,
        hdbAppointmentDate: req.body.hdbAppointmentDate
          ? new Date(req.body.hdbAppointmentDate as string)
          : undefined,
        agentId: user.id,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/transaction-hdb', { tx });
      }
      res.json({ tx });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/transactions/:id/otp — create OTP record
transactionRouter.post(
  '/agent/transactions/:id/otp',
  ...agentAuth,
  ...validateCreateOtp,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const user = req.user as AuthenticatedUser;
      const otp = await txService.createOtp({
        transactionId: req.params['id'] as string,
        hdbSerialNumber: req.body.hdbSerialNumber as string,
        agentId: user.id,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/otp-panel', { otp });
      }
      res.status(201).json({ otp });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/transactions/:id/otp/advance — advance OTP to next step
transactionRouter.post(
  '/agent/transactions/:id/otp/advance',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const otp = await txService.advanceOtp({
        transactionId: req.params['id'] as string,
        notes: req.body.notes as string | undefined,
        issuedAt: req.body.issuedAt ? new Date(req.body.issuedAt as string) : undefined,
        agentId: user.id,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/otp-panel', { otp });
      }
      res.json({ otp });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/transactions/:id/otp/scan/:scanType — upload OTP scan
transactionRouter.post(
  '/agent/transactions/:id/otp/scan/:scanType',
  ...agentAuth,
  upload.single('scan'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      const scanType = req.params['scanType'] as 'seller' | 'returned';
      if (!['seller', 'returned'].includes(scanType)) {
        return res.status(400).json({ error: 'scanType must be seller or returned' });
      }

      const user = req.user as AuthenticatedUser;
      const otp = await txService.uploadOtpScan({
        transactionId: req.params['id'] as string,
        scanType,
        fileBuffer: req.file.buffer,
        originalFilename: req.file.originalname,
        agentId: user.id,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/otp-panel', { otp });
      }
      res.json({ otp });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/transactions/:id/otp/review — mark agent review complete
transactionRouter.post(
  '/agent/transactions/:id/otp/review',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const otp = await txService.markOtpReviewed({
        transactionId: req.params['id'] as string,
        notes: req.body.notes as string | undefined,
        agentId: user.id,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/otp-panel', { otp });
      }
      res.json({ otp });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/transactions/:id/invoice/upload — upload commission invoice PDF
transactionRouter.post(
  '/agent/transactions/:id/invoice/upload',
  ...agentAuth,
  upload.single('invoice'),
  ...validateUploadInvoice,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      const user = req.user as AuthenticatedUser;
      const invoice = await txService.uploadInvoice({
        transactionId: req.params['id'] as string,
        fileBuffer: req.file.buffer,
        originalFilename: req.file.originalname,
        invoiceNumber: req.body.invoiceNumber as string,
        agentId: user.id,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/invoice-panel', { invoice });
      }
      res.status(201).json({ invoice });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/transactions/:id/invoice/send — send invoice to client
transactionRouter.post(
  '/agent/transactions/:id/invoice/send',
  ...agentAuth,
  ...validateSendInvoice,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const user = req.user as AuthenticatedUser;
      const invoice = await txService.sendInvoice({
        transactionId: req.params['id'] as string,
        sellerId: req.body.sellerId as string,
        agentId: user.id,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/invoice-panel', { invoice });
      }
      res.json({ invoice });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/transactions/:id/invoice/paid — mark invoice as paid
transactionRouter.post(
  '/agent/transactions/:id/invoice/paid',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const invoice = await txService.markInvoicePaid({
        transactionId: req.params['id'] as string,
        agentId: user.id,
      });

      if (req.headers['hx-request']) {
        return res.render('partials/agent/invoice-panel', { invoice });
      }
      res.json({ invoice });
    } catch (err) {
      next(err);
    }
  },
);

// GET /agent/transactions/:id/invoice/file — authenticated file download
transactionRouter.get(
  '/agent/transactions/:id/invoice/file',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const invoice = await txService.getTransaction(req.params['id'] as string);
      const invoicePath = (invoice as { commissionInvoice?: { invoiceFilePath?: string | null } }).commissionInvoice?.invoiceFilePath;
      if (!invoicePath) return res.status(404).json({ error: 'No invoice file found' });

      // Files are served through this authenticated route — never directly via nginx
      // localStorage.read() resolves the full absolute path internally
      const buffer = await localStorage.read(invoicePath);
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="invoice-${req.params['id']}.pdf"`);
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 5: Mount transaction router in app**

In `src/infra/http/app.ts`, add:
```typescript
import { transactionRouter } from '../../domains/transaction/transaction.router';
```

Inside `createApp()`, add **after `app.use(adminRouter)` and before `app.use(errorHandler)`**:
```typescript
app.use(transactionRouter);
```

- [ ] **Step 6: Create minimal view stubs**

Create `src/views/pages/agent/transaction.njk`:
```njk
{# pages/agent/transaction.njk #}
{% extends "layouts/agent.njk" %}
{% block content %}
<h1>{{ "Transaction" | t }}</h1>
{% include "partials/agent/transaction-detail.njk" %}
{% endblock %}
```

Create `src/views/partials/agent/transaction-detail.njk`:
```njk
{# partials/agent/transaction-detail.njk #}
<div class="transaction-detail" data-tx-id="{{ tx.id }}">
  <p>Status: {{ tx.status }}</p>
  {% if tx.otp %}{% include "partials/agent/otp-panel.njk" %}{% endif %}
  {% if tx.commissionInvoice %}{% include "partials/agent/invoice-panel.njk" %}{% endif %}
</div>
```

Create `src/views/partials/agent/otp-panel.njk`:
```njk
{# partials/agent/otp-panel.njk #}
<div class="otp-panel" data-otp-id="{{ otp.id }}">
  <p>OTP Status: {{ otp.status }}</p>
  <p>Serial: {{ otp.hdbSerialNumber }}</p>
</div>
```

Create `src/views/partials/agent/invoice-panel.njk`:
```njk
{# partials/agent/invoice-panel.njk #}
<div class="invoice-panel" data-invoice-id="{{ invoice.id }}">
  <p>Invoice Status: {{ invoice.status }}</p>
  <p>Invoice #: {{ invoice.invoiceNumber }}</p>
</div>
```

Create `src/views/partials/agent/transaction-row.njk`:
```njk
{# partials/agent/transaction-row.njk #}
<div class="transaction-row" data-tx-id="{{ tx.id }}">
  <span>{{ tx.propertyId }} — {{ tx.agreedPrice }}</span>
  <span class="status">{{ tx.status }}</span>
</div>
```

Create `src/views/partials/agent/transaction-hdb.njk`:
```njk
{# partials/agent/transaction-hdb.njk #}
<div class="hdb-status" data-tx-id="{{ tx.id }}">
  <p>HDB Status: {{ tx.hdbApplicationStatus }}</p>
</div>
```

- [ ] **Step 7: Run the router tests**

```bash
npm test -- --testPathPattern="transaction.router"
```

Expected: all tests pass.

- [ ] **Step 8: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/domains/transaction/ src/views/pages/agent/transaction.njk src/views/partials/agent/transaction-detail.njk src/views/partials/agent/otp-panel.njk src/views/partials/agent/invoice-panel.njk src/views/partials/agent/transaction-row.njk src/views/partials/agent/transaction-hdb.njk src/infra/http/app.ts
git commit -m "feat(transaction): add transaction validator, router, views, and app mounting"
```

---

## Chunk 3: Cron Jobs

### Task 6: Transaction jobs — OTP reminders and post-completion sequence

**Files:**
- Create: `src/domains/transaction/transaction.jobs.ts`
- Create: `src/domains/transaction/__tests__/transaction.jobs.test.ts`
- Modify: `src/server.ts`

**Pattern:** Follows `src/domains/viewing/viewing.jobs.ts` — exports a `registerTransactionJobs()` function, calls `registerJob()` from `@/infra/jobs/runner`, imported and called in `src/server.ts`.

- [ ] **Step 1: Write failing unit tests for jobs**

Create `src/domains/transaction/__tests__/transaction.jobs.test.ts`:

```typescript
// src/domains/transaction/__tests__/transaction.jobs.test.ts
import * as txRepo from '../transaction.repository';
import * as notificationService from '@/domains/notification/notification.service';
import * as txJobs from '../transaction.jobs';

jest.mock('../transaction.repository');
jest.mock('@/domains/notification/notification.service');
jest.mock('@/infra/jobs/runner');

const mockTxRepo = jest.mocked(txRepo);
const mockNotification = jest.mocked(notificationService);

function makeOtpWithTransaction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'otp-1',
    transactionId: 'tx-1',
    status: 'issued_to_buyer' as const,
    transaction: {
      id: 'tx-1',
      sellerId: 'seller-1',
      exerciseDeadline: null,
      seller: { id: 'seller-1', notificationPreference: 'in_app' },
    },
    ...overrides,
  };
}

function makeCompletedTransaction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx-1',
    sellerId: 'seller-1',
    completionDate: new Date(),
    seller: {
      id: 'seller-1',
      notificationPreference: 'in_app',
      consentMarketing: false,
    },
    ...overrides,
  };
}

describe('transaction.jobs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNotification.send.mockResolvedValue(undefined as never);
    // Default: no existing notification (allow sends)
    mockTxRepo.findExistingNotification.mockResolvedValue(null as never);
  });

  describe('sendOtpExerciseReminders', () => {
    it('sends reminder when deadline is exactly 14 days away', async () => {
      const deadline = new Date();
      deadline.setDate(deadline.getDate() + 14);

      const otpWithTx = makeOtpWithTransaction({
        transaction: {
          id: 'tx-1',
          sellerId: 'seller-1',
          exerciseDeadline: deadline,
          seller: { id: 'seller-1', notificationPreference: 'in_app' },
        },
      });

      mockTxRepo.findOtpsIssuedToBuyer.mockResolvedValue([otpWithTx] as never);
      // findExistingNotification returns null by default (set in beforeEach)

      await txJobs.sendOtpExerciseReminders();

      expect(mockNotification.send).toHaveBeenCalledTimes(1);
    });

    it('does NOT send reminder for a deadline that is 10 days away (not a reminder day)', async () => {
      const deadline = new Date();
      deadline.setDate(deadline.getDate() + 10);

      const otpWithTx = makeOtpWithTransaction({
        transaction: {
          id: 'tx-1',
          sellerId: 'seller-1',
          exerciseDeadline: deadline,
          seller: { id: 'seller-1', notificationPreference: 'in_app' },
        },
      });

      mockTxRepo.findOtpsIssuedToBuyer.mockResolvedValue([otpWithTx] as never);

      await txJobs.sendOtpExerciseReminders();

      expect(mockNotification.send).not.toHaveBeenCalled();
    });

    it('does NOT send duplicate reminder when notification already exists', async () => {
      const deadline = new Date();
      deadline.setDate(deadline.getDate() + 7);

      const otpWithTx = makeOtpWithTransaction({
        transaction: {
          id: 'tx-1',
          sellerId: 'seller-1',
          exerciseDeadline: deadline,
          seller: { id: 'seller-1', notificationPreference: 'in_app' },
        },
      });

      mockTxRepo.findOtpsIssuedToBuyer.mockResolvedValue([otpWithTx] as never);
      // Simulate existing notification (duplicate check)
      mockTxRepo.findExistingNotification.mockResolvedValue({ id: 'notif-1' } as never);

      await txJobs.sendOtpExerciseReminders();

      expect(mockNotification.send).not.toHaveBeenCalled();
    });
  });

  describe('sendPostCompletionMessages', () => {
    it('sends thank-you message on day 1 after completion', async () => {
      const tx = makeCompletedTransaction();
      mockTxRepo.findTransactionsCompletedDaysAgo.mockResolvedValue([tx] as never);
      // findExistingNotification returns null by default (set in beforeEach)

      await txJobs.sendPostCompletionMessages();

      // Should be called at least once (for the day-1 thank-you)
      expect(mockNotification.send).toHaveBeenCalled();
    });

    it('does NOT send day-14 buyer follow-up without marketing consent', async () => {
      const tx = makeCompletedTransaction({
        seller: {
          id: 'seller-1',
          notificationPreference: 'in_app',
          consentMarketing: false, // no marketing consent
        },
      });

      // Simulate: only day-14 transactions returned
      mockTxRepo.findTransactionsCompletedDaysAgo.mockImplementation(async (days) => {
        if (days === 14) return [tx] as never;
        return [] as never;
      });

      // findExistingNotification returns null by default (set in beforeEach)

      await txJobs.sendPostCompletionMessages();

      expect(mockNotification.send).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
npm test -- --testPathPattern="transaction.jobs"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create transaction jobs**

Create `src/domains/transaction/transaction.jobs.ts`:

```typescript
// src/domains/transaction/transaction.jobs.ts
import { registerJob } from '@/infra/jobs/runner';
import * as txRepo from './transaction.repository';
import * as notificationService from '@/domains/notification/notification.service';

const OTP_REMINDER_DAYS = [14, 7, 3, 1];

/**
 * Checks all OTPs issued to buyer and sends exercise deadline reminders.
 * Deduplication: checks Notification table before sending to prevent re-sends on cron re-runs.
 */
export async function sendOtpExerciseReminders(): Promise<void> {
  const otps = await txRepo.findOtpsIssuedToBuyer();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const otp of otps) {
    const tx = otp.transaction as { id: string; sellerId: string; exerciseDeadline: Date | null; seller: { notificationPreference: string } };
    if (!tx.exerciseDeadline) continue;

    const deadline = new Date(tx.exerciseDeadline);
    deadline.setHours(0, 0, 0, 0);
    const daysUntil = Math.round((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (!OTP_REMINDER_DAYS.includes(daysUntil)) continue;

    // Deduplication: check if we already sent this reminder
    const templateName = `otp_exercise_reminder_${daysUntil}d`;
    const existing = await txRepo.findExistingNotification(templateName, tx.sellerId);
    if (existing) continue;

    // Use the specific templateName so the dedup check finds it next time
    await notificationService.send({
      recipientType: 'seller',
      recipientId: tx.sellerId,
      templateName: templateName as never,
      templateData: {
        address: tx.id,
        status: `OTP exercise deadline is in ${daysUntil} day(s). Please contact your buyer.`,
      },
    }, 'system');
  }
}

/**
 * Post-completion sequence: day 1 (thank-you), day 7 (testimonial), day 14 (buyer follow-up).
 * Deduplication: checks Notification table before sending.
 * Day 14 requires active marketing consent.
 */
export async function sendPostCompletionMessages(): Promise<void> {
  const sequences: Array<{
    daysAgo: number;
    messageKey: string;
    requiresMarketing: boolean;
  }> = [
    { daysAgo: 1, messageKey: 'post_completion_day1', requiresMarketing: false },
    { daysAgo: 7, messageKey: 'post_completion_day7', requiresMarketing: false },
    { daysAgo: 14, messageKey: 'post_completion_day14', requiresMarketing: true },
  ];

  for (const seq of sequences) {
    const transactions = await txRepo.findTransactionsCompletedDaysAgo(seq.daysAgo);

    for (const tx of transactions) {
      const seller = tx.seller as { id: string; notificationPreference: string; consentMarketing: boolean };

      // Day 14: block without marketing consent
      if (seq.requiresMarketing && !seller.consentMarketing) continue;

      // Deduplication check — must match the templateName stored in the Notification record
      const existing = await txRepo.findExistingNotification(seq.messageKey, seller.id);
      if (existing) continue;

      // Use seq.messageKey as templateName so the dedup check finds it next time
      await notificationService.send({
        recipientType: 'seller',
        recipientId: seller.id,
        templateName: seq.messageKey as never,
        templateData: {
          address: tx.id,
          status: seq.messageKey,
        },
      }, 'system');
    }
  }
}

export function registerTransactionJobs(): void {
  registerJob(
    'transaction:otp-exercise-reminders',
    '0 9 * * *',
    () => sendOtpExerciseReminders(),
    'Asia/Singapore',
  );

  registerJob(
    'transaction:post-completion-messages',
    '0 9 * * *',
    () => sendPostCompletionMessages(),
    'Asia/Singapore',
  );
}
```

- [ ] **Step 4: Register transaction jobs in server.ts**

In `src/server.ts`, add:
```typescript
import { registerTransactionJobs } from './domains/transaction/transaction.jobs';
```

After `registerViewingJobs();`, add:
```typescript
registerTransactionJobs();
```

- [ ] **Step 5: Run jobs unit tests**

```bash
npm test -- --testPathPattern="transaction.jobs"
```

Expected: all tests pass.

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/domains/transaction/transaction.jobs.ts src/domains/transaction/__tests__/transaction.jobs.test.ts src/server.ts
git commit -m "feat(transaction): add OTP reminder and post-completion cron jobs"
```

---

## Chunk 4: Integration Tests and Final Verification

### Task 7: Integration tests — full transaction lifecycle

**Files:**
- Create: `tests/integration/transaction.test.ts`

**Prerequisite:** `factory.transaction()`, `factory.otp()`, and `factory.commissionInvoice()` must be added to `tests/fixtures/factory.ts` (done in Chunk 1, Task 3, Step 3).

- [ ] **Step 1: Create transaction integration test**

Create `tests/integration/transaction.test.ts`:

```typescript
// tests/integration/transaction.test.ts
import { factory } from '../fixtures/factory';
import { testPrisma } from '../helpers/prisma';
import * as txService from '../../src/domains/transaction/transaction.service';
import * as notificationService from '../../src/domains/notification/notification.service';

jest.mock('../../src/domains/notification/notification.service');
jest.mock('../../src/infra/storage/local-storage', () => ({
  localStorage: {
    save: jest.fn().mockResolvedValue('/uploads/test/file.pdf'),
    read: jest.fn().mockResolvedValue(Buffer.from('mock-pdf')),
  },
}));
jest.mock('../../src/domains/property/portal.service');

const mockNotification = jest.mocked(notificationService);

describe('transaction integration', () => {
  let agentId: string;
  let sellerId: string;
  let propertyId: string;

  beforeEach(async () => {
    await testPrisma.commissionInvoice.deleteMany();
    await testPrisma.otp.deleteMany();
    await testPrisma.transaction.deleteMany();
    await testPrisma.property.deleteMany();
    await testPrisma.seller.deleteMany();
    await testPrisma.agent.deleteMany();
    await testPrisma.systemSetting.deleteMany();

    mockNotification.send.mockResolvedValue(undefined as never);

    const agent = await factory.agent();
    agentId = agent.id;
    const seller = await factory.seller({ agentId });
    sellerId = seller.id;
    const property = await factory.property({ sellerId });
    propertyId = property.id;

    await testPrisma.systemSetting.createMany({
      data: [
        { id: 's1', key: 'commission_amount', value: '1499', description: 'test' },
        { id: 's2', key: 'gst_rate', value: '0.09', description: 'test' },
        { id: 's3', key: 'otp_exercise_days', value: '21', description: 'test' },
      ],
    });
  });

  it('creates a transaction', async () => {
    const tx = await txService.createTransaction({
      propertyId,
      sellerId,
      agreedPrice: 600000,
      agentId,
    });

    expect(tx.id).toBeDefined();
    expect(tx.status).toBe('option_issued');

    const persisted = await testPrisma.transaction.findUnique({ where: { id: tx.id } });
    expect(persisted?.status).toBe('option_issued');
  });

  it('OTP: creates OTP, rejects double-creation', async () => {
    const tx = await factory.transaction({ propertyId, sellerId });

    await txService.createOtp({ transactionId: tx.id, hdbSerialNumber: 'SN-001', agentId });

    await expect(
      txService.createOtp({ transactionId: tx.id, hdbSerialNumber: 'SN-002', agentId }),
    ).rejects.toThrow('OTP already exists');
  });

  it('OTP: advances status strictly sequentially', async () => {
    const tx = await factory.transaction({ propertyId, sellerId });
    await factory.otp({ transactionId: tx.id, status: 'prepared' });

    await txService.advanceOtp({ transactionId: tx.id, agentId });

    const otp = await testPrisma.otp.findFirst({ where: { transactionId: tx.id } });
    expect(otp?.status).toBe('sent_to_seller');
  });

  it('OTP: blocks issued_to_buyer without agent review', async () => {
    const tx = await factory.transaction({ propertyId, sellerId });
    await factory.otp({ transactionId: tx.id, status: 'returned', agentReviewedAt: null });

    await expect(
      txService.advanceOtp({ transactionId: tx.id, agentId }),
    ).rejects.toThrow('must review OTP');
  });

  it('OTP: sets exerciseDeadline when advancing to issued_to_buyer', async () => {
    const tx = await factory.transaction({ propertyId, sellerId });
    await factory.otp({
      transactionId: tx.id,
      status: 'returned',
      agentReviewedAt: new Date(),
    });

    await txService.advanceOtp({ transactionId: tx.id, agentId });

    const updated = await testPrisma.transaction.findUnique({ where: { id: tx.id } });
    expect(updated?.exerciseDeadline).not.toBeNull();
  });

  it('invoice: reads amounts from SystemSetting not schema defaults', async () => {
    const tx = await factory.transaction({ propertyId, sellerId });

    const invoice = await txService.uploadInvoice({
      transactionId: tx.id,
      fileBuffer: Buffer.from('fake-pdf'),
      originalFilename: 'invoice.pdf',
      invoiceNumber: 'INV-001',
      agentId,
    });

    expect(Number(invoice.amount)).toBe(1499);
    expect(Number(invoice.gstAmount)).toBeCloseTo(134.91, 1);
    expect(Number(invoice.totalAmount)).toBeCloseTo(1633.91, 1);
  });

  it('completionDate auto-set on transition to completed', async () => {
    const tx = await factory.transaction({ propertyId, sellerId, status: 'completing' });

    await txService.advanceTransactionStatus({
      transactionId: tx.id,
      status: 'completed',
      agentId,
    });

    const updated = await testPrisma.transaction.findUnique({ where: { id: tx.id } });
    expect(updated?.completionDate).not.toBeNull();
  });

  it('fallen-through cascade: expires OTP and portal listings', async () => {
    const tx = await factory.transaction({ propertyId, sellerId });
    await factory.otp({ transactionId: tx.id, status: 'issued_to_buyer' });

    await txService.advanceTransactionStatus({
      transactionId: tx.id,
      status: 'fallen_through',
      agentId,
    });

    const otp = await testPrisma.otp.findFirst({ where: { transactionId: tx.id } });
    expect(otp?.status).toBe('expired');
  });

  it('OTP: uploadOtpScan stores seller scan path', async () => {
    const tx = await factory.transaction({ propertyId, sellerId });
    await factory.otp({ transactionId: tx.id, status: 'signed_by_seller' });

    await txService.uploadOtpScan({
      transactionId: tx.id,
      scanType: 'seller',
      fileBuffer: Buffer.from('fake-scan'),
      originalFilename: 'signed.pdf',
      agentId,
    });

    const otp = await testPrisma.otp.findFirst({ where: { transactionId: tx.id } });
    expect(otp?.scannedCopyPathSeller).not.toBeNull();
  });

  it('OTP: uploadOtpScan stores returned scan path', async () => {
    const tx = await factory.transaction({ propertyId, sellerId });
    await factory.otp({
      transactionId: tx.id,
      status: 'returned',
      scannedCopyPathSeller: 'otp/tx-1/seller.pdf',
    });

    await txService.uploadOtpScan({
      transactionId: tx.id,
      scanType: 'returned',
      fileBuffer: Buffer.from('fake-scan'),
      originalFilename: 'returned.pdf',
      agentId,
    });

    const otp = await testPrisma.otp.findFirst({ where: { transactionId: tx.id } });
    expect(otp?.scannedCopyPathReturned).not.toBeNull();
  });

  it('invoice: sendInvoice updates status to sent_to_client', async () => {
    const tx = await factory.transaction({ propertyId, sellerId });
    const invoice = await factory.commissionInvoice({
      transactionId: tx.id,
      status: 'uploaded',
      invoiceFilePath: '/uploads/invoices/test.pdf',
    });

    await txService.sendInvoice({ transactionId: tx.id, sellerId, agentId });

    const updated = await testPrisma.commissionInvoice.findUnique({ where: { id: invoice.id } });
    expect(updated?.status).toBe('sent_to_client');
  });
});
```

- [ ] **Step 2: Run integration tests**

```bash
npm run test:integration -- --testPathPattern="transaction" --runInBand
```

Expected: all tests pass.

- [ ] **Step 3: Run all tests**

```bash
npm test && npm run test:integration -- --runInBand
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/transaction.test.ts
git commit -m "test(transaction): add integration tests for full transaction lifecycle"
```

---

### Task 8: Notification templates + final verification

**Files:**
- Modify: `src/domains/notification/notification.types.ts`
- Modify: `src/domains/notification/notification.templates.ts`

The transaction service uses `transaction_update` and `invoice_uploaded` for agent-visible events. The cron jobs use specific per-message keys for deduplication: `otp_exercise_reminder_14d`, `otp_exercise_reminder_7d`, `otp_exercise_reminder_3d`, `otp_exercise_reminder_1d`, `post_completion_day1`, `post_completion_day7`, `post_completion_day14`.

- [ ] **Step 1: Check and add missing template names**

```bash
grep -n "transaction_update\|invoice_uploaded\|otp_exercise_reminder\|post_completion" src/domains/notification/notification.types.ts
```

Add any missing keys to the `NotificationTemplateName` union in `src/domains/notification/notification.types.ts`:
```typescript
// Add these inside the union (after 'offer_analysis_shared'):
| 'otp_exercise_reminder_14d'
| 'otp_exercise_reminder_7d'
| 'otp_exercise_reminder_3d'
| 'otp_exercise_reminder_1d'
| 'post_completion_day1'
| 'post_completion_day7'
| 'post_completion_day14'
```

Then add corresponding entries in `src/domains/notification/notification.templates.ts` following the existing pattern. Content can be simple (the dedup logic is what matters, not the template body for these cron-only notifications):
```typescript
otp_exercise_reminder_14d: { whatsapp: '...', email: '...', inApp: 'OTP exercise deadline is in 14 days.' },
// ... repeat for 7d, 3d, 1d
post_completion_day1: { whatsapp: '...', email: '...', inApp: 'Thank you for completing your sale with us!' },
post_completion_day7: { whatsapp: '...', email: '...', inApp: 'Share your experience — leave us a testimonial!' },
post_completion_day14: { whatsapp: '...', email: '...', inApp: 'Considering buying again? We can help with your next purchase.' },
```

- [ ] **Step 2: Run full test suite one final time**

```bash
npm test && npm run test:integration -- --runInBand
```

Expected: all tests pass.

- [ ] **Step 3: Final commit**

```bash
git add src/domains/notification/
git commit -m "feat(transaction): SP2 complete — transaction domain, OTP lifecycle, invoice, and cron jobs"
```
