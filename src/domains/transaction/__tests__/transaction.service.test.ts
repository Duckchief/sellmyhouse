// src/domains/transaction/__tests__/transaction.service.test.ts
import * as txService from '../transaction.service';
import * as txRepo from '../transaction.repository';
import * as settingsService from '@/domains/shared/settings.service';
import * as notificationService from '@/domains/notification/notification.service';
import * as auditService from '@/domains/shared/audit.service';
import * as portalService from '@/domains/property/portal.service';
import { ValidationError, NotFoundError, ConflictError } from '@/domains/shared/errors';

jest.mock('../transaction.repository');
jest.mock('@/domains/shared/settings.service');
jest.mock('@/domains/notification/notification.service');
jest.mock('@/domains/shared/audit.service');
jest.mock('@/domains/property/portal.service');
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

function makeTransaction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx-1',
    propertyId: 'property-1',
    sellerId: 'seller-1',
    agreedPrice: '600000',
    status: 'option_issued' as const,
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
  });

  describe('createTransaction', () => {
    it('creates a transaction record', async () => {
      const tx = makeTransaction();
      mockTxRepo.createTransaction.mockResolvedValue(tx as never);

      const result = await txService.createTransaction({
        propertyId: 'property-1',
        sellerId: 'seller-1',
        agreedPrice: 600000,
        agentId: 'agent-1',
      });

      expect(mockTxRepo.createTransaction).toHaveBeenCalledTimes(1);
      expect(result.id).toBe('tx-1');
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
        txService.createOtp({ transactionId: 'tx-1', hdbSerialNumber: 'SN-001', agentId: 'agent-1' }),
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

      expect(mockTxRepo.updateOtpStatus).toHaveBeenCalledWith('otp-1', 'sent_to_seller', expect.any(Object));
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
      mockTxRepo.updateOtpStatus.mockResolvedValue({ ...otp, status: 'issued_to_buyer', issuedAt: new Date() } as never);
      mockTxRepo.updateExerciseDeadline.mockResolvedValue(tx as never);
      mockSettings.getNumber.mockResolvedValue(21);

      await txService.advanceOtp({ transactionId: 'tx-1', agentId: 'agent-1' });

      expect(mockTxRepo.updateExerciseDeadline).toHaveBeenCalledTimes(1);
    });
  });

  describe('advanceTransactionStatus', () => {
    it('sets completionDate automatically on transition to completed', async () => {
      const tx = makeTransaction({ status: 'completing' });
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockTxRepo.updateTransactionStatus.mockResolvedValue({ ...tx, status: 'completed', completionDate: new Date() } as never);

      await txService.advanceTransactionStatus({ transactionId: 'tx-1', status: 'completed', agentId: 'agent-1' });

      expect(mockTxRepo.updateTransactionStatus).toHaveBeenCalledWith(
        'tx-1',
        'completed',
        expect.any(Date), // completionDate auto-set
      );
    });

    it('triggers fallen-through cascade when status is fallen_through', async () => {
      const tx = makeTransaction({ status: 'option_issued' });
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockTxRepo.updateTransactionStatus.mockResolvedValue({ ...tx, status: 'fallen_through' } as never);
      mockPortalService.expirePortalListings.mockResolvedValue({ count: 3 } as never);

      await txService.advanceTransactionStatus({ transactionId: 'tx-1', status: 'fallen_through', agentId: 'agent-1' });

      expect(mockPortalService.expirePortalListings).toHaveBeenCalledWith('property-1');
    });
  });

  describe('uploadInvoice', () => {
    it('reads commission amounts from SystemSetting, not schema defaults', async () => {
      const tx = makeTransaction();
      mockTxRepo.findById.mockResolvedValue(tx as never);
      mockTxRepo.findInvoiceByTransactionId.mockResolvedValue(null);
      mockSettings.getNumber.mockImplementation(async (key: string) => {
        if (key === 'commission_amount') return 1499;
        if (key === 'gst_rate') return 0.09;
        return 0;
      });
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

      // Verify amounts come from SystemSetting
      expect(mockSettings.getNumber).toHaveBeenCalledWith('commission_amount', expect.any(Number));
      expect(mockSettings.getNumber).toHaveBeenCalledWith('gst_rate', expect.any(Number));
      expect(mockTxRepo.createCommissionInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 1499,
          gstAmount: expect.any(Number),
          totalAmount: expect.any(Number),
        }),
      );
    });
  });
});
