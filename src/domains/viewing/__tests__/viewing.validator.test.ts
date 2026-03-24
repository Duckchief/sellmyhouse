import {
  validateCreateSlot,
  validateCreateBulkSlots,
  validateCreateRecurringSlots,
  validateScheduleDays,
  validateBookingForm,
  validateOtp,
  validateFeedback,
} from '../viewing.validator';
import { ValidationError } from '@/domains/shared/errors';

describe('viewing.validator', () => {
  describe('validateCreateSlot', () => {
    const validInput = {
      propertyId: 'prop-1',
      date: '2026-04-15',
      startTime: '10:00',
      endTime: '10:15',
    };

    it('accepts valid input with defaults', () => {
      const result = validateCreateSlot(validInput);
      expect(result.propertyId).toBe('prop-1');
      expect(result.slotType).toBe('single');
      expect(result.maxViewers).toBe(1);
    });

    it('computes maxViewers from window for group slots', () => {
      // validInput: startTime '10:00', endTime '10:15' → 15 min → rounds to 30 min → 10 viewers
      const result = validateCreateSlot({
        ...validInput,
        slotType: 'group',
      });
      expect(result.slotType).toBe('group');
      expect(result.maxViewers).toBe(10); // ceil(15/30)*30/60*20 = 30/60*20 = 10
    });

    it('rejects past date', () => {
      expect(() => validateCreateSlot({ ...validInput, date: '2020-01-01' })).toThrow(
        ValidationError,
      );
    });

    it('rejects invalid time format', () => {
      expect(() => validateCreateSlot({ ...validInput, startTime: '25:00' })).toThrow(
        ValidationError,
      );
    });

    it('rejects end time before start time', () => {
      expect(() =>
        validateCreateSlot({ ...validInput, startTime: '10:00', endTime: '09:00' }),
      ).toThrow(ValidationError);
    });

    it('accepts group slot without explicit maxViewers (computed from window)', () => {
      const result = validateCreateSlot({ ...validInput, slotType: 'group' });
      expect(result.maxViewers).toBeGreaterThanOrEqual(2);
    });
  });

  describe('validateCreateBulkSlots', () => {
    const validInput = {
      propertyId: 'prop-1',
      startDate: '2026-04-01',
      endDate: '2026-04-28',
      dayOfWeek: '6',
      startTime: '10:00',
      endTime: '12:00',
      slotDurationMinutes: '15',
    };

    it('accepts valid bulk input', () => {
      const result = validateCreateBulkSlots(validInput);
      expect(result.dayOfWeek).toBe(6);
      expect(result.slotDurationMinutes).toBe(15);
    });

    it('rejects endDate before startDate', () => {
      expect(() => validateCreateBulkSlots({ ...validInput, endDate: '2026-03-01' })).toThrow(
        ValidationError,
      );
    });

    it('rejects range exceeding 8 weeks', () => {
      expect(() => validateCreateBulkSlots({ ...validInput, endDate: '2026-07-01' })).toThrow(
        ValidationError,
      );
    });

    it('rejects invalid dayOfWeek', () => {
      expect(() => validateCreateBulkSlots({ ...validInput, dayOfWeek: '7' })).toThrow(
        ValidationError,
      );
    });
  });

  describe('validateBookingForm', () => {
    const validInput = {
      name: 'John Doe',
      phone: '91234567',
      viewerType: 'buyer',
      consentService: 'true',
      slotId: 'slot-1',
      formLoadedAt: String(Date.now() - 10000),
    };

    it('accepts valid buyer input', () => {
      const result = validateBookingForm(validInput);
      expect(result.name).toBe('John Doe');
      expect(result.viewerType).toBe('buyer');
    });

    it('accepts valid agent input', () => {
      const result = validateBookingForm({
        ...validInput,
        viewerType: 'agent',
        agentName: 'Jane Agent',
        agentCeaReg: 'R123456A',
        agentAgencyName: 'PropCo',
      });
      expect(result.viewerType).toBe('agent');
      expect(result.agentName).toBe('Jane Agent');
    });

    it('rejects invalid SG phone', () => {
      expect(() => validateBookingForm({ ...validInput, phone: '12345678' })).toThrow(
        ValidationError,
      );
    });

    it('rejects phone not starting with 8 or 9', () => {
      expect(() => validateBookingForm({ ...validInput, phone: '71234567' })).toThrow(
        ValidationError,
      );
    });

    it('requires agent fields when viewerType is agent', () => {
      expect(() => validateBookingForm({ ...validInput, viewerType: 'agent' })).toThrow(
        ValidationError,
      );
    });

    it('requires consent', () => {
      expect(() => validateBookingForm({ ...validInput, consentService: 'false' })).toThrow(
        ValidationError,
      );
    });

    it('rejects missing name', () => {
      expect(() => validateBookingForm({ ...validInput, name: '' })).toThrow(ValidationError);
    });
  });

  describe('validateOtp', () => {
    it('accepts valid OTP', () => {
      const result = validateOtp({ phone: '91234567', otp: '123456', bookingId: 'v-1' });
      expect(result.otp).toBe('123456');
    });

    it('rejects non-6-digit OTP', () => {
      expect(() => validateOtp({ phone: '91234567', otp: '12345', bookingId: 'v-1' })).toThrow(
        ValidationError,
      );
    });

    it('rejects missing bookingId', () => {
      expect(() => validateOtp({ phone: '91234567', otp: '123456' })).toThrow(ValidationError);
    });
  });

  describe('validateCreateRecurringSlots', () => {
    const validDay = {
      dayOfWeek: 1,
      timeslots: [{ startTime: '18:00', endTime: '20:00', slotType: 'single' }],
    };

    it('accepts valid input', () => {
      const result = validateCreateRecurringSlots({
        propertyId: 'prop-1',
        days: [validDay],
      });
      expect(result.propertyId).toBe('prop-1');
      expect(result.days).toHaveLength(1);
      expect(result.days[0].dayOfWeek).toBe(1);
      expect(result.days[0].timeslots[0].slotType).toBe('single');
    });

    it('rejects missing propertyId', () => {
      expect(() => validateCreateRecurringSlots({ days: [validDay] })).toThrow(ValidationError);
    });

    it('rejects empty days array', () => {
      expect(() => validateCreateRecurringSlots({ propertyId: 'p', days: [] })).toThrow(
        ValidationError,
      );
    });

    it('rejects more than 7 days', () => {
      const days = Array.from({ length: 8 }, (_, i) => ({
        dayOfWeek: i % 7,
        timeslots: [{ startTime: '10:00', endTime: '11:00', slotType: 'single' }],
      }));
      expect(() => validateCreateRecurringSlots({ propertyId: 'p', days })).toThrow(
        ValidationError,
      );
    });

    it('rejects duplicate dayOfWeek', () => {
      expect(() =>
        validateCreateRecurringSlots({
          propertyId: 'p',
          days: [validDay, { ...validDay }],
        }),
      ).toThrow(ValidationError);
    });

    it('rejects more than 3 timeslots per day', () => {
      expect(() =>
        validateCreateRecurringSlots({
          propertyId: 'p',
          days: [
            {
              dayOfWeek: 1,
              timeslots: [
                { startTime: '10:00', endTime: '11:00', slotType: 'single' },
                { startTime: '11:00', endTime: '12:00', slotType: 'single' },
                { startTime: '12:00', endTime: '13:00', slotType: 'single' },
                { startTime: '13:00', endTime: '14:00', slotType: 'single' },
              ],
            },
          ],
        }),
      ).toThrow(ValidationError);
    });

    it('rejects overlapping timeslots within a day', () => {
      expect(() =>
        validateCreateRecurringSlots({
          propertyId: 'p',
          days: [
            {
              dayOfWeek: 1,
              timeslots: [
                { startTime: '10:00', endTime: '12:00', slotType: 'single' },
                { startTime: '11:00', endTime: '13:00', slotType: 'single' },
              ],
            },
          ],
        }),
      ).toThrow(ValidationError);
    });

    it('rejects times outside 10:00–20:00', () => {
      expect(() =>
        validateCreateRecurringSlots({
          propertyId: 'p',
          days: [
            {
              dayOfWeek: 1,
              timeslots: [{ startTime: '09:00', endTime: '11:00', slotType: 'single' }],
            },
          ],
        }),
      ).toThrow(ValidationError);
    });

    it('rejects invalid slotType', () => {
      expect(() =>
        validateCreateRecurringSlots({
          propertyId: 'p',
          days: [
            {
              dayOfWeek: 1,
              timeslots: [{ startTime: '10:00', endTime: '11:00', slotType: 'invalid' }],
            },
          ],
        }),
      ).toThrow(ValidationError);
    });

    it('accepts group slotType', () => {
      const result = validateCreateRecurringSlots({
        propertyId: 'p',
        days: [
          {
            dayOfWeek: 6,
            timeslots: [{ startTime: '13:00', endTime: '17:00', slotType: 'group' }],
          },
        ],
      });
      expect(result.days[0].timeslots[0].slotType).toBe('group');
    });
  });

  describe('validateScheduleDays', () => {
    it('validates days array without requiring propertyId from client', () => {
      const days = [
        { dayOfWeek: 1, timeslots: [{ startTime: '18:00', endTime: '20:00', slotType: 'single' }] },
      ];
      expect(() => validateScheduleDays(days)).not.toThrow();
      const result = validateScheduleDays(days);
      expect(result).toHaveLength(1);
      expect(result[0].dayOfWeek).toBe(1);
    });

    it('throws ValidationError for empty days array', () => {
      expect(() => validateScheduleDays([])).toThrow(ValidationError);
    });

    it('throws ValidationError for invalid timeslot', () => {
      const days = [
        { dayOfWeek: 1, timeslots: [{ startTime: '09:00', endTime: '10:00', slotType: 'single' }] },
      ];
      expect(() => validateScheduleDays(days)).toThrow(ValidationError); // before 10:00 start bound
    });
  });

  describe('validateFeedback', () => {
    it('accepts valid feedback with rating', () => {
      const result = validateFeedback({ feedback: 'Good viewing', interestRating: '4' });
      expect(result.feedback).toBe('Good viewing');
      expect(result.interestRating).toBe(4);
    });

    it('rejects rating outside 1-5', () => {
      expect(() => validateFeedback({ feedback: 'Ok', interestRating: '6' })).toThrow(
        ValidationError,
      );
    });

    it('rejects rating of 0', () => {
      expect(() => validateFeedback({ feedback: 'Ok', interestRating: '0' })).toThrow(
        ValidationError,
      );
    });

    it('rejects feedback over 1000 chars', () => {
      expect(() => validateFeedback({ feedback: 'a'.repeat(1001), interestRating: '3' })).toThrow(
        ValidationError,
      );
    });
  });
});
