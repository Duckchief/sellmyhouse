// src/domains/transaction/__tests__/transaction.jobs.test.ts
import * as txRepo from '../transaction.repository';
import * as notificationService from '@/domains/notification/notification.service';
import * as contentService from '@/domains/content/content.service';
import * as txJobs from '../transaction.jobs';

jest.mock('../transaction.repository');
jest.mock('@/domains/notification/notification.service');
jest.mock('@/domains/content/content.service');
jest.mock('@/infra/jobs/runner');

const mockTxRepo = jest.mocked(txRepo);
const mockNotification = jest.mocked(notificationService);
const mockContentService = jest.mocked(contentService);

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
    // Default: no existing testimonial, no existing referral
    mockContentService.getTestimonialBySeller.mockResolvedValue(null as never);
    mockContentService.issueTestimonialToken.mockResolvedValue(undefined as never);
    mockContentService.sendReferralLinks.mockResolvedValue({
      referralCode: 'TESTCODE',
    } as never);
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

    it('calls issueTestimonialToken on day-7 when no testimonial exists', async () => {
      const tx = makeCompletedTransaction({
        seller: {
          id: 'seller-1',
          name: 'John Doe',
          notificationPreference: 'in_app',
          consentMarketing: false,
        },
      });
      mockTxRepo.findTransactionsCompletedDaysAgo.mockImplementation(async (days) => {
        if (days === 7) return [tx] as never;
        return [] as never;
      });
      // No existing testimonial (set in beforeEach)

      await txJobs.sendPostCompletionMessages();

      expect(mockContentService.issueTestimonialToken).toHaveBeenCalledWith(
        'seller-1',
        'tx-1',
        'John Doe',
        '',
      );
    });

    it('does NOT call issueTestimonialToken when testimonial already exists', async () => {
      const tx = makeCompletedTransaction({
        seller: {
          id: 'seller-1',
          name: 'John Doe',
          notificationPreference: 'in_app',
          consentMarketing: false,
        },
      });
      mockTxRepo.findTransactionsCompletedDaysAgo.mockImplementation(async (days) => {
        if (days === 7) return [tx] as never;
        return [] as never;
      });
      mockContentService.getTestimonialBySeller.mockResolvedValue({ id: 't-existing' } as never);

      await txJobs.sendPostCompletionMessages();

      expect(mockContentService.issueTestimonialToken).not.toHaveBeenCalled();
    });

    it('includes referralLink in day-14 templateData', async () => {
      const tx = makeCompletedTransaction({
        seller: {
          id: 'seller-1',
          name: 'John Doe',
          notificationPreference: 'in_app',
          consentMarketing: true,
        },
      });
      mockTxRepo.findTransactionsCompletedDaysAgo.mockImplementation(async (days) => {
        if (days === 14) return [tx] as never;
        return [] as never;
      });
      mockContentService.sendReferralLinks.mockResolvedValue({
        referralCode: 'MYCODE12',
      } as never);
      process.env.APP_URL = 'https://sellmyhouse.sg';

      await txJobs.sendPostCompletionMessages();

      expect(mockNotification.send).toHaveBeenCalledWith(
        expect.objectContaining({
          templateData: expect.objectContaining({
            referralLink: 'https://sellmyhouse.sg/?ref=MYCODE12',
          }),
        }),
        'system',
      );
    });
  });
});
