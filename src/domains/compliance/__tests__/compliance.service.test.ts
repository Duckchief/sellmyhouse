// src/domains/compliance/__tests__/compliance.service.test.ts
import * as complianceRepo from '../compliance.repository';
import * as auditService from '../../shared/audit.service';
import * as settingsService from '../../shared/settings.service';
import * as complianceService from '../compliance.service';
import { NotFoundError } from '../../shared/errors';
import { localStorage } from '@/infra/storage/local-storage';
import { encryptedStorage } from '@/infra/storage/encrypted-storage';
import { scanBuffer } from '@/infra/security/virus-scanner';
import type { CddRecord, CddDocument } from '../compliance.types';

jest.mock('@/infra/storage/local-storage', () => ({
  localStorage: { delete: jest.fn(), save: jest.fn() },
}));
jest.mock('@/infra/storage/encrypted-storage', () => ({
  encryptedStorage: {
    save: jest.fn(),
    read: jest.fn(),
    delete: jest.fn(),
  },
}));
jest.mock('@/infra/security/virus-scanner', () => ({
  scanBuffer: jest.fn(),
}));
jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn().mockResolvedValue({ mime: 'image/jpeg', ext: 'jpg' }),
}));
jest.mock('../../shared/settings.service');
const mockStorage = localStorage as jest.Mocked<typeof localStorage>;
const mockSettings = settingsService as jest.Mocked<typeof settingsService>;
const mockEncryptedStorage = encryptedStorage as jest.Mocked<typeof encryptedStorage>;
const mockScanBuffer = scanBuffer as jest.MockedFunction<typeof scanBuffer>;

jest.mock('../compliance.repository');
jest.mock('../../shared/audit.service');

import * as txRepo from '../../transaction/transaction.repository';
jest.mock('../../transaction/transaction.repository');
const mockTxRepo = txRepo as jest.Mocked<typeof txRepo>;

import * as propertyRepo from '../../property/property.repository';
jest.mock('../../property/property.repository');
const mockPropertyRepo = propertyRepo as jest.Mocked<typeof propertyRepo>;

import * as offerRepo from '../../offer/offer.repository';
jest.mock('../../offer/offer.repository');
const mockOfferRepo = offerRepo as jest.Mocked<typeof offerRepo>;

import * as viewingRepo from '../../viewing/viewing.repository';
jest.mock('../../viewing/viewing.repository');
const mockViewingRepo = viewingRepo as jest.Mocked<typeof viewingRepo>;

import * as notificationService from '../../notification/notification.service';
jest.mock('../../notification/notification.service');
const mockNotificationService = notificationService as jest.Mocked<typeof notificationService>;

