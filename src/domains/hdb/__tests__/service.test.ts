// src/domains/hdb/__tests__/service.test.ts
import { Decimal } from '@prisma/client/runtime/library';
import { HdbService } from '../service';
import { HdbRepository } from '../repository';

jest.mock('../repository');

const mockRepo = new HdbRepository() as jest.Mocked<HdbRepository>;

describe('HdbService', () => {
  const service = new HdbService(mockRepo);

  beforeEach(() => jest.clearAllMocks());

  describe('getTransactions', () => {
    it('delegates to repository with filters', async () => {
      const mockData = [
        {
          id: '1',
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
          resalePrice: new Decimal(500000),
          source: 'csv_seed' as const,
          createdAt: new Date(),
        },
      ];
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

  describe('getMarketReport', () => {
    it('calculates statistics from transactions', async () => {
      const transactions = [
        {
          id: '1',
          month: '2024-01',
          town: 'TAMPINES',
          flatType: '4 ROOM',
          block: '1',
          streetName: 'ST',
          storeyRange: '01 TO 03',
          floorAreaSqm: 90,
          flatModel: 'A',
          leaseCommenceDate: 1995,
          remainingLease: null,
          resalePrice: new Decimal(400000),
          source: 'csv_seed' as const,
          createdAt: new Date(),
        },
        {
          id: '2',
          month: '2024-01',
          town: 'TAMPINES',
          flatType: '4 ROOM',
          block: '2',
          streetName: 'ST',
          storeyRange: '04 TO 06',
          floorAreaSqm: 95,
          flatModel: 'A',
          leaseCommenceDate: 1995,
          remainingLease: null,
          resalePrice: new Decimal(500000),
          source: 'csv_seed' as const,
          createdAt: new Date(),
        },
        {
          id: '3',
          month: '2024-02',
          town: 'TAMPINES',
          flatType: '4 ROOM',
          block: '3',
          streetName: 'ST',
          storeyRange: '07 TO 09',
          floorAreaSqm: 100,
          flatModel: 'A',
          leaseCommenceDate: 1995,
          remainingLease: null,
          resalePrice: new Decimal(600000),
          source: 'csv_seed' as const,
          createdAt: new Date(),
        },
      ];
      mockRepo.findTransactions.mockResolvedValue(transactions);

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
      mockRepo.findTransactions.mockResolvedValue([]);

      const report = await service.getMarketReport({
        town: 'NOWHERE',
        flatType: '4 ROOM',
        months: 24,
      });

      expect(report).toBeNull();
    });

    it('calculates median for even count', async () => {
      const transactions = [
        {
          id: '1',
          month: '2024-01',
          town: 'T',
          flatType: '4R',
          block: '1',
          streetName: 'S',
          storeyRange: 'R',
          floorAreaSqm: 90,
          flatModel: 'A',
          leaseCommenceDate: 1995,
          remainingLease: null,
          resalePrice: new Decimal(400000),
          source: 'csv_seed' as const,
          createdAt: new Date(),
        },
        {
          id: '2',
          month: '2024-01',
          town: 'T',
          flatType: '4R',
          block: '2',
          streetName: 'S',
          storeyRange: 'R',
          floorAreaSqm: 90,
          flatModel: 'A',
          leaseCommenceDate: 1995,
          remainingLease: null,
          resalePrice: new Decimal(600000),
          source: 'csv_seed' as const,
          createdAt: new Date(),
        },
      ];
      mockRepo.findTransactions.mockResolvedValue(transactions);

      const report = await service.getMarketReport({ town: 'T', flatType: '4R', months: 12 });

      // Median of [400000, 600000] = 500000
      expect(report!.median).toEqual(new Decimal(500000));
    });
  });
});
