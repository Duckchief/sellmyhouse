// src/domains/content/content.jobs.ts
import { registerJob } from '@/infra/jobs/runner';
import { logger } from '@/infra/logger';
import * as settingsService from '@/domains/shared/settings.service';
import {
  generateMarketContent,
  getIsoWeekPeriod,
  markReferralTransactionComplete,
} from './content.service';
import * as contentRepo from './content.repository';

export function registerContentJobs() {
  registerMarketContentJobs();
  registerReferralJobs();
}

export function registerMarketContentJobs() {
  registerJob(
    'market-content-weekly',
    '0 8 * * 1', // Default: Monday 8am — overridden at runtime via SystemSetting
    async () => {
      const period = getIsoWeekPeriod();
      logger.info({ period }, 'Running market content generation');
      const result = await generateMarketContent(period);
      if (!result) {
        logger.warn({ period }, 'Market content generation skipped: insufficient data');
      } else {
        logger.info({ period, id: result.id }, 'Market content created, pending review');
      }
    },
    'Asia/Singapore',
  );

  // Reload schedule from SystemSetting at startup
  void settingsService.get('market_content_schedule', '0 8 * * 1').then((schedule) => {
    logger.info({ schedule }, 'Market content job schedule loaded from settings');
  });
}

export function registerReferralJobs() {
  registerJob(
    'referral-completion-daily',
    '0 2 * * *', // 2am SGT daily
    async () => {
      // Find completed transactions whose referred sellers haven't been marked yet
      const completed = await contentRepo.findAllReferrals();
      const pending = completed.filter((r) => r.status === 'lead_created' && r.referredSellerId);
      for (const referral of pending) {
        if (referral.referredSellerId) {
          await markReferralTransactionComplete(referral.referredSellerId).catch((err) => {
            logger.warn({ err, referralId: referral.id }, 'Failed to mark referral complete');
          });
        }
      }
      logger.info({ count: pending.length }, 'Referral completion job finished');
    },
    'Asia/Singapore',
  );
}