import * as sellerService from '../../seller/seller.service';
jest.mock('../../seller/seller.service');
const mockSellerService = sellerService as jest.Mocked<typeof sellerService>;

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
  findInactiveAgentsForRetention: jest.Mock;
  findAuditLogsForSeller: jest.Mock;
  createEaa: jest.Mock;
  findEaaBySellerId: jest.Mock;
  updateEaaStatus: jest.Mock;
  updateEaaExplanation: jest.Mock;
  findEaaById: jest.Mock;
  deleteCddRecord: jest.Mock;
  upsertCddStatus: jest.Mock;
  findSellerCddRecord: jest.Mock;
  findLatestSellerCddRecord: jest.Mock;
  findCddRecordById: jest.Mock;
  addCddDocument: jest.Mock;
  removeCddDocument: jest.Mock;
  findCddRecordWithDocument: jest.Mock;
  findCompletedTransactionsForDocPurge: jest.Mock;
  purgeTransactionSensitiveDocs: jest.Mock;
  findCddRecordsForNricRedaction: jest.Mock;
  findCompletedTransactionsForFinancialRedaction: jest.Mock;
  redactTransactionFinancialData: jest.Mock;
  findCompletedTransactionsForAnonymisation: jest.Mock;
  anonymiseTransactionSeller: jest.Mock;
  redactSellerNotifications: jest.Mock;
  findPendingDocumentDownloads: jest.Mock;
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

  it('creates a flagged deletion request when service consent withdrawn with transactions (post-completion purge)', async () => {
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
      expect.objectContaining({ status: 'flagged', retentionRule: 'post_completion_purge' }),
    );
    expect(result.deletionBlocked).toBe(false);
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

  describe('service consent side effects', () => {
    const baseProperty = {
      id: 'prop-1',
      block: '123',
      street: 'Main St',
      town: 'Bishan',
      sellerId: 'seller1',
      listings: [],
    };

    beforeEach(() => {
      mockRepo.findSellerConsent.mockResolvedValue({ consentService: true, consentMarketing: false });
      mockRepo.findSellerWithTransactions.mockResolvedValue({ status: 'lead', transactions: [] });
      mockRepo.createConsentRecord.mockResolvedValue({ id: 'cr1' } as never);
      mockRepo.createDeletionRequest.mockResolvedValue({ id: 'dr1' } as never);
      mockAudit.log.mockResolvedValue(undefined);
      mockPropertyRepo.findBySellerId.mockResolvedValue(baseProperty as never);
      mockPropertyRepo.findActiveListingForProperty.mockResolvedValue(null);
      mockPropertyRepo.updateListingStatus.mockResolvedValue(undefined as never);
      mockOfferRepo.findByPropertyId.mockResolvedValue([]);
      mockOfferRepo.updateStatus.mockResolvedValue(undefined as never);
      mockViewingRepo.findActiveSlotsByPropertyId.mockResolvedValue([]);
      mockViewingRepo.cancelSlotAndViewings.mockResolvedValue(undefined as never);
      mockTxRepo.findTransactionBySellerId.mockResolvedValue(null);
      mockSellerService.findById.mockResolvedValue({ id: 'seller1', agentId: 'agent-1' } as never);
      mockNotificationService.send.mockResolvedValue(undefined);
    });

    it('voids pending offers on service consent withdrawal', async () => {
      const pendingOffer = { id: 'offer-1', status: 'pending', buyerAgentName: null };
      mockOfferRepo.findByPropertyId.mockResolvedValue([pendingOffer] as never);

      await complianceService.withdrawConsent({ sellerId: 'seller1', type: 'service', channel: 'web' });

      expect(mockOfferRepo.updateStatus).toHaveBeenCalledWith('offer-1', 'expired');
    });

    it('voids countered offers on service consent withdrawal', async () => {
      const counteredOffer = { id: 'offer-2', status: 'countered', buyerAgentName: 'External Agent' };
      mockOfferRepo.findByPropertyId.mockResolvedValue([counteredOffer] as never);

      await complianceService.withdrawConsent({ sellerId: 'seller1', type: 'service', channel: 'web' });

      expect(mockOfferRepo.updateStatus).toHaveBeenCalledWith('offer-2', 'expired');
    });

    it('does not void accepted or expired offers', async () => {
      const offers = [
        { id: 'offer-3', status: 'accepted', buyerAgentName: null },
        { id: 'offer-4', status: 'expired', buyerAgentName: null },
      ];
      mockOfferRepo.findByPropertyId.mockResolvedValue(offers as never);

      await complianceService.withdrawConsent({ sellerId: 'seller1', type: 'service', channel: 'web' });

      expect(mockOfferRepo.updateStatus).not.toHaveBeenCalled();
    });

    it('cancels active viewing slots on service consent withdrawal', async () => {
      const slot = { id: 'slot-1', status: 'available' };
      mockViewingRepo.findActiveSlotsByPropertyId.mockResolvedValue([slot] as never);

      await complianceService.withdrawConsent({ sellerId: 'seller1', type: 'service', channel: 'web' });

      expect(mockViewingRepo.cancelSlotAndViewings).toHaveBeenCalledWith('slot-1');
    });

    it('delists active listing on service consent withdrawal', async () => {
      const listing = { id: 'listing-1', status: 'listed' };
      mockPropertyRepo.findActiveListingForProperty.mockResolvedValue(listing as never);

      await complianceService.withdrawConsent({ sellerId: 'seller1', type: 'service', channel: 'web' });

      expect(mockPropertyRepo.updateListingStatus).toHaveBeenCalledWith('listing-1', 'closed');
    });

    it('marks active transaction as fallen_through on service consent withdrawal', async () => {
      const activeTx = { id: 'tx-1', status: 'option_issued' };
      mockTxRepo.findTransactionBySellerId.mockResolvedValue(activeTx as never);

      await complianceService.withdrawConsent({ sellerId: 'seller1', type: 'service', channel: 'web' });

      expect(mockTxRepo.updateFallenThrough).toHaveBeenCalledWith(
        'tx-1',
        expect.stringContaining('consent'),
      );
    });

    it('sends notification to listing agent for each co-broke voided offer', async () => {
      const coBrokeOffer = { id: 'offer-5', status: 'pending', buyerAgentName: 'External Agent Ltd' };
      mockOfferRepo.findByPropertyId.mockResolvedValue([coBrokeOffer] as never);

      await complianceService.withdrawConsent({ sellerId: 'seller1', type: 'service', channel: 'web' });

      expect(mockNotificationService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientType: 'agent',
          recipientId: 'agent-1',
          templateName: 'generic',
          preferredChannel: 'whatsapp',
        }),
        'agent-1',
      );
    });

    it('does not block withdrawal when side effects fail', async () => {
      mockPropertyRepo.findBySellerId.mockRejectedValue(new Error('DB error'));

      const result = await complianceService.withdrawConsent({
        sellerId: 'seller1',
        type: 'service',
        channel: 'web',
      });

      expect(result.consentRecordId).toBe('cr1');
    });

    it('does not run side effects for marketing consent withdrawal', async () => {
      await complianceService.withdrawConsent({ sellerId: 'seller1', type: 'marketing', channel: 'web' });

      expect(mockPropertyRepo.findBySellerId).not.toHaveBeenCalled();
    });
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
    mockRepo.findTransactionsCompletedBeforeForNric.mockResolvedValue([]);
    mockRepo.findCddRecordsForRetention.mockResolvedValue([]);
    mockRepo.findConsentRecordsForDeletion.mockResolvedValue([]);
    mockRepo.findClosedListingsForRetention.mockResolvedValue([]);
    mockRepo.findCompletedTransactionsForDocPurge.mockResolvedValue([]);
    mockRepo.purgeTransactionSensitiveDocs.mockResolvedValue({ filePaths: [] });
    mockRepo.findCddRecordsForNricRedaction = jest.fn().mockResolvedValue([]);
    mockRepo.findCompletedTransactionsForFinancialRedaction.mockResolvedValue([]);
    mockRepo.redactTransactionFinancialData.mockResolvedValue(undefined);
    mockRepo.findCompletedTransactionsForAnonymisation.mockResolvedValue([]);
    mockRepo.anonymiseTransactionSeller.mockResolvedValue(undefined);
    mockRepo.redactSellerNotifications = jest.fn().mockResolvedValue(undefined);
    mockRepo.findOldViewingSlotsForClosedProperties.mockResolvedValue([]);
    mockRepo.deleteOldViewingSlotsWithViewings.mockResolvedValue(0);
    mockRepo.findOldWeeklyUpdates.mockResolvedValue([]);
    mockRepo.deleteOldWeeklyUpdates.mockResolvedValue(0);
    mockRepo.findStaleCorrectionRequests.mockResolvedValue([]);
    mockRepo.findExistingDeletionRequest.mockResolvedValue(null);
    mockRepo.createDeletionRequest.mockResolvedValue({ id: 'dr1' } as never);
    mockRepo.findVerifiedViewersForRetention.mockResolvedValue([]);
    mockRepo.anonymiseVerifiedViewerRecords.mockResolvedValue(undefined);
    mockRepo.findBuyersForRetention.mockResolvedValue([]);
    mockRepo.anonymiseBuyerRecords.mockResolvedValue(undefined);
    mockRepo.findInactiveAgentsForRetention.mockResolvedValue([]);
    mockRepo.anonymiseAgentRecord.mockResolvedValue(undefined);
    mockAudit.log.mockResolvedValue(undefined);
    mockStorage.delete.mockResolvedValue(undefined);
    // Default retention periods from SystemSetting
    mockSettings.getNumber.mockResolvedValue(12); // fallback for any extra calls
    mockSettings.getNumber
      .mockResolvedValueOnce(12) // lead_retention_months
      .mockResolvedValueOnce(7) // sensitive_doc_retention_days
      .mockResolvedValueOnce(7) // financial_data_retention_days
      .mockResolvedValueOnce(30) // transaction_anonymisation_days
      .mockResolvedValueOnce(1) // consent_post_withdrawal_retention_years
      .mockResolvedValueOnce(6); // listing_retention_months
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

  it('Tier 1: auto-purges sensitive docs 7 days post-completion', async () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 10);
    mockRepo.findCompletedTransactionsForDocPurge.mockResolvedValue([
      {
        id: 'tx1',
        sellerId: 'seller1',
        completionDate: oldDate,
        otp: { id: 'otp1', scannedCopyPathSeller: 'otp/seller.pdf', scannedCopyPathReturned: null },
        commissionInvoice: { id: 'inv1', invoiceFilePath: 'invoices/inv.pdf' },
      },
    ]);
    mockRepo.purgeTransactionSensitiveDocs.mockResolvedValue({
      filePaths: ['otp/seller.pdf', 'invoices/inv.pdf'],
    });

    const result = await complianceService.scanRetention();
    expect(mockRepo.purgeTransactionSensitiveDocs).toHaveBeenCalledWith('tx1', 'seller1');
    expect(mockStorage.delete).toHaveBeenCalledWith('otp/seller.pdf');
    expect(mockStorage.delete).toHaveBeenCalledWith('invoices/inv.pdf');
    expect(result.flaggedCount).toBeGreaterThan(0);
  });

  it('Tier 2: auto-redacts financial data 7 days post-completion', async () => {
    mockRepo.findCompletedTransactionsForFinancialRedaction.mockResolvedValue([
      { id: 'tx1', sellerId: 'seller1', offerId: 'offer1' },
    ]);
    mockRepo.redactTransactionFinancialData.mockResolvedValue(undefined);

    const result = await complianceService.scanRetention();
    expect(mockRepo.redactTransactionFinancialData).toHaveBeenCalledWith('tx1');
    expect(result.flaggedCount).toBeGreaterThan(0);
  });

  it('Tier 3: auto-anonymises seller PII 30 days post-completion', async () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 35);
    mockRepo.findCompletedTransactionsForAnonymisation.mockResolvedValue([
      {
        id: 'tx1',
        sellerId: 'seller1',
        completionDate: oldDate,
        seller: {
          id: 'seller1',
          name: 'John Doe',
          transactions: [
            { id: 'tx1', completionDate: oldDate, anonymisedAt: null, status: 'completed' },
          ],
        },
      },
    ]);
    mockRepo.anonymiseTransactionSeller.mockResolvedValue(undefined);
    mockRepo.redactSellerNotifications = jest.fn().mockResolvedValue(undefined);

    const result = await complianceService.scanRetention();
    expect(mockRepo.anonymiseTransactionSeller).toHaveBeenCalledWith('tx1', 'seller1');
    // Finding #10: notification content is also redacted for the anonymised seller
    expect(mockRepo.redactSellerNotifications).toHaveBeenCalledWith('seller1');
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

  // Finding #4: scanRetention anonymises inactive agent PII fields
  it('anonymises inactive agent PII and writes audit log', async () => {
    mockRepo.findInactiveAgentsForRetention.mockResolvedValue([
      { id: 'agent-old', name: 'Retired Agent', email: 'retired@test.com' },
    ]);

    const result = await complianceService.scanRetention();

    expect(mockRepo.anonymiseAgentRecord).toHaveBeenCalledWith('agent-old');
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'compliance.agent_pii_anonymised',
        entityType: 'agent',
        entityId: 'agent-old',
      }),
    );
    expect(result.flaggedCount).toBeGreaterThan(0);
  });

  it('skips agent anonymisation when no inactive agents found', async () => {
    mockRepo.findInactiveAgentsForRetention.mockResolvedValue([]);

    await complianceService.scanRetention();

    expect(mockRepo.anonymiseAgentRecord).not.toHaveBeenCalled();
  });

  // Finding #6.2g: WeeklyUpdate 6-month retention
  it('deletes WeeklyUpdates older than 6 months and writes audit log', async () => {
    mockRepo.findOldWeeklyUpdates.mockResolvedValue([
      { id: 'wu-1', sellerId: 'seller-1', createdAt: new Date('2025-01-01') },
      { id: 'wu-2', sellerId: 'seller-2', createdAt: new Date('2025-02-01') },
    ]);
    mockRepo.deleteOldWeeklyUpdates.mockResolvedValue(2);

    const result = await complianceService.scanRetention();

    expect(mockRepo.findOldWeeklyUpdates).toHaveBeenCalledWith(expect.any(Date));
    expect(mockRepo.deleteOldWeeklyUpdates).toHaveBeenCalledWith(['wu-1', 'wu-2']);
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'compliance.weekly_updates_deleted',
        entityType: 'weekly_update',
      }),
    );
    expect(result.flaggedCount).toBeGreaterThan(0);
  });

  it('skips WeeklyUpdate deletion when none are older than 6 months', async () => {
    mockRepo.findOldWeeklyUpdates.mockResolvedValue([]);

    await complianceService.scanRetention();

    expect(mockRepo.deleteOldWeeklyUpdates).not.toHaveBeenCalled();
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
    mockRepo.hardDeleteListing.mockResolvedValue(undefined);
    mockRepo.redactNricFromCddRecord.mockResolvedValue(undefined);
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

  it('throws ComplianceError if deletion request is already executed', async () => {
    mockRepo.findDeletionRequest.mockResolvedValue({
      id: 'dr1',
      status: 'executed',
      targetType: 'lead',
      targetId: 'seller1',
      retentionRule: 'post_completion_purge',
      details: {},
    } as never);

    await expect(
      complianceService.executeHardDelete({ requestId: 'dr1', agentId: 'agent1' }),
    ).rejects.toThrow('not in a reviewable state');
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

// Finding #3: generateDataExport includes audit trail
describe('generateDataExport', () => {
  beforeEach(() => {
    mockRepo.getSellerPersonalData.mockResolvedValue({
      id: 'seller-1',
      name: 'Test Seller',
      email: 'test@example.com',
      phone: '+6591234567',
      status: 'active',
      consentService: true,
      consentMarketing: false,
      notificationPreference: 'email_only',
      createdAt: new Date(),
      consentRecords: [],
      properties: [],
      cddRecords: [{ nricLast4: '567A', identityVerified: true, verifiedAt: new Date() }],
    } as never);
    mockRepo.findAllConsentRecords.mockResolvedValue([]);
    mockRepo.findCorrectionRequestsBySeller.mockResolvedValue([]);
    mockRepo.findAuditLogsForSeller.mockResolvedValue([]);
    mockAudit.log.mockResolvedValue(undefined);
  });

  it('includes auditTrail in the export output', async () => {
    mockRepo.findAuditLogsForSeller.mockResolvedValue([
      {
        id: 'log-1',
        action: 'data_access.requested',
        entityType: 'seller',
        details: { requestedBy: 'seller' },
        createdAt: new Date(),
      },
    ]);

    const result = await complianceService.generateDataExport('seller-1');

    expect(result).toHaveProperty('auditTrail');
    expect(Array.isArray(result['auditTrail'])).toBe(true);
    expect(result['auditTrail']).toHaveLength(1);
    expect((result['auditTrail'] as unknown[])[0]).toMatchObject({
      action: 'data_access.requested',
      entityType: 'seller',
    });
  });

  it('masks nricLast4 values in audit log details', async () => {
    mockRepo.findAuditLogsForSeller.mockResolvedValue([
      {
        id: 'log-2',
        action: 'cdd.identity_verified',
        entityType: 'cdd_record',
        details: { nricLast4: '567A' },
        createdAt: new Date(),
      },
    ]);

    const result = await complianceService.generateDataExport('seller-1');
    const trail = result['auditTrail'] as { details: Record<string, unknown> }[];

    expect(trail[0]?.details?.['nricLast4']).toBe('SXXXX567A');
  });

  it('logs data_access.requested and data_access.fulfilled audit events', async () => {
    await complianceService.generateDataExport('seller-1');

    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'data_access.requested' }),
    );
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'data_access.fulfilled' }),
    );
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
    mockRepo.findLatestSellerCddRecord.mockResolvedValue({ identityVerified: true });
    mockRepo.createEaa.mockResolvedValue(mockEaa as never);
    mockAudit.log.mockResolvedValue(undefined);

    const result = await complianceService.createEaa(
      { sellerId: 'seller-1', agentId: 'agent-1' },
      'agent-1',
    );

    expect(result.id).toBe('eaa-1');
    expect(mockRepo.findLatestSellerCddRecord).toHaveBeenCalledWith('seller-1');
    expect(mockRepo.createEaa).toHaveBeenCalledWith(
      expect.objectContaining({ sellerId: 'seller-1', agentId: 'agent-1' }),
    );
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'compliance.eaa_created' }),
    );
  });

  it('throws ComplianceError when CDD is not verified', async () => {
    mockRepo.findLatestSellerCddRecord.mockResolvedValue({ identityVerified: false });

    await expect(
      complianceService.createEaa({ sellerId: 'seller-1', agentId: 'agent-1' }, 'agent-1'),
    ).rejects.toThrow('CDD must be verified before creating an EAA');
  });

  it('throws ComplianceError when no CDD record exists', async () => {
    mockRepo.findLatestSellerCddRecord.mockResolvedValue(null);

    await expect(
      complianceService.createEaa({ sellerId: 'seller-1', agentId: 'agent-1' }, 'agent-1'),
    ).rejects.toThrow('CDD must be verified before creating an EAA');
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

    await expect(complianceService.updateEaaStatus('eaa-1', 'active', 'agent-1')).rejects.toThrow(
      'Cannot transition',
    );
  });

  it('throws NotFoundError for non-existent EAA', async () => {
    mockRepo.findEaaById.mockResolvedValue(null);

    await expect(complianceService.updateEaaStatus('eaa-999', 'signed', 'agent-1')).rejects.toThrow(
      'not found',
    );
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

describe('updateCddStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRepo.findSellerCddRecord = jest.fn().mockResolvedValue(null);
  });

  it('calls deleteCddRecord and logs cdd.record_deleted for not_started', async () => {
    mockRepo.deleteCddRecord.mockResolvedValue(undefined);

    await complianceService.updateCddStatus('seller-1', 'not_started', 'agent-1');

    expect(mockRepo.deleteCddRecord).toHaveBeenCalledWith('seller-1');
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cdd.record_deleted', entityId: 'seller-1' }),
    );
  });

  it('calls upsertCddStatus and logs cdd.status_set_pending for pending', async () => {
    mockRepo.upsertCddStatus.mockResolvedValue(undefined);

    await complianceService.updateCddStatus('seller-1', 'pending', 'agent-1');

    expect(mockRepo.upsertCddStatus).toHaveBeenCalledWith('seller-1', 'agent-1', 'pending');
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cdd.status_set_pending', entityId: 'seller-1' }),
    );
  });

  it('allows admin to set verified directly', async () => {
    mockRepo.upsertCddStatus.mockResolvedValue(undefined);

    await complianceService.updateCddStatus('seller-1', 'verified', 'agent-1', true);

    expect(mockRepo.upsertCddStatus).toHaveBeenCalledWith('seller-1', 'agent-1', 'verified');
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cdd.identity_verified', entityId: 'seller-1' }),
    );
  });
});

