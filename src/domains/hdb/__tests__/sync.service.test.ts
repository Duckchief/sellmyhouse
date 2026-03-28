// src/domains/hdb/__tests__/sync.service.test.ts
import axios from 'axios';
import { HdbSyncService } from '../sync.service';
import { HdbRepository } from '../repository';

jest.mock('axios');
jest.mock('../repository');
jest.mock('@/infra/database/prisma', () => ({
  prisma: {},
  createId: jest.fn(() => 'mock-sync-id'),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockRepo = new HdbRepository() as jest.Mocked<HdbRepository>;

describe('HdbSyncService', () => {
  const service = new HdbSyncService(mockRepo);

  beforeEach(() => jest.clearAllMocks());

  it('fetches new records and inserts them', async () => {
    mockRepo.getLatestMonth.mockResolvedValue('2024-01');
    mockRepo.countTransactions.mockResolvedValue(1000);
    mockRepo.createManyTransactions.mockResolvedValue(2);
    mockRepo.createSyncLog.mockResolvedValue({
      id: 'sync-1',
      syncedAt: new Date(),
      recordsAdded: 2,
      recordsTotal: 1002,
      source: 'd_8b84c4ee58e3cfc0ece0d773c8ca6abc',
      status: 'success',
      error: null,
      createdAt: new Date(),
    });

    mockedAxios.get.mockResolvedValue({
      data: {
        result: {
          records: [
            {
              _id: 1,
              month: '2024-02',
              town: 'TAMPINES',
              flat_type: '4 ROOM',
              block: '123',
              street_name: 'TAMPINES ST 21',
              storey_range: '07 TO 09',
              floor_area_sqm: '93',
              flat_model: 'Model A',
              lease_commence_date: '1995',
              remaining_lease: '68 years 03 months',
              resale_price: '500000',
            },
            {
              _id: 2,
              month: '2024-03',
              town: 'ANG MO KIO',
              flat_type: '3 ROOM',
              block: '456',
              street_name: 'AMK AVE 1',
              storey_range: '04 TO 06',
              floor_area_sqm: '67',
              flat_model: 'New Generation',
              lease_commence_date: '1985',
              remaining_lease: '58 years',
              resale_price: '350000',
            },
          ],
          total: 2,
        },
      },
    });

    const result = await service.sync();

    expect(result.recordsAdded).toBe(2);
    expect(result.status).toBe('success');
    expect(mockRepo.createManyTransactions).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          town: 'TAMPINES',
          source: 'datagov_sync',
          resalePrice: 500000,
        }),
      ]),
    );
  });

  it('skips records older than latest month', async () => {
    mockRepo.getLatestMonth.mockResolvedValue('2024-06');
    mockRepo.countTransactions.mockResolvedValue(1000);
    mockRepo.createSyncLog.mockResolvedValue({
      id: 'sync-2',
      syncedAt: new Date(),
      recordsAdded: 0,
      recordsTotal: 1000,
      source: 'd_8b84c4ee58e3cfc0ece0d773c8ca6abc',
      status: 'success',
      error: null,
      createdAt: new Date(),
    });

    mockedAxios.get.mockResolvedValue({
      data: {
        result: {
          records: [
            {
              _id: 3,
              month: '2024-01',
              town: 'TAMPINES',
              flat_type: '4 ROOM',
              block: '1',
              street_name: 'ST',
              storey_range: '01 TO 03',
              floor_area_sqm: '90',
              flat_model: 'A',
              lease_commence_date: '1995',
              resale_price: '400000',
            },
          ],
          total: 1,
        },
      },
    });

    const result = await service.sync();

    expect(result.recordsAdded).toBe(0);
    expect(mockRepo.createManyTransactions).not.toHaveBeenCalled();
  });

  it('skips sync when no existing data (returns early)', async () => {
    mockRepo.getLatestMonth.mockResolvedValue(null);
    mockRepo.createSyncLog.mockResolvedValue({
      id: 'sync-3',
      syncedAt: new Date(),
      recordsAdded: 0,
      recordsTotal: 0,
      source: 'd_8b84c4ee58e3cfc0ece0d773c8ca6abc',
      status: 'success',
      error: null,
      createdAt: new Date(),
    });

    const result = await service.sync();

    expect(result.recordsAdded).toBe(0);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('skips records from the same month as latest (strict > avoids re-inserts)', async () => {
    mockRepo.getLatestMonth.mockResolvedValue('2026-03');
    mockRepo.countTransactions.mockResolvedValue(500);
    mockRepo.createSyncLog.mockResolvedValue({
      id: 'sync-5',
      syncedAt: new Date(),
      recordsAdded: 0,
      recordsTotal: 500,
      source: 'd_8b84c4ee58e3cfc0ece0d773c8ca6abc',
      status: 'success',
      error: null,
      createdAt: new Date(),
    });

    mockedAxios.get.mockResolvedValue({
      data: {
        result: {
          records: [
            {
              _id: 99,
              month: '2026-03',
              town: 'YISHUN',
              flat_type: 'EXECUTIVE',
              block: '789',
              street_name: 'YISHUN AVE 4',
              storey_range: '10 TO 12',
              floor_area_sqm: '146',
              flat_model: 'Maisonette',
              lease_commence_date: '1988',
              remaining_lease: '62 years',
              resale_price: '850000',
            },
          ],
          total: 1,
        },
      },
    });

    const result = await service.sync();

    expect(result.recordsAdded).toBe(0);
    expect(mockRepo.createManyTransactions).not.toHaveBeenCalled();
  });

  it('logs failure when API errors', async () => {
    mockRepo.getLatestMonth.mockResolvedValue('2024-01');
    mockRepo.createSyncLog.mockResolvedValue({
      id: 'sync-4',
      syncedAt: new Date(),
      recordsAdded: 0,
      recordsTotal: 0,
      source: 'd_8b84c4ee58e3cfc0ece0d773c8ca6abc',
      status: 'failed',
      error: 'Network error',
      createdAt: new Date(),
    });

    mockedAxios.get.mockRejectedValue(new Error('Network error'));

    await expect(service.sync()).rejects.toThrow('Network error');

    expect(mockRepo.createSyncLog).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error: 'Network error',
      }),
    );
  });
});
