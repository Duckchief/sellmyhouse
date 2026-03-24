import { calcOpenHouseMaxViewers } from './viewing.validator';
import type { RecurringScheduleRow, VirtualSlot, RecurringDayConfig } from './viewing.types';

/**
 * Pure function. No DB access.
 * Given a RecurringSchedule and a date range (inclusive), returns all virtual slot windows.
 *
 * - single slots: generate 15-minute sub-windows
 * - group slots: one window spanning the full startTime–endTime
 *
 * Dates are handled in UTC to avoid timezone drift.
 */
export function generateRecurringWindowsForRange(
  schedule: RecurringScheduleRow,
  startDate: Date,
  endDate: Date,
): VirtualSlot[] {
  const results: VirtualSlot[] = [];
  const days = schedule.days as unknown as RecurringDayConfig[];

  const cur = new Date(
    Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()),
  );
  const end = new Date(
    Date.UTC(
      endDate.getUTCFullYear(),
      endDate.getUTCMonth(),
      endDate.getUTCDate(),
      23,
      59,
      59,
      999,
    ),
  );

  while (cur <= end) {
    const dow = cur.getUTCDay();
    const dateStr = cur.toISOString().split('T')[0]; // YYYY-MM-DD

    const dayConfig = days.find((d) => d.dayOfWeek === dow);
    if (dayConfig) {
      for (const ts of dayConfig.timeslots) {
        const slotDate = new Date(cur);

        if (ts.slotType === 'group') {
          results.push({
            id: `rec:${dateStr}:${ts.startTime}:${ts.endTime}`,
            date: slotDate,
            startTime: ts.startTime,
            endTime: ts.endTime,
            slotType: 'group',
            maxViewers: calcOpenHouseMaxViewers(ts.startTime, ts.endTime),
          });
        } else {
          const [sh, sm] = ts.startTime.split(':').map(Number);
          const [eh, em] = ts.endTime.split(':').map(Number);
          const startMinutes = sh * 60 + sm;
          const endMinutes = eh * 60 + em;

          const clampedEnd = Math.min(endMinutes, 24 * 60 - 15); // Never generate past 23:45
          for (let t = startMinutes; t + 15 <= clampedEnd; t += 15) {
            const subStart = toHHMM(t);
            const subEnd = toHHMM(t + 15);
            results.push({
              id: `rec:${dateStr}:${subStart}:${subEnd}`,
              date: new Date(slotDate),
              startTime: subStart,
              endTime: subEnd,
              slotType: 'single',
              maxViewers: 1,
            });
          }
        }
      }
    }

    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  return results;
}

function toHHMM(minutes: number): string {
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${h}:${m}`;
}