describe('verifyCdd', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws ValidationError when phrase is wrong', async () => {
    await expect(
      complianceService.verifyCdd('seller-1', 'agent-1', 'wrong phrase'),
    ).rejects.toThrow('Invalid confirmation phrase');
  });

  it('throws ConflictError when record is already identityVerified', async () => {
    mockRepo.findSellerCddRecord = jest.fn().mockResolvedValue({
      id: 'cdd-1',
      identityVerified: true,
    });

    await expect(complianceService.verifyCdd('seller-1', 'agent-1', 'I confirm')).rejects.toThrow(
      'CDD is already verified and locked',
    );
  });

  it('calls upsertCddStatus("verified") and logs audit on success', async () => {
    // upsertCddStatus with 'verified' sets identityVerified=true and verifiedAt=now in the repo
    mockRepo.findSellerCddRecord = jest.fn().mockResolvedValue(null);
    mockRepo.upsertCddStatus.mockResolvedValue(undefined);

    await complianceService.verifyCdd('seller-1', 'agent-1', 'I confirm');

    expect(mockRepo.upsertCddStatus).toHaveBeenCalledWith('seller-1', 'agent-1', 'verified');
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cdd.identity_verified', entityId: 'seller-1' }),
    );
  });
});

describe('updateCddStatus — lock guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRepo.findSellerCddRecord = jest.fn();
  });

  it('throws ForbiddenError when agent tries to set status=verified directly', async () => {
    await expect(
      complianceService.updateCddStatus('seller-1', 'verified', 'agent-1', false),
    ).rejects.toThrow('Agents must use the verification modal to set CDD to Verified');
  });

  it('throws ForbiddenError when agent tries to change status on a locked record', async () => {
    mockRepo.findSellerCddRecord.mockResolvedValue({
      id: 'cdd-1',
      identityVerified: true,
    });

    await expect(
      complianceService.updateCddStatus('seller-1', 'pending', 'agent-1', false),
    ).rejects.toThrow('CDD is locked. Contact an admin to revert.');
  });

  it('allows admin to revert a locked record (skips lock check)', async () => {
    // identityVerified: true — proves admin bypasses the lock
    mockRepo.findSellerCddRecord.mockResolvedValue({
      id: 'cdd-1',
      identityVerified: true,
    });
    mockRepo.deleteCddRecord.mockResolvedValue(undefined);

    await complianceService.updateCddStatus('seller-1', 'not_started', 'agent-1', true);

    expect(mockRepo.deleteCddRecord).toHaveBeenCalledWith('seller-1');
  });
});

