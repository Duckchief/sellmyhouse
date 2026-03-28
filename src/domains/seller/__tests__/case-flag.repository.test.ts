import * as repo from '../case-flag.repository';

jest.mock('../../../infra/database/prisma', () => ({
  prisma: {
    caseFlag: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));

const { prisma } = jest.requireMock('../../../infra/database/prisma') as {
  prisma: {
    caseFlag: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
    };
  };
};

describe('case-flag.repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('creates a case flag record', async () => {
      const data = {
        id: 'flag-1',
        sellerId: 's-1',
        flagType: 'other' as const,
        description: 'test',
      };
      prisma.caseFlag.create.mockResolvedValue({ ...data, status: 'identified' });

      const result = await repo.create(data);

      expect(prisma.caseFlag.create).toHaveBeenCalledWith({ data });
      expect(result).toMatchObject({ id: 'flag-1', status: 'identified' });
    });
  });

  describe('updateStatus', () => {
    it('sets resolvedAt when status is resolved', async () => {
      prisma.caseFlag.update.mockResolvedValue({ id: 'flag-1', status: 'resolved' });

      await repo.updateStatus('flag-1', 'resolved');

      const call = prisma.caseFlag.update.mock.calls[0][0] as { data: { resolvedAt?: Date } };
      expect(call.data.resolvedAt).toBeInstanceOf(Date);
    });

    it('sets resolvedAt when status is out_of_scope', async () => {
      prisma.caseFlag.update.mockResolvedValue({ id: 'flag-1', status: 'out_of_scope' });

      await repo.updateStatus('flag-1', 'out_of_scope');

      const call = prisma.caseFlag.update.mock.calls[0][0] as { data: { resolvedAt?: Date } };
      expect(call.data.resolvedAt).toBeInstanceOf(Date);
    });

    it('does not set resolvedAt for in_progress status', async () => {
      prisma.caseFlag.update.mockResolvedValue({ id: 'flag-1', status: 'in_progress' });

      await repo.updateStatus('flag-1', 'in_progress');

      const call = prisma.caseFlag.update.mock.calls[0][0] as { data: { resolvedAt?: unknown } };
      expect(call.data.resolvedAt).toBeUndefined();
    });

    it('passes guidanceProvided when supplied', async () => {
      prisma.caseFlag.update.mockResolvedValue({ id: 'flag-1', status: 'in_progress' });

      await repo.updateStatus('flag-1', 'in_progress', 'Some guidance text');

      const call = prisma.caseFlag.update.mock.calls[0][0] as {
        data: { guidanceProvided?: string };
      };
      expect(call.data.guidanceProvided).toBe('Some guidance text');
    });
  });

  describe('findById', () => {
    it('calls findUnique with the given id', async () => {
      prisma.caseFlag.findUnique.mockResolvedValue({ id: 'flag-1' });

      await repo.findById('flag-1');

      expect(prisma.caseFlag.findUnique).toHaveBeenCalledWith({ where: { id: 'flag-1' } });
    });

    it('returns null when not found', async () => {
      prisma.caseFlag.findUnique.mockResolvedValue(null);
      const result = await repo.findById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('findBySellerId', () => {
    it('returns flags ordered by createdAt desc', async () => {
      prisma.caseFlag.findMany.mockResolvedValue([]);

      await repo.findBySellerId('seller-1');

      expect(prisma.caseFlag.findMany).toHaveBeenCalledWith({
        where: { sellerId: 'seller-1' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findActiveMopFlag', () => {
    it('queries for active mop_not_met flags only', async () => {
      prisma.caseFlag.findFirst.mockResolvedValue(null);

      await repo.findActiveMopFlag('seller-1');

      expect(prisma.caseFlag.findFirst).toHaveBeenCalledWith({
        where: {
          sellerId: 'seller-1',
          flagType: 'mop_not_met',
          status: { in: ['identified', 'in_progress'] },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('returns the flag when found', async () => {
      const flag = { id: 'flag-1', flagType: 'mop_not_met', status: 'identified' };
      prisma.caseFlag.findFirst.mockResolvedValue(flag);

      const result = await repo.findActiveMopFlag('seller-1');

      expect(result).toEqual(flag);
    });
  });
});
