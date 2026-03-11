import * as repo from '../agent-settings.repository';

jest.mock('../../../infra/database/prisma', () => ({
  prisma: {
    agentSetting: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
  },
  createId: jest.fn().mockReturnValue('test-setting-id'),
}));

const { prisma } = jest.requireMock('../../../infra/database/prisma');

describe('agent-settings.repository', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('upsert', () => {
    it('creates or updates setting using compound unique key', async () => {
      prisma.agentSetting.upsert.mockResolvedValue({});
      await repo.upsert('agent1', 'smtp_host', 'encrypted-value');
      expect(prisma.agentSetting.upsert).toHaveBeenCalledWith({
        where: { agentId_key: { agentId: 'agent1', key: 'smtp_host' } },
        update: { encryptedValue: 'encrypted-value' },
        create: expect.objectContaining({
          id: 'test-setting-id',
          agentId: 'agent1',
          key: 'smtp_host',
          encryptedValue: 'encrypted-value',
        }),
      });
    });

    it('returns the upserted record', async () => {
      const mockRecord = {
        id: 'test-setting-id',
        agentId: 'agent1',
        key: 'smtp_host',
        encryptedValue: 'encrypted-value',
      };
      prisma.agentSetting.upsert.mockResolvedValue(mockRecord);

      const result = await repo.upsert('agent1', 'smtp_host', 'encrypted-value');

      expect(result).toEqual(mockRecord);
    });
  });

  describe('findAllForAgent', () => {
    it('returns all settings for a given agent ordered by key', async () => {
      const mockSettings = [
        { id: 's1', agentId: 'agent1', key: 'smtp_host', encryptedValue: 'enc1' },
        { id: 's2', agentId: 'agent1', key: 'whatsapp_api_token', encryptedValue: 'enc2' },
      ];
      prisma.agentSetting.findMany.mockResolvedValue(mockSettings);

      const result = await repo.findAllForAgent('agent1');

      expect(prisma.agentSetting.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { agentId: 'agent1' } }),
      );
      expect(result).toEqual(mockSettings);
    });

    it('returns empty array when agent has no settings', async () => {
      prisma.agentSetting.findMany.mockResolvedValue([]);

      const result = await repo.findAllForAgent('agent-with-no-settings');

      expect(result).toEqual([]);
    });

    it('orders results by key ascending', async () => {
      prisma.agentSetting.findMany.mockResolvedValue([]);

      await repo.findAllForAgent('agent1');

      expect(prisma.agentSetting.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { key: 'asc' } }),
      );
    });
  });

  describe('findByKey', () => {
    it('returns single setting using compound unique constraint', async () => {
      const mockSetting = { id: 's1', agentId: 'agent1', key: 'smtp_host', encryptedValue: 'enc' };
      prisma.agentSetting.findUnique.mockResolvedValue(mockSetting);

      const result = await repo.findByKey('agent1', 'smtp_host');

      expect(prisma.agentSetting.findUnique).toHaveBeenCalledWith({
        where: { agentId_key: { agentId: 'agent1', key: 'smtp_host' } },
      });
      expect(result).toEqual(mockSetting);
    });

    it('returns null when setting does not exist', async () => {
      prisma.agentSetting.findUnique.mockResolvedValue(null);

      const result = await repo.findByKey('agent1', 'smtp_host');

      expect(result).toBeNull();
    });
  });

  describe('deleteByKey', () => {
    it('deletes setting using compound unique constraint', async () => {
      prisma.agentSetting.delete.mockResolvedValue({});

      await repo.deleteByKey('agent1', 'smtp_host');

      expect(prisma.agentSetting.delete).toHaveBeenCalledWith({
        where: { agentId_key: { agentId: 'agent1', key: 'smtp_host' } },
      });
    });

    it('returns the deleted record', async () => {
      const mockDeleted = {
        id: 's1',
        agentId: 'agent1',
        key: 'smtp_host',
        encryptedValue: 'enc',
      };
      prisma.agentSetting.delete.mockResolvedValue(mockDeleted);

      const result = await repo.deleteByKey('agent1', 'smtp_host');

      expect(result).toEqual(mockDeleted);
    });
  });
});
