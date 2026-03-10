import { get, getNumber, getBoolean, getCommission } from './settings.service';
import * as settingsRepo from './settings.repository';

jest.mock('./settings.repository');

const mockRepo = settingsRepo as jest.Mocked<typeof settingsRepo>;

describe('settings.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('get', () => {
    it('returns setting value', async () => {
      mockRepo.findByKey.mockResolvedValue({
        id: '1',
        key: 'ai_provider',
        value: 'anthropic',
        description: '',
        updatedByAgentId: null,
        updatedAt: new Date(),
        createdAt: new Date(),
      });

      const result = await get('ai_provider');
      expect(result).toBe('anthropic');
    });

    it('returns default when setting not found', async () => {
      mockRepo.findByKey.mockResolvedValue(null);

      const result = await get('ai_provider', 'anthropic');
      expect(result).toBe('anthropic');
    });

    it('throws when setting not found and no default', async () => {
      mockRepo.findByKey.mockResolvedValue(null);

      await expect(get('nonexistent')).rejects.toThrow('Setting not found: nonexistent');
    });
  });

  describe('getNumber', () => {
    it('returns parsed number', async () => {
      mockRepo.findByKey.mockResolvedValue({
        id: '1',
        key: 'commission_amount',
        value: '1499',
        description: '',
        updatedByAgentId: null,
        updatedAt: new Date(),
        createdAt: new Date(),
      });

      const result = await getNumber('commission_amount');
      expect(result).toBe(1499);
    });
  });

  describe('getBoolean', () => {
    it('returns true for "true"', async () => {
      mockRepo.findByKey.mockResolvedValue({
        id: '1',
        key: 'whatsapp_enabled',
        value: 'true',
        description: '',
        updatedByAgentId: null,
        updatedAt: new Date(),
        createdAt: new Date(),
      });

      const result = await getBoolean('whatsapp_enabled');
      expect(result).toBe(true);
    });

    it('returns false for non-"true"', async () => {
      mockRepo.findByKey.mockResolvedValue({
        id: '1',
        key: 'maintenance_mode',
        value: 'false',
        description: '',
        updatedByAgentId: null,
        updatedAt: new Date(),
        createdAt: new Date(),
      });

      const result = await getBoolean('maintenance_mode');
      expect(result).toBe(false);
    });
  });

  describe('getCommission', () => {
    it('returns commission amount and total with GST', async () => {
      mockRepo.findByKey
        .mockResolvedValueOnce({
          id: '1',
          key: 'commission_amount',
          value: '1499',
          description: '',
          updatedByAgentId: null,
          updatedAt: new Date(),
          createdAt: new Date(),
        })
        .mockResolvedValueOnce({
          id: '2',
          key: 'gst_rate',
          value: '0.09',
          description: '',
          updatedByAgentId: null,
          updatedAt: new Date(),
          createdAt: new Date(),
        });

      const result = await getCommission();
      expect(result.amount).toBe(1499);
      expect(result.gstRate).toBe(0.09);
      expect(result.gstAmount).toBeCloseTo(134.91);
      expect(result.total).toBeCloseTo(1633.91);
    });
  });
});
