import { submitLead } from '../lead.service';
import * as leadRepo from '../lead.repository';
import * as auditService from '../../shared/audit.service';
import * as notificationService from '../../notification/notification.service';

jest.mock('../lead.repository');
jest.mock('../../shared/audit.service');
jest.mock('../../notification/notification.service');

const mockLeadRepo = leadRepo as jest.Mocked<typeof leadRepo>;
const mockAudit = auditService as jest.Mocked<typeof auditService>;
const mockNotification = notificationService as jest.Mocked<typeof notificationService>;

describe('lead.service', () => {
  beforeEach(() => jest.clearAllMocks());

  const validInput = {
    name: 'John Tan',
    phone: '91234567',
    consentService: true,
    consentMarketing: false,
    leadSource: 'website' as const,
    ipAddress: '127.0.0.1',
    userAgent: 'test',
  };

  it('creates seller, consent record, audit log, and notifies admin', async () => {
    mockLeadRepo.findActiveSellerByPhone.mockResolvedValue(null);
    mockLeadRepo.createSellerLead.mockResolvedValue({
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
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockLeadRepo.createConsentRecord.mockResolvedValue({
      id: 'consent-1',
      subjectType: 'seller',
      subjectId: 'seller-1',
      purposeService: true,
      purposeMarketing: false,
      consentGivenAt: new Date(),
      consentWithdrawnAt: null,
      withdrawalChannel: null,
      ipAddress: '127.0.0.1',
      userAgent: 'test',
      createdAt: new Date(),
    });
    mockLeadRepo.findAdminAgents.mockResolvedValue([{ id: 'admin-1' }]);
    mockAudit.log.mockResolvedValue(undefined);
    mockNotification.send.mockResolvedValue(undefined);

    const result = await submitLead(validInput);

    expect(result.sellerId).toBe('seller-1');
    expect(mockLeadRepo.findActiveSellerByPhone).toHaveBeenCalledWith('91234567');
    expect(mockLeadRepo.createSellerLead).toHaveBeenCalledWith({
      name: 'John Tan',
      phone: '91234567',
      consentService: true,
      consentMarketing: false,
      leadSource: 'website',
    });
    expect(mockLeadRepo.createConsentRecord).toHaveBeenCalledWith({
      subjectId: 'seller-1',
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
      id: 'seller-2',
      name: 'Jane',
      phone: '81234567',
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
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockLeadRepo.createConsentRecord.mockResolvedValue({
      id: 'consent-2',
      subjectType: 'seller',
      subjectId: 'seller-2',
      purposeService: true,
      purposeMarketing: false,
      consentGivenAt: new Date(),
      consentWithdrawnAt: null,
      withdrawalChannel: null,
      ipAddress: null,
      userAgent: null,
      createdAt: new Date(),
    });
    mockLeadRepo.findAdminAgents.mockResolvedValue([]);
    mockAudit.log.mockResolvedValue(undefined);

    const result = await submitLead({ ...validInput, phone: '81234567' });

    expect(result.sellerId).toBe('seller-2');
    // Notification should NOT be called when there are no admin agents
    expect(mockNotification.send).not.toHaveBeenCalled();
  });
});