describe('uploadCddDocument', () => {
  const baseInput = {
    cddRecordId: 'cdd-1',
    agentId: 'agent-1',
    isAdmin: false,
    fileBuffer: Buffer.from('fake-nric-image'),
    originalFilename: 'nric.jpg',
    mimeType: 'image/jpeg',
    docType: 'nric' as const,
  };

  it('encrypts, saves, appends document, and writes audit log', async () => {
    mockRepo.findCddRecordById.mockResolvedValue({
      id: 'cdd-1',
      verifiedByAgentId: 'agent-1',
      documents: [],
    } as unknown as CddRecord);
    mockScanBuffer.mockResolvedValue({ isClean: true, viruses: [] });
    mockEncryptedStorage.save.mockResolvedValue({
      path: 'cdd/cdd-1/nric-doc123.enc',
      wrappedKey: 'wrapped-key',
    });
    mockRepo.addCddDocument.mockResolvedValue(undefined);
    mockAudit.log.mockResolvedValue(undefined);

    const result = await complianceService.uploadCddDocument(baseInput);

    expect(mockScanBuffer).toHaveBeenCalledWith(baseInput.fileBuffer, baseInput.originalFilename);
    expect(mockEncryptedStorage.save).toHaveBeenCalled();
    expect(mockRepo.addCddDocument).toHaveBeenCalled();
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cdd.document_uploaded' }),
    );
    expect(result.docType).toBe('nric');
    expect(result.uploadedByAgentId).toBe('agent-1');
  });

  it('throws ValidationError when virus detected', async () => {
    mockRepo.findCddRecordById.mockResolvedValue({
      id: 'cdd-1',
      verifiedByAgentId: 'agent-1',
      documents: [],
    } as unknown as CddRecord);
    mockScanBuffer.mockResolvedValue({ isClean: false, viruses: ['EICAR-Test-Signature'] });
    mockAudit.log.mockResolvedValue(undefined);

    await expect(complianceService.uploadCddDocument(baseInput)).rejects.toThrow('security scan');
    expect(mockEncryptedStorage.save).not.toHaveBeenCalled();
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cdd.document_scan_rejected' }),
    );
  });

  it('throws ValidationError when document limit (5) exceeded', async () => {
    const docs = Array.from({ length: 5 }, (_, i) => ({ id: `doc-${i}` }));
    mockRepo.findCddRecordById.mockResolvedValue({
      id: 'cdd-1',
      verifiedByAgentId: 'agent-1',
      documents: docs,
    } as unknown as CddRecord);

    await expect(complianceService.uploadCddDocument(baseInput)).rejects.toThrow('Maximum 5');
    expect(mockScanBuffer).not.toHaveBeenCalled();
  });

  it('throws ForbiddenError when agent does not own the CDD record', async () => {
    mockRepo.findCddRecordById.mockResolvedValue({
      id: 'cdd-1',
      verifiedByAgentId: 'other-agent',
      documents: [],
    } as unknown as CddRecord);

    await expect(
      complianceService.uploadCddDocument({ ...baseInput, agentId: 'agent-1', isAdmin: false }),
    ).rejects.toThrow('not authorised');
  });

  it('allows admin to upload regardless of ownership', async () => {
    mockRepo.findCddRecordById.mockResolvedValue({
      id: 'cdd-1',
      verifiedByAgentId: 'other-agent',
      documents: [],
    } as unknown as CddRecord);
    mockScanBuffer.mockResolvedValue({ isClean: true, viruses: [] });
    mockEncryptedStorage.save.mockResolvedValue({ path: 'cdd/cdd-1/nric.enc', wrappedKey: 'k' });
    mockRepo.addCddDocument.mockResolvedValue(undefined);
    mockAudit.log.mockResolvedValue(undefined);

    await expect(
      complianceService.uploadCddDocument({ ...baseInput, isAdmin: true }),
    ).resolves.not.toThrow();
  });

  it('throws NotFoundError when CDD record does not exist', async () => {
    mockRepo.findCddRecordById.mockResolvedValue(null);
    await expect(complianceService.uploadCddDocument(baseInput)).rejects.toThrow('CddRecord');
  });
});

