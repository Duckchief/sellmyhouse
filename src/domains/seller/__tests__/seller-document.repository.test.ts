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
      const expected = {
        id: 'doc-1',
        ...input,
        uploadedAt: new Date(),
        downloadedAt: null,
        downloadedBy: null,
        deletedAt: null,
      };
      (mockPrisma.sellerDocument.create as jest.Mock).mockResolvedValue(expected);

      const result = await sellerDocRepo.create(input);

      expect(mockPrisma.sellerDocument.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ ...input, id: expect.any(String) }),
      });
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
