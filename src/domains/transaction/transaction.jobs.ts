// src/domains/transaction/transaction.jobs.ts
import { registerJob } from '@/infra/jobs/runner';
import * as txRepo from './transaction.repository';
import * as notificationService from '@/domains/notification/notification.service';
import * as contentService from '@/domains/content/content.service';
import { logger } from '@/infra/logger';
import type { NotificationTemplateName } from '@/domains/notification/notification.types';

const OTP_REMINDER_DAYS = [14, 7, 3, 1];

const OTP_REMINDER_TEMPLATE: Record<number, NotificationTemplateName> = {
  14: 'otp_exercise_reminder_14d',
  7: 'otp_exercise_reminder_7d',
  3: 'otp_exercise_reminder_3d',
  1: 'otp_exercise_reminder_1d',
};

/**
 * Checks all OTPs issued to buyer and sends exercise deadline reminders.
 * Deduplication: checks Notification table before sending to prevent re-sends on cron re-runs.
 * M13: Each iteration is wrapped in try/catch so one failure does not abort the batch.
 */
export async function sendOtpExerciseReminders(): Promise<void> {
  const otps = await txRepo.findOtpsIssuedToBuyer();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const otp of otps) {
    try {
      const tx = otp.transaction as {
        id: string;
        sellerId: string;
        exerciseDeadline: Date | null;
        seller: { notificationPreference: string };
      };
      if (!tx.exerciseDeadline) continue;

      const deadline = new Date(tx.exerciseDeadline);
      deadline.setHours(0, 0, 0, 0);
      const daysUntil = Math.round((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      if (!OTP_REMINDER_DAYS.includes(daysUntil)) continue;

      // Deduplication: check if we already sent this reminder
      const templateName = OTP_REMINDER_TEMPLATE[daysUntil];
      if (!templateName) continue; // skip if no template defined for this day count
      const existing = await txRepo.findExistingNotification(templateName, tx.sellerId);
      if (existing) continue;

      await notificationService.send(
        {
          recipientType: 'seller',
          recipientId: tx.sellerId,
          templateName: templateName,
          templateData: {
            address: tx.id,
            status: `OTP exercise deadline is in ${daysUntil} day(s). Please contact your buyer.`,
          },
        },
        'system',
      );
    } catch (err) {
      logger.error({ err, otpId: otp.id }, 'Failed to send OTP exercise reminder');
    }
  }
}

/**
 * Post-completion sequence: day 1 (thank-you), day 7 (testimonial), day 14 (buyer follow-up).
 * Deduplication: checks Notification table before sending.
 * Day 14 requires active marketing consent.
 * M13: Each iteration is wrapped in try/catch so one failure does not abort the batch.
 * M15: Uses property address from included relation instead of transaction ID.
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
      try {
        const seller = tx.seller as {
          id: string;
          name: string;
          notificationPreference: string;
          consentMarketing: boolean;
        };

        // Day 14: block without marketing consent
        if (seq.requiresMarketing && !seller.consentMarketing) continue;

        // Deduplication check — must match the templateName stored in the Notification record
        const existing = await txRepo.findExistingNotification(seq.messageKey, seller.id);
        if (existing) continue;

        // M15: Use actual property address from included relation, not transaction ID
        const property = (tx as { property?: { town?: string; street?: string; block?: string } })
          .property;
        const address = property ? `${property.block} ${property.street}, ${property.town}` : tx.id;

        // Build template data, extended per day
        const templateData: Record<string, string> = {
          address,
          status: seq.messageKey,
        };

        // Day 7: issue testimonial token if one doesn't exist yet
        if (seq.daysAgo === 7) {
          const existingTestimonial = await contentService.getTestimonialBySeller(seller.id);
          if (!existingTestimonial) {
            await contentService
              .issueTestimonialToken(seller.id, tx.id, seller.name ?? '', '')
              .catch(() => {}); // don't fail the job on token issuance error
          }
        }

        // Day 14: include referral link so the seller can share it
        if (seq.daysAgo === 14) {
          const referral = await contentService.sendReferralLinks(seller.id).catch(() => null);
          templateData.referralLink = referral?.referralCode
            ? `${process.env.APP_URL ?? 'https://sellmyhouse.sg'}/?ref=${referral.referralCode}`
            : '';
        }

        await notificationService.send(
          {
            recipientType: 'seller',
            recipientId: seller.id,
            templateName: seq.messageKey as NotificationTemplateName,
            templateData,
          },
          'system',
        );
      } catch (err) {
        logger.error({ err, transactionId: tx.id }, 'Failed to send post-completion message');
      }
    }
  }
}

/**
 * N4: HDB appointment reminders — sends reminders for appointments in the next 3 days.
 * Deduplication via Notification table check.
 * M13: Each iteration is wrapped in try/catch so one failure does not abort the batch.
 * M14: Uses 'hdb_appointment_reminder' as template name consistently (matches dedup check).
 */
export async function sendHdbAppointmentReminders(): Promise<{ reminded: number }> {
  const upcoming = await txRepo.findUpcomingHdbAppointments(3);
  let reminded = 0;

  for (const tx of upcoming) {
    try {
      // M14: Use consistent template name for both dedup check and send
      const existing = await txRepo.findExistingNotification(
        'hdb_appointment_reminder',
        tx.sellerId,
      );
      if (existing) continue;

      const appointmentDate = tx.hdbAppointmentDate
        ? tx.hdbAppointmentDate.toISOString().split('T')[0]
        : 'upcoming';

      await notificationService.send(
        {
          recipientType: 'seller',
          recipientId: tx.sellerId,
          templateName: 'hdb_appointment_reminder' as NotificationTemplateName,
          templateData: {
            message: `Your HDB resale appointment is on ${appointmentDate}. Please ensure all required documents are ready.`,
          },
        },
        'system',
      );
      reminded++;
    } catch (err) {
      logger.error({ err, transactionId: tx.id }, 'Failed to send HDB appointment reminder');
    }
  }

  return { reminded };
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

  // N4: HDB appointment reminders — daily at 9am SGT
  registerJob(
    'transaction:hdb-appointment-reminders',
    '0 9 * * *',
    async () => {
      await sendHdbAppointmentReminders();
    },
    'Asia/Singapore',
  );
}
