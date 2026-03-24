import { generateRecurringWindowsForRange } from '../recurring.utils';
import type { RecurringScheduleRow } from '../viewing.types';

function makeSchedule(days: RecurringScheduleRow['days']): RecurringScheduleRow {
  return {
    id: 'sched-1',
    propertyId: 'prop-1',
    days,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('generateRecurringWindowsForRange', () => {
  // 2026-03-23 is a Monday (UTC)
  const monday = new Date('2026-03-23T00:00:00.000Z');
  const tuesday = new Date('2026-03-24T00:00:00.000Z');

  it('returns empty array for empty schedule', () => {
    const schedule = makeSchedule([]);
    const result = generateRecurringWindowsForRange(schedule, monday, monday);
    expect(result).toEqual([]);
  });

  it('returns empty array when no day matches', () => {
    const schedule = makeSchedule([
      { dayOfWeek: 0, timeslots: [{ startTime: '10:00', endTime: '12:00', slotType: 'single' }] },
    ]);
    const result = generateRecurringWindowsForRange(schedule, monday, monday);
    expect(result).toEqual([]);
  });

  it('generates 15-min sub-windows for single slot type', () => {
    const schedule = makeSchedule([
      { dayOfWeek: 1, timeslots: [{ startTime: '18:00', endTime: '19:00', slotType: 'single' }] },
    ]);
    const result = generateRecurringWindowsForRange(schedule, monday, monday);
    expect(result).toHaveLength(4);
    expect(result[0]).toMatchObject({
      id: 'rec:2026-03-23:18:00:18:15',
      startTime: '18:00',
      endTime: '18:15',
      slotType: 'single',
      maxViewers: 1,
    });
    expect(result[3]).toMatchObject({
      id: 'rec:2026-03-23:18:45:19:00',
      startTime: '18:45',
      endTime: '19:00',
    });
  });

  it('generates one window spanning full range for group slot type', () => {
    const schedule = makeSchedule([
      { dayOfWeek: 1, timeslots: [{ startTime: '14:00', endTime: '17:00', slotType: 'group' }] },
    ]);
    const result = generateRecurringWindowsForRange(schedule, monday, monday);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'rec:2026-03-23:14:00:17:00',
      startTime: '14:00',
      endTime: '17:00',
      slotType: 'group',
    });
    expect(result[0].maxViewers).toBe(60);
  });

  it('generates windows across multiple days in range', () => {
    const schedule = makeSchedule([
      { dayOfWeek: 1, timeslots: [{ startTime: '18:00', endTime: '18:30', slotType: 'single' }] },
      { dayOfWeek: 2, timeslots: [{ startTime: '18:00', endTime: '18:30', slotType: 'single' }] },
    ]);
    const result = generateRecurringWindowsForRange(schedule, monday, tuesday);
    expect(result).toHaveLength(4); // 2 sub-windows per day × 2 days
    expect(result[0].id).toMatch(/^rec:2026-03-23:/);
    expect(result[2].id).toMatch(/^rec:2026-03-24:/);
  });

  it('handles multiple timeslots per day', () => {
    const schedule = makeSchedule([
      {
        dayOfWeek: 1,
        timeslots: [
          { startTime: '10:00', endTime: '10:30', slotType: 'single' },
          { startTime: '18:00', endTime: '18:30', slotType: 'single' },
        ],
      },
    ]);
    const result = generateRecurringWindowsForRange(schedule, monday, monday);
    expect(result).toHaveLength(4); // 2 per timeslot × 2 timeslots
  });

  it('date field on each virtual slot is midnight UTC', () => {
    const schedule = makeSchedule([
      { dayOfWeek: 1, timeslots: [{ startTime: '18:00', endTime: '18:15', slotType: 'single' }] },
    ]);
    const result = generateRecurringWindowsForRange(schedule, monday, monday);
    expect(result[0].date.getUTCHours()).toBe(0);
    expect(result[0].date.getUTCMinutes()).toBe(0);
  });

  it('respects exact range boundaries (inclusive)', () => {
    const endOfMonday = new Date('2026-03-23T23:59:59.000Z');
    const schedule = makeSchedule([
      { dayOfWeek: 1, timeslots: [{ startTime: '23:00', endTime: '23:15', slotType: 'single' }] },
    ]);
    const result = generateRecurringWindowsForRange(schedule, monday, endOfMonday);
    expect(result).toHaveLength(1);
  });
});
