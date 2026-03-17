// src/domains/transaction/__tests__/transaction.service.test.ts
import * as txService from '../transaction.service';
import * as txRepo from '../transaction.repository';
import * as settingsService from '@/domains/shared/settings.service';
import * as notificationService from '@/domains/notification/notification.service';
import * as auditService from '@/domains/shared/audit.service';
import * as portalService from '@/domains/property/portal.service';
import * as propertyService from '@/domains/property/property.service';
import * as viewingService from '@/domains/viewing/viewing.service';
import * as offerService from '@/domains/offer/offer.service';
import * as complianceService from '@/domains/compliance/compliance.service';
import * as reviewService from '@/domains/review/review.service';
import { ValidationError, ConflictError, ComplianceError } from '@/domains/shared/errors';

jest.mock('../transaction.repository');
jest.mock('@/domains/shared/settings.service');
jest.mock('@/domains/notification/notification.service');
jest.mock('@/domains/shared/audit.service');
jest.mock('@/domains/property/portal.service');
jest.mock('@/domains/property/property.service');
jest.mock('@/domains/viewing/viewing.service');
jest.mock('@/domains/offer/offer.service');
jest.mock('@/domains/compliance/compliance.service');
jest.mock('@/domains/review/review.service');
jest.mock('@/infra/security/virus-scanner', () => ({
  scanBuffer: jest.fn().mockResolvedValue({ isClean: true, viruses: [] }),
}));
jest.mock('@/infra/storage/local-storage', () => ({
  localStorage: {
    save: jest.fn().mockResolvedValue('invoices/tx-1/invoice-abc.pdf'),
    read: jest.fn().mockResolvedValue(Buffer.from('')),
    delete: jest.fn().mockResolvedValue(undefined),
    exists: jest.fn().mockResolvedValue(true),
  },
}));

const mockTxRepo = jest.mocked(txRepo);
const mockSettings = jest.mocked(settingsService);
const mockNotification = jest.mocked(notificationService);
const mockAudit = jest.mocked(auditService);
const mockPortalService = jest.mocked(portalService);
const mockPropertyService = jest.mocked(propertyService);
const mockViewingService = jest.mocked(viewingService);
const mockOfferService = jest.mocked(offerService);
const mockComplianceService = jest.mocked(complianceService);
const mockReviewService = jest.mocked(reviewService);

function makeTransaction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx-1',
    propertyId: 'property-1',
    sellerId: 'seller-1',
    offerId: 'offer-1',
    agreedPrice: '600000',
    status: 'option_issued' as const,
    hdbApplicationStatus: 'not_started' as const,
    completionDate: null,
    exerciseDeadline: null,
    otp: null,
    commissionInvoice: null,
    ...overrides,
  };
}

function makeOtp(overrides: Record<string, unknown> = {}) {
  return {
    id: 'otp-1',
    transactionId: 'tx-1',
    hdbSerialNumber: 'SN-001',
    status: 'prepared' as const,
    issuedAt: null,
    agentReviewedAt: null,
    agentReviewedByAgentId: null,
    scannedCopyPathSeller: null,
    scannedCopyPathReturned: null,
    ...overrides,
  };
}

