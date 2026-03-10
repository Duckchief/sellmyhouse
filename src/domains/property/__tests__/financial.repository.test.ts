import * as financialRepo from '../financial.repository';
import { prisma } from '@/infra/database/prisma';

jest.mock('@/infra/database/prisma', () => ({
  prisma: {
    financialReport: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  },
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

const sampleReportData = {
  inputs: { salePrice: 500000, outstandingLoan: 200000 },
  outputs: { netCashProceeds: 127857 },
  metadata: {
    flatType: '4 ROOM',
    town: 'TAMPINES',
    leaseCommenceDate: 1995,
    calculatedAt: '2026-03-10T00:00:00.000Z',
  },
};

describe('financial.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('creates a financial report record', async () => {
      const expected = { id: 'report-1', reportData: sampleReportData, version: 1 };
      (mockPrisma.financialReport.create as jest.Mock).mockResolvedValue(expected);

      const result = await financialRepo.create({
        id: 'report-1',
        sellerId: 'seller-1',
        propertyId: 'property-1',
        reportData: sampleReportData,
        version: 1,
      });

      expect(mockPrisma.financialReport.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: 'report-1',
          sellerId: 'seller-1',
          propertyId: 'property-1',
          reportData: sampleReportData,
          version: 1,
        }),
      });
      expect(result).toEqual(expected);
    });
  });

  describe('findById', () => {
    it('finds a report by id', async () => {
      const expected = { id: 'report-1', reportData: sampleReportData };
      (mockPrisma.financialReport.findUnique as jest.Mock).mockResolvedValue(expected);

      const result = await financialRepo.findById('report-1');
      expect(mockPrisma.financialReport.findUnique).toHaveBeenCalledWith({
        where: { id: 'report-1' },
      });
      expect(result).toEqual(expected);
    });

    it('returns null when not found', async () => {
      (mockPrisma.financialReport.findUnique as jest.Mock).mockResolvedValue(null);
      const result = await financialRepo.findById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('findLatestForProperty', () => {
    it('returns the latest report for a property', async () => {
      const expected = { id: 'report-2', version: 2 };
      (mockPrisma.financialReport.findFirst as jest.Mock).mockResolvedValue(expected);

      const result = await financialRepo.findLatestForProperty('seller-1', 'property-1');
      expect(mockPrisma.financialReport.findFirst).toHaveBeenCalledWith({
        where: { sellerId: 'seller-1', propertyId: 'property-1' },
        orderBy: { version: 'desc' },
      });
      expect(result).toEqual(expected);
    });
  });

  describe('updateNarrative', () => {
    it('updates AI narrative and provider metadata', async () => {
      (mockPrisma.financialReport.update as jest.Mock).mockResolvedValue({ id: 'report-1' });

      await financialRepo.updateNarrative('report-1', {
        aiNarrative: 'Your estimated net proceeds...',
        aiProvider: 'anthropic',
        aiModel: 'claude-sonnet-4-20250514',
      });

      expect(mockPrisma.financialReport.update).toHaveBeenCalledWith({
        where: { id: 'report-1' },
        data: {
          aiNarrative: 'Your estimated net proceeds...',
          aiProvider: 'anthropic',
          aiModel: 'claude-sonnet-4-20250514',
        },
      });
    });
  });

  describe('approve', () => {
    it('sets review and approval fields', async () => {
      (mockPrisma.financialReport.update as jest.Mock).mockResolvedValue({ id: 'report-1' });

      await financialRepo.approve('report-1', 'agent-1', 'Looks correct');

      expect(mockPrisma.financialReport.update).toHaveBeenCalledWith({
        where: { id: 'report-1' },
        data: expect.objectContaining({
          reviewedByAgentId: 'agent-1',
          reviewNotes: 'Looks correct',
        }),
      });
    });
  });

  describe('markSent', () => {
    it('records sent timestamp and channel', async () => {
      (mockPrisma.financialReport.update as jest.Mock).mockResolvedValue({ id: 'report-1' });

      await financialRepo.markSent('report-1', 'whatsapp');

      expect(mockPrisma.financialReport.update).toHaveBeenCalledWith({
        where: { id: 'report-1' },
        data: expect.objectContaining({
          sentVia: 'whatsapp',
        }),
      });
    });
  });

  describe('findAllForSeller', () => {
    it('returns all reports for a seller ordered by version desc', async () => {
      const expected = [
        { id: 'r2', version: 2 },
        { id: 'r1', version: 1 },
      ];
      (mockPrisma.financialReport.findMany as jest.Mock).mockResolvedValue(expected);

      const result = await financialRepo.findAllForSeller('seller-1');
      expect(mockPrisma.financialReport.findMany).toHaveBeenCalledWith({
        where: { sellerId: 'seller-1' },
        orderBy: { version: 'desc' },
      });
      expect(result).toEqual(expected);
    });
  });
});
