import { submitLead } from '../lead.service';
import * as leadRepo from '../lead.repository';
import * as settingsService from '../../shared/settings.service';
import * as auditService from '../../shared/audit.service';
import * as notificationService from '../../notification/notification.service';

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
    mockSettings.get.mockResolvedValue(''); // default: no default agent
  });

  const validInput = {
    name: 'John Tan',
    countryCode: '+65',
    nationalNumber: '91234567',
    phone: '+6591234567',
    consentService: true,
    consentMarketing: false,
    leadSource: 'website' as const,
    ipAddress: '127.0.0.1',
    userAgent: 'test',
  };

  const sellerFixture = {
    id: 'seller-1',
    name: 'John Tan',
    countryCode: '+65',
    nationalNumber: '91234567',
    phone: '+6591234567',
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

  it('creates seller and consent record atomically, writes audit log, notifies admin', async () => {
    mockLeadRepo.findActiveSellerByPhone.mockResolvedValue(null);
    mockLeadRepo.submitLeadAtomically.mockResolvedValue(sellerFixture);
    mockLeadRepo.findAdminAgents.mockResolvedValue([
      { id: 'admin-1', notificationPreference: 'whatsapp_and_email' },
    ]);
    mockAudit.log.mockResolvedValue(undefined);
    mockNotification.send.mockResolvedValue(undefined);

    const result = await submitLead(validInput);

    expect(result.sellerId).toBe('seller-1');
    expect(mockLeadRepo.findActiveSellerByPhone).toHaveBeenCalledWith('+6591234567');
    // Atomic creation of seller + consent is now handled inside the repository
    expect(mockLeadRepo.submitLeadAtomically).toHaveBeenCalledWith({
      name: 'John Tan',
      countryCode: '+65',
      nationalNumber: '91234567',
      phone: '+6591234567',
      consentService: true,
      consentMarketing: false,
      leadSource: 'website',
      retentionExpiresAt: expect.any(Date),
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
    mockLeadRepo.submitLeadAtomically.mockResolvedValue({
      ...sellerFixture,
      id: 'seller-2',
      phone: '+6581234567',
      nationalNumber: '81234567',
      name: 'Jane',
    });
    mockLeadRepo.findAdminAgents.mockResolvedValue([]);
    mockAudit.log.mockResolvedValue(undefined);

    const result = await submitLead({ ...validInput, nationalNumber: '81234567', phone: '+6581234567' });

    expect(result.sellerId).toBe('seller-2');
    // Only the welcome_seller notification should be sent — no admin notifications
    expect(mockNotification.send).toHaveBeenCalledTimes(1);
    expect(mockNotification.send).toHaveBeenCalledWith(
      expect.objectContaining({ templateName: 'welcome_seller', recipientType: 'seller' }),
      'system',
    );
  });

  it('uses email channel when admin notificationPreference is email_only', async () => {
    mockLeadRepo.findActiveSellerByPhone.mockResolvedValue(null);
    mockLeadRepo.submitLeadAtomically.mockResolvedValue(sellerFixture);
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

  it('rolls back if submitLeadAtomically throws — error propagates out of submitLead', async () => {
    mockLeadRepo.findActiveSellerByPhone.mockResolvedValue(null);
    mockLeadRepo.submitLeadAtomically.mockRejectedValue(new Error('DB constraint error'));

    await expect(submitLead(validInput)).rejects.toThrow('DB constraint error');
    // In production the real prisma.$transaction rolls back the seller insert.
    // Here we verify the service propagates the error without swallowing it,
    // and does NOT proceed to write the audit log.
    expect(mockAudit.log).not.toHaveBeenCalled();
  });

  it('auto-assigns default agent when default_agent_id is set', async () => {
    mockLeadRepo.findActiveSellerByPhone.mockResolvedValue(null);
    mockLeadRepo.submitLeadAtomically.mockResolvedValue(sellerFixture);
    mockLeadRepo.findAdminAgents.mockResolvedValue([]);
    mockLeadRepo.assignAgent = jest.fn().mockResolvedValue(undefined);
    mockAudit.log.mockResolvedValue(undefined);
    mockNotification.send.mockResolvedValue(undefined);
    mockSettings.get.mockResolvedValue('agent-default-1');

    await submitLead(validInput);

    expect(mockLeadRepo.assignAgent).toHaveBeenCalledWith('seller-1', 'agent-default-1');
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'lead.auto_assigned' }),
    );
  });

  it('does not assign agent when no default_agent_id is set', async () => {
    mockLeadRepo.findActiveSellerByPhone.mockResolvedValue(null);
    mockLeadRepo.submitLeadAtomically.mockResolvedValue(sellerFixture);
    mockLeadRepo.findAdminAgents.mockResolvedValue([]);
    mockLeadRepo.assignAgent = jest.fn().mockResolvedValue(undefined);
    mockAudit.log.mockResolvedValue(undefined);
    mockNotification.send.mockResolvedValue(undefined);
    mockSettings.get.mockResolvedValue('');

    await submitLead(validInput);

    expect(mockLeadRepo.assignAgent).not.toHaveBeenCalled();
  });
});
