import { log, getEntityHistory } from './audit.service';
import * as auditRepo from './audit.repository';

jest.mock('./audit.repository');

const mockRepo = auditRepo as jest.Mocked<typeof auditRepo>;

describe('audit.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('log', () => {
    it('creates an audit entry', async () => {
      const entry = {
        action: 'property.created',
        entityType: 'Property',
        entityId: 'prop_123',
        details: { town: 'Tampines' },
      };
      mockRepo.create.mockResolvedValue({
        id: 'audit_1',
        agentId: null,
        ...entry,
        ipAddress: null,
        createdAt: new Date(),
      });

      await log(entry);

      expect(mockRepo.create).toHaveBeenCalledWith(entry);
    });

    it('does not throw on failure (fire-and-forget)', async () => {
      mockRepo.create.mockRejectedValue(new Error('DB down'));

      // Should not throw
      await expect(
        log({
          action: 'test',
          entityType: 'Test',
          entityId: '1',
          details: {},
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('getEntityHistory', () => {
    it('returns audit entries for an entity', async () => {
      const records = [
        {
          id: 'audit_1',
          agentId: null,
          action: 'property.created',
          entityType: 'Property',
          entityId: 'prop_123',
          details: {},
          ipAddress: null,
          createdAt: new Date(),
        },
      ];
      mockRepo.findByEntity.mockResolvedValue(records);

      const result = await getEntityHistory('Property', 'prop_123');

      expect(result).toEqual(records);
      expect(mockRepo.findByEntity).toHaveBeenCalledWith('Property', 'prop_123');
    });
  });
});
