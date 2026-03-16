// src/domains/compliance/__tests__/compliance.service.test.ts
import * as complianceRepo from '../compliance.repository';
import * as auditService from '../../shared/audit.service';
import * as settingsService from '../../shared/settings.service';
import * as complianceService from '../compliance.service';
import { localStorage } from '@/infra/storage/local-storage';

jest.mock('@/infra/storage/local-storage', () => ({
  localStorage: { delete: jest.fn(), save: jest.fn() },
}));
jest.mock('../../shared/settings.service');
const mockStorage = localStorage as jest.Mocked<typeof localStorage>;
const mockSettings = settingsService as jest.Mocked<typeof settingsService>;

jest.mock('../compliance.repository');
jest.mock('../../shared/audit.service');

const mockRepo = complianceRepo as jest.Mocked<typeof complianceRepo> & {
  findLeadsForRetention: jest.Mock;
  findServiceWithdrawnForDeletion: jest.Mock;
  findTransactionsForRetention: jest.Mock;
  findCddRecordsForRetention: jest.Mock;
  findConsentRecordsForDeletion: jest.Mock;
  findStaleCorrectionRequests: jest.Mock;
  findExistingDeletionRequest: jest.Mock;
  collectSellerFilePaths: jest.Mock;
  collectTransactionFilePaths: jest.Mock;
  hardDeleteSeller: jest.Mock;
  hardDeleteCddDocuments: jest.Mock;
  hardDeleteConsentRecord: jest.Mock;
  hardDeleteTransaction: jest.Mock;
  anonymiseAgentRecord: jest.Mock;
  findAgentById: jest.Mock;
  findVerifiedViewersForRetention: jest.Mock;
  anonymiseVerifiedViewerRecords: jest.Mock;
  findBuyersForRetention: jest.Mock;
  anonymiseBuyerRecords: jest.Mock;
  createEaa: jest.Mock;
  findEaaBySellerId: jest.Mock;
  updateEaaStatus: jest.Mock;
  updateEaaSignedCopy: jest.Mock;
  updateEaaExplanation: jest.Mock;
  findEaaById: jest.Mock;
};
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

