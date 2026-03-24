import * as viewingRepo from '../viewing.repository';
import { prisma } from '@/infra/database/prisma';
import { NotFoundError } from '@/domains/shared/errors';

jest.mock('@/infra/database/prisma', () => ({
  prisma: {
    viewingSlot: {
      create: jest.fn(),
      createMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
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
    recurringSchedule: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
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

  describe('findSlotsByPropertyAndMonth', () => {
    it('returns slots for the given month', async () => {
      mockedPrisma.viewingSlot.findMany.mockResolvedValue([] as never);

      await viewingRepo.findSlotsByPropertyAndMonth('prop-1', 2026, 3);

      expect(mockedPrisma.viewingSlot.findMany).toHaveBeenCalledWith({
        where: {
          propertyId: 'prop-1',
          date: {
            gte: new Date('2026-03-01T00:00:00.000Z'),
            lt: new Date('2026-04-01T00:00:00.000Z'),
          },
          status: { not: 'cancelled' },
        },
        include: { viewings: { where: { status: { not: 'cancelled' } } } },
        orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      });
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

  describe('findActiveSlotsByDateRange', () => {
    it('returns active slots in date range without includes', async () => {
      const mockSlots = [
        {
          id: 's1',
          date: new Date('2026-04-01'),
          startTime: '10:00',
          endTime: '10:10',
          status: 'available',
        },
      ];
      mockedPrisma.viewingSlot.findMany.mockResolvedValue(mockSlots as never);

      const result = await viewingRepo.findActiveSlotsByDateRange(
        'prop-1',
        new Date('2026-04-01'),
        new Date('2026-05-01'),
      );

      expect(mockedPrisma.viewingSlot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            propertyId: 'prop-1',
            status: { in: ['available', 'booked', 'full'] },
          }),
        }),
      );
      expect(result).toEqual(mockSlots);
    });
  });

  describe('findRecurringSchedule', () => {
    it('returns schedule for property', async () => {
      const schedule = {
        id: 's1',
        propertyId: 'p1',
        days: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockedPrisma.recurringSchedule.findUnique.mockResolvedValue(schedule as never);
      const result = await viewingRepo.findRecurringSchedule('p1');
      expect(mockedPrisma.recurringSchedule.findUnique).toHaveBeenCalledWith({
        where: { propertyId: 'p1' },
      });
      expect(result).toEqual(schedule);
    });

    it('returns null when no schedule exists', async () => {
      mockedPrisma.recurringSchedule.findUnique.mockResolvedValue(null);
      const result = await viewingRepo.findRecurringSchedule('p1');
      expect(result).toBeNull();
    });
  });

  describe('upsertRecurringSchedule', () => {
    it('upserts schedule with given days', async () => {
      const days = [
        {
          dayOfWeek: 1,
          timeslots: [{ startTime: '18:00', endTime: '20:00', slotType: 'single' as const }],
        },
      ];
      const schedule = {
        id: 's1',
        propertyId: 'p1',
        days,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockedPrisma.recurringSchedule.upsert.mockResolvedValue(schedule as never);

      await viewingRepo.upsertRecurringSchedule('p1', 's1', days);

      expect(mockedPrisma.recurringSchedule.upsert).toHaveBeenCalledWith({
        where: { propertyId: 'p1' },
        update: { days },
        create: { id: 's1', propertyId: 'p1', days },
      });
    });
  });

  describe('deleteRecurringSchedule', () => {
    it('deletes schedule for property using deleteMany', async () => {
      mockedPrisma.recurringSchedule.deleteMany.mockResolvedValue({ count: 1 } as never);
      await viewingRepo.deleteRecurringSchedule('p1');
      expect(mockedPrisma.recurringSchedule.deleteMany).toHaveBeenCalledWith({
        where: { propertyId: 'p1' },
      });
    });

    it('resolves without error when no schedule exists', async () => {
      mockedPrisma.recurringSchedule.deleteMany.mockResolvedValue({ count: 0 });
      await expect(viewingRepo.deleteRecurringSchedule('prop-1')).resolves.toBeUndefined();
    });
  });

  describe('findSlotsByPropertyAndDate', () => {
    it('returns non-cancelled slots for the given date', async () => {
      const slots = [
        {
          id: 'slot-1',
          date: new Date(),
          startTime: '18:00',
          endTime: '18:15',
          status: 'available',
        },
      ];
      mockedPrisma.viewingSlot.findMany.mockResolvedValue(slots as never);
      const date = new Date('2026-03-23T00:00:00.000Z');

      const result = await viewingRepo.findSlotsByPropertyAndDate('p1', date);

      expect(mockedPrisma.viewingSlot.findMany).toHaveBeenCalledWith({
        where: {
          propertyId: 'p1',
          date,
          status: { not: 'cancelled' },
        },
        orderBy: { startTime: 'asc' },
      });
      expect(result).toEqual(slots);
    });
  });

  describe('materialiseRecurringSlot', () => {
    it('inserts slot via raw SQL and returns the full row', async () => {
      const mockRow = {
        id: 'existing-uuid',
        propertyId: 'p1',
        date: new Date('2026-03-23T00:00:00.000Z'),
        startTime: '18:00',
        endTime: '18:15',
        durationMinutes: 15,
        slotType: 'single',
        maxViewers: 1,
        currentBookings: 0,
        status: 'available',
        createdAt: new Date(),
      };
      mockedPrisma.$executeRaw.mockResolvedValue(1);
      mockedPrisma.viewingSlot.findFirst.mockResolvedValue(mockRow as never);

      const result = await viewingRepo.materialiseRecurringSlot({
        id: 'new-uuid',
        propertyId: 'p1',
        date: new Date('2026-03-23T00:00:00.000Z'),
        startTime: '18:00',
        endTime: '18:15',
        slotType: 'single',
        maxViewers: 1,
        durationMinutes: 15,
      });

      expect(mockedPrisma.$executeRaw).toHaveBeenCalled();
      expect(mockedPrisma.viewingSlot.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            propertyId: 'p1',
            startTime: '18:00',
            endTime: '18:15',
          }),
        }),
      );
      expect(result.id).toBe('existing-uuid');
      expect(result.status).toBe('available');

      // Verify $executeRaw SQL includes 'recurring' as the source literal
      const call = mockedPrisma.$executeRaw.mock.calls[0];
      const sqlParts = call[0] as TemplateStringsArray; // TemplateStringsArray
      const fullSql = sqlParts.join('');
      expect(fullSql).toContain('recurring');
    });

    it('throws if row is not found after insert', async () => {
      mockedPrisma.$executeRaw.mockResolvedValue(0);
      mockedPrisma.viewingSlot.findFirst.mockResolvedValue(null);

      await expect(
        viewingRepo.materialiseRecurringSlot({
          id: 'new-uuid',
          propertyId: 'p1',
          date: new Date(),
          startTime: '18:00',
          endTime: '18:15',
          slotType: 'single',
          maxViewers: 1,
          durationMinutes: 15,
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });
});
