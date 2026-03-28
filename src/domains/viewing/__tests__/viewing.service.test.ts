import * as viewingService from '../viewing.service';
import * as viewingRepo from '../viewing.repository';
import * as auditService from '@/domains/shared/audit.service';
import * as notificationService from '@/domains/notification/notification.service';
import * as settingsService from '@/domains/shared/settings.service';
import * as complianceService from '@/domains/compliance/compliance.service';
import * as propertyService from '@/domains/property/property.service';
import {
  NotFoundError,
  ValidationError,
  ConflictError,
  RateLimitError,
} from '@/domains/shared/errors';
import {
  OTP_MAX_ATTEMPTS,
  OTP_MAX_REQUESTS_PER_HOUR,
  BOOKINGS_PER_PHONE_PER_DAY,
} from '../viewing.types';

jest.mock('../viewing.repository');
jest.mock('@/domains/shared/audit.service');
jest.mock('@/domains/notification/notification.service');
jest.mock('@/domains/shared/settings.service');
jest.mock('@/domains/compliance/compliance.service');
jest.mock('@/domains/property/property.service');
jest.mock('@paralleldrive/cuid2', () => ({ createId: () => 'test-id-123' }));
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-otp'),
  compare: jest.fn().mockResolvedValue(true),
}));

const mockedRepo = jest.mocked(viewingRepo);
const mockedAudit = jest.mocked(auditService);
const mockedNotification = jest.mocked(notificationService);
const mockedSettings = jest.mocked(settingsService);
const mockedComplianceService = jest.mocked(complianceService);
const mockedPropertyService = jest.mocked(propertyService);