describe('scanRetention', () => {
  beforeEach(() => {
    mockRepo.findLeadsForRetention.mockResolvedValue([]);
    mockRepo.findServiceWithdrawnForDeletion.mockResolvedValue([]);
    mockRepo.findTransactionsForRetention.mockResolvedValue([]);
    mockRepo.findCddRecordsForRetention.mockResolvedValue([]);
    mockRepo.findConsentRecordsForDeletion.mockResolvedValue([]);
    mockRepo.findStaleCorrectionRequests.mockResolvedValue([]);
    mockRepo.findExistingDeletionRequest.mockResolvedValue(null);
    mockRepo.createDeletionRequest.mockResolvedValue({ id: 'dr1' } as never);
    mockRepo.findVerifiedViewersForRetention.mockResolvedValue([]);
    mockRepo.anonymiseVerifiedViewerRecords.mockResolvedValue(undefined);
    mockRepo.findBuyersForRetention.mockResolvedValue([]);
    mockRepo.anonymiseBuyerRecords.mockResolvedValue(undefined);
    mockAudit.log.mockResolvedValue(undefined);
    // Default retention periods from SystemSetting
    mockSettings.getNumber.mockResolvedValue(12); // lead_retention_months (first call)
    mockSettings.getNumber
      .mockResolvedValueOnce(12) // lead_retention_months
      .mockResolvedValueOnce(5) // transaction_retention_years
      .mockResolvedValueOnce(5) // cdd_retention_years
      .mockResolvedValueOnce(1); // consent_post_withdrawal_retention_years
  });

  it('flags leads inactive for 12+ months', async () => {
    const oldDate = new Date();
    oldDate.setFullYear(oldDate.getFullYear() - 2);
    mockRepo.findLeadsForRetention.mockResolvedValue([
      { id: 'seller1', name: 'Old Lead', updatedAt: oldDate },
    ]);

    const result = await complianceService.scanRetention();
    expect(mockRepo.createDeletionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: 'lead',
        targetId: 'seller1',
        retentionRule: 'lead_12_month',
        status: 'flagged',
      }),
    );
    expect(result.flaggedCount).toBeGreaterThan(0);
  });

  it('does NOT flag leads that already have a deletion request', async () => {
    const oldDate = new Date();
    oldDate.setFullYear(oldDate.getFullYear() - 2);
    mockRepo.findLeadsForRetention.mockResolvedValue([
      { id: 'seller1', name: 'Old Lead', updatedAt: oldDate },
    ]);
    mockRepo.findExistingDeletionRequest.mockResolvedValue({ id: 'existing', status: 'flagged' });

    const result = await complianceService.scanRetention();
    expect(mockRepo.createDeletionRequest).not.toHaveBeenCalled();
    expect(result.flaggedCount).toBe(0);
  });

  it('flags transaction records older than 5 years', async () => {
    const oldDate = new Date();
    oldDate.setFullYear(oldDate.getFullYear() - 6);
    mockRepo.findTransactionsForRetention.mockResolvedValue([
      { id: 'tx1', sellerId: 'seller1', completionDate: oldDate },
    ]);

    const result = await complianceService.scanRetention();
    expect(mockRepo.createDeletionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: 'transaction',
        targetId: 'tx1',
        retentionRule: 'transaction_5_year',
      }),
    );
    expect(result.flaggedCount).toBeGreaterThan(0);
  });

  // FIX 1: scanRetention anonymises expired VerifiedViewer PII fields
  it('anonymises expired VerifiedViewer PII and writes audit log', async () => {
    mockRepo.findVerifiedViewersForRetention.mockResolvedValue([
      { id: 'viewer-1', name: 'Alice', phone: '91234567' },
    ]);

    const result = await complianceService.scanRetention();

    expect(mockRepo.anonymiseVerifiedViewerRecords).toHaveBeenCalledWith(['viewer-1']);
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'compliance.viewer_pii_anonymised',
        entityType: 'verified_viewer',
        entityId: 'viewer-1',
      }),
    );
    expect(result.flaggedCount).toBeGreaterThan(0);
  });

  // FIX 1: scanRetention anonymises expired Buyer PII fields
  it('anonymises expired Buyer PII and writes audit log', async () => {
    mockRepo.findBuyersForRetention.mockResolvedValue([
      { id: 'buyer-1', name: 'Bob', email: 'bob@example.com', phone: '98765432' },
    ]);

    const result = await complianceService.scanRetention();

    expect(mockRepo.anonymiseBuyerRecords).toHaveBeenCalledWith(['buyer-1']);
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'compliance.buyer_pii_anonymised',
        entityType: 'buyer',
        entityId: 'buyer-1',
      }),
    );
    expect(result.flaggedCount).toBeGreaterThan(0);
  });
});