describe('transaction.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAudit.log.mockResolvedValue(undefined as never);
    mockNotification.send.mockResolvedValue(undefined as never);
    mockSettings.getNumber.mockResolvedValue(21); // otp_exercise_days default
    mockSettings.get.mockResolvedValue('anthropic');
    mockSettings.getCommission.mockResolvedValue({
      amount: 1499,
      gstRate: 0.09,
      gstAmount: 134.91,
      total: 1633.91,
    } as never);
    mockPropertyService.revertPropertyToDraft.mockResolvedValue(undefined as never);
    mockViewingService.cancelSlotsForPropertyCascade.mockResolvedValue(undefined as never);
    // Default: offer is accepted (H4)
    mockOfferService.findOffer.mockResolvedValue({
      id: 'offer-1',
      propertyId: 'property-1',
      status: 'accepted',
      isCoBroke: false,
    } as never);
    // Default: no seller CDD record (H5)
    mockComplianceService.findLatestSellerCddRecord.mockResolvedValue(null);
    // Default: Gate 3 passes (H3)
    mockReviewService.checkComplianceGate.mockResolvedValue(undefined);
    // Default: counterparty CDD gate — buyer is represented (has agent)
    mockTxRepo.findAcceptedOfferByPropertyId.mockResolvedValue({
      id: 'offer-1',
      buyerName: 'Jane Buyer',
      buyerAgentName: 'John Agent',
      buyerAgentCeaReg: 'R012345B',
    } as never);
    mockTxRepo.findCounterpartyCddByPropertyId.mockResolvedValue(null);
    // Default: property address for L5
    mockPropertyService.getPropertyById.mockResolvedValue({
      id: 'property-1',
      block: '123',
      street: 'Tampines Ave 1',
      town: 'TAMPINES',
    } as never);
  });

  describe('createTransaction', () => {
    it('creates a transaction record with accepted offerId', async () => {
      const tx = makeTransaction();
      mockTxRepo.createTransaction.mockResolvedValue(tx as never);

      const result = await txService.createTransaction({
        propertyId: 'property-1',
        sellerId: 'seller-1',
        offerId: 'offer-1',
        agreedPrice: 600000,
        agentId: 'agent-1',
      });

      expect(mockTxRepo.createTransaction).toHaveBeenCalledTimes(1);
      expect(result.id).toBe('tx-1');
    });

    it('throws ValidationError when offerId points to non-accepted offer', async () => {
      mockOfferService.findOffer.mockResolvedValue({
        id: 'offer-1',
        propertyId: 'property-1',
        status: 'pending',
      } as never);

      await expect(
        txService.createTransaction({
          propertyId: 'property-1',
          sellerId: 'seller-1',
          offerId: 'offer-1',
          agreedPrice: 600000,
          agentId: 'agent-1',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when offer does not exist', async () => {
      mockOfferService.findOffer.mockResolvedValue(null);

      await expect(
        txService.createTransaction({
          propertyId: 'property-1',
          sellerId: 'seller-1',
          offerId: 'bad-offer',
          agreedPrice: 600000,
          agentId: 'agent-1',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('sets sellerCddRecordId from the sellers latest CDD record', async () => {
      const tx = makeTransaction();
      mockTxRepo.createTransaction.mockResolvedValue(tx as never);
      mockComplianceService.findLatestSellerCddRecord.mockResolvedValue({
        id: 'cdd-1',
        verifiedAt: new Date(),
      } as never);

      await txService.createTransaction({
        propertyId: 'property-1',
        sellerId: 'seller-1',
        offerId: 'offer-1',
        agreedPrice: 600000,
        agentId: 'agent-1',
      });

      expect(mockTxRepo.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ sellerCddRecordId: 'cdd-1' }),
      );
    });
  });

  describe('createOtp', () => {
    it('creates OTP record', async () => {
      const tx = makeTransaction();
      const otp = makeOtp();
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockTxRepo.findOtpByTransactionId.mockResolvedValue(null);
      mockTxRepo.createOtp.mockResolvedValue(otp as never);

      await txService.createOtp({
        transactionId: 'tx-1',
        hdbSerialNumber: 'SN-001',
        agentId: 'agent-1',
      });

      expect(mockTxRepo.createOtp).toHaveBeenCalledTimes(1);
    });

    it('throws ConflictError if OTP already exists for transaction', async () => {
      const tx = makeTransaction();
      const existingOtp = makeOtp();
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockTxRepo.findOtpByTransactionId.mockResolvedValue(existingOtp as never);

      await expect(
        txService.createOtp({
          transactionId: 'tx-1',
          hdbSerialNumber: 'SN-001',
          agentId: 'agent-1',
        }),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('advanceOtp', () => {
    it('advances OTP to next status (prepared → sent_to_seller)', async () => {
      const tx = makeTransaction();
      const otp = makeOtp({ status: 'prepared' });
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockTxRepo.findOtpByTransactionId.mockResolvedValue(otp as never);
      mockTxRepo.updateOtpStatus.mockResolvedValue({ ...otp, status: 'sent_to_seller' } as never);

      await txService.advanceOtp({ transactionId: 'tx-1', agentId: 'agent-1' });

      expect(mockTxRepo.updateOtpStatus).toHaveBeenCalledWith(
        'otp-1',
        'sent_to_seller',
        expect.any(Object),
      );
    });

    it('throws ValidationError when trying to advance from terminal state', async () => {
      const tx = makeTransaction();
      const otp = makeOtp({ status: 'exercised' });
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockTxRepo.findOtpByTransactionId.mockResolvedValue(otp as never);

      await expect(
        txService.advanceOtp({ transactionId: 'tx-1', agentId: 'agent-1' }),
      ).rejects.toThrow(ValidationError);
    });

    it('blocks issued_to_buyer transition without agent review', async () => {
      const tx = makeTransaction();
      const otp = makeOtp({ status: 'returned', agentReviewedAt: null });
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockTxRepo.findOtpByTransactionId.mockResolvedValue(otp as never);

      await expect(
        txService.advanceOtp({ transactionId: 'tx-1', agentId: 'agent-1' }),
      ).rejects.toThrow(ValidationError);
    });

    it('sets exerciseDeadline when advancing to issued_to_buyer', async () => {
      const tx = makeTransaction();
      const otp = makeOtp({
        status: 'returned',
        agentReviewedAt: new Date(), // agent has reviewed
      });
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockTxRepo.findOtpByTransactionId.mockResolvedValue(otp as never);
      mockTxRepo.updateOtpStatus.mockResolvedValue({
        ...otp,
        status: 'issued_to_buyer',
        issuedAt: new Date(),
      } as never);
      mockTxRepo.updateExerciseDeadline.mockResolvedValue(tx as never);
      mockSettings.getNumber.mockResolvedValue(21);

      await txService.advanceOtp({ transactionId: 'tx-1', agentId: 'agent-1' });

      expect(mockTxRepo.updateExerciseDeadline).toHaveBeenCalledTimes(1);
    });

    it('blocks issued_to_buyer when buyer is unrepresented and no counterparty CDD exists', async () => {
      const tx = makeTransaction();
      const otp = makeOtp({ status: 'returned', agentReviewedAt: new Date() });
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockTxRepo.findOtpByTransactionId.mockResolvedValue(otp as never);
      mockTxRepo.findAcceptedOfferByPropertyId.mockResolvedValue({
        id: 'offer-1',
        buyerName: 'Jane Buyer',
        buyerAgentName: null,
        buyerAgentCeaReg: null,
      } as never);
      mockTxRepo.findCounterpartyCddByPropertyId.mockResolvedValue(null);

      await expect(
        txService.advanceOtp({ transactionId: 'tx-1', agentId: 'agent-1' }),
      ).rejects.toThrow(ComplianceError);
    });

    it('allows issued_to_buyer when buyer has a buyer agent (represented)', async () => {
      const tx = makeTransaction();
      const otp = makeOtp({ status: 'returned', agentReviewedAt: new Date() });
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockTxRepo.findOtpByTransactionId.mockResolvedValue(otp as never);
      mockTxRepo.findAcceptedOfferByPropertyId.mockResolvedValue({
        id: 'offer-1',
        buyerName: 'Jane Buyer',
        buyerAgentName: 'John Agent',
        buyerAgentCeaReg: 'R012345B',
      } as never);
      mockTxRepo.updateOtpStatus.mockResolvedValue({ ...otp, status: 'issued_to_buyer' } as never);
      mockTxRepo.updateExerciseDeadline.mockResolvedValue(tx as never);
      mockSettings.getNumber.mockResolvedValue(21);

      await txService.advanceOtp({ transactionId: 'tx-1', agentId: 'agent-1' });
      expect(mockTxRepo.updateOtpStatus).toHaveBeenCalled();
    });

    it('allows issued_to_buyer when buyer is unrepresented but counterparty CDD is verified', async () => {
      const tx = makeTransaction();
      const otp = makeOtp({ status: 'returned', agentReviewedAt: new Date() });
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockTxRepo.findOtpByTransactionId.mockResolvedValue(otp as never);
      mockTxRepo.findAcceptedOfferByPropertyId.mockResolvedValue({
        id: 'offer-1',
        buyerName: 'Jane Buyer',
        buyerAgentName: null,
        buyerAgentCeaReg: null,
      } as never);
      mockTxRepo.findCounterpartyCddByPropertyId.mockResolvedValue({
        id: 'cdd-buyer-1',
        subjectType: 'buyer',
        identityVerified: true,
      } as never);
      mockTxRepo.updateOtpStatus.mockResolvedValue({ ...otp, status: 'issued_to_buyer' } as never);
      mockTxRepo.updateExerciseDeadline.mockResolvedValue(tx as never);
      mockSettings.getNumber.mockResolvedValue(21);

      await txService.advanceOtp({ transactionId: 'tx-1', agentId: 'agent-1' });
      expect(mockTxRepo.updateOtpStatus).toHaveBeenCalled();
    });

    it('allows issued_to_buyer when no accepted offer exists (edge case)', async () => {
      const tx = makeTransaction();
      const otp = makeOtp({ status: 'returned', agentReviewedAt: new Date() });
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockTxRepo.findOtpByTransactionId.mockResolvedValue(otp as never);
      mockTxRepo.findAcceptedOfferByPropertyId.mockResolvedValue(null);
      mockTxRepo.updateOtpStatus.mockResolvedValue({ ...otp, status: 'issued_to_buyer' } as never);
      mockTxRepo.updateExerciseDeadline.mockResolvedValue(tx as never);
      mockSettings.getNumber.mockResolvedValue(21);

      await txService.advanceOtp({ transactionId: 'tx-1', agentId: 'agent-1' });
      expect(mockTxRepo.updateOtpStatus).toHaveBeenCalled();
    });
  });

  describe('advanceTransactionStatus', () => {
    it('sets completionDate automatically on transition to completed', async () => {
      const tx = makeTransaction({ status: 'completing' });
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockTxRepo.updateTransactionStatus.mockResolvedValue({
        ...tx,
        status: 'completed',
        completionDate: new Date(),
      } as never);

      await txService.advanceTransactionStatus({
        transactionId: 'tx-1',
        status: 'completed',
        agentId: 'agent-1',
      });

      expect(mockTxRepo.updateTransactionStatus).toHaveBeenCalledWith(
        'tx-1',
        'completed',
        expect.any(Date), // completionDate auto-set
      );
    });

    it('throws ValidationError when trying to regress transaction status', async () => {
      const tx = makeTransaction({ status: 'completed' });
      mockTxRepo.findById.mockResolvedValue(tx as never);

      await expect(
        txService.advanceTransactionStatus({
          transactionId: 'tx-1',
          status: 'completing',
          agentId: 'agent-1',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ComplianceError when counterparty CDD is not completed (Gate 3)', async () => {
      const tx = makeTransaction({ status: 'option_issued' });
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockReviewService.checkComplianceGate.mockRejectedValue(
        new ComplianceError('Gate 3: Counterparty CDD must be completed before proceeding'),
      );

      await expect(
        txService.advanceTransactionStatus({
          transactionId: 'tx-1',
          status: 'option_exercised',
          agentId: 'agent-1',
        }),
      ).rejects.toThrow(ComplianceError);
    });

    it('passes Gate 3 and advances status when counterparty CDD is verified', async () => {
      const tx = makeTransaction({ status: 'option_issued' });
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockReviewService.checkComplianceGate.mockResolvedValue(undefined);
      mockTxRepo.updateTransactionStatus.mockResolvedValue({
        ...tx,
        status: 'option_exercised',
      } as never);

      await txService.advanceTransactionStatus({
        transactionId: 'tx-1',
        status: 'option_exercised',
        agentId: 'agent-1',
      });

      expect(mockTxRepo.updateTransactionStatus).toHaveBeenCalledWith(
        'tx-1',
        'option_exercised',
        undefined,
      );
    });

    it('throws ComplianceError when advancing to completed without HDB approval_granted (Gate 5)', async () => {
      const tx = makeTransaction({ status: 'completing' });
      mockTxRepo.findById.mockResolvedValue(tx as never);
      // Gate 3 passes, Gate 5 fails
      mockReviewService.checkComplianceGate
        .mockResolvedValueOnce(undefined) // counterparty_cdd
        .mockRejectedValueOnce(
          new ComplianceError(
            'Gate 5: HDB application must be approved (approval_granted) before transaction can be completed',
          ),
        );

      await expect(
        txService.advanceTransactionStatus({
          transactionId: 'tx-1',
          status: 'completed',
          agentId: 'agent-1',
        }),
      ).rejects.toThrow(ComplianceError);

      expect(mockTxRepo.updateTransactionStatus).not.toHaveBeenCalled();
    });

    it('Gate 5 is not checked when advancing to non-completed status', async () => {
      const tx = makeTransaction({ status: 'option_issued' });
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockReviewService.checkComplianceGate.mockResolvedValue(undefined);
      mockTxRepo.updateTransactionStatus.mockResolvedValue({
        ...tx,
        status: 'option_exercised',
      } as never);

      await txService.advanceTransactionStatus({
        transactionId: 'tx-1',
        status: 'option_exercised',
        agentId: 'agent-1',
      });

      // checkComplianceGate should only be called once (Gate 3), not twice
      expect(mockReviewService.checkComplianceGate).toHaveBeenCalledTimes(1);
      expect(mockReviewService.checkComplianceGate).toHaveBeenCalledWith(
        'counterparty_cdd',
        'tx-1',
        { buyerRepresented: false },
      );
    });

    it('advances to completed when both Gate 3 and Gate 5 pass', async () => {
      const tx = makeTransaction({ status: 'completing' });
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockReviewService.checkComplianceGate.mockResolvedValue(undefined);
      mockTxRepo.updateTransactionStatus.mockResolvedValue({
        ...tx,
        status: 'completed',
        completionDate: new Date(),
      } as never);

      await txService.advanceTransactionStatus({
        transactionId: 'tx-1',
        status: 'completed',
        agentId: 'agent-1',
      });

      expect(mockReviewService.checkComplianceGate).toHaveBeenCalledWith(
        'counterparty_cdd',
        'tx-1',
        { buyerRepresented: false },
      );
      expect(mockReviewService.checkComplianceGate).toHaveBeenCalledWith('hdb_complete', 'tx-1');
      expect(mockTxRepo.updateTransactionStatus).toHaveBeenCalledWith(
        'tx-1',
        'completed',
        expect.any(Date),
      );
    });

    it('calls refreshCddRetentionOnCompletion with (transactionId, sellerId) when advancing to completed', async () => {
      const tx = makeTransaction({ status: 'completing' });
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockReviewService.checkComplianceGate.mockResolvedValue(undefined);
      mockComplianceService.refreshCddRetentionOnCompletion.mockResolvedValue(undefined);
      mockTxRepo.updateTransactionStatus.mockResolvedValue({
        ...tx,
        status: 'completed',
        completionDate: new Date(),
      } as never);

      await txService.advanceTransactionStatus({
        transactionId: 'tx-1',
        status: 'completed',
        agentId: 'agent-1',
      });

      expect(mockComplianceService.refreshCddRetentionOnCompletion).toHaveBeenCalledWith(
        'tx-1',
        'seller-1',
      );
    });

    it('does NOT call refreshCddRetentionOnCompletion when advancing to option_exercised', async () => {
      const tx = makeTransaction({ status: 'option_issued' });
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockReviewService.checkComplianceGate.mockResolvedValue(undefined);
      mockTxRepo.updateTransactionStatus.mockResolvedValue({
        ...tx,
        status: 'option_exercised',
      } as never);

      await txService.advanceTransactionStatus({
        transactionId: 'tx-1',
        status: 'option_exercised',
        agentId: 'agent-1',
      });

      expect(mockComplianceService.refreshCddRetentionOnCompletion).not.toHaveBeenCalled();
    });

    it('passes buyerRepresented: true to Gate 3 when offer is co-broke', async () => {
      const tx = makeTransaction({ status: 'option_issued' });
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockOfferService.findOffer.mockResolvedValue({
        id: 'offer-1',
        status: 'accepted',
        isCoBroke: true,
        buyerAgentName: 'John Agent',
        buyerAgentCeaReg: 'R012345B',
      } as never);
      mockTxRepo.updateTransactionStatus.mockResolvedValue({
        ...tx,
        status: 'option_exercised',
      } as never);

      await txService.advanceTransactionStatus({
        transactionId: 'tx-1',
        status: 'option_exercised',
        agentId: 'agent-1',
      });

      expect(mockReviewService.checkComplianceGate).toHaveBeenCalledWith(
        'counterparty_cdd',
        'tx-1',
        { buyerRepresented: true },
      );
    });

    it('passes buyerRepresented: false when tx has no offerId', async () => {
      const tx = makeTransaction({ status: 'option_issued', offerId: null });
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockTxRepo.updateTransactionStatus.mockResolvedValue({
        ...tx,
        status: 'option_exercised',
      } as never);

      await txService.advanceTransactionStatus({
        transactionId: 'tx-1',
        status: 'option_exercised',
        agentId: 'agent-1',
      });

      expect(mockReviewService.checkComplianceGate).toHaveBeenCalledWith(
        'counterparty_cdd',
        'tx-1',
        { buyerRepresented: false },
      );
    });
  });

  describe('markFallenThrough', () => {
    it('triggers fallen-through cascade and notifies seller', async () => {
      const tx = makeTransaction({ status: 'option_issued' });
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockTxRepo.updateFallenThrough.mockResolvedValue({
        ...tx,
        status: 'fallen_through',
        fallenThroughReason: 'Buyer financing fell through.',
      } as never);
      mockTxRepo.findOtpByTransactionId.mockResolvedValue(null);
      mockPortalService.expirePortalListings.mockResolvedValue({ count: 3 } as never);

      await txService.markFallenThrough({
        transactionId: 'tx-1',
        sellerId: 'seller-1',
        reason: 'Buyer financing fell through.',
        agentId: 'agent-1',
      });

      expect(mockTxRepo.updateFallenThrough).toHaveBeenCalledWith(
        'tx-1',
        'Buyer financing fell through.',
      );
      expect(mockPortalService.expirePortalListings).toHaveBeenCalledWith('property-1');
      expect(mockNotification.send).toHaveBeenCalledWith(
        expect.objectContaining({ recipientType: 'seller', recipientId: 'seller-1' }),
        'agent-1',
      );
    });

    it('cancels viewing slots for the property', async () => {
      const tx = makeTransaction({ status: 'option_issued' });
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockTxRepo.updateFallenThrough.mockResolvedValue({
        ...tx,
        status: 'fallen_through',
      } as never);
      mockTxRepo.findOtpByTransactionId.mockResolvedValue(null);
      mockPortalService.expirePortalListings.mockResolvedValue({ count: 0 } as never);

      await txService.markFallenThrough({
        transactionId: 'tx-1',
        sellerId: 'seller-1',
        reason: 'Buyer financing fell through.',
        agentId: 'agent-1',
      });

      expect(mockViewingService.cancelSlotsForPropertyCascade).toHaveBeenCalledWith(
        'property-1',
        'agent-1',
      );
    });

    it('reverts property to draft', async () => {
      const tx = makeTransaction({ status: 'option_issued' });
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockTxRepo.updateFallenThrough.mockResolvedValue({
        ...tx,
        status: 'fallen_through',
      } as never);
      mockTxRepo.findOtpByTransactionId.mockResolvedValue(null);
      mockPortalService.expirePortalListings.mockResolvedValue({ count: 0 } as never);

      await txService.markFallenThrough({
        transactionId: 'tx-1',
        sellerId: 'seller-1',
        reason: 'Buyer financing fell through.',
        agentId: 'agent-1',
      });

      expect(mockPropertyService.revertPropertyToDraft).toHaveBeenCalledWith('property-1');
    });
  });

  describe('updateHdbTracking', () => {
    it('notifies seller when hdbApplicationStatus is set', async () => {
      const tx = makeTransaction();
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockTxRepo.updateHdbTracking.mockResolvedValue({
        ...tx,
        hdbApplicationStatus: 'application_submitted',
      } as never);
      mockPropertyService.getPropertyById.mockResolvedValue({
        block: '123',
        street: 'Ang Mo Kio Ave 1',
        town: 'Ang Mo Kio',
      } as never);

      await txService.updateHdbTracking({
        transactionId: 'tx-1',
        hdbApplicationStatus: 'application_submitted',
        agentId: 'agent-1',
      });

      expect(mockNotification.send).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientType: 'seller',
          recipientId: 'seller-1',
          templateName: 'transaction_update',
        }),
        'agent-1',
      );
    });

    it('does NOT notify seller when hdbApplicationStatus is not provided', async () => {
      const tx = makeTransaction();
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockTxRepo.updateHdbTracking.mockResolvedValue(tx as never);

      await txService.updateHdbTracking({
        transactionId: 'tx-1',
        hdbAppointmentDate: new Date(),
        agentId: 'agent-1',
      });

      expect(mockNotification.send).not.toHaveBeenCalled();
    });
  });

  describe('markOtpReviewed', () => {
    it('throws ValidationError when videoCallConfirmedAt is null on the linked EAA', async () => {
      const otp = makeOtp({ status: 'returned' });
      mockTxRepo.findOtpByTransactionId.mockResolvedValue(otp as never);
      mockTxRepo.findEaaByTransactionId.mockResolvedValue({
        id: 'eaa-1',
        videoCallConfirmedAt: null,
        signedCopyPath: null,
      } as never);

      await expect(
        txService.markOtpReviewed({ transactionId: 'tx-1', agentId: 'agent-1' }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when no EAA is linked to the transaction', async () => {
      const otp = makeOtp({ status: 'returned' });
      mockTxRepo.findOtpByTransactionId.mockResolvedValue(otp as never);
      mockTxRepo.findEaaByTransactionId.mockResolvedValue(null);

      await expect(
        txService.markOtpReviewed({ transactionId: 'tx-1', agentId: 'agent-1' }),
      ).rejects.toThrow(ValidationError);
    });

    it('marks OTP as reviewed when videoCallConfirmedAt is set', async () => {
      const otp = makeOtp({ status: 'returned' });
      mockTxRepo.findOtpByTransactionId.mockResolvedValue(otp as never);
      mockTxRepo.findEaaByTransactionId.mockResolvedValue({
        id: 'eaa-1',
        videoCallConfirmedAt: new Date(),
        signedCopyPath: null,
      } as never);
      mockTxRepo.updateOtpReview.mockResolvedValue({
        ...otp,
        agentReviewedAt: new Date(),
      } as never);

      await txService.markOtpReviewed({ transactionId: 'tx-1', agentId: 'agent-1' });

      expect(mockTxRepo.updateOtpReview).toHaveBeenCalledWith(
        'otp-1',
        expect.any(Date),
        'agent-1',
        undefined,
      );
    });
  });

  describe('uploadInvoice', () => {
    it('reads commission amounts from SystemSetting via getCommission(), not schema defaults', async () => {
      const tx = makeTransaction();
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockTxRepo.findInvoiceByTransactionId.mockResolvedValue(null);
      mockSettings.getCommission.mockResolvedValue({
        amount: 1499,
        gstRate: 0.09,
        gstAmount: 134.91,
        total: 1633.91,
      } as never);
      mockTxRepo.createCommissionInvoice.mockResolvedValue({
        id: 'inv-1',
        amount: '1499',
        gstAmount: '134.91',
        totalAmount: '1633.91',
        status: 'uploaded',
      } as never);

      await txService.uploadInvoice({
        transactionId: 'tx-1',
        fileBuffer: Buffer.from('fake-pdf'),
        originalFilename: 'invoice.pdf',
        invoiceNumber: 'INV-001',
        agentId: 'agent-1',
      });

      // Verify amounts are sourced from getCommission(), not hardcoded
      expect(mockSettings.getCommission).toHaveBeenCalledTimes(1);
      expect(mockTxRepo.createCommissionInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 1499,
          gstAmount: 134.91,
          totalAmount: 1633.91,
        }),
      );
    });

    it('throws if commission SystemSettings are missing (no silent fallback)', async () => {
      const tx = makeTransaction();
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockTxRepo.findInvoiceByTransactionId.mockResolvedValue(null);
      mockSettings.getCommission.mockRejectedValue(
        new Error('Setting not found: commission_amount'),
      );

      await expect(
        txService.uploadInvoice({
          transactionId: 'tx-1',
          fileBuffer: Buffer.from('fake-pdf'),
          originalFilename: 'invoice.pdf',
          invoiceNumber: 'INV-001',
          agentId: 'agent-1',
        }),
      ).rejects.toThrow('Setting not found: commission_amount');

      expect(mockTxRepo.createCommissionInvoice).not.toHaveBeenCalled();
    });
  });
});
