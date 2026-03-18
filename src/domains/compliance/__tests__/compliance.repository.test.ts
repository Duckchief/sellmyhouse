// src/domains/compliance/__tests__/compliance.repository.test.ts
import * as complianceRepo from '../compliance.repository';
import type { CddDocument, CddRecord } from '../compliance.types';

jest.mock('@/infra/database/prisma', () => ({
  prisma: {
    testimonial: {
      deleteMany: jest.fn(),
    },
    otp: {
      deleteMany: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    commissionInvoice: {
      deleteMany: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    transaction: {
      delete: jest.fn(),
    },
    property: {
      findMany: jest.fn(),
    },
    cddRecord: {
      create: jest.fn(),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

import { prisma } from '@/infra/database/prisma';

const mockPrisma = prisma as jest.Mocked<typeof prisma> & {
  testimonial: { deleteMany: jest.Mock };
  otp: { deleteMany: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock };
  commissionInvoice: { deleteMany: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock };
  transaction: { delete: jest.Mock };
  property: { findMany: jest.Mock };
  cddRecord: {
    create: jest.Mock;
    updateMany: jest.Mock;
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
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
    expect(typeof complianceRepo.createEaa).toBe('function');
    expect(typeof complianceRepo.findEaaBySellerId).toBe('function');
    expect(typeof complianceRepo.updateEaaStatus).toBe('function');
    expect(typeof complianceRepo.updateEaaExplanation).toBe('function');
    expect(typeof complianceRepo.findEaaById).toBe('function');
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

    expect(mockPrisma.testimonial.deleteMany).toHaveBeenCalledWith({
      where: { transactionId: TX_ID },
    });
    expect(mockPrisma.otp.deleteMany).toHaveBeenCalledWith({ where: { transactionId: TX_ID } });
    expect(mockPrisma.commissionInvoice.deleteMany).toHaveBeenCalledWith({
      where: { transactionId: TX_ID },
    });
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
          OR: [{ subjectId: 'tx-abc' }, { subjectType: 'seller', subjectId: 'seller-xyz' }],
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

// ─── upsertCddStatus ───────────────────────────────────────────────────────────

describe('upsertCddStatus', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a new stub record when none exists (pending)', async () => {
    mockPrisma.cddRecord.findFirst.mockResolvedValue(null);
    mockPrisma.cddRecord.create.mockResolvedValue({
      id: 'cdd-1',
      identityVerified: false,
    } as never);

    await complianceRepo.upsertCddStatus('seller-1', 'agent-1', 'pending');

    expect(mockPrisma.cddRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subjectType: 'seller',
          subjectId: 'seller-1',
          identityVerified: false,
          verifiedByAgentId: 'agent-1',
        }),
      }),
    );
  });

  it('creates a new stub record when none exists (verified)', async () => {
    mockPrisma.cddRecord.findFirst.mockResolvedValue(null);
    mockPrisma.cddRecord.create.mockResolvedValue({ id: 'cdd-1', identityVerified: true } as never);

    await complianceRepo.upsertCddStatus('seller-1', 'agent-1', 'verified');

    expect(mockPrisma.cddRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          identityVerified: true,
          verifiedByAgentId: 'agent-1',
        }),
      }),
    );
    const call = mockPrisma.cddRecord.create.mock.calls[0][0];
    expect(call.data.verifiedAt).toBeInstanceOf(Date);
  });

  it('updates existing record in-place', async () => {
    mockPrisma.cddRecord.findFirst.mockResolvedValue({ id: 'existing-cdd' } as never);
    mockPrisma.cddRecord.update.mockResolvedValue({} as never);

    await complianceRepo.upsertCddStatus('seller-1', 'agent-1', 'verified');

    expect(mockPrisma.cddRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'existing-cdd' },
        data: expect.objectContaining({ identityVerified: true }),
      }),
    );
    expect(mockPrisma.cddRecord.create).not.toHaveBeenCalled();
  });
});

// ─── deleteCddRecord ───────────────────────────────────────────────────────────

describe('deleteCddRecord', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deletes the seller CDD record if one exists', async () => {
    mockPrisma.cddRecord.findFirst.mockResolvedValue({ id: 'cdd-1' } as never);
    mockPrisma.cddRecord.delete.mockResolvedValue({} as never);

    await complianceRepo.deleteCddRecord('seller-1');

    expect(mockPrisma.cddRecord.delete).toHaveBeenCalledWith({ where: { id: 'cdd-1' } });
  });

  it('is a no-op when no record exists', async () => {
    mockPrisma.cddRecord.findFirst.mockResolvedValue(null);

    await complianceRepo.deleteCddRecord('seller-1');

    expect(mockPrisma.cddRecord.delete).not.toHaveBeenCalled();
  });
});

// ─── CDD document repository functions ───────────────────────────────────────

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

// ─── collectSellerFilePaths — CDD documents ───────────────────────────────────

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