describe('executeHardDelete', () => {
  beforeEach(() => {
    mockRepo.collectSellerFilePaths.mockResolvedValue([]);
    mockRepo.collectTransactionFilePaths.mockResolvedValue([]);
    mockRepo.hardDeleteSeller.mockResolvedValue(undefined);
    mockRepo.hardDeleteCddDocuments.mockResolvedValue(undefined);
    mockRepo.hardDeleteConsentRecord.mockResolvedValue(undefined);
    mockRepo.hardDeleteTransaction.mockResolvedValue(undefined);
    mockRepo.updateDeletionRequest.mockResolvedValue({} as never);
    mockAudit.log.mockResolvedValue(undefined);
    mockStorage.delete.mockResolvedValue(undefined);
  });

  it('throws if deletion request is not found', async () => {
    mockRepo.findDeletionRequest.mockResolvedValue(null);
    await expect(
      complianceService.executeHardDelete({ requestId: 'dr1', agentId: 'agent1' }),
    ).rejects.toThrow();
  });

  it('throws ComplianceError if deletion request is blocked', async () => {
    mockRepo.findDeletionRequest.mockResolvedValue({
      id: 'dr1',
      status: 'blocked',
      targetType: 'lead',
      targetId: 'seller1',
      retentionRule: 'aml_cft_5_year',
      details: {},
    } as never);

    await expect(
      complianceService.executeHardDelete({ requestId: 'dr1', agentId: 'agent1' }),
    ).rejects.toThrow('AML/CFT');
  });

  it('deletes all seller files via localStorage.delete before DB cascade', async () => {
    mockRepo.findDeletionRequest.mockResolvedValue({
      id: 'dr1',
      status: 'flagged',
      targetType: 'lead',
      targetId: 'seller1',
      retentionRule: '30_day_grace',
      details: {},
    } as never);
    mockRepo.collectSellerFilePaths.mockResolvedValue([
      'photos/listing1/photo1.jpg',
      'photos/listing1/photo1-optimized.jpg',
      'otp/tx1/seller-copy.pdf',
      'invoices/tx1/invoice.pdf',
    ]);

    await complianceService.executeHardDelete({ requestId: 'dr1', agentId: 'agent1' });

    expect(mockRepo.collectSellerFilePaths).toHaveBeenCalledWith('seller1');
    expect(mockStorage.delete).toHaveBeenCalledTimes(4);
    expect(mockStorage.delete).toHaveBeenCalledWith('photos/listing1/photo1.jpg');
    expect(mockStorage.delete).toHaveBeenCalledWith('invoices/tx1/invoice.pdf');
  });

  it('logs audit event and continues if a file deletion fails', async () => {
    mockRepo.findDeletionRequest.mockResolvedValue({
      id: 'dr1',
      status: 'flagged',
      targetType: 'lead',
      targetId: 'seller1',
      retentionRule: '30_day_grace',
      details: {},
    } as never);
    mockRepo.collectSellerFilePaths.mockResolvedValue(['otp/tx1/seller-copy.pdf']);
    mockStorage.delete.mockRejectedValueOnce(new Error('ENOENT: file not found'));

    await complianceService.executeHardDelete({ requestId: 'dr1', agentId: 'agent1' });

    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'compliance.file_unlink_failed' }),
    );
    // DB delete still runs despite file error
    expect(mockRepo.hardDeleteSeller).toHaveBeenCalledWith('seller1');
  });

  it('calls hardDeleteSeller even when there are no files', async () => {
    mockRepo.findDeletionRequest.mockResolvedValue({
      id: 'dr1',
      status: 'flagged',
      targetType: 'lead',
      targetId: 'seller1',
      retentionRule: '30_day_grace',
      details: {},
    } as never);
    mockRepo.collectSellerFilePaths.mockResolvedValue([]);

    await complianceService.executeHardDelete({ requestId: 'dr1', agentId: 'agent1' });

    expect(mockStorage.delete).not.toHaveBeenCalled();
    expect(mockRepo.hardDeleteSeller).toHaveBeenCalledWith('seller1');
  });

  it('collects and unlinks transaction files before DB delete', async () => {
    mockRepo.findDeletionRequest.mockResolvedValue({
      id: 'dr2',
      status: 'flagged',
      targetType: 'transaction',
      targetId: 'tx-001',
      retentionRule: '30_day_grace',
      details: {},
    } as never);
    mockRepo.collectTransactionFilePaths.mockResolvedValue([
      'otp/tx-001/seller.pdf',
      'invoices/tx-001/invoice.pdf',
    ]);

    await complianceService.executeHardDelete({ requestId: 'dr2', agentId: 'agent1' });

    expect(mockRepo.collectTransactionFilePaths).toHaveBeenCalledWith('tx-001');
    expect(mockStorage.delete).toHaveBeenCalledTimes(2);
    expect(mockStorage.delete).toHaveBeenCalledWith('otp/tx-001/seller.pdf');
    expect(mockStorage.delete).toHaveBeenCalledWith('invoices/tx-001/invoice.pdf');
    expect(mockRepo.hardDeleteTransaction).toHaveBeenCalledWith('tx-001');
  });

  it('calls hardDeleteTransaction even when there are no transaction files', async () => {
    mockRepo.findDeletionRequest.mockResolvedValue({
      id: 'dr2',
      status: 'flagged',
      targetType: 'transaction',
      targetId: 'tx-001',
      retentionRule: '30_day_grace',
      details: {},
    } as never);
    mockRepo.collectTransactionFilePaths.mockResolvedValue([]);

    await complianceService.executeHardDelete({ requestId: 'dr2', agentId: 'agent1' });

    expect(mockStorage.delete).not.toHaveBeenCalled();
    expect(mockRepo.hardDeleteTransaction).toHaveBeenCalledWith('tx-001');
  });

  it('logs audit event and continues if a transaction file deletion fails', async () => {
    mockRepo.findDeletionRequest.mockResolvedValue({
      id: 'dr2',
      status: 'flagged',
      targetType: 'transaction',
      targetId: 'tx-001',
      retentionRule: '30_day_grace',
      details: {},
    } as never);
    mockRepo.collectTransactionFilePaths.mockResolvedValue(['otp/tx-001/seller.pdf']);
    mockStorage.delete.mockRejectedValueOnce(new Error('ENOENT'));

    await complianceService.executeHardDelete({ requestId: 'dr2', agentId: 'agent1' });

    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'compliance.file_unlink_failed' }),
    );
    // DB delete still runs despite file error
    expect(mockRepo.hardDeleteTransaction).toHaveBeenCalledWith('tx-001');
  });
});

