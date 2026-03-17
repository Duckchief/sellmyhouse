// src/domains/admin/__tests__/admin.service.test.ts
import { SETTING_VALIDATORS } from '../admin.validator';
import { SETTING_KEYS } from '@/domains/shared/settings.types';

// ─── Pre-load mocks before importing service ──────────────────
jest.mock('../admin.repository');
jest.mock('@/domains/shared/audit.service');
jest.mock('@/domains/shared/audit.repository');
jest.mock('@/domains/shared/settings.service');
jest.mock('@/domains/notification/notification.service');
jest.mock('@/domains/compliance/compliance.service');
jest.mock('@/domains/agent/agent.service');
jest.mock('@/domains/transaction/transaction.service');
jest.mock('@/domains/viewing/viewing.service');
jest.mock('@/domains/offer/offer.service');
jest.mock('nodemailer', () => ({
  createTransport: () => ({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'test-msg-id' }),
  }),
}));

import * as adminRepo from '../admin.repository';
import * as auditService from '@/domains/shared/audit.service';
import * as auditRepo from '@/domains/shared/audit.repository';
import * as settingsService from '@/domains/shared/settings.service';
import * as notificationService from '@/domains/notification/notification.service';
import * as complianceService from '@/domains/compliance/compliance.service';
import * as agentService from '@/domains/agent/agent.service';
import * as transactionService from '@/domains/transaction/transaction.service';
import * as viewingService from '@/domains/viewing/viewing.service';
import * as offerService from '@/domains/offer/offer.service';
import * as adminService from '../admin.service';
import { NotFoundError } from '@/domains/shared/errors';

const mockAdminRepo = adminRepo as jest.Mocked<typeof adminRepo>;
const mockAudit = auditService as jest.Mocked<typeof auditService>;
const mockAuditRepo = auditRepo as jest.Mocked<typeof auditRepo>;
const mockSettingsService = settingsService as jest.Mocked<typeof settingsService>;
const mockNotificationService = notificationService as jest.Mocked<typeof notificationService>;
const mockComplianceService = complianceService as jest.Mocked<typeof complianceService>;
const mockAgentService = agentService as jest.Mocked<typeof agentService>;
const mockTransactionService = transactionService as jest.Mocked<typeof transactionService>;
const mockViewingService = viewingService as jest.Mocked<typeof viewingService>;
const mockOfferService = offerService as jest.Mocked<typeof offerService>;

beforeEach(() => {
  jest.clearAllMocks();
  mockAudit.log.mockResolvedValue(undefined);
});

// ─── getAdminPipeline ────────────────────────────────────────

describe('getAdminPipeline', () => {
  it('returns stages grouped by seller status', async () => {
    mockAdminRepo.getPipelineForAdmin.mockResolvedValue([
      {
        id: 's1',
        name: 'Alice',
        phone: '91234567',
        status: 'lead',
        agent: { name: 'Agent A' },
        properties: [{ town: 'TAMPINES', askingPrice: { toNumber: () => 500000 } }],
      },
      {
        id: 's2',
        name: 'Bob',
        phone: '91234568',
        status: 'active',
        agent: null,
        properties: [],
      },
    ] as never);

    const result = await adminService.getAdminPipeline();
    expect(result.stages).toHaveLength(2);
    expect(result.stages[0].status).toBe('lead');
    expect(result.stages[0].sellers[0].agentName).toBe('Agent A');
    expect(result.stages[0].sellers[0].town).toBe('TAMPINES');
    expect(result.stages[1].status).toBe('active');
    expect(result.totalSellers).toBe(2);
  });

  it('returns empty stages array when no sellers', async () => {
    mockAdminRepo.getPipelineForAdmin.mockResolvedValue([]);

    const result = await adminService.getAdminPipeline();
    expect(result.stages).toHaveLength(0);
    expect(result.totalSellers).toBe(0);
  });
});

// ─── getUnassignedLeads ─────────────────────────────────────

