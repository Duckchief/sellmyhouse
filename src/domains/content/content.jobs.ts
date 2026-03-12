// src/domains/content/content.jobs.ts
import { registerJob } from '@/infra/jobs/runner';
import { logger } from '@/infra/logger';
import * as settingsService from '@/domains/shared/settings.service';
import { generateMarketContent, getIsoWeekPeriod } from './content.service';

export function registerContentJobs() {
  registerMarketContentJobs();
  // Section 4: testimonial post-completion cron
  // Section 5: referral post-completion cron
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
