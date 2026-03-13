// src/domains/hdb/__tests__/service.test.ts
import { Decimal } from '@prisma/client/runtime/library';
import { HdbService } from '../service';
import { HdbRepository } from '../repository';

jest.mock('../repository');

const mockRepo = new HdbRepository() as jest.Mocked<HdbRepository>;

const makeTxn = (id: string, price: number) => makeTransaction(id, price);

const makeTransaction = (id: string, price: number, month = '2024-01') => ({
  id,
  month,
  town: 'TAMPINES',
  flatType: '4 ROOM',
  block: id,
  streetName: 'ST',
  storeyRange: '01 TO 03',
  floorAreaSqm: 90,
  flatModel: 'A',
  leaseCommenceDate: 1995,
  remainingLease: null,
  resalePrice: new Decimal(price),
  source: 'csv_seed' as const,
  createdAt: new Date(),
});

describe('HdbService', () => {
  const service = new HdbService(mockRepo);

  beforeEach(() => jest.clearAllMocks());

  describe('getTransactions', () => {
    it('delegates to repository with filters', async () => {
      const mockData = [makeTransaction('1', 500000)];
      mockRepo.findTransactions.mockResolvedValue(mockData);

      const result = await service.getTransactions({ town: 'TAMPINES' });

      expect(result).toEqual(mockData);
      expect(mockRepo.findTransactions).toHaveBeenCalledWith({ town: 'TAMPINES' });
    });
  });

  describe('getDistinctTowns', () => {
    it('returns list of towns', async () => {
      mockRepo.getDistinctTowns.mockResolvedValue(['ANG MO KIO', 'TAMPINES']);

      const result = await service.getDistinctTowns();

      expect(result).toEqual(['ANG MO KIO', 'TAMPINES']);
    });
  });

  describe('getDistinctFlatTypes', () => {
    it('returns list of flat types', async () => {
      mockRepo.getDistinctFlatTypes.mockResolvedValue(['3 ROOM', '4 ROOM']);

      const result = await service.getDistinctFlatTypes();

      expect(result).toEqual(['3 ROOM', '4 ROOM']);
    });
  });

  describe('getDistinctStoreyRanges', () => {
    it('returns list of storey ranges', async () => {
      mockRepo.getDistinctStoreyRanges.mockResolvedValue(['01 TO 03', '04 TO 06', '07 TO 09']);

      const result = await service.getDistinctStoreyRanges();

      expect(result).toEqual(['01 TO 03', '04 TO 06', '07 TO 09']);
    });
  });

  describe('getMarketReport', () => {
    it('returns aggregated stats from DB', async () => {
      mockRepo.getMarketReportStats.mockResolvedValue({
        count: 3,
        min: 400000,
        max: 600000,
        median: 500000,
        avgPricePerSqm: 5500,
      });
      mockRepo.getRecentTransactions.mockResolvedValue([
        makeTransaction('3', 600000, '2024-02'),
        makeTransaction('2', 500000, '2024-01'),
        makeTransaction('1', 400000, '2024-01'),
      ]);

      const report = await service.getMarketReport({
        town: 'TAMPINES',
        flatType: '4 ROOM',
        months: 24,
      });

      expect(report).not.toBeNull();
      expect(report!.count).toBe(3);
      expect(report!.min).toEqual(new Decimal(400000));
      expect(report!.max).toEqual(new Decimal(600000));
      expect(report!.median).toEqual(new Decimal(500000));
      expect(report!.town).toBe('TAMPINES');
    });

    it('returns null when no transactions found', async () => {
      mockRepo.getMarketReportStats.mockResolvedValue(null);
      mockRepo.getRecentTransactions.mockResolvedValue([]);

      const report = await service.getMarketReport({
        town: 'NOWHERE',
        flatType: '4 ROOM',
        months: 24,
      });

      expect(report).toBeNull();
    });

  describe('getPaginatedTransactions', () => {
    const filters = { town: 'TAMPINES', flatType: '4 ROOM', months: 24 };

    it('returns page 1 transactions with pagination metadata', async () => {
      mockRepo.getRecentTransactions.mockResolvedValue([
        makeTxn('1', 500000),
        makeTxn('2', 510000),
      ]);
      mockRepo.countFilteredTransactions.mockResolvedValue(25);

      const result = await service.getPaginatedTransactions(filters, 1, 10);

      expect(result.transactions).toHaveLength(2);
      expect(result.total).toBe(25);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(10);
      expect(result.totalPages).toBe(3);
      expect(mockRepo.getRecentTransactions).toHaveBeenCalledWith(
        expect.anything(),
        10,
        0,
      );
    });

    it('calculates correct offset for page 2', async () => {
      mockRepo.getRecentTransactions.mockResolvedValue([makeTxn('1', 500000)]);
      mockRepo.countFilteredTransactions.mockResolvedValue(25);

      await service.getPaginatedTransactions(filters, 2, 10);

      expect(mockRepo.getRecentTransactions).toHaveBeenCalledWith(
        expect.anything(),
        10,
        10,
      );
    });

    it('totalPages rounds up for partial last page', async () => {
      mockRepo.getRecentTransactions.mockResolvedValue([]);
      mockRepo.countFilteredTransactions.mockResolvedValue(21);

      const result = await service.getPaginatedTransactions(filters, 1, 10);

      expect(result.totalPages).toBe(3);
    });
  });

    it('returns correct median from stats', async () => {
      mockRepo.getMarketReportStats.mockResolvedValue({
        count: 2,
        min: 400000,
        max: 600000,
        median: 500000,
        avgPricePerSqm: 5500,
      });
      mockRepo.getRecentTransactions.mockResolvedValue([
        makeTransaction('2', 600000),
        makeTransaction('1', 400000),
      ]);

      const report = await service.getMarketReport({ town: 'T', flatType: '4R', months: 12 });

      expect(report!.median).toEqual(new Decimal(500000));
    });
  });
});
