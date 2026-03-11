// src/domains/admin/__tests__/admin.service.test.ts
import { SETTING_VALIDATORS } from '../admin.validator';
import { SETTING_KEYS } from '@/domains/shared/settings.types';

// ─── Pre-load mocks before importing service ──────────────────
jest.mock('../admin.repository');
jest.mock('@/domains/shared/audit.service');
jest.mock('@/domains/shared/settings.repository');
jest.mock('@/domains/notification/notification.repository');
jest.mock('nodemailer', () => ({
  createTransport: () => ({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'test-msg-id' }),
  }),
}));

import * as adminRepo from '../admin.repository';
import * as auditService from '@/domains/shared/audit.service';
import * as settingsRepo from '@/domains/shared/settings.repository';
import * as adminService from '../admin.service';

const mockAdminRepo = adminRepo as jest.Mocked<typeof adminRepo>;
const mockAudit = auditService as jest.Mocked<typeof auditService>;
const mockSettingsRepo = settingsRepo as jest.Mocked<typeof settingsRepo>;

beforeEach(() => {
  jest.clearAllMocks();
  mockAudit.log.mockResolvedValue(undefined);
});

// ─── SETTING_VALIDATORS ───────────────────────────────────────

describe('SETTING_VALIDATORS', () => {
  it('has a validator for every key in SETTING_KEYS', () => {
    const keys = Object.values(SETTING_KEYS);
    for (const key of keys) {
      expect(SETTING_VALIDATORS).toHaveProperty(key);
    }
  });

  it('accepts valid commission_amount', () => {
    expect(SETTING_VALIDATORS['commission_amount']('1499')).toBe(true);
  });

  it('rejects negative commission_amount', () => {
    expect(SETTING_VALIDATORS['commission_amount']('-500')).toBe(false);
  });

  it('rejects non-numeric commission_amount', () => {
    expect(SETTING_VALIDATORS['commission_amount']('abc')).toBe(false);
  });

  it('accepts gst_rate of 0.09', () => {
    expect(SETTING_VALIDATORS['gst_rate']('0.09')).toBe(true);
  });

  it('rejects gst_rate >= 1', () => {
    expect(SETTING_VALIDATORS['gst_rate']('1')).toBe(false);
  });

  it('rejects transaction_retention_years < 5 (AML/CFT minimum)', () => {
    expect(SETTING_VALIDATORS['transaction_retention_years']('3')).toBe(false);
  });

  it('accepts transaction_retention_years of 5', () => {
    expect(SETTING_VALIDATORS['transaction_retention_years']('5')).toBe(true);
  });

  it('accepts valid reminder_schedule JSON array', () => {
    expect(SETTING_VALIDATORS['reminder_schedule']('[14, 7, 3, 1]')).toBe(true);
  });

  it('rejects invalid reminder_schedule (not JSON)', () => {
    expect(SETTING_VALIDATORS['reminder_schedule']('14,7,3,1')).toBe(false);
  });

  it('rejects reminder_schedule with non-numbers', () => {
    expect(SETTING_VALIDATORS['reminder_schedule']('["14", "7"]')).toBe(false);
  });

  it('accepts valid ai_provider', () => {
    expect(SETTING_VALIDATORS['ai_provider']('anthropic')).toBe(true);
    expect(SETTING_VALIDATORS['ai_provider']('openai')).toBe(true);
    expect(SETTING_VALIDATORS['ai_provider']('google')).toBe(true);
  });

  it('rejects unknown ai_provider', () => {
    expect(SETTING_VALIDATORS['ai_provider']('mistral')).toBe(false);
  });

  it('accepts boolean string for whatsapp_enabled', () => {
    expect(SETTING_VALIDATORS['whatsapp_enabled']('true')).toBe(true);
    expect(SETTING_VALIDATORS['whatsapp_enabled']('false')).toBe(true);
  });

  it('rejects non-boolean string for whatsapp_enabled', () => {
    expect(SETTING_VALIDATORS['whatsapp_enabled']('yes')).toBe(false);
  });
});

// ─── createAgent ─────────────────────────────────────────────

describe('createAgent', () => {
  it('creates agent with hashed password and audits', async () => {
    mockAdminRepo.findAgentByEmail.mockResolvedValue(null);
    mockAdminRepo.createAgent.mockResolvedValue({
      id: 'agent-1',
      name: 'Jane Doe',
      email: 'jane@test.local',
    });

    const result = await adminService.createAgent(
      { name: 'Jane Doe', email: 'jane@test.local', phone: '91234567', ceaRegNo: 'R012345A' },
      'admin-1',
    );

    expect(result.id).toBe('agent-1');
    expect(mockAdminRepo.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Jane Doe',
        email: 'jane@test.local',
        passwordHash: expect.stringMatching(/^\$2[aby]\$/),
      }),
    );
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'agent.created', agentId: 'admin-1' }),
    );
  });

  it('throws ConflictError when email already taken', async () => {
    mockAdminRepo.findAgentByEmail.mockResolvedValue({ id: 'existing' });

    const { ConflictError } = await import('@/domains/shared/errors');
    await expect(
      adminService.createAgent(
        { name: 'Jane', email: 'jane@test.local', phone: '91234567', ceaRegNo: 'R012345A' },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

// ─── deactivateAgent ─────────────────────────────────────────

describe('deactivateAgent', () => {
  it('throws ValidationError when agent has active sellers', async () => {
    mockAdminRepo.findAgentById.mockResolvedValue({
      id: 'a1',
      name: 'A',
      email: 'a@t.com',
      isActive: true,
    });
    mockAdminRepo.countActiveSellers.mockResolvedValue(3);

    const { ValidationError } = await import('@/domains/shared/errors');
    await expect(adminService.deactivateAgent('a1', 'admin-1')).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(mockAdminRepo.updateAgentStatus).not.toHaveBeenCalled();
  });

  it('deactivates and audits when no active sellers', async () => {
    mockAdminRepo.findAgentById.mockResolvedValue({
      id: 'a1',
      name: 'A',
      email: 'a@t.com',
      isActive: true,
    });
    mockAdminRepo.countActiveSellers.mockResolvedValue(0);
    mockAdminRepo.updateAgentStatus.mockResolvedValue(undefined);

    await adminService.deactivateAgent('a1', 'admin-1');

    expect(mockAdminRepo.updateAgentStatus).toHaveBeenCalledWith('a1', false);
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'agent.deactivated' }),
    );
  });
});

// ─── reactivateAgent ─────────────────────────────────────────

describe('reactivateAgent', () => {
  it('reactivates and audits', async () => {
    mockAdminRepo.findAgentById.mockResolvedValue({
      id: 'a1',
      name: 'A',
      email: 'a@t.com',
      isActive: false,
    });
    mockAdminRepo.updateAgentStatus.mockResolvedValue(undefined);

    await adminService.reactivateAgent('a1', 'admin-1');

    expect(mockAdminRepo.updateAgentStatus).toHaveBeenCalledWith('a1', true);
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'agent.reactivated' }),
    );
  });
});