describe('viewing.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSettings.getNumber.mockResolvedValue(15);
    mockedComplianceService.createViewerConsentRecord.mockResolvedValue(undefined as never);
  });

  // ─── Slot Management ───────────────────────────────────

  describe('createSlot', () => {
    it('creates a single slot with defaults', async () => {
      mockedRepo.findPropertyById.mockResolvedValue({
        id: 'prop-1',
        sellerId: 'seller-1',
      } as never);
      mockedRepo.findSlotsByPropertyAndDateRange.mockResolvedValue([] as never);
      mockedRepo.findActiveSlotsByPropertyId.mockResolvedValue([] as never);
      mockedRepo.createSlot.mockResolvedValue({
        id: 'test-id-123',
        propertyId: 'prop-1',
        status: 'available',
      } as never);

      await viewingService.createSlot(
        {
          propertyId: 'prop-1',
          date: new Date('2026-04-15'),
          startTime: '10:00',
          endTime: '10:15',
        },
        'seller-1',
      );

      expect(mockedRepo.createSlot).toHaveBeenCalledWith(
        expect.objectContaining({
          propertyId: 'prop-1',
          slotType: 'single',
          maxViewers: 1,
          durationMinutes: 15,
        }),
      );
      expect(mockedAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'viewing.slot_created' }),
      );
    });
  });

  describe('createBulkSlots', () => {
    it('generates correct number of slots for weekly recurring', async () => {
      mockedRepo.findPropertyById.mockResolvedValue({
        id: 'prop-1',
        sellerId: 'seller-1',
      } as never);
      mockedRepo.findActiveSlotsByPropertyId.mockResolvedValue([] as never);
      mockedRepo.createManySlots.mockResolvedValue({ count: 32 });

      // 4 Saturdays, 2-hour window with 15-min slots = 4 * 8 = 32 slots
      await viewingService.createBulkSlots(
        {
          propertyId: 'prop-1',
          startDate: new Date('2026-04-04'), // Saturday
          endDate: new Date('2026-04-25'), // 4th Saturday
          dayOfWeek: 6,
          startTime: '10:00',
          endTime: '12:00',
          slotDurationMinutes: 15,
        },
        'seller-1',
      );

      const callArg = mockedRepo.createManySlots.mock.calls[0][0];
      expect(callArg.length).toBe(32); // 4 Saturdays * 8 slots each
      expect(mockedAudit.log).toHaveBeenCalled();
    });
  });

  describe('cancelSlot', () => {
    it('cancels slot and notifies all viewers', async () => {
      mockedRepo.findSlotById.mockResolvedValue({
        id: 'slot-1',
        propertyId: 'prop-1',
        property: { sellerId: 'seller-1', town: 'Bishan', street: 'Bishan St 23' },
        status: 'booked',
        date: new Date('2026-04-15'),
        startTime: '10:00',
      } as never);

      mockedRepo.findViewingsBySlot.mockResolvedValue([
        { id: 'v-1', verifiedViewer: { id: 'viewer-1', phone: '91234567' } },
        { id: 'v-2', verifiedViewer: { id: 'viewer-2', phone: '81234567' } },
      ] as never);

      mockedRepo.cancelSlotAndViewings.mockResolvedValue({ id: 'slot-1' } as never);

      await viewingService.cancelSlot('slot-1', 'seller-1');

      expect(mockedRepo.cancelSlotAndViewings).toHaveBeenCalledWith('slot-1');
      expect(mockedNotification.send).toHaveBeenCalledTimes(2);
      expect(mockedAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'viewing.slot_cancelled' }),
      );
    });

    it('throws NotFoundError for nonexistent slot', async () => {
      mockedRepo.findSlotById.mockResolvedValue(null);

      await expect(viewingService.cancelSlot('bad-id', 'seller-1')).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError if seller does not own property', async () => {
      mockedRepo.findSlotById.mockResolvedValue({
        id: 'slot-1',
        property: { sellerId: 'other-seller' },
      } as never);

      await expect(viewingService.cancelSlot('slot-1', 'seller-1')).rejects.toThrow();
    });
  });

  // ─── cancelSlotsForPropertyCascade ─────────────────────

  describe('cancelSlotsForPropertyCascade', () => {
    it('cancels all active slots for the property', async () => {
      mockedRepo.findActiveSlotsByPropertyId.mockResolvedValue([
        {
          id: 'slot-1',
          propertyId: 'prop-1',
          date: new Date('2026-04-15'),
          startTime: '10:00',
          property: { block: '123', street: 'Ang Mo Kio Ave 3', town: 'ANG MO KIO' },
          viewings: [],
        },
        {
          id: 'slot-2',
          propertyId: 'prop-1',
          date: new Date('2026-04-16'),
          startTime: '11:00',
          property: { block: '123', street: 'Ang Mo Kio Ave 3', town: 'ANG MO KIO' },
          viewings: [],
        },
      ] as never);
      mockedRepo.cancelSlotAndViewings.mockResolvedValue({ id: 'slot-1' } as never);
      mockedRepo.deleteRecurringSchedule.mockResolvedValue(undefined as never);

      await viewingService.cancelSlotsForPropertyCascade('prop-1', 'agent-1');

      expect(mockedRepo.cancelSlotAndViewings).toHaveBeenCalledTimes(2);
      expect(mockedRepo.cancelSlotAndViewings).toHaveBeenCalledWith('slot-1');
      expect(mockedRepo.cancelSlotAndViewings).toHaveBeenCalledWith('slot-2');
    });

    it('notifies each booked viewer before cancelling', async () => {
      mockedRepo.findActiveSlotsByPropertyId.mockResolvedValue([
        {
          id: 'slot-1',
          propertyId: 'prop-1',
          date: new Date('2026-04-15'),
          startTime: '10:00',
          property: { block: '123', street: 'Ang Mo Kio Ave 3', town: 'ANG MO KIO' },
          viewings: [
            { verifiedViewer: { id: 'viewer-1' } },
            { verifiedViewer: { id: 'viewer-2' } },
          ],
        },
      ] as never);
      mockedRepo.cancelSlotAndViewings.mockResolvedValue({ id: 'slot-1' } as never);
      mockedRepo.deleteRecurringSchedule.mockResolvedValue(undefined as never);

      await viewingService.cancelSlotsForPropertyCascade('prop-1', 'agent-1');

      expect(mockedNotification.send).toHaveBeenCalledTimes(2);
      expect(mockedNotification.send).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientType: 'viewer',
          recipientId: 'viewer-1',
          templateName: 'viewing_cancelled',
        }),
        'agent-1',
      );
    });

    it('does nothing when there are no active slots', async () => {
      mockedRepo.findActiveSlotsByPropertyId.mockResolvedValue([] as never);
      mockedRepo.deleteRecurringSchedule.mockResolvedValue(undefined as never);

      await viewingService.cancelSlotsForPropertyCascade('prop-1', 'agent-1');

      expect(mockedRepo.cancelSlotAndViewings).not.toHaveBeenCalled();
      expect(mockedNotification.send).not.toHaveBeenCalled();
      expect(mockedAudit.log).not.toHaveBeenCalled();
    });

    it('writes an audit log entry when slots are cancelled', async () => {
      mockedRepo.findActiveSlotsByPropertyId.mockResolvedValue([
        {
          id: 'slot-1',
          propertyId: 'prop-1',
          date: new Date('2026-04-15'),
          startTime: '10:00',
          property: { block: '123', street: 'Ang Mo Kio Ave 3', town: 'ANG MO KIO' },
          viewings: [],
        },
      ] as never);
      mockedRepo.cancelSlotAndViewings.mockResolvedValue({ id: 'slot-1' } as never);
      mockedRepo.deleteRecurringSchedule.mockResolvedValue(undefined as never);

      await viewingService.cancelSlotsForPropertyCascade('prop-1', 'agent-1');

      expect(mockedAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'viewing.cascade_cancelled',
          entityType: 'property',
          entityId: 'prop-1',
        }),
      );
    });

    it('deletes recurring schedule for property on cascade cancel', async () => {
      mockedRepo.findActiveSlotsByPropertyId.mockResolvedValue([] as never);
      mockedRepo.deleteRecurringSchedule.mockResolvedValue(undefined as never);

      await viewingService.cancelSlotsForPropertyCascade('prop-1', 'agent-1');

      expect(mockedRepo.deleteRecurringSchedule).toHaveBeenCalledWith('prop-1');
    });
  });

  // ─── Bulk Cancel Slots ─────────────────────────────────

  describe('bulkCancelSlots', () => {
    it('returns { cancelled: 0 } for empty array', async () => {
      const result = await viewingService.bulkCancelSlots([], 'seller-1');
      expect(result).toEqual({ cancelled: 0 });
      expect(mockedRepo.bulkCancelSlotsAndViewings).not.toHaveBeenCalled();
    });

    it('cancels slots owned by the seller', async () => {
      mockedRepo.findSlotsByIds.mockResolvedValue([
        { id: 'slot-1', property: { sellerId: 'seller-1' } },
        { id: 'slot-2', property: { sellerId: 'seller-1' } },
      ] as never);
      mockedRepo.findSlotsWithBookedViewers.mockResolvedValue([] as never);
      mockedRepo.bulkCancelSlotsAndViewings.mockResolvedValue({ cancelled: 2 } as never);

      const result = await viewingService.bulkCancelSlots(['slot-1', 'slot-2'], 'seller-1');

      expect(result).toEqual({ cancelled: 2 });
      expect(mockedRepo.bulkCancelSlotsAndViewings).toHaveBeenCalledWith(['slot-1', 'slot-2']);
    });

    it('throws ForbiddenError when a slot belongs to another seller', async () => {
      mockedRepo.findSlotsByIds.mockResolvedValue([
        { id: 'slot-1', property: { sellerId: 'seller-1' } },
        { id: 'slot-2', property: { sellerId: 'seller-OTHER' } },
      ] as never);

      await expect(
        viewingService.bulkCancelSlots(['slot-1', 'slot-2'], 'seller-1'),
      ).rejects.toThrow('You do not own one or more of these slots');

      expect(mockedRepo.bulkCancelSlotsAndViewings).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when a slot ID does not exist', async () => {
      mockedRepo.findSlotsByIds.mockResolvedValue([
        { id: 'slot-1', property: { sellerId: 'seller-1' } },
      ] as never);

      await expect(
        viewingService.bulkCancelSlots(['slot-1', 'slot-missing'], 'seller-1'),
      ).rejects.toThrow();

      expect(mockedRepo.bulkCancelSlotsAndViewings).not.toHaveBeenCalled();
    });

    it('sends notifications for slots with booked viewers', async () => {
      mockedRepo.findSlotsByIds.mockResolvedValue([
        { id: 'slot-1', property: { sellerId: 'seller-1' } },
      ] as never);
      mockedRepo.findSlotsWithBookedViewers.mockResolvedValue([
        {
          id: 'slot-1',
          property: { town: 'BISHAN', street: 'Bishan St 23', sellerId: 'seller-1' },
          viewings: [{ verifiedViewer: { id: 'viewer-1' } }],
        },
      ] as never);
      mockedRepo.bulkCancelSlotsAndViewings.mockResolvedValue({ cancelled: 1 } as never);

      await viewingService.bulkCancelSlots(['slot-1'], 'seller-1');

      expect(mockedNotification.send).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientType: 'viewer',
          recipientId: 'viewer-1',
          templateName: 'viewing_cancelled',
        }),
        'system',
      );
    });

    it('logs an audit entry', async () => {
      mockedRepo.findSlotsByIds.mockResolvedValue([
        { id: 'slot-1', property: { sellerId: 'seller-1' } },
      ] as never);
      mockedRepo.findSlotsWithBookedViewers.mockResolvedValue([] as never);
      mockedRepo.bulkCancelSlotsAndViewings.mockResolvedValue({ cancelled: 1 } as never);

      await viewingService.bulkCancelSlots(['slot-1'], 'seller-1');

      expect(mockedAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'viewing.bulk_slots_cancelled',
          entityType: 'viewing_slot',
          details: expect.objectContaining({ slotCount: 1, sellerId: 'seller-1' }),
        }),
      );
    });
  });

  // ─── Booking Flow ──────────────────────────────────────

  describe('initiateBooking', () => {
    const validInput = {
      name: 'John Doe',
      phone: '91234567',
      viewerType: 'buyer' as const,
      consentService: true,
      slotId: 'slot-1',
      formLoadedAt: Date.now() - 10000,
    };

    it('rejects honeypot-filled form silently', async () => {
      const result = await viewingService.initiateBooking(
        { ...validInput, website: 'spam.com' },
        { ipAddress: '127.0.0.1' },
      );

      expect(result).toEqual({ spam: true });
      expect(mockedRepo.createViewingWithLock).not.toHaveBeenCalled();
    });

    it('rejects too-fast submission silently', async () => {
      const result = await viewingService.initiateBooking(
        { ...validInput, formLoadedAt: Date.now() - 1000 },
        { ipAddress: '127.0.0.1' },
      );

      expect(result).toEqual({ spam: true });
    });

    it('rejects duplicate booking', async () => {
      mockedRepo.findDuplicateBooking.mockResolvedValue({ id: 'existing' } as never);

      await expect(
        viewingService.initiateBooking(validInput, { ipAddress: '127.0.0.1' }),
      ).rejects.toThrow(ConflictError);
    });

    it('rejects when daily booking limit exceeded', async () => {
      mockedRepo.findDuplicateBooking.mockResolvedValue(null);
      mockedRepo.countBookingsToday.mockResolvedValue(BOOKINGS_PER_PHONE_PER_DAY);

      await expect(
        viewingService.initiateBooking(validInput, { ipAddress: '127.0.0.1' }),
      ).rejects.toThrow(ValidationError);
    });

    // S3e: OTP_MAX_REQUESTS_PER_HOUR must be enforced
    it('throws RateLimitError when OTP request limit per hour is exceeded for new viewer', async () => {
      mockedRepo.findDuplicateBooking.mockResolvedValue(null);
      mockedRepo.countBookingsToday.mockResolvedValue(0);
      mockedRepo.findVerifiedViewerByPhone.mockResolvedValue(null); // new viewer
      mockedRepo.createVerifiedViewer.mockResolvedValue({
        id: 'viewer-new',
        phone: '91234567',
        noShowCount: 0,
      } as never);
      mockedRepo.countOtpRequestsThisHour.mockResolvedValue(OTP_MAX_REQUESTS_PER_HOUR);

      await expect(
        viewingService.initiateBooking(validInput, { ipAddress: '127.0.0.1' }),
      ).rejects.toThrow(RateLimitError);
    });

    // C2a: slot full path in createViewingWithLock (tested via repo mock)
    it('throws ConflictError when slot is full', async () => {
      mockedRepo.findDuplicateBooking.mockResolvedValue(null);
      mockedRepo.countBookingsToday.mockResolvedValue(0);
      mockedRepo.findVerifiedViewerByPhone.mockResolvedValue(null);
      mockedRepo.createVerifiedViewer.mockResolvedValue({
        id: 'viewer-new',
        phone: '91234567',
        noShowCount: 0,
      } as never);
      mockedRepo.countOtpRequestsThisHour.mockResolvedValue(0);
      mockedRepo.findSlotById.mockResolvedValue({
        id: 'slot-1',
        propertyId: 'prop-1',
        date: new Date('2026-04-15'),
        startTime: '10:00',
      } as never);
      mockedRepo.createViewingWithLock.mockRejectedValue(new ConflictError('Viewing slot is full'));

      await expect(
        viewingService.initiateBooking(validInput, { ipAddress: '127.0.0.1' }),
      ).rejects.toThrow(ConflictError);
    });

    it('creates booking with OTP for new viewer', async () => {
      mockedRepo.findDuplicateBooking.mockResolvedValue(null);
      mockedRepo.countBookingsToday.mockResolvedValue(0);
      mockedRepo.findVerifiedViewerByPhone.mockResolvedValue(null);
      mockedRepo.createVerifiedViewer.mockResolvedValue({
        id: 'test-id-123',
        phone: '91234567',
        noShowCount: 0,
      } as never);
      mockedRepo.findSlotById.mockResolvedValue({
        id: 'slot-1',
        propertyId: 'prop-1',
        date: new Date('2026-04-15'),
        startTime: '10:00',
      } as never);
      mockedRepo.createViewingWithLock.mockResolvedValue({
        id: 'test-id-123',
        status: 'pending_otp',
      } as never);

      const result = await viewingService.initiateBooking(validInput, { ipAddress: '127.0.0.1' });

      expect(result).toEqual(
        expect.objectContaining({
          viewingId: 'test-id-123',
          status: 'pending_otp',
          isReturningViewer: false,
        }),
      );
      expect(mockedNotification.send).toHaveBeenCalled(); // OTP sent
    });

    // FIX 1: retentionExpiresAt is set on VerifiedViewer creation
    it('sets retentionExpiresAt on new VerifiedViewer creation', async () => {
      mockedRepo.findDuplicateBooking.mockResolvedValue(null);
      mockedRepo.countBookingsToday.mockResolvedValue(0);
      mockedRepo.countOtpRequestsThisHour.mockResolvedValue(0);
      mockedRepo.findVerifiedViewerByPhone.mockResolvedValue(null);
      mockedRepo.createVerifiedViewer.mockResolvedValue({
        id: 'test-id-123',
        phone: '91234567',
        noShowCount: 0,
      } as never);
      mockedRepo.findSlotById.mockResolvedValue({
        id: 'slot-1',
        propertyId: 'prop-1',
        date: new Date('2026-04-15'),
        startTime: '10:00',
      } as never);
      mockedRepo.createViewingWithLock.mockResolvedValue({
        id: 'test-id-123',
        status: 'pending_otp',
      } as never);
      mockedSettings.getNumber.mockResolvedValue(30); // transaction_anonymisation_days

      await viewingService.initiateBooking(validInput, { ipAddress: '127.0.0.1' });

      expect(mockedRepo.createVerifiedViewer).toHaveBeenCalledWith(
        expect.objectContaining({ retentionExpiresAt: expect.any(Date) }),
      );
    });

    it('skips OTP for returning verified viewer', async () => {
      mockedRepo.findDuplicateBooking.mockResolvedValue(null);
      mockedRepo.countBookingsToday.mockResolvedValue(0);
      mockedRepo.findVerifiedViewerByPhone.mockResolvedValue({
        id: 'viewer-1',
        phone: '91234567',
        phoneVerifiedAt: new Date(),
        noShowCount: 0,
      } as never);
      mockedRepo.findSlotById.mockResolvedValue({
        id: 'slot-1',
        propertyId: 'prop-1',
        date: new Date('2026-04-15'),
        startTime: '10:00',
      } as never);
      mockedRepo.createViewingWithLock.mockResolvedValue({
        id: 'test-id-123',
        status: 'scheduled',
      } as never);
      mockedRepo.findViewingById.mockResolvedValue({
        id: 'test-id-123',
        property: { sellerId: 'seller-1', town: 'Bishan', street: 'Bishan St 23' },
        viewingSlot: { date: new Date(), startTime: '10:00' },
        verifiedViewer: { name: 'John', viewerType: 'buyer' },
      } as never);

      const result = await viewingService.initiateBooking(validInput, { ipAddress: '127.0.0.1' });

      expect(result).toEqual(
        expect.objectContaining({
          status: 'scheduled',
          isReturningViewer: true,
        }),
      );
      expect(mockedRepo.incrementBookings).toHaveBeenCalledWith('viewer-1');
    });

    it('includes no-show warning for viewer with history', async () => {
      mockedRepo.findDuplicateBooking.mockResolvedValue(null);
      mockedRepo.countBookingsToday.mockResolvedValue(0);
      mockedRepo.findVerifiedViewerByPhone.mockResolvedValue({
        id: 'viewer-1',
        phone: '91234567',
        phoneVerifiedAt: new Date(),
        noShowCount: 2,
      } as never);
      mockedRepo.findSlotById.mockResolvedValue({
        id: 'slot-1',
        propertyId: 'prop-1',
        date: new Date('2026-04-15'),
        startTime: '10:00',
      } as never);
      mockedRepo.createViewingWithLock.mockResolvedValue({
        id: 'test-id-123',
        status: 'scheduled',
      } as never);
      mockedRepo.findViewingById.mockResolvedValue({
        id: 'test-id-123',
        property: { sellerId: 'seller-1', town: 'Bishan', street: 'Bishan St 23' },
        viewingSlot: { date: new Date(), startTime: '10:00' },
        verifiedViewer: { name: 'John', viewerType: 'buyer', noShowCount: 2 },
      } as never);

      const result = await viewingService.initiateBooking(validInput, { ipAddress: '127.0.0.1' });

      expect('noShowWarning' in result && result.noShowWarning).toEqual({ count: 2 });
    });
  });

  // ─── OTP Verification ─────────────────────────────────

  describe('verifyOtp', () => {
    it('verifies valid OTP and transitions to scheduled', async () => {
      mockedRepo.findViewingById.mockResolvedValue({
        id: 'v-1',
        status: 'pending_otp',
        otpHash: 'hashed-otp',
        otpExpiresAt: new Date(Date.now() + 300000),
        otpAttempts: 0,
        verifiedViewerId: 'viewer-1',
        property: { sellerId: 'seller-1', town: 'Bishan', street: 'Bishan St 23' },
        viewingSlot: { date: new Date(), startTime: '10:00' },
        verifiedViewer: { id: 'viewer-1', name: 'John', viewerType: 'buyer' },
      } as never);

      await viewingService.verifyOtp({ phone: '91234567', otp: '123456', bookingId: 'v-1' });

      expect(mockedRepo.updateViewingStatus).toHaveBeenCalledWith('v-1', { status: 'scheduled' });
      expect(mockedRepo.incrementBookings).toHaveBeenCalledWith('viewer-1');
    });

    // FIX 2: verifyOtp success creates a ConsentRecord with viewerId set
    it('creates a viewer ConsentRecord after successful OTP verification', async () => {
      mockedRepo.findViewingById.mockResolvedValue({
        id: 'v-1',
        status: 'pending_otp',
        otpHash: 'hashed-otp',
        otpExpiresAt: new Date(Date.now() + 300000),
        otpAttempts: 0,
        verifiedViewerId: 'viewer-1',
        property: { sellerId: 'seller-1', town: 'Bishan', street: 'Bishan St 23' },
        viewingSlot: { date: new Date(), startTime: '10:00' },
        verifiedViewer: { id: 'viewer-1', name: 'John', viewerType: 'buyer' },
      } as never);

      await viewingService.verifyOtp({ phone: '91234567', otp: '123456', bookingId: 'v-1' });

      expect(mockedComplianceService.createViewerConsentRecord).toHaveBeenCalledWith(
        expect.objectContaining({ viewerId: 'viewer-1', subjectId: 'viewer-1' }),
      );
    });

    // C2e / B-CRIT: phoneVerifiedAt must be set after successful OTP verification
    it('sets phoneVerifiedAt on viewer after successful OTP verification', async () => {
      mockedRepo.findViewingById.mockResolvedValue({
        id: 'v-1',
        status: 'pending_otp',
        otpHash: 'hashed-otp',
        otpExpiresAt: new Date(Date.now() + 300000),
        otpAttempts: 0,
        verifiedViewerId: 'viewer-1',
        property: { sellerId: 'seller-1', town: 'Bishan', street: 'Bishan St 23' },
        viewingSlot: { date: new Date(), startTime: '10:00' },
        verifiedViewer: { id: 'viewer-1', name: 'John', viewerType: 'buyer' },
      } as never);

      await viewingService.verifyOtp({ phone: '91234567', otp: '123456', bookingId: 'v-1' });

      expect(mockedRepo.setPhoneVerified).toHaveBeenCalledWith('viewer-1');
    });

    // B-CRIT: returning viewer (phoneVerifiedAt set) must skip OTP on subsequent booking
    it('skips OTP and books immediately for viewer with phoneVerifiedAt set', async () => {
      mockedRepo.findDuplicateBooking.mockResolvedValue(null);
      mockedRepo.countBookingsToday.mockResolvedValue(0);
      mockedRepo.findVerifiedViewerByPhone.mockResolvedValue({
        id: 'viewer-1',
        phone: '91234567',
        phoneVerifiedAt: new Date('2026-01-01'), // previously verified
        noShowCount: 0,
      } as never);
      mockedRepo.findSlotById.mockResolvedValue({
        id: 'slot-1',
        propertyId: 'prop-1',
        date: new Date('2026-04-15'),
        startTime: '10:00',
      } as never);
      mockedRepo.createViewingWithLock.mockResolvedValue({
        id: 'booking-1',
        status: 'scheduled',
      } as never);
      mockedRepo.findViewingById.mockResolvedValue({
        id: 'booking-1',
        property: { sellerId: 'seller-1', town: 'Bishan', street: 'Bishan St 23' },
        viewingSlot: { date: new Date(), startTime: '10:00' },
        verifiedViewer: { name: 'John', viewerType: 'buyer' },
      } as never);

      const result = await viewingService.initiateBooking(
        {
          name: 'John',
          phone: '91234567',
          viewerType: 'buyer',
          consentService: true,
          slotId: 'slot-1',
          formLoadedAt: Date.now() - 10000,
        },
        { ipAddress: '127.0.0.1' },
      );

      // Must book immediately without OTP
      expect(result).toEqual(
        expect.objectContaining({ status: 'scheduled', isReturningViewer: true }),
      );
      // countOtpRequestsThisHour must NOT be called for returning viewers
      expect(mockedRepo.countOtpRequestsThisHour).not.toHaveBeenCalled();
    });

    it('rejects expired OTP', async () => {
      mockedRepo.findViewingById.mockResolvedValue({
        id: 'v-1',
        status: 'pending_otp',
        otpHash: 'hashed-otp',
        otpExpiresAt: new Date(Date.now() - 1000), // expired
        otpAttempts: 0,
      } as never);

      await expect(
        viewingService.verifyOtp({ phone: '91234567', otp: '123456', bookingId: 'v-1' }),
      ).rejects.toThrow(ValidationError);
    });

    it('rejects after max attempts', async () => {
      mockedRepo.findViewingById.mockResolvedValue({
        id: 'v-1',
        status: 'pending_otp',
        otpHash: 'hashed-otp',
        otpExpiresAt: new Date(Date.now() + 300000),
        otpAttempts: OTP_MAX_ATTEMPTS,
      } as never);

      await expect(
        viewingService.verifyOtp({ phone: '91234567', otp: '123456', bookingId: 'v-1' }),
      ).rejects.toThrow(ValidationError);
    });
  });

  // ─── Cancellation ──────────────────────────────────────

  describe('cancelViewing', () => {
    it('cancels viewing and decrements slot bookings', async () => {
      mockedRepo.findViewingByCancelToken.mockResolvedValue({
        id: 'v-1',
        viewingSlotId: 'slot-1',
        status: 'scheduled',
        viewingSlot: { id: 'slot-1', currentBookings: 1, maxViewers: 1, slotType: 'single' },
        property: { sellerId: 'seller-1', town: 'Bishan', street: 'Bishan St 23' },
        verifiedViewer: { name: 'John' },
      } as never);

      await viewingService.cancelViewing('v-1', 'cancel-token-123');

      expect(mockedRepo.cancelViewingAtomically).toHaveBeenCalledWith(
        'v-1',
        'slot-1',
        'available',
      );
      expect(mockedNotification.send).toHaveBeenCalled();
    });

    it('throws if viewing already cancelled', async () => {
      mockedRepo.findViewingByCancelToken.mockResolvedValue({
        id: 'v-1',
        status: 'cancelled',
      } as never);

      await expect(viewingService.cancelViewing('v-1', 'cancel-token')).rejects.toThrow(
        ValidationError,
      );
    });
  });

  // ─── Post-Viewing ─────────────────────────────────────

  describe('submitFeedback', () => {
    it('saves feedback and rating', async () => {
      mockedRepo.findViewingById.mockResolvedValue({
        id: 'v-1',
        status: 'completed',
        property: { sellerId: 'seller-1' },
      } as never);

      await viewingService.submitFeedback('v-1', 'seller-1', {
        feedback: 'Good viewing',
        interestRating: 4,
      });

      expect(mockedRepo.updateViewingStatus).toHaveBeenCalledWith('v-1', {
        feedback: 'Good viewing',
        interestRating: 4,
      });
    });

    it('throws if seller does not own property', async () => {
      mockedRepo.findViewingById.mockResolvedValue({
        id: 'v-1',
        status: 'completed',
        property: { sellerId: 'other-seller' },
      } as never);

      await expect(
        viewingService.submitFeedback('v-1', 'seller-1', { feedback: 'Ok', interestRating: 3 }),
      ).rejects.toThrow();
    });
  });

  describe('markNoShow', () => {
    it('transitions to no_show and increments viewer count', async () => {
      mockedRepo.findViewingById.mockResolvedValue({
        id: 'v-1',
        status: 'scheduled',
        verifiedViewerId: 'viewer-1',
        property: { sellerId: 'seller-1' },
      } as never);

      await viewingService.markNoShow('v-1', 'seller-1');

      expect(mockedRepo.updateViewingStatus).toHaveBeenCalledWith('v-1', { status: 'no_show' });
      expect(mockedRepo.incrementNoShow).toHaveBeenCalledWith('viewer-1');
    });
  });

  describe('markCompleted', () => {
    it('transitions to completed', async () => {
      mockedRepo.findViewingById.mockResolvedValue({
        id: 'v-1',
        status: 'scheduled',
        property: { sellerId: 'seller-1' },
      } as never);

      await viewingService.markCompleted('v-1', 'seller-1');

      expect(mockedRepo.updateViewingStatus).toHaveBeenCalledWith('v-1', {
        status: 'completed',
        completedAt: expect.any(Date),
      });
    });
  });

  // ─── Reminders ─────────────────────────────────────────

  describe('sendMorningReminders', () => {
    it('groups viewings by seller and sends one notification each', async () => {
      mockedRepo.findTodaysViewingsGroupedBySeller.mockResolvedValue([
        {
          id: 'v-1',
          property: { sellerId: 'seller-1', town: 'Bishan', street: 'Bishan St 23' },
          viewingSlot: { startTime: '10:00' },
          verifiedViewer: { name: 'John' },
        },
        {
          id: 'v-2',
          property: { sellerId: 'seller-1', town: 'Bishan', street: 'Bishan St 23' },
          viewingSlot: { startTime: '11:00' },
          verifiedViewer: { name: 'Jane' },
        },
        {
          id: 'v-3',
          property: { sellerId: 'seller-2', town: 'Tampines', street: 'Tampines St 42' },
          viewingSlot: { startTime: '14:00' },
          verifiedViewer: { name: 'Bob' },
        },
      ] as never);

      await viewingService.sendMorningReminders();

      // 2 sellers = 2 notifications
      expect(mockedNotification.send).toHaveBeenCalledTimes(2);
    });
  });

  describe('sendOneHourReminders', () => {
    it('sends individual reminders to viewers and sellers', async () => {
      mockedRepo.findViewingsNeedingReminder.mockResolvedValue([
        {
          id: 'v-1',
          property: { sellerId: 'seller-1', town: 'Bishan', street: 'Bishan St 23' },
          viewingSlot: { startTime: '10:00', date: new Date() },
          verifiedViewer: { id: 'viewer-1', name: 'John' },
        },
      ] as never);

      await viewingService.sendOneHourReminders();

      // 1 viewing = 2 notifications (viewer + seller)
      expect(mockedNotification.send).toHaveBeenCalledTimes(2);
    });
  });

  // ─── Viewer Follow-up ──────────────────────────────────

  describe('sendViewerFollowups', () => {
    it('sends follow-up to viewer 24 hours after completed viewing', async () => {
      mockedRepo.findViewingsNeedingFollowup.mockResolvedValue([
        {
          id: 'v-1',
          verifiedViewer: { id: 'viewer-1', phone: '91234567' },
          viewingSlot: {
            property: {
              town: 'TAMPINES',
              street: 'TAMPINES ST 21',
              sellerId: 's1',
              seller: { agentId: 'a1' },
            },
          },
        },
      ] as never);

      const result = await viewingService.sendViewerFollowups();

      expect(result.sent).toBe(1);
      expect(mockedNotification.send).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientType: 'viewer',
          recipientId: 'viewer-1',
          templateName: 'viewing_followup_viewer',
        }),
        'system',
      );
      expect(mockedRepo.markFollowupSent).toHaveBeenCalledWith('v-1');
    });

    it('returns zero when no viewings need follow-up', async () => {
      mockedRepo.findViewingsNeedingFollowup.mockResolvedValue([]);

      const result = await viewingService.sendViewerFollowups();
      expect(result.sent).toBe(0);
    });
  });

  // ─── findFirstViewingDateForProperty ───────────────────

  describe('findFirstViewingDateForProperty', () => {
    it('returns the earliest scheduled date for scheduled/completed viewings', async () => {
      const mockDate = new Date('2026-01-15T10:00:00Z');
      mockedRepo.findFirstViewingDateForProperty.mockResolvedValue(mockDate);

      const result = await viewingService.findFirstViewingDateForProperty('prop-1');

      expect(mockedRepo.findFirstViewingDateForProperty).toHaveBeenCalledWith('prop-1');
      expect(result).toEqual(mockDate);
    });

    it('returns null when no viewings exist', async () => {
      mockedRepo.findFirstViewingDateForProperty.mockResolvedValue(null);
      const result = await viewingService.findFirstViewingDateForProperty('prop-1');
      expect(result).toBeNull();
    });
  });

  // ─── Stats ─────────────────────────────────────────────

  describe('getViewingStats', () => {
    it('returns aggregated stats', async () => {
      mockedRepo.findPropertyById.mockResolvedValue({
        id: 'prop-1',
        sellerId: 'seller-1',
      } as never);
      mockedRepo.getViewingStats.mockResolvedValue({
        totalViewings: 10,
        upcomingCount: 3,
        noShowCount: 1,
        averageInterestRating: 3.5,
      });

      const result = await viewingService.getViewingStats('prop-1', 'seller-1');

      expect(result.totalViewings).toBe(10);
      expect(result.averageInterestRating).toBe(3.5);
    });
  });

  // ─── Calendar Methods (legacy — no schedule) ──────────

  describe('saveSchedule', () => {
    it('resolves propertyId from seller and upserts schedule', async () => {
      const days = [
        {
          dayOfWeek: 1,
          timeslots: [{ startTime: '18:00', endTime: '20:00', slotType: 'single' as const }],
        },
      ];
      mockedPropertyService.getPropertyForSeller.mockResolvedValue({ id: 'prop-1' } as never);
      mockedRepo.upsertRecurringSchedule.mockResolvedValue({
        id: 'sched-1',
        propertyId: 'prop-1',
        days,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

      const result = await viewingService.saveSchedule(days, 'seller-1');

      expect(mockedRepo.upsertRecurringSchedule).toHaveBeenCalledWith(
        'prop-1',
        expect.any(String), // cuid2
        days,
      );
      expect(result).toMatchObject({ propertyId: 'prop-1' });
    });

    it('throws NotFoundError if seller has no active property', async () => {
      mockedPropertyService.getPropertyForSeller.mockResolvedValue(null as never);
      await expect(viewingService.saveSchedule([], 'seller-1')).rejects.toThrow(NotFoundError);
    });
  });

  describe('deleteSchedule', () => {
    it('resolves propertyId from seller and deletes schedule', async () => {
      mockedPropertyService.getPropertyForSeller.mockResolvedValue({ id: 'prop-1' } as never);
      mockedRepo.deleteRecurringSchedule.mockResolvedValue(undefined as never);

      await viewingService.deleteSchedule('seller-1');

      expect(mockedRepo.deleteRecurringSchedule).toHaveBeenCalledWith('prop-1');
    });

    it('throws NotFoundError if seller has no active property', async () => {
      mockedPropertyService.getPropertyForSeller.mockResolvedValue(null as never);
      await expect(viewingService.deleteSchedule('seller-1')).rejects.toThrow(NotFoundError);
    });
  });

  describe('getMonthSlotMeta — with recurring schedule', () => {
    beforeEach(() => {
      mockedRepo.findPropertyById.mockResolvedValue({
        id: 'prop-1',
        sellerId: 'seller-1',
      } as never);
      mockedRepo.findRecurringSchedule.mockResolvedValue({
        id: 'sched-1',
        propertyId: 'prop-1',
        days: [
          {
            dayOfWeek: 1,
            timeslots: [{ startTime: '18:00', endTime: '18:15', slotType: 'single' }],
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);
    });

    it('counts virtual slot as available when no real slot exists', async () => {
      mockedRepo.findSlotsByPropertyAndMonth.mockResolvedValue([] as never);

      const result = await viewingService.getMonthSlotMeta('prop-1', 2026, 3, 'seller-1');

      expect(result['2026-03-23']).toEqual({ available: 1, full: 0 });
    });

    it('uses real slot status when materialised slot exists', async () => {
      mockedRepo.findSlotsByPropertyAndMonth.mockResolvedValue([
        {
          id: 'uuid-1',
          date: new Date('2026-03-23T00:00:00.000Z'),
          startTime: '18:00',
          endTime: '18:15',
          status: 'full',
          slotType: 'single',
          maxViewers: 1,
          currentBookings: 1,
        },
      ] as never);

      const result = await viewingService.getMonthSlotMeta('prop-1', 2026, 3, 'seller-1');

      expect(result['2026-03-23']).toEqual({ available: 0, full: 1 });
    });

    it('includes manual slot not covered by schedule', async () => {
      mockedRepo.findSlotsByPropertyAndMonth.mockResolvedValue([
        {
          id: 'uuid-manual',
          date: new Date('2026-03-25T00:00:00.000Z'), // Wednesday — not in schedule
          startTime: '10:00',
          endTime: '10:15',
          status: 'available',
          slotType: 'single',
          maxViewers: 1,
          currentBookings: 0,
        },
      ] as never);

      const result = await viewingService.getMonthSlotMeta('prop-1', 2026, 3, 'seller-1');

      expect(result['2026-03-25']).toEqual({ available: 1, full: 0 });
      expect(result['2026-03-23']).toEqual({ available: 1, full: 0 }); // virtual still counted
    });

    it('returns empty object when no schedule and no slots', async () => {
      mockedRepo.findRecurringSchedule.mockResolvedValue(null as never);
      mockedRepo.findSlotsByPropertyAndMonth.mockResolvedValue([] as never);

      const result = await viewingService.getMonthSlotMeta('prop-1', 2026, 3, 'seller-1');

      expect(result).toEqual({});
    });
  });

  describe('getSlotsForDate — with recurring schedule', () => {
    beforeEach(() => {
      mockedRepo.findPropertyById.mockResolvedValue({
        id: 'prop-1',
        sellerId: 'seller-1',
      } as never);
      mockedRepo.findRecurringSchedule.mockResolvedValue({
        id: 'sched-1',
        propertyId: 'prop-1',
        days: [
          {
            dayOfWeek: 1,
            timeslots: [{ startTime: '18:00', endTime: '19:00', slotType: 'single' }],
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);
      mockedRepo.findSlotsByPropertyAndDate.mockResolvedValue([] as never);
    });

    it('includes virtual slots in merged list', async () => {
      const result = await viewingService.getSlotsForDate('prop-1', '2026-03-23', 'seller-1');
      // 18:00-19:00 single = 4 × 15-min sub-windows
      expect(result.slots.length).toBe(4);
      // Virtual slots use rec: IDs
      expect(result.slots.some((s: { id: string }) => s.id.startsWith('rec:'))).toBe(true);
    });

    it('suppresses virtual slot when real slot exists for same window', async () => {
      mockedRepo.findSlotsByPropertyAndDate.mockResolvedValue([
        {
          id: 'uuid-1',
          date: new Date('2026-03-23T00:00:00.000Z'),
          startTime: '18:00',
          endTime: '18:15',
          status: 'booked',
          slotType: 'single',
          maxViewers: 1,
          currentBookings: 1,
        },
      ] as never);

      const result = await viewingService.getSlotsForDate('prop-1', '2026-03-23', 'seller-1');
      const slot1815 = result.slots.find((s: { startTime: string }) => s.startTime === '18:00');
      // Should use UUID, not rec: ID
      expect(slot1815?.id).toBe('uuid-1');
    });
  });

  describe('initiateBooking — recurring slot', () => {
    const recSlotId = 'rec:2026-03-23:18:00:18:15';

    beforeEach(() => {
      // Mock spam checks to pass
      mockedRepo.findDuplicateBooking.mockResolvedValue(null as never);
      mockedRepo.countBookingsToday.mockResolvedValue(0 as never);
      mockedRepo.findVerifiedViewerByPhone.mockResolvedValue(null as never);
      mockedSettings.getNumber.mockResolvedValue(30 as never);
      mockedRepo.createVerifiedViewer.mockResolvedValue({
        id: 'viewer-1',
        noShowCount: 0,
        phoneVerifiedAt: null,
      } as never);
      mockedRepo.countOtpRequestsThisHour.mockResolvedValue(0 as never);
      mockedNotification.send.mockResolvedValue(undefined as never);
      mockedRepo.createViewingWithLock.mockResolvedValue({ id: 'viewing-1' } as never);
      mockedRepo.findViewingById.mockResolvedValue(null as never);

      // Schedule mock
      mockedRepo.findRecurringSchedule.mockResolvedValue({
        id: 'sched-1',
        propertyId: 'prop-1',
        days: [
          {
            dayOfWeek: 1, // Monday
            timeslots: [{ startTime: '18:00', endTime: '19:00', slotType: 'single' }],
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

      // Materialise returns a full slot row
      mockedRepo.materialiseRecurringSlot.mockResolvedValue({
        id: 'uuid-materialised',
        propertyId: 'prop-1',
        date: new Date('2026-03-23T00:00:00.000Z'),
        startTime: '18:00',
        endTime: '18:15',
        status: 'available',
        slotType: 'single',
        maxViewers: 1,
        currentBookings: 0,
        source: 'recurring',
      } as never);
      // findSlotById is called with the resolved UUID
      mockedRepo.findSlotById.mockResolvedValue({
        id: 'uuid-materialised',
        propertyId: 'prop-1',
        date: new Date('2026-03-23T00:00:00.000Z'),
        startTime: '18:00',
        endTime: '18:15',
        status: 'available',
        slotType: 'single',
        maxViewers: 1,
        currentBookings: 0,
        source: 'recurring',
      } as never);
    });

    it('materialises slot and uses UUID for duplicate check', async () => {
      await viewingService.initiateBooking(
        {
          name: 'Test',
          phone: '91234567',
          viewerType: 'buyer',
          consentService: true,
          slotId: recSlotId,
          propertyId: 'prop-1',
        },
        {},
      );

      expect(mockedRepo.materialiseRecurringSlot).toHaveBeenCalledWith(
        expect.objectContaining({
          propertyId: 'prop-1',
          startTime: '18:00',
          endTime: '18:15',
          slotType: 'single',
          maxViewers: 1,
        }),
      );

      // Duplicate check uses materialised UUID, not rec: ID
      expect(mockedRepo.findDuplicateBooking).toHaveBeenCalledWith('91234567', 'uuid-materialised');

      // createViewingWithLock also uses UUID
      expect(mockedRepo.createViewingWithLock).toHaveBeenCalledWith(
        expect.objectContaining({ viewingSlotId: 'uuid-materialised' }),
      );
    });

    it('throws ValidationError for rec: ID with window not in schedule', async () => {
      await expect(
        viewingService.initiateBooking(
          {
            name: 'Test',
            phone: '91234567',
            viewerType: 'buyer',
            consentService: true,
            slotId: 'rec:2026-03-22:18:00:18:15', // Sunday, not in schedule
            propertyId: 'prop-1',
          },
          {},
        ),
      ).rejects.toThrow(ValidationError);
    });

    it('throws NotFoundError if no recurring schedule exists', async () => {
      mockedRepo.findRecurringSchedule.mockResolvedValue(null as never);
      await expect(
        viewingService.initiateBooking(
          {
            name: 'Test',
            phone: '91234567',
            viewerType: 'buyer',
            consentService: true,
            slotId: recSlotId,
            propertyId: 'prop-1',
          },
          {},
        ),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('getPublicBookingPage — with recurring schedule', () => {
    const propertySlug = 'test-slug';

    beforeEach(() => {
      mockedRepo.findPropertyBySlug.mockResolvedValue({
        id: 'prop-1',
        slug: propertySlug,
      } as never);
      mockedRepo.findRecurringSchedule.mockResolvedValue({
        id: 'sched-1',
        propertyId: 'prop-1',
        days: [
          {
            dayOfWeek: 1, // Monday
            timeslots: [{ startTime: '18:00', endTime: '19:00', slotType: 'single' }],
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);
      mockedRepo.findSlotsByPropertyAndDateRange.mockResolvedValue([] as never);
    });

    it('includes virtual slots in availableSlots', async () => {
      const result = await viewingService.getPublicBookingPage(propertySlug);
      expect(result).not.toBeNull();
      // Should contain virtual slots (rec: IDs) for Mondays in next 30 days
      expect(result!.availableSlots.some((s: { id: string }) => s.id.startsWith('rec:'))).toBe(
        true,
      );
    });

    it('virtual slot carries slotType and maxViewers', async () => {
      const result = await viewingService.getPublicBookingPage(propertySlug);
      const virtualSlot = result!.availableSlots.find((s: { id: string }) =>
        s.id.startsWith('rec:'),
      );
      expect(virtualSlot).toBeDefined();
      expect((virtualSlot as { slotType: string })!.slotType).toBe('single');
      expect((virtualSlot as { maxViewers: number })!.maxViewers).toBe(1);
    });

    it('manual slot suppresses matching virtual window (precedence rule)', async () => {
      // Find a Monday in the next 30 days
      const nextMonday = (() => {
        const d = new Date();
        d.setUTCHours(0, 0, 0, 0);
        const dow = d.getUTCDay();
        const days = (1 - dow + 7) % 7 || 7;
        d.setUTCDate(d.getUTCDate() + days);
        return d;
      })();
      const dateStr = nextMonday.toISOString().split('T')[0];

      // A manual slot exists for the same 18:00-18:15 window
      mockedRepo.findSlotsByPropertyAndDateRange.mockResolvedValue([
        {
          id: 'manual-uuid',
          date: nextMonday,
          startTime: '18:00',
          endTime: '18:15',
          status: 'available',
          slotType: 'single',
          maxViewers: 1,
          currentBookings: 0,
        },
      ] as never);

      const result = await viewingService.getPublicBookingPage(propertySlug);

      // No duplicate rec: slot for the same window
      const recSlotForWindow = result!.availableSlots.filter(
        (s: { id: string }) => s.id === `rec:${dateStr}:18:00:18:15`,
      );
      expect(recSlotForWindow).toHaveLength(0);
    });

    it('cancelled slots are excluded', async () => {
      const result = await viewingService.getPublicBookingPage(propertySlug);
      expect(
        result!.availableSlots.every((s: { status: string }) => s.status !== 'cancelled'),
      ).toBe(true);
    });

    it('returns null when property not found', async () => {
      mockedRepo.findPropertyBySlug.mockResolvedValue(null as never);
      const result = await viewingService.getPublicBookingPage(propertySlug);
      expect(result).toBeNull();
    });
  });
});
