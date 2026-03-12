// src/domains/content/content.jobs.ts
import { registerJob } from '@/infra/jobs/runner';

export function registerContentJobs() {
  // Jobs registered per section:
  // Section 3: market content weekly cron
  // Section 4: testimonial post-completion cron
  // Section 5: referral post-completion cron
  void registerJob; // referenced to avoid unused import warning until sections are implemented
}