describe('downloadCddDocument', () => {
  const mockDoc: CddDocument = {
    id: 'doc-1',
    docType: 'nric',
    label: null,
    path: 'cdd/cdd-1/nric-doc1.enc',
    wrappedKey: 'wrapped-key',
    mimeType: 'image/jpeg',
    sizeBytes: 5000,
    uploadedAt: '2026-03-18T00:00:00.000Z',
    uploadedByAgentId: 'agent-1',
  };

  it('decrypts and returns buffer with document metadata', async () => {
    mockRepo.findCddRecordWithDocument.mockResolvedValue({
      verifiedByAgentId: 'agent-1',
      document: mockDoc,
    });
    const decryptedBuffer = Buffer.from('decrypted-nric-image');
    mockEncryptedStorage.read.mockResolvedValue(decryptedBuffer);
    mockAudit.log.mockResolvedValue(undefined);

    const result = await complianceService.downloadCddDocument({
      cddRecordId: 'cdd-1',
      documentId: 'doc-1',
      agentId: 'agent-1',
      isAdmin: false,
    });

    expect(mockEncryptedStorage.read).toHaveBeenCalledWith(mockDoc.path, mockDoc.wrappedKey);
    expect(result.buffer).toEqual(decryptedBuffer);
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.docType).toBe('nric');
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cdd.document_downloaded' }),
    );
  });

  it('throws ForbiddenError when agent does not own the record', async () => {
    mockRepo.findCddRecordWithDocument.mockResolvedValue({
      verifiedByAgentId: 'other-agent',
      document: mockDoc,
    });

    await expect(
      complianceService.downloadCddDocument({
        cddRecordId: 'cdd-1',
        documentId: 'doc-1',
        agentId: 'agent-1',
        isAdmin: false,
      }),
    ).rejects.toThrow('not authorised');
  });

  it('throws NotFoundError when document entry does not exist', async () => {
    mockRepo.findCddRecordWithDocument.mockResolvedValue({
      verifiedByAgentId: 'agent-1',
      document: null,
    });

    await expect(
      complianceService.downloadCddDocument({
        cddRecordId: 'cdd-1',
        documentId: 'missing',
        agentId: 'agent-1',
        isAdmin: false,
      }),
    ).rejects.toThrow('CddDocument');
  });
});

