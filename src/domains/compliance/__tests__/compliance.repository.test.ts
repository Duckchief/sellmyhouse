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
  },
}));

import { prisma } from '@/infra/database/prisma';

const mockPrisma = prisma as jest.Mocked<typeof prisma> & {
  testimonial: { deleteMany: jest.Mock };
  otp: { deleteMany: jest.Mock; findUnique: jest.Mock };
  commissionInvoice: { deleteMany: jest.Mock; findUnique: jest.Mock };
  transaction: { delete: jest.Mock };
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