describe('getUnassignedLeads', () => {
  it('returns paginated unassigned leads', async () => {
    mockAdminRepo.findUnassignedLeads.mockResolvedValue([
      {
        id: 's1',
        name: 'Alice',
        phone: '91234567',
        status: 'lead',
        leadSource: 'website',
        createdAt: new Date(),
        properties: [{ town: 'TAMPINES' }],
      },
    ] as never);
    mockAdminRepo.countUnassignedLeads.mockResolvedValue(1);

    const result = await adminService.getUnassignedLeads(1);
    expect(result.leads).toHaveLength(1);
    expect(result.leads[0].town).toBe('TAMPINES');
    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  it('defaults to page 1 when no page provided', async () => {
    mockAdminRepo.findUnassignedLeads.mockResolvedValue([]);
    mockAdminRepo.countUnassignedLeads.mockResolvedValue(0);

    const result = await adminService.getUnassignedLeads();
    expect(result.page).toBe(1);
    expect(mockAdminRepo.findUnassignedLeads).toHaveBeenCalledWith(1, 25);
  });
});

// ─── getAdminLeadQueue ──────────────────────────────────────

describe('getAdminLeadQueue', () => {
  const unassignedSeller = {
    id: 's1',
    name: 'Alice',
    phone: '91234567',
    leadSource: 'website',
    createdAt: new Date('2026-01-01'),
    properties: [{ town: 'TAMPINES' }],
  };

  const assignedSeller = {
    id: 's2',
    name: 'Bob',
    phone: '91234568',
    leadSource: null,
    createdAt: new Date('2026-01-02'),
    properties: [],
  };

  it('returns unassigned and all leads', async () => {
    mockAdminRepo.findUnassignedLeads.mockResolvedValue([unassignedSeller] as never);
    mockAdminRepo.countUnassignedLeads.mockResolvedValue(1);
    mockAdminRepo.findAllLeads.mockResolvedValue([assignedSeller, unassignedSeller] as never);

    const result = await adminService.getAdminLeadQueue();

    expect(result.unassigned.leads).toHaveLength(1);
    expect(result.unassigned.leads[0].name).toBe('Alice');
    expect(result.all).toHaveLength(2);
    expect(result.all[0].name).toBe('Bob');
    expect(result.all[0].town).toBeNull();
    expect(result.all[1].town).toBe('TAMPINES');
  });

  it('returns empty arrays when no leads exist', async () => {
    mockAdminRepo.findUnassignedLeads.mockResolvedValue([]);
    mockAdminRepo.countUnassignedLeads.mockResolvedValue(0);
    mockAdminRepo.findAllLeads.mockResolvedValue([]);

    const result = await adminService.getAdminLeadQueue();

    expect(result.unassigned.leads).toHaveLength(0);
    expect(result.all).toHaveLength(0);
  });

  it('passes page to getUnassignedLeads', async () => {
    mockAdminRepo.findUnassignedLeads.mockResolvedValue([]);
    mockAdminRepo.countUnassignedLeads.mockResolvedValue(0);
    mockAdminRepo.findAllLeads.mockResolvedValue([]);

    await adminService.getAdminLeadQueue(3);

    expect(mockAdminRepo.findUnassignedLeads).toHaveBeenCalledWith(3, 25);
  });
});

// ─── getReviewQueue ─────────────────────────────────────────

describe('getReviewQueue', () => {
  it('returns unified review items sorted by date ascending', async () => {
    const earlyDate = new Date('2026-01-01');
    const lateDate = new Date('2026-02-01');
    mockAdminRepo.getReviewQueue.mockResolvedValue({
      pendingListings: [
        {
          id: 'p1',
          updatedAt: lateDate,
          property: { block: '123', street: 'Tampines St 11', seller: { id: 's1', name: 'Alice' } },
        },
      ],
      pendingReports: [
        {
          id: 'r1',
          generatedAt: earlyDate,
          seller: { id: 's2', name: 'Bob' },
          property: { block: '456', street: 'Bedok St 22' },
        },
      ],
    } as never);

    const result = await adminService.getReviewQueue();
    expect(result).toHaveLength(2);
    // Sorted ascending by submittedAt — earlyDate first
    expect(result[0].type).toBe('report');
    expect(result[0].sellerName).toBe('Bob');
    expect(result[1].type).toBe('listing');
    expect(result[1].sellerName).toBe('Alice');
  });

  it('returns empty array when no pending items', async () => {
    mockAdminRepo.getReviewQueue.mockResolvedValue({
      pendingListings: [],
      pendingReports: [],
    } as never);

    const result = await adminService.getReviewQueue();
    expect(result).toHaveLength(0);
  });
});

// ─── getNotifications ────────────────────────────────────────

describe('getNotifications', () => {
  it('delegates to notificationService with date conversion', async () => {
    const mockResult = {
      notifications: [{ id: 'n1', channel: 'email', status: 'sent' }],
      total: 1,
      page: 1,
      limit: 50,
      totalPages: 1,
    };
    mockNotificationService.getNotifications.mockResolvedValue(mockResult as never);

    const result = await adminService.getNotifications({
      channel: 'email',
      status: 'sent',
      dateFrom: '2026-01-01',
      dateTo: '2026-03-15',
      page: 1,
    });

    expect(result).toEqual(mockResult);
    expect(mockNotificationService.getNotifications).toHaveBeenCalledWith({
      channel: 'email',
      status: 'sent',
      dateFrom: expect.any(Date),
      dateTo: expect.any(Date),
      page: 1,
      limit: 50,
    });
  });

  it('handles empty filter', async () => {
    const mockResult = { notifications: [], total: 0, page: 1, limit: 50, totalPages: 0 };
    mockNotificationService.getNotifications.mockResolvedValue(mockResult as never);

    const result = await adminService.getNotifications({});

    expect(result).toEqual(mockResult);
    expect(mockNotificationService.getNotifications).toHaveBeenCalledWith({
      channel: undefined,
      status: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      page: undefined,
      limit: 50,
    });
  });
});

// ─── getAuditLog ─────────────────────────────────────────────

describe('getAuditLog', () => {
  it('delegates to auditRepo.findMany', async () => {
    const mockResult = {
      entries: [{ id: 'a1', action: 'agent.created', entityType: 'agent', entityId: 'x' }],
      total: 1,
      page: 1,
      limit: 50,
      totalPages: 1,
    };
    mockAuditRepo.findMany.mockResolvedValue(mockResult as never);

    const result = await adminService.getAuditLog({ action: 'agent.created', page: 1 });

    expect(result).toEqual(mockResult);
    expect(mockAuditRepo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'agent.created', page: 1 }),
    );
  });
});

