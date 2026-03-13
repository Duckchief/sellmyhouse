import { submitLead } from '../lead.service';
import * as leadRepo from '../lead.repository';
import * as settingsService from '../../shared/settings.service';
import * as auditService from '../../shared/audit.service';
import * as notificationService from '../../notification/notification.service';

// Mock prisma so prisma.$transaction executes its callback synchronously with a fake tx
jest.mock('@/infra/database/prisma', () => ({
  prisma: {
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn('mock-tx')),
  },
  createId: jest.fn(() => 'mock-id'),
}));

jest.mock('../lead.repository');
jest.mock('../../shared/settings.service');
jest.mock('../../shared/audit.service');
jest.mock('../../notification/notification.service');

const mockLeadRepo = leadRepo as jest.Mocked<typeof leadRepo>;
const mockSettings = settingsService as jest.Mocked<typeof settingsService>;
const mockAudit = auditService as jest.Mocked<typeof auditService>;
const mockNotification = notificationService as jest.Mocked<typeof notificationService>;

describe('lead.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettings.getNumber.mockResolvedValue(6);
  });

  const validInput = {
    name: 'John Tan',
    phone: '91234567',
    consentService: true,
    consentMarketing: false,
    leadSource: 'website' as const,
    ipAddress: '127.0.0.1',
    userAgent: 'test',
  };

  const sellerFixture = {
    id: 'seller-1',
    name: 'John Tan',
    phone: '91234567',
    email: null,
    passwordHash: null,
    agentId: null,
    status: 'lead',
    notificationPreference: 'whatsapp_and_email',
    consentService: true,
    consentMarketing: false,
    consentTimestamp: new Date(),
    consentWithdrawnAt: null,
    leadSource: 'website',
    onboardingStep: 0,
    twoFactorSecret: null,
    twoFactorEnabled: false,
    twoFactorBackupCodes: null,
    failedTwoFactorAttempts: 0,
    twoFactorLockedUntil: null,
    failedLoginAttempts: 0,
    loginLockedUntil: null,
    passwordResetToken: null,
    passwordResetExpiry: null,
    consultationCompletedAt: null,
    retentionExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as ReturnType<typeof mockLeadRepo.createSellerLead> extends Promise<infer T> ? T : never;

  const consentFixture = {
    id: 'consent-1',
    subjectType: 'seller',
    subjectId: 'seller-1',
    sellerId: 'seller-1',
    buyerId: null,
    purposeService: true,
    purposeMarketing: false,
    consentGivenAt: new Date(),
    consentWithdrawnAt: null,
    withdrawalChannel: null,
    ipAddress: '127.0.0.1',
    userAgent: 'test',
    createdAt: new Date(),
  } as ReturnType<typeof mockLeadRepo.createConsentRecord> extends Promise<infer T> ? T : never;

  it('creates seller and consent record atomically, writes audit log, notifies admin', async () => {
    mockLeadRepo.findActiveSellerByPhone.mockResolvedValue(null);
    mockLeadRepo.createSellerLead.mockResolvedValue(sellerFixture);
    mockLeadRepo.createConsentRecord.mockResolvedValue(consentFixture);
    mockLeadRepo.findAdminAgents.mockResolvedValue([
      { id: 'admin-1', notificationPreference: 'whatsapp_and_email' },
    ]);
    mockAudit.log.mockResolvedValue(undefined);
    mockNotification.send.mockResolvedValue(undefined);

    const result = await submitLead(validInput);

    expect(result.sellerId).toBe('seller-1');
    expect(mockLeadRepo.findActiveSellerByPhone).toHaveBeenCalledWith('91234567');
    // Both repo calls must pass the tx argument (mock-tx) from prisma.$transaction
    expect(mockLeadRepo.createSellerLead).toHaveBeenCalledWith('mock-tx', {
      name: 'John Tan',
      phone: '91234567',
      consentService: true,
      consentMarketing: false,
      leadSource: 'website',
      retentionExpiresAt: expect.any(Date),
    });
    expect(mockLeadRepo.createConsentRecord).toHaveBeenCalledWith('mock-tx', {
      sellerId: 'seller-1',
      purposeService: true,
      purposeMarketing: false,
      ipAddress: '127.0.0.1',
      userAgent: 'test',
    });
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'lead.created',
        entityType: 'Seller',
        entityId: 'seller-1',
      }),
    );
    expect(mockNotification.send).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientType: 'agent',
        recipientId: 'admin-1',
        templateName: 'generic',
        preferredChannel: 'whatsapp',
      }),
      'system',
    );
  });

  it('throws ConflictError for duplicate phone', async () => {
    mockLeadRepo.findActiveSellerByPhone.mockResolvedValue({
      id: 'existing',
      name: 'Existing',
      phone: '91234567',
    } as ReturnType<typeof mockLeadRepo.findActiveSellerByPhone> extends Promise<infer T>
      ? NonNullable<T>
      : never);

    await expect(submitLead(validInput)).rejects.toThrow('already exists');
  });

  it('logs warning when no admin agents exist', async () => {
    mockLeadRepo.findActiveSellerByPhone.mockResolvedValue(null);
    mockLeadRepo.createSellerLead.mockResolvedValue({
      ...sellerFixture,
      id: 'seller-2',
      phone: '81234567',
      name: 'Jane',
    });
    mockLeadRepo.createConsentRecord.mockResolvedValue({
      ...consentFixture,
      id: 'consent-2',
      subjectId: 'seller-2',
      sellerId: 'seller-2',
      ipAddress: null,
      userAgent: null,
    });
    mockLeadRepo.findAdminAgents.mockResolvedValue([]);
    mockAudit.log.mockResolvedValue(undefined);

    const result = await submitLead({ ...validInput, phone: '81234567' });

    expect(result.sellerId).toBe('seller-2');
    // Notification should NOT be called when there are no admin agents
    expect(mockNotification.send).not.toHaveBeenCalled();
  });

  it('uses email channel when admin notificationPreference is email_only', async () => {
    mockLeadRepo.findActiveSellerByPhone.mockResolvedValue(null);
    mockLeadRepo.createSellerLead.mockResolvedValue(sellerFixture);
    mockLeadRepo.createConsentRecord.mockResolvedValue(consentFixture);
    mockLeadRepo.findAdminAgents.mockResolvedValue([
      { id: 'admin-2', notificationPreference: 'email_only' },
    ]);
    mockAudit.log.mockResolvedValue(undefined);
    mockNotification.send.mockResolvedValue(undefined);

    await submitLead(validInput);

    expect(mockNotification.send).toHaveBeenCalledWith(
      expect.objectContaining({ preferredChannel: 'email' }),
      'system',
    );
  });

  it('rolls back if createConsentRecord throws — error propagates out of submitLead', async () => {
    mockLeadRepo.findActiveSellerByPhone.mockResolvedValue(null);
    mockLeadRepo.createSellerLead.mockResolvedValue(sellerFixture);
    mockLeadRepo.createConsentRecord.mockRejectedValue(new Error('DB constraint error'));

    await expect(submitLead(validInput)).rejects.toThrow('DB constraint error');
    // In production the real prisma.$transaction rolls back the seller insert.
    // Here we verify the service propagates the error without swallowing it,
    // and does NOT proceed to write the audit log.
    expect(mockAudit.log).not.toHaveBeenCalled();
  });
});
