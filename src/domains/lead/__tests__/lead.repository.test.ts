import * as leadRepo from '../lead.repository';

jest.mock('@/infra/database/prisma', () => ({
  prisma: {
    seller: {
      update: jest.fn(),
    },
  },
}));

const { prisma: mockPrisma } = jest.requireMock('@/infra/database/prisma');

describe('lead.repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('assignAgent', () => {
    it('updates seller agentId', async () => {
      mockPrisma.seller.update.mockResolvedValue({ id: 'seller-1', agentId: 'agent-1' } as any);
      await leadRepo.assignAgent('seller-1', 'agent-1');
      expect(mockPrisma.seller.update).toHaveBeenCalledWith({
        where: { id: 'seller-1' },
        data: { agentId: 'agent-1' },
      });
    });
  });
});