// ─── exportAuditLogCsv ──────────────────────────────────────

describe('exportAuditLogCsv', () => {
  it('exports entries and logs the export action', async () => {
    const entries = [
      { id: 'a1', action: 'test', entityType: 'x', entityId: '1', createdAt: new Date() },
    ];
    mockAuditRepo.exportAll.mockResolvedValue(entries as never);

    const result = await adminService.exportAuditLogCsv({}, 'admin-1');

    expect(result).toEqual(entries);
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'audit_log.exported',
        agentId: 'admin-1',
        details: expect.objectContaining({ entryCount: 1 }),
      }),
    );
  });
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
    mockSettingsService.findByKey.mockResolvedValue({
      id: 'id-1',
      key: 'commission_amount',
      value: '1499',
      description: 'Commission amount',
      updatedByAgentId: null,
      updatedAt: new Date(),
      createdAt: new Date(),
    });
    mockSettingsService.upsert.mockResolvedValue({
      id: 'id-1',
      key: 'commission_amount',
      value: '1600',
      description: 'Commission amount',
      updatedByAgentId: 'admin-1',
      updatedAt: new Date(),
      createdAt: new Date(),
    });

    await adminService.updateSetting('commission_amount', '1600', 'admin-1');

    expect(mockSettingsService.upsert).toHaveBeenCalledWith(
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

// ─── getAdminSellerDetail ────────────────────────────────────

describe('getAdminSellerDetail', () => {
  beforeEach(() => {
    mockAgentService.getNotificationHistory.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      totalPages: 0,
    });
    mockComplianceService.findEaaBySellerId.mockResolvedValue(null);
    mockTransactionService.findTransactionBySellerId.mockResolvedValue(null);
    mockTransactionService.findOtpByTransactionId.mockResolvedValue(null);
    mockViewingService.findFirstViewingDateForProperty.mockResolvedValue(null);
    mockComplianceService.findCddRecordByTransactionAndSubjectType.mockResolvedValue(null);
    mockOfferService.findOffer.mockResolvedValue(null);
  });

  const baseSeller = {
    id: 'seller-1',
    name: 'Alice Tan',
    email: 'alice@example.com',
    phone: '91234567',
    status: 'lead',
    notificationPreference: 'whatsapp_and_email',
    createdAt: new Date('2026-01-01'),
    agent: { id: 'agent-1', name: 'Bob Agent', ceaRegNo: 'R12345', phone: '98765432' },
    properties: [
      {
        id: 'prop-1',
        block: '123',
        street: 'Tampines Ave 1',
        town: 'TAMPINES',
        flatType: '4 ROOM',
        floorAreaSqm: 90,
        storeyRange: '10 TO 12',
        askingPrice: { toNumber: () => 500000 },
        status: 'listed',
      },
    ],
    transactions: [
      {
        id: 'txn-1',
        status: 'option_issued',
        offerId: 'offer-1',
        agreedPrice: { toNumber: () => 498000 },
        hdbApplicationStatus: 'not_started',
        otp: { status: 'prepared' },
        createdAt: new Date('2026-02-01'),
      },
    ],
    consentRecords: [
      { id: 'cr-1', consentWithdrawnAt: null, createdAt: new Date() },
      { id: 'cr-2', consentWithdrawnAt: new Date(), createdAt: new Date() },
    ],
  };

  const baseCdd = {
    id: 'cdd-1',
    riskLevel: 'standard',
    identityVerified: true,
    verifiedAt: new Date('2026-01-15'),
    createdAt: new Date('2026-01-15'),
  };

  const baseAudit = [
    {
      id: 'log-1',
      action: 'seller.created',
      entityType: 'seller',
      entityId: 'seller-1',
      details: {},
      createdAt: new Date(),
    },
  ];

  const baseNotification = [
    {
      id: 'notif-1',
      channel: 'whatsapp',
      templateName: 'welcome',
      content: 'Hello',
      status: 'delivered',
      sentAt: new Date('2026-02-01'),
      deliveredAt: new Date('2026-02-01'),
      createdAt: new Date('2026-02-01'),
    },
  ];

  it('throws NotFoundError when seller not found', async () => {
    mockAdminRepo.findSellerDetailForAdmin.mockResolvedValue(null);
    mockComplianceService.findLatestSellerCddRecord.mockResolvedValue(null);
    mockAuditRepo.findByEntity.mockResolvedValue([] as never);

    await expect(adminService.getAdminSellerDetail('unknown-id')).rejects.toThrow(NotFoundError);
  });

  it('returns full detail when seller exists', async () => {
    mockAdminRepo.findSellerDetailForAdmin.mockResolvedValue(baseSeller as never);
    mockComplianceService.findLatestSellerCddRecord.mockResolvedValue(baseCdd as never);
    mockAuditRepo.findByEntity.mockResolvedValue(baseAudit as never);
    mockAgentService.getNotificationHistory.mockResolvedValue({
      items: baseNotification,
      total: 1,
      page: 1,
      totalPages: 1,
    } as never);
    mockTransactionService.findTransactionBySellerId.mockResolvedValue({
      id: 'txn-1',
      status: 'option_issued',
      offerId: 'offer-1',
      agreedPrice: { toNumber: () => 498000 },
      hdbApplicationStatus: 'not_started',
      hdbAppSubmittedAt: null,
      hdbAppApprovedAt: null,
      hdbAppointmentDate: null,
      completionDate: null,
      createdAt: new Date('2026-02-01'),
    } as never);
    mockTransactionService.findOtpByTransactionId.mockResolvedValue({
      status: 'prepared',
      agentReviewedAt: null,
      issuedAt: null,
      exercisedAt: null,
    } as never);

    const result = await adminService.getAdminSellerDetail('seller-1');

    expect(result.seller.name).toBe('Alice Tan');
    expect(result.seller.status).toBe('lead');
    expect(result.property?.town).toBe('TAMPINES');
    expect(result.property?.askingPrice).toBe(500000);
    expect(result.agent?.ceaRegNo).toBe('R12345');
    expect(result.transaction?.status).toBe('option_issued');
    expect(result.transaction?.offerId).toBe('offer-1');
    expect(result.transaction?.agreedPrice).toBe(498000);
    expect(result.transaction?.otpStatus).toBe('prepared');
    expect(result.compliance.cdd?.riskLevel).toBe('standard');
    expect(result.compliance.cdd?.identityVerified).toBe(true);
    expect(result.compliance.consentCount).toBe(2);
    expect(result.compliance.hasWithdrawal).toBe(true);
    expect(result.auditLog).toHaveLength(1);
    expect(result.auditLog[0].action).toBe('seller.created');
    expect(result.milestones.length).toBeGreaterThan(0);
    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0].channel).toBe('whatsapp');
  });

  it('returns null property, agent and transaction when seller has none', async () => {
    mockAdminRepo.findSellerDetailForAdmin.mockResolvedValue({
      ...baseSeller,
      agent: null,
      properties: [],
      transactions: [],
      consentRecords: [],
    } as never);
    mockComplianceService.findLatestSellerCddRecord.mockResolvedValue(null);
    mockAuditRepo.findByEntity.mockResolvedValue([] as never);

    const result = await adminService.getAdminSellerDetail('seller-2');
    expect(result.property).toBeNull();
    expect(result.transaction).toBeNull();
    expect(result.agent).toBeNull();
    expect(result.compliance.cdd).toBeNull();
    expect(result.compliance.consentCount).toBe(0);
    expect(result.compliance.hasWithdrawal).toBe(false);
    expect(result.auditLog).toHaveLength(0);
  });

  it('caps audit log at 20 entries', async () => {
    const manyLogs = Array.from({ length: 30 }, (_, i) => ({
      id: `log-${i}`,
      action: 'seller.updated',
      entityType: 'seller',
      entityId: 'seller-1',
      details: {},
      createdAt: new Date(),
    }));
    mockAdminRepo.findSellerDetailForAdmin.mockResolvedValue(baseSeller as never);
    mockComplianceService.findLatestSellerCddRecord.mockResolvedValue(baseCdd as never);
    mockAuditRepo.findByEntity.mockResolvedValue(manyLogs as never);

    const result = await adminService.getAdminSellerDetail('seller-1');
    expect(result.auditLog).toHaveLength(20);
  });
});
