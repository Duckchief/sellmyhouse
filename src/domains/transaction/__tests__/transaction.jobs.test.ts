// src/domains/transaction/__tests__/transaction.jobs.test.ts
import * as txRepo from '../transaction.repository';
import * as notificationService from '@/domains/notification/notification.service';
import * as contentService from '@/domains/content/content.service';
import * as txJobs from '../transaction.jobs';

jest.mock('../transaction.repository');
jest.mock('@/domains/notification/notification.service');
jest.mock('@/domains/content/content.service');
jest.mock('@/infra/jobs/runner');
jest.mock('@/infra/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

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
    mockTxRepo.findExistingNotification.mockResolvedValue(null as never);
    mockContentService.getTestimonialBySeller.mockResolvedValue(null as never);
    mockContentService.issueTestimonialToken.mockResolvedValue(undefined as never);
    mockContentService.sendReferralLinks.mockResolvedValue({ referralCode: 'TESTCODE' } as never);
  });

  describe('sendOtpExerciseReminders', () => {
    it('sends reminder when deadline is exactly 14 days away', async () => {
      const deadline = new Date();
      deadline.setDate(deadline.getDate() + 14);
      const otpWithTx = makeOtpWithTransaction({
        transaction: { id: 'tx-1', sellerId: 'seller-1', exerciseDeadline: deadline, seller: { id: 'seller-1', notificationPreference: 'in_app' } },
      });
      mockTxRepo.findOtpsIssuedToBuyer.mockResolvedValue([otpWithTx] as never);
      await txJobs.sendOtpExerciseReminders();
      expect(mockNotification.send).toHaveBeenCalledTimes(1);
    });

    it('does NOT send reminder for non-reminder day', async () => {
      const deadline = new Date();
      deadline.setDate(deadline.getDate() + 10);
      const otpWithTx = makeOtpWithTransaction({
        transaction: { id: 'tx-1', sellerId: 'seller-1', exerciseDeadline: deadline, seller: { id: 'seller-1', notificationPreference: 'in_app' } },
      });
      mockTxRepo.findOtpsIssuedToBuyer.mockResolvedValue([otpWithTx] as never);
      await txJobs.sendOtpExerciseReminders();
      expect(mockNotification.send).not.toHaveBeenCalled();
    });

    it('does NOT send duplicate reminder', async () => {
      const deadline = new Date();
      deadline.setDate(deadline.getDate() + 7);
      const otpWithTx = makeOtpWithTransaction({
        transaction: { id: 'tx-1', sellerId: 'seller-1', exerciseDeadline: deadline, seller: { id: 'seller-1', notificationPreference: 'in_app' } },
      });
      mockTxRepo.findOtpsIssuedToBuyer.mockResolvedValue([otpWithTx] as never);
      mockTxRepo.findExistingNotification.mockResolvedValue({ id: 'notif-1' } as never);
      await txJobs.sendOtpExerciseReminders();
      expect(mockNotification.send).not.toHaveBeenCalled();
    });

    it('continues when one OTP notification fails (M13)', async () => {
      const deadline = new Date();
      deadline.setDate(deadline.getDate() + 7);
      const otp1 = makeOtpWithTransaction({ id: 'otp-1', transaction: { id: 'tx-1', sellerId: 'seller-1', exerciseDeadline: deadline, seller: { id: 'seller-1', notificationPreference: 'in_app' } } });
      const otp2 = makeOtpWithTransaction({ id: 'otp-2', transaction: { id: 'tx-2', sellerId: 'seller-2', exerciseDeadline: deadline, seller: { id: 'seller-2', notificationPreference: 'in_app' } } });
      mockTxRepo.findOtpsIssuedToBuyer.mockResolvedValue([otp1, otp2] as never);
      mockNotification.send.mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce(undefined as never);
      await txJobs.sendOtpExerciseReminders();
      expect(mockNotification.send).toHaveBeenCalledTimes(2);
    });
  });

  describe('sendPostCompletionMessages', () => {
    it('sends thank-you on day 1', async () => {
      const tx = makeCompletedTransaction();
      mockTxRepo.findTransactionsCompletedDaysAgo.mockResolvedValue([tx] as never);
      await txJobs.sendPostCompletionMessages();
      expect(mockNotification.send).toHaveBeenCalled();
    });

    it('blocks day-14 without marketing consent', async () => {
      const tx = makeCompletedTransaction({ seller: { id: 'seller-1', notificationPreference: 'in_app', consentMarketing: false } });
      mockTxRepo.findTransactionsCompletedDaysAgo.mockImplementation(async (days) => (days === 14 ? [tx] as never : [] as never));
      await txJobs.sendPostCompletionMessages();
      expect(mockNotification.send).not.toHaveBeenCalled();
    });

    it('issues testimonial token on day-7', async () => {
      const tx = makeCompletedTransaction({ seller: { id: 'seller-1', name: 'John Doe', notificationPreference: 'in_app', consentMarketing: false } });
      mockTxRepo.findTransactionsCompletedDaysAgo.mockImplementation(async (days) => (days === 7 ? [tx] as never : [] as never));
      await txJobs.sendPostCompletionMessages();
      expect(mockContentService.issueTestimonialToken).toHaveBeenCalledWith('seller-1', 'tx-1', 'John Doe', '');
    });

    it('skips testimonial token when exists', async () => {
      const tx = makeCompletedTransaction({ seller: { id: 'seller-1', name: 'John Doe', notificationPreference: 'in_app', consentMarketing: false } });
      mockTxRepo.findTransactionsCompletedDaysAgo.mockImplementation(async (days) => (days === 7 ? [tx] as never : [] as never));
      mockContentService.getTestimonialBySeller.mockResolvedValue({ id: 't-existing' } as never);
      await txJobs.sendPostCompletionMessages();
      expect(mockContentService.issueTestimonialToken).not.toHaveBeenCalled();
    });

    it('continues when one post-completion notification fails (M13)', async () => {
      const tx1 = makeCompletedTransaction({ id: 'tx-1', seller: { id: 'seller-1', name: 'S1', notificationPreference: 'in_app', consentMarketing: false } });
      const tx2 = makeCompletedTransaction({ id: 'tx-2', sellerId: 'seller-2', seller: { id: 'seller-2', name: 'S2', notificationPreference: 'in_app', consentMarketing: false } });
      mockTxRepo.findTransactionsCompletedDaysAgo.mockImplementation(async (days) => (days === 1 ? [tx1, tx2] as never : [] as never));
      mockNotification.send.mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce(undefined as never);
      await txJobs.sendPostCompletionMessages();
      expect(mockNotification.send).toHaveBeenCalledTimes(2);
    });

    it('includes referralLink in day-14', async () => {
      const tx = makeCompletedTransaction({ seller: { id: 'seller-1', name: 'John', notificationPreference: 'in_app', consentMarketing: true } });
      mockTxRepo.findTransactionsCompletedDaysAgo.mockImplementation(async (days) => (days === 14 ? [tx] as never : [] as never));
      mockContentService.sendReferralLinks.mockResolvedValue({ referralCode: 'MYCODE12' } as never);
      process.env.APP_URL = 'https://sellmyhouse.sg';
      await txJobs.sendPostCompletionMessages();
      expect(mockNotification.send).toHaveBeenCalledWith(expect.objectContaining({ templateData: expect.objectContaining({ referralLink: 'https://sellmyhouse.sg/?ref=MYCODE12' }) }), 'system');
    });
  });

  describe('sendHdbAppointmentReminders', () => {
    it('sends with hdb_appointment_reminder template (M14)', async () => {
      mockTxRepo.findUpcomingHdbAppointments.mockResolvedValue([{ id: 'tx-1', sellerId: 'seller-1', hdbAppointmentDate: new Date(Date.now() + 86400000) }] as never);
      const result = await txJobs.sendHdbAppointmentReminders();
      expect(result.reminded).toBe(1);
      expect(mockNotification.send).toHaveBeenCalledWith(expect.objectContaining({ templateName: 'hdb_appointment_reminder' }), 'system');
    });

    it('skips if already sent', async () => {
      mockTxRepo.findUpcomingHdbAppointments.mockResolvedValue([{ id: 'tx-1', sellerId: 'seller-1', hdbAppointmentDate: new Date(Date.now() + 86400000) }] as never);
      mockTxRepo.findExistingNotification.mockResolvedValue({ id: 'n-1' } as never);
      const result = await txJobs.sendHdbAppointmentReminders();
      expect(result.reminded).toBe(0);
    });

    it('continues when one HDB reminder fails (M13)', async () => {
      mockTxRepo.findUpcomingHdbAppointments.mockResolvedValue([
        { id: 'tx-1', sellerId: 'seller-1', hdbAppointmentDate: new Date(Date.now() + 86400000) },
        { id: 'tx-2', sellerId: 'seller-2', hdbAppointmentDate: new Date(Date.now() + 86400000) },
      ] as never);
      mockNotification.send.mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce(undefined as never);
      const result = await txJobs.sendHdbAppointmentReminders();
      expect(result.reminded).toBe(1);
      expect(mockNotification.send).toHaveBeenCalledTimes(2);
    });
  });
});