describe('anonymiseAgent', () => {
  it('calls repository anonymiseAgentRecord and logs audit event', async () => {
    mockRepo.findAgentById.mockResolvedValue({
      id: 'agent1',
      name: 'John Tan',
      email: 'john@test.com',
      phone: '+65912345678',
      isActive: false,
    });
    mockRepo.anonymiseAgentRecord.mockResolvedValue(undefined);
    mockAudit.log.mockResolvedValue(undefined);

    await complianceService.anonymiseAgent({ agentId: 'agent1', requestedByAgentId: 'admin1' });

    expect(mockRepo.anonymiseAgentRecord).toHaveBeenCalledWith('agent1');
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'agent.anonymised', entityId: 'agent1' }),
    );
  });

  it('throws ComplianceError if agent is active', async () => {
    mockRepo.findAgentById.mockResolvedValue({
      id: 'agent1',
      name: 'Active Agent',
      email: 'active@test.com',
      phone: '+65912345678',
      isActive: true,
    });
    await expect(
      complianceService.anonymiseAgent({ agentId: 'agent1', requestedByAgentId: 'admin1' }),
    ).rejects.toThrow('active');
  });
});

// ─── EAA Management ──────────────────────────────────────────────────────────

describe('createEaa', () => {
  it('creates EAA and logs audit event', async () => {
    const mockEaa = {
      id: 'eaa-1',
      sellerId: 'seller-1',
      agentId: 'agent-1',
      agreementType: 'non_exclusive',
      status: 'draft',
    };
    mockRepo.createEaa.mockResolvedValue(mockEaa as never);
    mockAudit.log.mockResolvedValue(undefined);

    const result = await complianceService.createEaa(
      { sellerId: 'seller-1', agentId: 'agent-1' },
      'agent-1',
    );

    expect(result.id).toBe('eaa-1');
    expect(mockRepo.createEaa).toHaveBeenCalledWith(
      expect.objectContaining({ sellerId: 'seller-1', agentId: 'agent-1' }),
    );
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'compliance.eaa_created' }),
    );
  });
});

describe('updateEaaStatus', () => {
  const baseEaa = {
    id: 'eaa-1',
    sellerId: 'seller-1',
    agentId: 'agent-1',
    status: 'draft',
    videoCallConfirmedAt: null,
  };

  it('transitions draft → sent_to_seller', async () => {
    mockRepo.findEaaById.mockResolvedValue(baseEaa as never);
    mockRepo.updateEaaStatus.mockResolvedValue({ ...baseEaa, status: 'sent_to_seller' } as never);
    mockAudit.log.mockResolvedValue(undefined);

    const result = await complianceService.updateEaaStatus('eaa-1', 'sent_to_seller', 'agent-1');
    expect(result.status).toBe('sent_to_seller');
  });

  it('rejects invalid transition draft → active', async () => {
    mockRepo.findEaaById.mockResolvedValue(baseEaa as never);

    await expect(
      complianceService.updateEaaStatus('eaa-1', 'active', 'agent-1'),
    ).rejects.toThrow('Cannot transition');
  });

  it('throws NotFoundError for non-existent EAA', async () => {
    mockRepo.findEaaById.mockResolvedValue(null);

    await expect(
      complianceService.updateEaaStatus('eaa-999', 'signed', 'agent-1'),
    ).rejects.toThrow('not found');
  });
});