describe('deleteCddDocument', () => {
  it('deletes encrypted file, removes from JSON, and audits', async () => {
    mockRepo.findCddRecordWithDocument.mockResolvedValue({
      verifiedByAgentId: 'agent-1',
      document: {
        id: 'doc-1',
        docType: 'nric',
        path: 'cdd/cdd-1/nric-doc1.enc',
        wrappedKey: 'wrapped',
        label: null,
        mimeType: 'image/jpeg',
        sizeBytes: 5000,
        uploadedAt: '2026-03-18T00:00:00.000Z',
        uploadedByAgentId: 'agent-1',
      },
    });
    mockEncryptedStorage.delete.mockResolvedValue(undefined);
    mockRepo.removeCddDocument.mockResolvedValue('cdd/cdd-1/nric-doc1.enc');
    mockAudit.log.mockResolvedValue(undefined);

    await complianceService.deleteCddDocument({
      cddRecordId: 'cdd-1',
      documentId: 'doc-1',
      agentId: 'agent-1',
      isAdmin: false,
    });

    expect(mockEncryptedStorage.delete).toHaveBeenCalledWith('cdd/cdd-1/nric-doc1.enc');
    expect(mockRepo.removeCddDocument).toHaveBeenCalledWith('cdd-1', 'doc-1');
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cdd.document_deleted' }),
    );
  });

  it('throws ForbiddenError when agent does not own record', async () => {
    mockRepo.findCddRecordWithDocument.mockResolvedValue({
      verifiedByAgentId: 'other-agent',
      document: { id: 'doc-1', path: 'cdd/cdd-1/nric.enc', wrappedKey: 'k' },
    });

    await expect(
      complianceService.deleteCddDocument({
        cddRecordId: 'cdd-1',
        documentId: 'doc-1',
        agentId: 'agent-1',
        isAdmin: false,
      }),
    ).rejects.toThrow('not authorised');

    expect(mockEncryptedStorage.delete).not.toHaveBeenCalled();
  });
});

describe('scanRetention — Tier 1 sensitive doc purge deletes CDD .enc files', () => {
  it('purges CDD .enc files via purgeTransactionSensitiveDocs', async () => {
    // Minimal mock setup — just enough to reach Tier 1 section
    mockRepo.findLeadsForRetention.mockResolvedValue([]);
    mockRepo.findServiceWithdrawnForDeletion.mockResolvedValue([]);
    mockRepo.findConsentRecordsForDeletion.mockResolvedValue([]);
    mockRepo.findClosedListingsForRetention.mockResolvedValue([]);
    mockRepo.findOldViewingSlotsForClosedProperties.mockResolvedValue([]);
    mockRepo.deleteOldViewingSlotsWithViewings.mockResolvedValue(0);
    mockRepo.findOldWeeklyUpdates.mockResolvedValue([]);
    mockRepo.deleteOldWeeklyUpdates.mockResolvedValue(0);
    mockRepo.findStaleCorrectionRequests.mockResolvedValue([]);
    mockRepo.findVerifiedViewersForRetention.mockResolvedValue([]);
    mockRepo.findBuyersForRetention.mockResolvedValue([]);
    mockRepo.findCompletedTransactionsForFinancialRedaction.mockResolvedValue([]);
    mockRepo.findCompletedTransactionsForAnonymisation.mockResolvedValue([]);
    mockRepo.findInactiveAgentsForRetention.mockResolvedValue([]);
    mockRepo.findExistingDeletionRequest.mockResolvedValue(null);
    mockRepo.createDeletionRequest.mockResolvedValue({ id: 'dr-1' } as never);
    mockAudit.log.mockResolvedValue(undefined);
    mockStorage.delete.mockResolvedValue(undefined);
    mockSettings.getNumber
      .mockResolvedValueOnce(12) // lead_retention_months
      .mockResolvedValueOnce(7) // sensitive_doc_retention_days
      .mockResolvedValueOnce(7) // financial_data_retention_days
      .mockResolvedValueOnce(30) // transaction_anonymisation_days
      .mockResolvedValueOnce(1) // consent_post_withdrawal_retention_years
      .mockResolvedValueOnce(6); // listing_retention_months

    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 10);
    mockRepo.findCompletedTransactionsForDocPurge.mockResolvedValue([
      {
        id: 'tx-1',
        sellerId: 'seller-1',
        completionDate: oldDate,
        otp: {
          id: 'otp-1',
          scannedCopyPathSeller: 'otp/seller.pdf',
          scannedCopyPathReturned: null,
        },
        commissionInvoice: { id: 'inv-1', invoiceFilePath: 'invoices/inv.pdf' },
      },
    ]);
    mockRepo.purgeTransactionSensitiveDocs.mockResolvedValue({
      filePaths: ['otp/seller.pdf', 'invoices/inv.pdf', 'cdd/cdd-1/nric-doc1.jpg.enc'],
    });

    await complianceService.scanRetention();

    expect(mockRepo.purgeTransactionSensitiveDocs).toHaveBeenCalledWith('tx-1', 'seller-1');
    expect(mockStorage.delete).toHaveBeenCalledWith('cdd/cdd-1/nric-doc1.jpg.enc');
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'compliance.sensitive_docs_purged',
        entityType: 'transaction',
        entityId: 'tx-1',
      }),
    );
  });
});

