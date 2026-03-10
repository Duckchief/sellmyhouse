import * as service from '../agent-settings.service';

jest.mock('../agent-settings.repository');
jest.mock('../../shared/audit.service');
jest.mock('../../shared/encryption');
jest.mock('nodemailer');
jest.mock('axios');

const repo = jest.requireMock('../agent-settings.repository');
const auditService = jest.requireMock('../../shared/audit.service');
const encryption = jest.requireMock('../../shared/encryption');

describe('AgentSettingsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    encryption.encrypt = jest.fn().mockReturnValue('encrypted-value');
    encryption.decrypt = jest.fn().mockReturnValue('decrypted-value');
    auditService.log = jest.fn().mockResolvedValue(undefined);
  });

  describe('saveSetting', () => {
    it('encrypts value before upsert', async () => {
      repo.upsert = jest.fn().mockResolvedValue({});

      await service.saveSetting('agent1', 'smtp_host', 'smtp.gmail.com');

      expect(encryption.encrypt).toHaveBeenCalledWith('smtp.gmail.com');
      expect(repo.upsert).toHaveBeenCalledWith('agent1', 'smtp_host', 'encrypted-value');
    });

    it('logs audit with key but not value', async () => {
      repo.upsert = jest.fn().mockResolvedValue({});

      await service.saveSetting('agent1', 'whatsapp_api_token', 'secret-token');

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'agent_setting.updated',
          details: { key: 'whatsapp_api_token' },
        }),
      );
      // Ensure the value is NOT in the audit log
      const auditCall = auditService.log.mock.calls[0][0];
      expect(auditCall.details.value).toBeUndefined();
    });
  });

  describe('getSetting', () => {
    it('returns null when key not found', async () => {
      repo.findByKey = jest.fn().mockResolvedValue(null);

      const result = await service.getSetting('agent1', 'smtp_host');
      expect(result).toBeNull();
    });

    it('decrypts value on get', async () => {
      repo.findByKey = jest
        .fn()
        .mockResolvedValue({ encryptedValue: 'encrypted', updatedAt: new Date() });

      const result = await service.getSetting('agent1', 'smtp_host');
      expect(encryption.decrypt).toHaveBeenCalledWith('encrypted');
      expect(result).toBe('decrypted-value');
    });
  });

  describe('getSettingsView', () => {
    it('masks sensitive values', async () => {
      encryption.decrypt = jest.fn().mockReturnValue('my-long-secret-token-1234');
      repo.findAllForAgent = jest.fn().mockResolvedValue([
        { key: 'whatsapp_api_token', encryptedValue: 'enc', updatedAt: new Date() },
        { key: 'smtp_host', encryptedValue: 'enc', updatedAt: new Date() },
      ]);

      const result = await service.getSettingsView('agent1');

      const tokenView = result.find((r) => r.key === 'whatsapp_api_token');
      expect(tokenView?.maskedValue).toBe('****1234');

      const hostView = result.find((r) => r.key === 'smtp_host');
      expect(hostView?.maskedValue).toBe('my-long-secret-token-1234'); // host not masked
    });

    it('returns null maskedValue for unconfigured keys', async () => {
      repo.findAllForAgent = jest.fn().mockResolvedValue([]);

      const result = await service.getSettingsView('agent1');

      expect(result.length).toBe(9); // 3 WhatsApp + 6 SMTP
      expect(result.every((r) => r.maskedValue === null)).toBe(true);
    });
  });
});
