// tests/integration/hdb.test.ts
import { testPrisma, cleanDatabase } from '../helpers/prisma';
import { factory } from '../fixtures/factory';
import { Decimal } from '@prisma/client/runtime/library';

describe('HDB Integration', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  describe('HDB transaction queries', () => {
    it('returns distinct towns', async () => {
      await factory.hdbTransaction({ town: 'TAMPINES' });
      await factory.hdbTransaction({ town: 'BEDOK' });
      await factory.hdbTransaction({ town: 'TAMPINES' }); // duplicate

      const towns = await testPrisma.hdbTransaction.findMany({
        distinct: ['town'],
        select: { town: true },
        orderBy: { town: 'asc' },
      });

      expect(towns.map((t) => t.town)).toEqual(['BEDOK', 'TAMPINES']);
    });

    it('returns distinct flat types', async () => {
      await factory.hdbTransaction({ flatType: '4 ROOM' });
      await factory.hdbTransaction({ flatType: '3 ROOM' });
      await factory.hdbTransaction({ flatType: '5 ROOM' });

      const types = await testPrisma.hdbTransaction.findMany({
        distinct: ['flatType'],
        select: { flatType: true },
        orderBy: { flatType: 'asc' },
      });

      expect(types.map((t) => t.flatType)).toEqual(['3 ROOM', '4 ROOM', '5 ROOM']);
    });

    it('filters by month range', async () => {
      await factory.hdbTransaction({ month: '2023-01' });
      await factory.hdbTransaction({ month: '2023-06' });
      await factory.hdbTransaction({ month: '2024-01' });
      await factory.hdbTransaction({ month: '2024-06' });

      const results = await testPrisma.hdbTransaction.findMany({
        where: { month: { gte: '2023-06', lte: '2024-01' } },
      });

      expect(results).toHaveLength(2);
    });

    it('stores resalePrice as Decimal', async () => {
      const txn = await factory.hdbTransaction({ resalePrice: 523456.78 });

      const found = await testPrisma.hdbTransaction.findUnique({
        where: { id: txn.id },
      });

      expect(found!.resalePrice).toBeInstanceOf(Decimal);
      expect(found!.resalePrice.toString()).toBe('523456.78');
    });
  });

  describe('HDB data sync logging', () => {
    it('creates a sync log entry', async () => {
      const { createId } = await import('@paralleldrive/cuid2');
      const syncLog = await testPrisma.hdbDataSync.create({
        data: {
          id: createId(),
          recordsAdded: 150,
          recordsTotal: 972150,
          source: 'test-dataset',
          status: 'success',
        },
      });

      expect(syncLog.recordsAdded).toBe(150);
      expect(syncLog.status).toBe('success');
    });
  });
});
