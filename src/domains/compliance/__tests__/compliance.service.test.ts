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
