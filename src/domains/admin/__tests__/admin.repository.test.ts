import { findAllSellers } from '../admin.repository';

jest.mock('@/infra/database/prisma', () => ({
  prisma: {
    seller: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  },
}));

import { prisma } from '@/infra/database/prisma';

const mockFindMany = prisma.seller.findMany as jest.Mock;
const mockCount = prisma.seller.count as jest.Mock;

describe('findAllSellers', () => {
  beforeEach(() => jest.clearAllMocks());

  it('filters by agentId = null when agentId is "unassigned"', async () => {
    await findAllSellers({ agentId: 'unassigned' });
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ agentId: null }),
      }),
    );
  });

  it('filters by specific agentId when a UUID is provided', async () => {
    await findAllSellers({ agentId: 'agent-123' });
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ agentId: 'agent-123' }),
      }),
    );
  });

  it('does not add agentId to where when agentId is undefined', async () => {
    await findAllSellers({});
    const calledWhere = mockFindMany.mock.calls[0][0].where;
    expect(calledWhere).not.toHaveProperty('agentId');
  });
});
