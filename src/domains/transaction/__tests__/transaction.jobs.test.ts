// src/domains/transaction/__tests__/transaction.jobs.test.ts
import * as txRepo from '../transaction.repository';
import * as notificationService from '@/domains/notification/notification.service';
import * as txJobs from '../transaction.jobs';

jest.mock('../transaction.repository');
jest.mock('@/domains/notification/notification.service');
jest.mock('@/infra/jobs/runner');

const mockTxRepo = jest.mocked(txRepo);
const mockNotification = jest.mocked(notificationService);

function makeOtpWithTransaction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'otp-1',
    transactionId: 'tx-1',
    status: 'issued_to_buyer' as const,
    transaction: {
      id: 'tx-1',
      sellerId: 'seller-1',
      exerciseDeadline: null,
      seller: { id: 'seller-1', notificationPreference: 'in_app' },
    },
    ...overrides,
  };
}

function makeCompletedTransaction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx-1',
    sellerId: 'seller-1',
    completionDate: new Date(),
    seller: {
      id: 'seller-1',
      notificationPreference: 'in_app',
      consentMarketing: false,
    },
    ...overrides,
  };
}

describe('transaction.jobs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNotification.send.mockResolvedValue(undefined as never);
    // Default: no existing notification (allow sends)
    mockTxRepo.findExistingNotification.mockResolvedValue(null as never);
  });

  describe('sendOtpExerciseReminders', () => {
    it('sends reminder when deadline is exactly 14 days away', async () => {
      const deadline = new Date();
      deadline.setDate(deadline.getDate() + 14);

      const otpWithTx = makeOtpWithTransaction({
        transaction: {
          id: 'tx-1',
          sellerId: 'seller-1',
          exerciseDeadline: deadline,
          seller: { id: 'seller-1', notificationPreference: 'in_app' },
        },
      });

      mockTxRepo.findOtpsIssuedToBuyer.mockResolvedValue([otpWithTx] as never);
      // findExistingNotification returns null by default (set in beforeEach)

      await txJobs.sendOtpExerciseReminders();

      expect(mockNotification.send).toHaveBeenCalledTimes(1);
    });

    it('does NOT send reminder for a deadline that is 10 days away (not a reminder day)', async () => {
      const deadline = new Date();
      deadline.setDate(deadline.getDate() + 10);

      const otpWithTx = makeOtpWithTransaction({
        transaction: {
          id: 'tx-1',
          sellerId: 'seller-1',
          exerciseDeadline: deadline,
          seller: { id: 'seller-1', notificationPreference: 'in_app' },
        },
      });

      mockTxRepo.findOtpsIssuedToBuyer.mockResolvedValue([otpWithTx] as never);

      await txJobs.sendOtpExerciseReminders();

      expect(mockNotification.send).not.toHaveBeenCalled();
    });

    it('does NOT send duplicate reminder when notification already exists', async () => {
      const deadline = new Date();
      deadline.setDate(deadline.getDate() + 7);

      const otpWithTx = makeOtpWithTransaction({
        transaction: {
          id: 'tx-1',
          sellerId: 'seller-1',
          exerciseDeadline: deadline,
          seller: { id: 'seller-1', notificationPreference: 'in_app' },
        },
      });

      mockTxRepo.findOtpsIssuedToBuyer.mockResolvedValue([otpWithTx] as never);
      // Simulate existing notification (duplicate check)
      mockTxRepo.findExistingNotification.mockResolvedValue({ id: 'notif-1' } as never);

      await txJobs.sendOtpExerciseReminders();

      expect(mockNotification.send).not.toHaveBeenCalled();
    });
  });

  describe('sendPostCompletionMessages', () => {
    it('sends thank-you message on day 1 after completion', async () => {
      const tx = makeCompletedTransaction();
      mockTxRepo.findTransactionsCompletedDaysAgo.mockResolvedValue([tx] as never);
      // findExistingNotification returns null by default (set in beforeEach)

      await txJobs.sendPostCompletionMessages();

      // Should be called at least once (for the day-1 thank-you)
      expect(mockNotification.send).toHaveBeenCalled();
    });

    it('does NOT send day-14 buyer follow-up without marketing consent', async () => {
      const tx = makeCompletedTransaction({
        seller: {
          id: 'seller-1',
          notificationPreference: 'in_app',
          consentMarketing: false, // no marketing consent
        },
      });

      // Simulate: only day-14 transactions returned
      mockTxRepo.findTransactionsCompletedDaysAgo.mockImplementation(async (days) => {
        if (days === 14) return [tx] as never;
        return [] as never;
      });

      // findExistingNotification returns null by default (set in beforeEach)

      await txJobs.sendPostCompletionMessages();

      expect(mockNotification.send).not.toHaveBeenCalled();
    });
  });
});
