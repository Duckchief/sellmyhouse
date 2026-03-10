import * as viewingRepo from '../viewing.repository';
import { prisma } from '@/infra/database/prisma';

jest.mock('@/infra/database/prisma', () => ({
  prisma: {
    viewingSlot: {
      create: jest.fn(),
      createMany: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    viewing: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    verifiedViewer: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    property: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  },
}));

const mockedPrisma = jest.mocked(prisma);

describe('viewing.repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('createSlot', () => {
    it('creates a viewing slot', async () => {
      const slotData = {
        id: 'slot-1',
        propertyId: 'prop-1',
        date: new Date('2026-04-01'),
        startTime: '10:00',
        endTime: '10:15',
        durationMinutes: 15,
        slotType: 'single' as const,
        maxViewers: 1,
      };

      mockedPrisma.viewingSlot.create.mockResolvedValue({
        ...slotData,
        currentBookings: 0,
        status: 'available',
        createdAt: new Date(),
      } as never);

      const result = await viewingRepo.createSlot(slotData);

      expect(mockedPrisma.viewingSlot.create).toHaveBeenCalledWith({
        data: slotData,
      });
      expect(result.status).toBe('available');
    });
  });

  describe('createManySlots', () => {
    it('creates multiple slots', async () => {
      const slots = [
        {
          id: 'slot-1',
          propertyId: 'prop-1',
          date: new Date(),
          startTime: '10:00',
          endTime: '10:15',
          durationMinutes: 15,
          slotType: 'single' as const,
          maxViewers: 1,
        },
        {
          id: 'slot-2',
          propertyId: 'prop-1',
          date: new Date(),
          startTime: '10:15',
          endTime: '10:30',
          durationMinutes: 15,
          slotType: 'single' as const,
          maxViewers: 1,
        },
      ];

      mockedPrisma.viewingSlot.createMany.mockResolvedValue({ count: 2 });

      const result = await viewingRepo.createManySlots(slots);

      expect(result.count).toBe(2);
    });
  });

  describe('findVerifiedViewerByPhone', () => {
    it('finds viewer by phone', async () => {
      mockedPrisma.verifiedViewer.findUnique.mockResolvedValue({
        id: 'viewer-1',
        phone: '91234567',
        name: 'John',
        noShowCount: 0,
      } as never);

      const result = await viewingRepo.findVerifiedViewerByPhone('91234567');

      expect(result?.phone).toBe('91234567');
    });

    it('returns null when not found', async () => {
      mockedPrisma.verifiedViewer.findUnique.mockResolvedValue(null);

      const result = await viewingRepo.findVerifiedViewerByPhone('99999999');

      expect(result).toBeNull();
    });
  });

  describe('incrementNoShow', () => {
    it('increments no-show count', async () => {
      mockedPrisma.verifiedViewer.update.mockResolvedValue({
        id: 'viewer-1',
        noShowCount: 3,
      } as never);

      await viewingRepo.incrementNoShow('viewer-1');

      expect(mockedPrisma.verifiedViewer.update).toHaveBeenCalledWith({
        where: { id: 'viewer-1' },
        data: { noShowCount: { increment: 1 } },
      });
    });
  });

  describe('findSlotsByPropertyAndDateRange', () => {
    it('finds slots within date range', async () => {
      mockedPrisma.viewingSlot.findMany.mockResolvedValue([
        { id: 'slot-1', date: new Date('2026-04-01'), status: 'available' },
      ] as never);

      const result = await viewingRepo.findSlotsByPropertyAndDateRange(
        'prop-1',
        new Date('2026-04-01'),
        new Date('2026-04-07'),
      );

      expect(mockedPrisma.viewingSlot.findMany).toHaveBeenCalledWith({
        where: {
          propertyId: 'prop-1',
          date: { gte: new Date('2026-04-01'), lte: new Date('2026-04-07') },
        },
        include: { viewings: { include: { verifiedViewer: true } } },
        orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('updateViewingStatus', () => {
    it('updates viewing status', async () => {
      mockedPrisma.viewing.update.mockResolvedValue({
        id: 'viewing-1',
        status: 'completed',
        completedAt: new Date(),
      } as never);

      await viewingRepo.updateViewingStatus('viewing-1', {
        status: 'completed',
        completedAt: new Date(),
      });

      expect(mockedPrisma.viewing.update).toHaveBeenCalledWith({
        where: { id: 'viewing-1' },
        data: expect.objectContaining({ status: 'completed' }),
      });
    });
  });

  describe('getViewingStats', () => {
    it('returns aggregated stats', async () => {
      mockedPrisma.viewing.count.mockResolvedValueOnce(10); // total
      mockedPrisma.viewing.count.mockResolvedValueOnce(3); // upcoming
      mockedPrisma.viewing.count.mockResolvedValueOnce(1); // no-shows
      mockedPrisma.$queryRaw.mockResolvedValue([{ avg: 3.5 }]);

      const result = await viewingRepo.getViewingStats('prop-1');

      expect(result.totalViewings).toBe(10);
      expect(result.upcomingCount).toBe(3);
      expect(result.noShowCount).toBe(1);
      expect(result.averageInterestRating).toBe(3.5);
    });
  });
});