describe('purgeSensitiveDocs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAudit.log.mockResolvedValue(undefined);
    mockStorage.delete.mockResolvedValue(undefined);
    mockRepo.findCddRecordsForNricRedaction = jest.fn().mockResolvedValue([]);
  });

  it('purges sensitive docs for completed transactions past the 7-day threshold', async () => {
    mockSettings.getNumber.mockResolvedValueOnce(7); // sensitive_doc_retention_days
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 10);
    mockRepo.findCompletedTransactionsForDocPurge.mockResolvedValue([
      {
        id: 'tx-daily-1',
        sellerId: 'seller-daily-1',
        completionDate: oldDate,
        otp: { id: 'otp-1', scannedCopyPathSeller: 'otp/seller.pdf', scannedCopyPathReturned: null },
        commissionInvoice: { id: 'inv-1', invoiceFilePath: 'invoices/inv.pdf' },
      },
    ]);
    mockRepo.purgeTransactionSensitiveDocs.mockResolvedValue({
      filePaths: ['otp/seller.pdf', 'invoices/inv.pdf'],
    });

    const result = await complianceService.purgeSensitiveDocs();

    expect(mockRepo.purgeTransactionSensitiveDocs).toHaveBeenCalledWith('tx-daily-1', 'seller-daily-1');
    expect(mockStorage.delete).toHaveBeenCalledWith('otp/seller.pdf');
    expect(mockStorage.delete).toHaveBeenCalledWith('invoices/inv.pdf');
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'compliance.sensitive_docs_purged',
        entityType: 'transaction',
        entityId: 'tx-daily-1',
      }),
    );
    expect(result.purgedCount).toBe(1);
  });

  it('skips transactions that have no files remaining', async () => {
    mockSettings.getNumber.mockResolvedValueOnce(7);
    mockRepo.findCompletedTransactionsForDocPurge.mockResolvedValue([
      {
        id: 'tx-empty',
        sellerId: 'seller-2',
        completionDate: new Date(),
        otp: { id: 'otp-2', scannedCopyPathSeller: null, scannedCopyPathReturned: null },
        commissionInvoice: null,
      },
    ]);
    mockRepo.purgeTransactionSensitiveDocs.mockResolvedValue({ filePaths: [] });

    const result = await complianceService.purgeSensitiveDocs();

    expect(mockRepo.purgeTransactionSensitiveDocs).not.toHaveBeenCalled();
    expect(result.purgedCount).toBe(0);
  });

  it('returns purgedCount 0 when no transactions qualify', async () => {
    mockSettings.getNumber.mockResolvedValueOnce(7);
    mockRepo.findCompletedTransactionsForDocPurge.mockResolvedValue([]);

    const result = await complianceService.purgeSensitiveDocs();

    expect(result.purgedCount).toBe(0);
  });

  // Finding #2.6: nricLast4 redaction for transactions with CDD records but no OTP/invoice files
  it('redacts nricLast4 on CDD records for completed transactions past cutoff even when no OTP/invoice files exist', async () => {
    mockSettings.getNumber.mockResolvedValueOnce(7); // sensitive_doc_retention_days
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 10);
    mockRepo.findCompletedTransactionsForDocPurge.mockResolvedValue([
      {
        id: 'tx-cdd-only',
        sellerId: 'seller-cdd',
        completionDate: oldDate,
        otp: { id: 'otp-1', scannedCopyPathSeller: null, scannedCopyPathReturned: null },
        commissionInvoice: null,
      },
    ]);
    mockRepo.findCddRecordsForNricRedaction = jest.fn().mockResolvedValue([{ id: 'cdd-1' }]);
    mockRepo.redactNricFromCddRecord = jest.fn().mockResolvedValue(undefined);

    await complianceService.purgeSensitiveDocs();

    expect(mockRepo.findCddRecordsForNricRedaction).toHaveBeenCalledWith(expect.any(Date));
    expect(mockRepo.redactNricFromCddRecord).toHaveBeenCalledWith('cdd-1');
  });

  it('skips CDD nricLast4 redaction when no records qualify', async () => {
    mockSettings.getNumber.mockResolvedValueOnce(7);
    mockRepo.findCompletedTransactionsForDocPurge.mockResolvedValue([]);
    mockRepo.findCddRecordsForNricRedaction = jest.fn().mockResolvedValue([]);
    mockRepo.redactNricFromCddRecord = jest.fn().mockResolvedValue(undefined);

    await complianceService.purgeSensitiveDocs();

    expect(mockRepo.redactNricFromCddRecord).not.toHaveBeenCalled();
  });
});