// ─── anonymiseAgent ──────────────────────────────────────────

describe('anonymiseAgent', () => {
  it('throws ValidationError when agent has active sellers', async () => {
    mockAdminRepo.findAgentById.mockResolvedValue({
      id: 'a1',
      name: 'A',
      email: 'a@t.com',
      isActive: true,
    });
    mockAdminRepo.countActiveSellers.mockResolvedValue(1);

    const { ValidationError } = await import('@/domains/shared/errors');
    await expect(adminService.anonymiseAgent('a1', 'admin-1')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('anonymises fields and audits', async () => {
    mockAdminRepo.findAgentById.mockResolvedValue({
      id: 'a1',
      name: 'Agent A',
      email: 'a@t.com',
      isActive: true,
    });
    mockAdminRepo.countActiveSellers.mockResolvedValue(0);
    mockAdminRepo.anonymiseAgent.mockResolvedValue(undefined);

    await adminService.anonymiseAgent('a1', 'admin-1');

    expect(mockAdminRepo.anonymiseAgent).toHaveBeenCalledWith('a1');
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'agent.anonymised' }),
    );
  });
});

// ─── reassignSeller ──────────────────────────────────────────

describe('reassignSeller', () => {
  it('validates new agent is active before reassigning', async () => {
    mockAdminRepo.findSellerById.mockResolvedValue({ id: 's1', agentId: 'a1', name: 'Seller' });
    mockAdminRepo.findAgentById.mockResolvedValue({
      id: 'a2',
      name: 'B',
      email: 'b@t.com',
      isActive: false,
    });

    const { ValidationError } = await import('@/domains/shared/errors');
    await expect(adminService.reassignSeller('s1', 'a2', 'admin-1')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('reassigns and audits with fromAgentId and toAgentId', async () => {
    mockAdminRepo.findSellerById.mockResolvedValue({ id: 's1', agentId: 'a1', name: 'Seller' });
    mockAdminRepo.findAgentById.mockResolvedValue({
      id: 'a2',
      name: 'B',
      email: 'b@t.com',
      isActive: true,
    });
    mockAdminRepo.assignSeller.mockResolvedValue(undefined);

    await adminService.reassignSeller('s1', 'a2', 'admin-1');

    expect(mockAdminRepo.assignSeller).toHaveBeenCalledWith('s1', 'a2');
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'lead.reassigned',
        details: expect.objectContaining({ fromAgentId: 'a1', toAgentId: 'a2' }),
      }),
    );
  });
});

// ─── updateSetting ───────────────────────────────────────────

describe('updateSetting', () => {
  it('rejects negative commission_amount', async () => {
    const { ValidationError } = await import('@/domains/shared/errors');
    await expect(
      adminService.updateSetting('commission_amount', '-500', 'admin-1'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects transaction_retention_years < 5 (AML/CFT minimum)', async () => {
    const { ValidationError } = await import('@/domains/shared/errors');
    await expect(
      adminService.updateSetting('transaction_retention_years', '3', 'admin-1'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects unknown setting key', async () => {
    const { ValidationError } = await import('@/domains/shared/errors');
    await expect(
      adminService.updateSetting('unknown_key', 'value', 'admin-1'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('saves valid value and audits with old and new values', async () => {
    mockSettingsRepo.findByKey.mockResolvedValue({
      id: 'id-1',
      key: 'commission_amount',
      value: '1499',
      description: 'Commission amount',
      updatedByAgentId: null,
      updatedAt: new Date(),
      createdAt: new Date(),
    });
    mockSettingsRepo.upsert.mockResolvedValue({
      id: 'id-1',
      key: 'commission_amount',
      value: '1600',
      description: 'Commission amount',
      updatedByAgentId: 'admin-1',
      updatedAt: new Date(),
      createdAt: new Date(),
    });

    await adminService.updateSetting('commission_amount', '1600', 'admin-1');

    expect(mockSettingsRepo.upsert).toHaveBeenCalledWith(
      'commission_amount',
      '1600',
      expect.any(String),
      'admin-1',
    );
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'setting.changed',
        details: expect.objectContaining({
          key: 'commission_amount',
          oldValue: '1499',
          newValue: '1600',
        }),
      }),
    );
  });
});