describe('uploadEaaSignedCopy', () => {
  const baseEaa = {
    id: 'eaa-1',
    sellerId: 'seller-1',
    agentId: 'agent-1',
    status: 'draft',
  };

  it('saves file and updates EAA record', async () => {
    mockRepo.findEaaById.mockResolvedValue(baseEaa as never);
    mockStorage.save.mockResolvedValue('eaa/seller-1/eaa-1.pdf');
    mockRepo.updateEaaSignedCopy.mockResolvedValue({
      ...baseEaa,
      signedCopyPath: 'eaa/seller-1/eaa-1.pdf',
    } as never);
    mockAudit.log.mockResolvedValue(undefined);

    const result = await complianceService.uploadEaaSignedCopy(
      'eaa-1',
      { buffer: Buffer.from('pdf'), mimetype: 'application/pdf', originalname: 'signed.pdf' },
      'agent-1',
    );

    expect(mockStorage.save).toHaveBeenCalledWith(
      'eaa/seller-1/eaa-1.pdf',
      expect.any(Buffer),
    );
    expect(result.signedCopyPath).toBe('eaa/seller-1/eaa-1.pdf');
  });

  it('rejects non-allowed file types', async () => {
    mockRepo.findEaaById.mockResolvedValue(baseEaa as never);

    await expect(
      complianceService.uploadEaaSignedCopy(
        'eaa-1',
        { buffer: Buffer.from('exe'), mimetype: 'application/x-msdownload', originalname: 'virus.exe' },
        'agent-1',
      ),
    ).rejects.toThrow('File type not allowed');
  });

  it('rejects files exceeding 10MB', async () => {
    mockRepo.findEaaById.mockResolvedValue(baseEaa as never);

    await expect(
      complianceService.uploadEaaSignedCopy(
        'eaa-1',
        { buffer: Buffer.alloc(11 * 1024 * 1024), mimetype: 'application/pdf', originalname: 'large.pdf' },
        'agent-1',
      ),
    ).rejects.toThrow('10MB');
  });
});

describe('confirmEaaExplanation', () => {
  const baseEaa = {
    id: 'eaa-1',
    sellerId: 'seller-1',
    agentId: 'agent-1',
    status: 'signed',
    videoCallConfirmedAt: null,
  };

  it('stores method and sets confirmedAt', async () => {
    mockRepo.findEaaById.mockResolvedValue(baseEaa as never);
    mockRepo.updateEaaExplanation.mockResolvedValue({
      ...baseEaa,
      videoCallConfirmedAt: new Date(),
      videoCallNotes: 'video_call: Explained all terms',
    } as never);
    mockAudit.log.mockResolvedValue(undefined);

    await complianceService.confirmEaaExplanation({
      eaaId: 'eaa-1',
      method: 'video_call',
      notes: 'Explained all terms',
      agentId: 'agent-1',
    });

    expect(mockRepo.updateEaaExplanation).toHaveBeenCalledWith(
      expect.objectContaining({ eaaId: 'eaa-1', method: 'video_call' }),
    );
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'compliance.eaa_explanation_confirmed' }),
    );
  });

  it('rejects when explanation already confirmed', async () => {
    mockRepo.findEaaById.mockResolvedValue({
      ...baseEaa,
      videoCallConfirmedAt: new Date(),
    } as never);

    await expect(
      complianceService.confirmEaaExplanation({
        eaaId: 'eaa-1',
        method: 'in_person',
        agentId: 'agent-1',
      }),
    ).rejects.toThrow('already been confirmed');
  });
});
