// src/domains/hdb/__tests__/repository.test.ts
import { HdbRepository } from '../repository';

// Mock prisma — factory must be self-contained (jest.mock is hoisted above const declarations)
jest.mock('@/infra/database/prisma', () => ({
  prisma: {
    hdbTransaction: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
    },
    hdbDataSync: {
      create: jest.fn(),
    },
  },
  createId: jest.fn(() => 'mock-id'),
}));

// Retrieve the mocked prisma after hoisting
import { prisma as mockPrismaModule } from '@/infra/database/prisma';

const mockPrisma = mockPrismaModule as unknown as {
  hdbTransaction: {
    createMany: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    findFirst: jest.Mock;
  };
  hdbDataSync: {
    create: jest.Mock;
  };
};

describe('HdbRepository', () => {
  const repo = new HdbRepository();

  beforeEach(() => jest.clearAllMocks());

  describe('createManyTransactions', () => {
    it('calls createMany with skipDuplicates', async () => {
      const data = [
        {
          id: 'id1',
          month: '2024-01',
          town: 'TAMPINES',
          flatType: '4 ROOM',
          block: '123',
          streetName: 'TAMPINES ST 21',
          storeyRange: '07 TO 09',
          floorAreaSqm: 93,
          flatModel: 'Model A',
          leaseCommenceDate: 1995,
          remainingLease: null,
          resalePrice: 500000,
          source: 'csv_seed' as const,
        },
      ];
      mockPrisma.hdbTransaction.createMany.mockResolvedValue({ count: 1 });

      const result = await repo.createManyTransactions(data);

      expect(result).toBe(1);
      expect(mockPrisma.hdbTransaction.createMany).toHaveBeenCalledWith({
        data,
        skipDuplicates: true,
      });
    });
  });

  describe('findTransactions', () => {
    it('builds where clause from filters', async () => {
      mockPrisma.hdbTransaction.findMany.mockResolvedValue([]);

      await repo.findTransactions({ town: 'TAMPINES', flatType: '4 ROOM' });

      expect(mockPrisma.hdbTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            town: 'TAMPINES',
            flatType: '4 ROOM',
          }),
        }),
      );
    });

    it('applies month range filter', async () => {
      mockPrisma.hdbTransaction.findMany.mockResolvedValue([]);

      await repo.findTransactions({ fromMonth: '2023-01', toMonth: '2024-06' });

      expect(mockPrisma.hdbTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            month: { gte: '2023-01', lte: '2024-06' },
          }),
        }),
      );
    });
  });

  describe('getDistinctTowns', () => {
    it('returns unique town names sorted', async () => {
      mockPrisma.hdbTransaction.findMany.mockResolvedValue([
        { town: 'ANG MO KIO' },
        { town: 'TAMPINES' },
      ]);

      const result = await repo.getDistinctTowns();

      expect(result).toEqual(['ANG MO KIO', 'TAMPINES']);
    });
  });

  describe('getDistinctFlatTypes', () => {
    it('returns unique flat types sorted', async () => {
      mockPrisma.hdbTransaction.findMany.mockResolvedValue([
        { flatType: '3 ROOM' },
        { flatType: '4 ROOM' },
      ]);

      const result = await repo.getDistinctFlatTypes();

      expect(result).toEqual(['3 ROOM', '4 ROOM']);
    });
  });

  describe('getDistinctFlatTypesByTown', () => {
    it('returns distinct flat types filtered by town', async () => {
      mockPrisma.hdbTransaction.findMany.mockResolvedValue([
        { flatType: '3 ROOM' },
        { flatType: '4 ROOM' },
      ]);

      const result = await repo.getDistinctFlatTypesByTown('BISHAN');

      expect(mockPrisma.hdbTransaction.findMany).toHaveBeenCalledWith({
        distinct: ['flatType'],
        select: { flatType: true },
        orderBy: { flatType: 'asc' },
        where: { town: 'BISHAN' },
      });
      expect(result).toEqual(['3 ROOM', '4 ROOM']);
    });

    it('returns empty array when town has no transactions', async () => {
      mockPrisma.hdbTransaction.findMany.mockResolvedValue([]);

      const result = await repo.getDistinctFlatTypesByTown('UNKNOWN TOWN');

      expect(result).toEqual([]);
    });
  });

  describe('getDistinctStoreyRangesByTownAndFlatType', () => {
    it('returns storey ranges filtered by town and flat type', async () => {
      mockPrisma.hdbTransaction.findMany.mockResolvedValue([
        { storeyRange: '01 TO 03' },
        { storeyRange: '04 TO 06' },
      ]);

      const result = await repo.getDistinctStoreyRangesByTownAndFlatType('TAMPINES', '4 ROOM');

      expect(mockPrisma.hdbTransaction.findMany).toHaveBeenCalledWith({
        distinct: ['storeyRange'],
        select: { storeyRange: true },
        orderBy: { storeyRange: 'asc' },
        where: { town: 'TAMPINES', flatType: '4 ROOM' },
      });
      expect(result).toEqual(['01 TO 03', '04 TO 06']);
    });
  });

  describe('getRecentTransactions', () => {
    it('fetches with limit and default offset of 0', async () => {
      mockPrisma.hdbTransaction.findMany.mockResolvedValue([]);

      await repo.getRecentTransactions({ town: 'TAMPINES' }, 10);

      expect(mockPrisma.hdbTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10, skip: 0 }),
      );
    });

    it('fetches with explicit offset for pagination', async () => {
      mockPrisma.hdbTransaction.findMany.mockResolvedValue([]);

      await repo.getRecentTransactions({ town: 'TAMPINES' }, 10, 20);

      expect(mockPrisma.hdbTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10, skip: 20 }),
      );
    });
  });

  describe('countFilteredTransactions', () => {
    it('counts transactions matching filters', async () => {
      mockPrisma.hdbTransaction.count.mockResolvedValue(47);

      const result = await repo.countFilteredTransactions({
        town: 'TAMPINES',
        flatType: '4 ROOM',
      });

      expect(result).toBe(47);
      expect(mockPrisma.hdbTransaction.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ town: 'TAMPINES', flatType: '4 ROOM' }),
        }),
      );
    });

    it('applies month range filter when fromMonth provided', async () => {
      mockPrisma.hdbTransaction.count.mockResolvedValue(10);

      await repo.countFilteredTransactions({ town: 'T', fromMonth: '2023-01' });

      expect(mockPrisma.hdbTransaction.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ month: { gte: '2023-01' } }),
        }),
      );
    });
  });

  describe('countTransactions', () => {
    it('returns total count', async () => {
      mockPrisma.hdbTransaction.count.mockResolvedValue(972000);

      const result = await repo.countTransactions();

      expect(result).toBe(972000);
    });
  });

  describe('getLatestMonth', () => {
    it('returns latest month string', async () => {
      mockPrisma.hdbTransaction.findFirst.mockResolvedValue({ month: '2024-12' });

      const result = await repo.getLatestMonth();

      expect(result).toBe('2024-12');
    });

    it('returns null when no records exist', async () => {
      mockPrisma.hdbTransaction.findFirst.mockResolvedValue(null);

      const result = await repo.getLatestMonth();

      expect(result).toBeNull();
    });
  });

  describe('createSyncLog', () => {
    it('creates a sync log entry', async () => {
      const syncData = {
        id: 'sync-1',
        recordsAdded: 100,
        recordsTotal: 1000,
        source: 'test-dataset',
        status: 'success' as const,
      };
      mockPrisma.hdbDataSync.create.mockResolvedValue(syncData);

      const result = await repo.createSyncLog(syncData);

      expect(result).toEqual(syncData);
      expect(mockPrisma.hdbDataSync.create).toHaveBeenCalledWith({
        data: syncData,
      });
    });
  });
});
