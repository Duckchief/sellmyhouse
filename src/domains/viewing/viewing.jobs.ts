import { registerJob } from '@/infra/jobs/runner';
import * as viewingService from './viewing.service';

export function registerViewingJobs() {
  registerJob(
    'viewing:morning-reminders',
    '0 9 * * *',
    () => viewingService.sendMorningReminders(),
    'Asia/Singapore',
  );

  registerJob(
    'viewing:one-hour-reminders',
    '*/15 * * * *',
    () => viewingService.sendOneHourReminders(),
    'Asia/Singapore',
  );

  registerJob(
    'viewing:feedback-prompts',
    '*/15 * * * *',
    () => viewingService.sendFeedbackPrompts(),
    'Asia/Singapore',
  );

  registerJob(
    'viewing:followup',
    '0 */2 * * *', // Every 2 hours
    async () => { await viewingService.sendViewerFollowups(); },
    'Asia/Singapore',
  );
}
