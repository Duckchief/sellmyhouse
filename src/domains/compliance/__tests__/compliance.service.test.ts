// src/domains/compliance/__tests__/compliance.service.test.ts
import * as complianceRepo from '../compliance.repository';
import * as auditService from '../../shared/audit.service';
import * as complianceService from '../compliance.service';

jest.mock('../compliance.repository');
jest.mock('../../shared/audit.service');

const mockRepo = complianceRepo as jest.Mocked<typeof complianceRepo>;
const mockAudit = auditService as jest.Mocked<typeof auditService>;

beforeEach(() => jest.clearAllMocks());

describe('checkDncAllowed', () => {
  it('blocks marketing message when consentMarketing is false', async () => {
    mockRepo.findSellerConsent.mockResolvedValue({ consentService: true, consentMarketing: false });
    const result = await complianceService.checkDncAllowed('seller1', 'whatsapp', 'marketing');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('marketing consent');
  });

  it('allows service message when consentMarketing is false but consentService is true', async () => {
    mockRepo.findSellerConsent.mockResolvedValue({ consentService: true, consentMarketing: false });
    const result = await complianceService.checkDncAllowed('seller1', 'whatsapp', 'service');
    expect(result.allowed).toBe(true);
  });

  it('blocks all messages when consentService is false', async () => {
    mockRepo.findSellerConsent.mockResolvedValue({
      consentService: false,
      consentMarketing: false,
    });
    const result = await complianceService.checkDncAllowed('seller1', 'whatsapp', 'service');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('service consent');
  });

  it('allows service message when both consents are true', async () => {
    mockRepo.findSellerConsent.mockResolvedValue({ consentService: true, consentMarketing: true });
    const result = await complianceService.checkDncAllowed('seller1', 'email', 'service');
    expect(result.allowed).toBe(true);
  });
});

describe('withdrawConsent', () => {
  const baseSeller = { status: 'active', transactions: [] };

  it('creates a new consent record (append-only)', async () => {
    mockRepo.findSellerConsent.mockResolvedValue({ consentService: true, consentMarketing: true });
    mockRepo.findSellerWithTransactions.mockResolvedValue({ ...baseSeller, transactions: [] });
    mockRepo.createConsentRecord.mockResolvedValue({ id: 'cr1' } as never);
    mockAudit.log.mockResolvedValue(undefined);

    await complianceService.withdrawConsent({
      sellerId: 'seller1',
      type: 'marketing',
      channel: 'web',
    });

    expect(mockRepo.createConsentRecord).toHaveBeenCalledWith(
      expect.objectContaining({ purposeMarketing: false }),
    );
  });

  it('updates seller.consentMarketing flag when withdrawing marketing consent', async () => {
    mockRepo.findSellerConsent.mockResolvedValue({ consentService: true, consentMarketing: true });
    mockRepo.findSellerWithTransactions.mockResolvedValue({ ...baseSeller, transactions: [] });
    mockRepo.createConsentRecord.mockResolvedValue({ id: 'cr1' } as never);
    mockAudit.log.mockResolvedValue(undefined);

    await complianceService.withdrawConsent({
      sellerId: 'seller1',
      type: 'marketing',
      channel: 'web',
    });

    expect(mockRepo.updateSellerConsent).toHaveBeenCalledWith('seller1', {
      consentMarketing: false,
    });
  });

  it('creates a flagged deletion request when service consent withdrawn with no transactions', async () => {
    mockRepo.findSellerConsent.mockResolvedValue({ consentService: true, consentMarketing: false });
    mockRepo.findSellerWithTransactions.mockResolvedValue({ status: 'lead', transactions: [] });
    mockRepo.createConsentRecord.mockResolvedValue({ id: 'cr1' } as never);
    mockRepo.createDeletionRequest.mockResolvedValue({ id: 'dr1' } as never);
    mockAudit.log.mockResolvedValue(undefined);

    const result = await complianceService.withdrawConsent({
      sellerId: 'seller1',
      type: 'service',
      channel: 'web',
    });

    expect(mockRepo.createDeletionRequest).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'flagged', retentionRule: '30_day_grace' }),
    );
    expect(result.deletionBlocked).toBe(false);
  });

  it('creates a blocked deletion request when service consent withdrawn with transactions', async () => {
    mockRepo.findSellerConsent.mockResolvedValue({ consentService: true, consentMarketing: false });
    mockRepo.findSellerWithTransactions.mockResolvedValue({
      status: 'completed',
      transactions: [{ completionDate: new Date(), status: 'completed' }],
    });
    mockRepo.createConsentRecord.mockResolvedValue({ id: 'cr1' } as never);
    mockRepo.createDeletionRequest.mockResolvedValue({ id: 'dr1' } as never);
    mockAudit.log.mockResolvedValue(undefined);

    const result = await complianceService.withdrawConsent({
      sellerId: 'seller1',
      type: 'service',
      channel: 'web',
    });

    expect(mockRepo.createDeletionRequest).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'blocked', retentionRule: 'aml_cft_5_year' }),
    );
    expect(result.deletionBlocked).toBe(true);
  });

  it('logs consent.withdrawn audit event', async () => {
    mockRepo.findSellerConsent.mockResolvedValue({ consentService: true, consentMarketing: true });
    mockRepo.findSellerWithTransactions.mockResolvedValue({ ...baseSeller, transactions: [] });
    mockRepo.createConsentRecord.mockResolvedValue({ id: 'cr1' } as never);
    mockAudit.log.mockResolvedValue(undefined);

    await complianceService.withdrawConsent({
      sellerId: 'seller1',
      type: 'marketing',
      channel: 'web',
    });

    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'consent.withdrawn' }),
    );
  });
});

