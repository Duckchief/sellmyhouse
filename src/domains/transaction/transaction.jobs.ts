// src/domains/transaction/transaction.jobs.ts
import { registerJob } from '@/infra/jobs/runner';
import * as txRepo from './transaction.repository';
import * as notificationService from '@/domains/notification/notification.service';

const OTP_REMINDER_DAYS = [14, 7, 3, 1];

/**
 * Checks all OTPs issued to buyer and sends exercise deadline reminders.
 * Deduplication: checks Notification table before sending to prevent re-sends on cron re-runs.
 */
export async function sendOtpExerciseReminders(): Promise<void> {
  const otps = await txRepo.findOtpsIssuedToBuyer();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const otp of otps) {
    const tx = otp.transaction as {
      id: string;
      sellerId: string;
      exerciseDeadline: Date | null;
      seller: { notificationPreference: string };
    };
    if (!tx.exerciseDeadline) continue;

    const deadline = new Date(tx.exerciseDeadline);
    deadline.setHours(0, 0, 0, 0);
    const daysUntil = Math.round(
      (deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (!OTP_REMINDER_DAYS.includes(daysUntil)) continue;

    // Deduplication: check if we already sent this reminder
    const templateName = `otp_exercise_reminder_${daysUntil}d`;
    const existing = await txRepo.findExistingNotification(templateName, tx.sellerId);
    if (existing) continue;

    await notificationService.send(
      {
        recipientType: 'seller',
        recipientId: tx.sellerId,
        templateName: templateName as never,
        templateData: {
          address: tx.id,
          status: `OTP exercise deadline is in ${daysUntil} day(s). Please contact your buyer.`,
        },
      },
      'system',
    );
  }
}

/**
 * Post-completion sequence: day 1 (thank-you), day 7 (testimonial), day 14 (buyer follow-up).
 * Deduplication: checks Notification table before sending.
 * Day 14 requires active marketing consent.
 */
export async function sendPostCompletionMessages(): Promise<void> {
  const sequences: Array<{
    daysAgo: number;
    messageKey: string;
    requiresMarketing: boolean;
  }> = [
    { daysAgo: 1, messageKey: 'post_completion_day1', requiresMarketing: false },
    { daysAgo: 7, messageKey: 'post_completion_day7', requiresMarketing: false },
    { daysAgo: 14, messageKey: 'post_completion_day14', requiresMarketing: true },
  ];

  for (const seq of sequences) {
    const transactions = await txRepo.findTransactionsCompletedDaysAgo(seq.daysAgo);

    for (const tx of transactions) {
      const seller = tx.seller as {
        id: string;
        notificationPreference: string;
        consentMarketing: boolean;
      };

      // Day 14: block without marketing consent
      if (seq.requiresMarketing && !seller.consentMarketing) continue;

      // Deduplication check — must match the templateName stored in the Notification record
      const existing = await txRepo.findExistingNotification(seq.messageKey, seller.id);
      if (existing) continue;

      await notificationService.send(
        {
          recipientType: 'seller',
          recipientId: seller.id,
          templateName: seq.messageKey as never,
          templateData: {
            address: tx.id,
            status: seq.messageKey,
          },
        },
        'system',
      );
    }
  }
}

export function registerTransactionJobs(): void {
  registerJob(
    'transaction:otp-exercise-reminders',
    '0 9 * * *',
    () => sendOtpExerciseReminders(),
    'Asia/Singapore',
  );

  registerJob(
    'transaction:post-completion-messages',
    '0 9 * * *',
    () => sendPostCompletionMessages(),
    'Asia/Singapore',
  );
}
