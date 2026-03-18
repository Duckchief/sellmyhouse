import * as repo from '../profile.repository';

jest.mock('@/infra/database/prisma', () => ({
  prisma: {
    agent: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));
jest.mock('bcrypt');

const { prisma } = jest.requireMock('@/infra/database/prisma');
const bcrypt = jest.requireMock('bcrypt');

describe('ProfileRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findAgentById', () => {
    it('returns agent when found', async () => {
      const agent = {
        id: 'agent1',
        name: 'John Doe',
        email: 'john@test.com',
        role: 'agent',
        createdAt: new Date('2025-01-01'),
        twoFactorEnabled: false,
        avatarPath: null,
      };
      prisma.agent.findUnique.mockResolvedValue(agent);

      const result = await repo.findAgentById('agent1');

      expect(prisma.agent.findUnique).toHaveBeenCalledWith({
        where: { id: 'agent1' },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
          twoFactorEnabled: true,
          avatarPath: true,
        },
      });
      expect(result).toEqual(agent);
    });

    it('returns null when not found', async () => {
      prisma.agent.findUnique.mockResolvedValue(null);
      const result = await repo.findAgentById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('updateAvatarPath', () => {
    it('updates avatarPath for the agent', async () => {
      prisma.agent.update.mockResolvedValue({});
      await repo.updateAvatarPath('agent1', '/uploads/avatars/agent1.jpg');
      expect(prisma.agent.update).toHaveBeenCalledWith({
        where: { id: 'agent1' },
        data: { avatarPath: '/uploads/avatars/agent1.jpg' },
      });
    });
  });

  describe('clearAvatarPath', () => {
    it('sets avatarPath to null', async () => {
      prisma.agent.update.mockResolvedValue({});
      await repo.clearAvatarPath('agent1');
      expect(prisma.agent.update).toHaveBeenCalledWith({
        where: { id: 'agent1' },
        data: { avatarPath: null },
      });
    });
  });

  describe('updatePasswordHash', () => {
    it('updates passwordHash for the agent', async () => {
      prisma.agent.update.mockResolvedValue({});
      await repo.updatePasswordHash('agent1', 'new-hash');
      expect(prisma.agent.update).toHaveBeenCalledWith({
        where: { id: 'agent1' },
        data: { passwordHash: 'new-hash' },
      });
    });
  });

  describe('verifyPassword', () => {
    it('returns true when password matches hash', async () => {
      prisma.agent.findUnique.mockResolvedValue({ passwordHash: 'hash' });
      bcrypt.compare.mockResolvedValue(true);

      const result = await repo.verifyPassword('agent1', 'correct');
      expect(result).toBe(true);
    });

    it('returns false when agent not found', async () => {
      prisma.agent.findUnique.mockResolvedValue(null);
      const result = await repo.verifyPassword('agent1', 'any');
      expect(result).toBe(false);
    });
  });
});