describe('createCorrectionRequest', () => {
  it('creates a correction request with status pending', async () => {
    mockRepo.createCorrectionRequest.mockResolvedValue({ id: 'corr1', status: 'pending' } as never);
    mockAudit.log.mockResolvedValue(undefined);

    const result = await complianceService.createCorrectionRequest({
      sellerId: 'seller1',
      fieldName: 'name',
      currentValue: 'Old Name',
      requestedValue: 'New Name',
      reason: 'Legal name change',
    });

    expect(mockRepo.createCorrectionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        sellerId: 'seller1',
        fieldName: 'name',
        requestedValue: 'New Name',
      }),
    );
    expect(result.id).toBe('corr1');
  });

  it('logs data_correction.requested audit event', async () => {
    mockRepo.createCorrectionRequest.mockResolvedValue({ id: 'corr1' } as never);
    mockAudit.log.mockResolvedValue(undefined);

    await complianceService.createCorrectionRequest({
      sellerId: 'seller1',
      fieldName: 'email',
      requestedValue: 'new@email.com',
    });

    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'data_correction.requested' }),
    );
  });
});

describe('processCorrectionRequest — approve', () => {
  it('auto-applies the change for eligible fields (name, email, phone)', async () => {
    mockRepo.findCorrectionRequest.mockResolvedValue({
      id: 'corr1',
      sellerId: 'seller1',
      fieldName: 'name',
      requestedValue: 'New Name',
      status: 'pending',
    } as never);
    mockRepo.updateCorrectionRequest.mockResolvedValue({
      id: 'corr1',
      status: 'completed',
    } as never);
    mockRepo.updateSellerField.mockResolvedValue(undefined);
    mockAudit.log.mockResolvedValue(undefined);

    await complianceService.processCorrectionRequest({
      requestId: 'corr1',
      agentId: 'agent1',
      decision: 'approve',
    });

    expect(mockRepo.updateCorrectionRequest).toHaveBeenCalledWith(
      'corr1',
      expect.objectContaining({ status: 'completed' }),
    );
    expect(mockRepo.updateSellerField).toHaveBeenCalledWith('seller1', 'name', 'New Name');
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'data_correction.processed' }),
    );
  });

  it('marks as completed without auto-apply for manual fields (nricLast4)', async () => {
    mockRepo.findCorrectionRequest.mockResolvedValue({
      id: 'corr1',
      sellerId: 'seller1',
      fieldName: 'nricLast4',
      requestedValue: '123A',
      status: 'pending',
    } as never);
    mockRepo.updateCorrectionRequest.mockResolvedValue({
      id: 'corr1',
      status: 'completed',
    } as never);
    mockAudit.log.mockResolvedValue(undefined);

    await complianceService.processCorrectionRequest({
      requestId: 'corr1',
      agentId: 'agent1',
      decision: 'approve',
      processNotes: 'Re-verified identity via video call',
    });

    expect(mockRepo.updateCorrectionRequest).toHaveBeenCalled();
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'data_correction.processed' }),
    );
  });
});

describe('processCorrectionRequest — reject', () => {
  it('updates status to rejected with process notes', async () => {
    mockRepo.findCorrectionRequest.mockResolvedValue({
      id: 'corr1',
      sellerId: 'seller1',
      fieldName: 'name',
      requestedValue: 'New Name',
      status: 'pending',
    } as never);
    mockRepo.updateCorrectionRequest.mockResolvedValue({
      id: 'corr1',
      status: 'rejected',
    } as never);
    mockAudit.log.mockResolvedValue(undefined);

    await complianceService.processCorrectionRequest({
      requestId: 'corr1',
      agentId: 'agent1',
      decision: 'reject',
      processNotes: 'Cannot verify identity claim',
    });

    expect(mockRepo.updateCorrectionRequest).toHaveBeenCalledWith(
      'corr1',
      expect.objectContaining({ status: 'rejected' }),
    );
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'data_correction.rejected' }),
    );
  });
});
