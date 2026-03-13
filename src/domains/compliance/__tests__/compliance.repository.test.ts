// src/domains/compliance/__tests__/compliance.repository.test.ts
import * as complianceRepo from '../compliance.repository';

jest.mock('@/infra/database/prisma', () => ({
  prisma: {
    testimonial: {
      deleteMany: jest.fn(),
    },
    otp: {
      deleteMany: jest.fn(),
      findUnique: jest.fn(),
    },
    commissionInvoice: {
      deleteMany: jest.fn(),
      findUnique: jest.fn(),
    },
    transaction: {
      delete: jest.fn(),
    },
    cddRecord: {
      create: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

import { prisma } from '@/infra/database/prisma';

const mockPrisma = prisma as jest.Mocked<typeof prisma> & {
  testimonial: { deleteMany: jest.Mock };
  otp: { deleteMany: jest.Mock; findUnique: jest.Mock };
  commissionInvoice: { deleteMany: jest.Mock; findUnique: jest.Mock };
  transaction: { delete: jest.Mock };
  cddRecord: { create: jest.Mock; updateMany: jest.Mock };
};

beforeEach(() => jest.clearAllMocks());

// ─── Light smoke test ─────────────────────────────────────────────────────────

// This is a light smoke test — full DB tests are in tests/integration/
describe('compliance.repository', () => {
  it('exports expected functions', () => {
    expect(typeof complianceRepo.createConsentRecord).toBe('function');
    expect(typeof complianceRepo.findLatestConsentRecord).toBe('function');
    expect(typeof complianceRepo.createDeletionRequest).toBe('function');
    expect(typeof complianceRepo.findDeletionRequest).toBe('function');
    expect(typeof complianceRepo.updateDeletionRequest).toBe('function');
    expect(typeof complianceRepo.findPendingDeletionRequests).toBe('function');
  });
});

// ─── hardDeleteTransaction ────────────────────────────────────────────────────

describe('hardDeleteTransaction', () => {
  const TX_ID = 'tx-001';

  beforeEach(() => {
    mockPrisma.testimonial.deleteMany.mockResolvedValue({ count: 0 } as never);
    mockPrisma.otp.deleteMany.mockResolvedValue({ count: 0 } as never);
    mockPrisma.commissionInvoice.deleteMany.mockResolvedValue({ count: 0 } as never);
    mockPrisma.transaction.delete.mockResolvedValue({} as never);
  });

  it('deletes Testimonial before Transaction to avoid FK violation', async () => {
    const order: string[] = [];
    mockPrisma.testimonial.deleteMany.mockImplementation(async () => {
      order.push('testimonial');
      return { count: 1 } as never;
    });
    mockPrisma.transaction.delete.mockImplementation(async () => {
      order.push('transaction');
      return {} as never;
    });

    await complianceRepo.hardDeleteTransaction(TX_ID);

    expect(order.indexOf('testimonial')).toBeLessThan(order.indexOf('transaction'));
  });

  it('deletes Otp before Transaction to avoid FK violation', async () => {
    const order: string[] = [];
    mockPrisma.otp.deleteMany.mockImplementation(async () => {
      order.push('otp');
      return { count: 1 } as never;
    });
    mockPrisma.transaction.delete.mockImplementation(async () => {
      order.push('transaction');
      return {} as never;
    });

    await complianceRepo.hardDeleteTransaction(TX_ID);

    expect(order.indexOf('otp')).toBeLessThan(order.indexOf('transaction'));
  });

  it('deletes CommissionInvoice before Transaction to avoid FK violation', async () => {
    const order: string[] = [];
    mockPrisma.commissionInvoice.deleteMany.mockImplementation(async () => {
      order.push('commissionInvoice');
      return { count: 1 } as never;
    });
    mockPrisma.transaction.delete.mockImplementation(async () => {
      order.push('transaction');
      return {} as never;
    });

    await complianceRepo.hardDeleteTransaction(TX_ID);

    expect(order.indexOf('commissionInvoice')).toBeLessThan(order.indexOf('transaction'));
  });

  it('calls each deleteMany with the correct transactionId filter', async () => {
    await complianceRepo.hardDeleteTransaction(TX_ID);

    expect(mockPrisma.testimonial.deleteMany).toHaveBeenCalledWith({ where: { transactionId: TX_ID } });
    expect(mockPrisma.otp.deleteMany).toHaveBeenCalledWith({ where: { transactionId: TX_ID } });
    expect(mockPrisma.commissionInvoice.deleteMany).toHaveBeenCalledWith({ where: { transactionId: TX_ID } });
    expect(mockPrisma.transaction.delete).toHaveBeenCalledWith({ where: { id: TX_ID } });
  });
});

// ─── collectTransactionFilePaths ─────────────────────────────────────────────

describe('collectTransactionFilePaths', () => {
  const TX_ID = 'tx-002';

  it('returns OTP scanned copy paths when both are set', async () => {
    mockPrisma.otp.findUnique.mockResolvedValue({
      scannedCopyPathSeller: 'otp/tx-002/seller.pdf',
      scannedCopyPathReturned: 'otp/tx-002/returned.pdf',
    } as never);
    mockPrisma.commissionInvoice.findUnique.mockResolvedValue(null);

    const paths = await complianceRepo.collectTransactionFilePaths(TX_ID);

    expect(paths).toContain('otp/tx-002/seller.pdf');
    expect(paths).toContain('otp/tx-002/returned.pdf');
  });

  it('returns invoice file path when set', async () => {
    mockPrisma.otp.findUnique.mockResolvedValue(null);
    mockPrisma.commissionInvoice.findUnique.mockResolvedValue({
      invoiceFilePath: 'invoices/tx-002/invoice.pdf',
    } as never);

    const paths = await complianceRepo.collectTransactionFilePaths(TX_ID);

    expect(paths).toContain('invoices/tx-002/invoice.pdf');
  });

  it('returns all paths when OTP and invoice are both present', async () => {
    mockPrisma.otp.findUnique.mockResolvedValue({
      scannedCopyPathSeller: 'otp/tx-002/seller.pdf',
      scannedCopyPathReturned: 'otp/tx-002/returned.pdf',
    } as never);
    mockPrisma.commissionInvoice.findUnique.mockResolvedValue({
      invoiceFilePath: 'invoices/tx-002/invoice.pdf',
    } as never);

    const paths = await complianceRepo.collectTransactionFilePaths(TX_ID);

    expect(paths).toHaveLength(3);
    expect(paths).toContain('otp/tx-002/seller.pdf');
    expect(paths).toContain('otp/tx-002/returned.pdf');
    expect(paths).toContain('invoices/tx-002/invoice.pdf');
  });

  it('returns empty array when no OTP or invoice exists', async () => {
    mockPrisma.otp.findUnique.mockResolvedValue(null);
    mockPrisma.commissionInvoice.findUnique.mockResolvedValue(null);

    const paths = await complianceRepo.collectTransactionFilePaths(TX_ID);

    expect(paths).toHaveLength(0);
  });

  it('omits null OTP path fields', async () => {
    mockPrisma.otp.findUnique.mockResolvedValue({
      scannedCopyPathSeller: 'otp/tx-002/seller.pdf',
      scannedCopyPathReturned: null,
    } as never);
    mockPrisma.commissionInvoice.findUnique.mockResolvedValue(null);

    const paths = await complianceRepo.collectTransactionFilePaths(TX_ID);

    expect(paths).toHaveLength(1);
    expect(paths).toContain('otp/tx-002/seller.pdf');
  });

  it('queries OTP and invoice with the correct transactionId', async () => {
    mockPrisma.otp.findUnique.mockResolvedValue(null);
    mockPrisma.commissionInvoice.findUnique.mockResolvedValue(null);

    await complianceRepo.collectTransactionFilePaths(TX_ID);

    expect(mockPrisma.otp.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { transactionId: TX_ID } }),
    );
    expect(mockPrisma.commissionInvoice.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { transactionId: TX_ID } }),
    );
  });
});

// ─── createCddRecord ──────────────────────────────────────────────────────────

describe('createCddRecord', () => {
  const baseInput = {
    subjectType: 'seller',
    subjectId: 'seller-1',
    fullName: 'John Doe',
    nricLast4: '567A',
    verifiedByAgentId: 'agent-1',
  };

  beforeEach(() => {
    mockPrisma.cddRecord.create.mockResolvedValue({
      id: 'cdd-001',
      subjectType: 'seller',
      subjectId: 'seller-1',
      fullName: 'John Doe',
      nricLast4: '567A',
      verifiedByAgentId: 'agent-1',
      documents: [],
      riskLevel: 'standard',
      identityVerified: false,
      verifiedAt: null,
      retentionExpiresAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
  });

  it('sets retentionExpiresAt to approximately now + 5 years (within 1 second)', async () => {
    const before = new Date();
    before.setFullYear(before.getFullYear() + 5);

    await complianceRepo.createCddRecord(baseInput);

    const after = new Date();
    after.setFullYear(after.getFullYear() + 5);

    const call = mockPrisma.cddRecord.create.mock.calls[0][0];
    const expiry: Date = call.data.retentionExpiresAt;

    expect(expiry.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(expiry.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });

  it('creates record with correct subjectType, subjectId, fullName, nricLast4 fields', async () => {
    await complianceRepo.createCddRecord({
      ...baseInput,
      riskLevel: 'enhanced',
    });

    expect(mockPrisma.cddRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subjectType: 'seller',
          subjectId: 'seller-1',
          fullName: 'John Doe',
          nricLast4: '567A',
          riskLevel: 'enhanced',
        }),
      }),
    );
  });

  it('defaults documents to empty array when not provided', async () => {
    await complianceRepo.createCddRecord(baseInput);

    const call = mockPrisma.cddRecord.create.mock.calls[0][0];
    expect(call.data.documents).toEqual([]);
  });
});

// ─── refreshCddRetentionOnCompletion ─────────────────────────────────────────

describe('refreshCddRetentionOnCompletion', () => {
  beforeEach(() => {
    mockPrisma.cddRecord.updateMany.mockResolvedValue({ count: 2 } as never);
  });

  it('calls updateMany with OR clause matching transactionId subjectId and seller subjectId', async () => {
    await complianceRepo.refreshCddRetentionOnCompletion('tx-abc', 'seller-xyz');

    expect(mockPrisma.cddRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { subjectId: 'tx-abc' },
            { subjectType: 'seller', subjectId: 'seller-xyz' },
          ],
        },
      }),
    );
  });

  it('sets retentionExpiresAt to approximately now + 5 years (within 1 second)', async () => {
    const before = new Date();
    before.setFullYear(before.getFullYear() + 5);

    await complianceRepo.refreshCddRetentionOnCompletion('tx-abc', 'seller-xyz');

    const after = new Date();
    after.setFullYear(after.getFullYear() + 5);

    const call = mockPrisma.cddRecord.updateMany.mock.calls[0][0];
    const expiry: Date = call.data.retentionExpiresAt;

    expect(expiry.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(expiry.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });
});