describe('confirmHuttonsSubmission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAudit.log.mockResolvedValue(undefined);
    mockStorage.delete.mockResolvedValue(undefined);
  });

  it('confirms handoff, purges sensitive docs, and writes audit log', async () => {
    mockTxRepo.findById.mockResolvedValue({
      id: 'tx-1',
      sellerId: 'seller-1',
      status: 'completed',
      completionDate: new Date(),
      seller: { agentId: 'agent-1' },
      huttonsSubmittedAt: null,
    } as any);
    mockTxRepo.confirmHuttonsHandoff.mockResolvedValue({} as any);
    mockRepo.purgeTransactionSensitiveDocs.mockResolvedValue({
      filePaths: ['otp/seller.pdf', 'cdd/doc.jpg.enc'],
    });

    const result = await complianceService.confirmHuttonsSubmission('tx-1', 'agent-1');

    expect(mockTxRepo.confirmHuttonsHandoff).toHaveBeenCalledWith('tx-1', 'agent-1');
    expect(mockRepo.purgeTransactionSensitiveDocs).toHaveBeenCalledWith('tx-1', 'seller-1');
    expect(mockStorage.delete).toHaveBeenCalledWith('otp/seller.pdf');
    expect(mockStorage.delete).toHaveBeenCalledWith('cdd/doc.jpg.enc');
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'compliance.huttons_handoff_confirmed',
        entityType: 'transaction',
        entityId: 'tx-1',
      }),
    );
    expect(result.purgedFiles).toBe(2);
  });

  it('throws NotFoundError when transaction does not exist', async () => {
    mockTxRepo.findById.mockResolvedValue(null);

    await expect(
      complianceService.confirmHuttonsSubmission('tx-missing', 'agent-1'),
    ).rejects.toThrow('not found');
  });

  it('throws ValidationError when transaction is not completed', async () => {
    mockTxRepo.findById.mockResolvedValue({
      id: 'tx-1',
      status: 'option_issued',
      seller: { agentId: 'agent-1' },
    } as any);

    await expect(
      complianceService.confirmHuttonsSubmission('tx-1', 'agent-1'),
    ).rejects.toThrow('completed');
  });

  it('throws ForbiddenError when agent does not own the transaction', async () => {
    mockTxRepo.findById.mockResolvedValue({
      id: 'tx-1',
      status: 'completed',
      seller: { agentId: 'agent-other' },
      huttonsSubmittedAt: null,
    } as any);

    await expect(
      complianceService.confirmHuttonsSubmission('tx-1', 'agent-1'),
    ).rejects.toThrow();
  });

  it('throws ConflictError when already submitted', async () => {
    mockTxRepo.findById.mockResolvedValue({
      id: 'tx-1',
      status: 'completed',
      seller: { agentId: 'agent-1' },
      huttonsSubmittedAt: new Date(),
    } as any);

    await expect(
      complianceService.confirmHuttonsSubmission('tx-1', 'agent-1'),
    ).rejects.toThrow();
  });
});

describe('recordHuttonsTransferConsent', () => {
  it('carries forward existing service/marketing consent values', async () => {
    mockRepo.findSellerConsent.mockResolvedValue({ consentService: true, consentMarketing: true });
    mockRepo.createConsentRecord.mockResolvedValue({} as any);

    await complianceService.recordHuttonsTransferConsent('seller-123');

    expect(mockRepo.createConsentRecord).toHaveBeenCalledWith({
      subjectId: 'seller-123',
      purposeService: true,
      purposeMarketing: true,
      purposeHuttonsTransfer: true,
    });
  });

  it('uses defaults when no existing consent record exists', async () => {
    mockRepo.findSellerConsent.mockResolvedValue(null);
    mockRepo.createConsentRecord.mockResolvedValue({} as any);

    await complianceService.recordHuttonsTransferConsent('seller-new');

    expect(mockRepo.createConsentRecord).toHaveBeenCalledWith({
      subjectId: 'seller-new',
      purposeService: true,
      purposeMarketing: false,
      purposeHuttonsTransfer: true,
    });
  });
});

describe('grantMarketingConsent', () => {
  it('sets consentMarketing to true and creates a consent record', async () => {
    mockRepo.findSellerConsent.mockResolvedValue({
      consentService: true,
      consentMarketing: false,
    });
    mockRepo.createConsentRecord.mockResolvedValue({ id: 'record-1' } as any);
    mockRepo.updateSellerConsent.mockResolvedValue(undefined);

    const result = await complianceService.grantMarketingConsent({
      sellerId: 'seller-1',
      channel: 'web',
      ipAddress: '127.0.0.1',
      userAgent: 'Mozilla/5.0',
    });

    expect(mockRepo.createConsentRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectId: 'seller-1',
        purposeMarketing: true,
        purposeService: true,
      }),
    );
    expect(mockRepo.updateSellerConsent).toHaveBeenCalledWith('seller-1', {
      consentMarketing: true,
    });
    expect(result.consentRecordId).toBe('record-1');
  });

  it('throws NotFoundError when seller does not exist', async () => {
    mockRepo.findSellerConsent.mockResolvedValue(null);

    await expect(
      complianceService.grantMarketingConsent({ sellerId: 'missing', channel: 'web' }),
    ).rejects.toThrow(NotFoundError);
  });

  it('is idempotent — can grant when already true', async () => {
    mockRepo.findSellerConsent.mockResolvedValue({
      consentService: true,
      consentMarketing: true,
    });
    mockRepo.createConsentRecord.mockResolvedValue({ id: 'record-2' } as any);
    mockRepo.updateSellerConsent.mockResolvedValue(undefined);

    const result = await complianceService.grantMarketingConsent({
      sellerId: 'seller-1',
      channel: 'web',
    });

    expect(result.consentRecordId).toBe('record-2');
  });

  it('writes an audit log entry', async () => {
    mockRepo.findSellerConsent.mockResolvedValue({
      consentService: true,
      consentMarketing: false,
    });
    mockRepo.createConsentRecord.mockResolvedValue({ id: 'record-3' } as any);
    mockRepo.updateSellerConsent.mockResolvedValue(undefined);

    await complianceService.grantMarketingConsent({ sellerId: 'seller-1', channel: 'web' });

    const mockAudit = auditService as jest.Mocked<typeof auditService>;
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'consent.granted',
        entityType: 'seller',
        entityId: 'seller-1',
      }),
    );
  });
});
