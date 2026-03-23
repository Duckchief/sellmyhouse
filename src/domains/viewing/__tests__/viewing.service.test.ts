import * as viewingService from '../viewing.service';
import * as viewingRepo from '../viewing.repository';
import * as auditService from '@/domains/shared/audit.service';
import * as notificationService from '@/domains/notification/notification.service';
import * as settingsService from '@/domains/shared/settings.service';
import * as complianceService from '@/domains/compliance/compliance.service';
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

      await viewingService.cancelSlotsForPropertyCascade('prop-1', 'agent-1');

      expect(mockedAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'viewing.cascade_cancelled',
          entityType: 'property',
          entityId: 'prop-1',
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

      expect(mockedRepo.updateViewingStatus).toHaveBeenCalledWith('v-1', { status: 'cancelled' });
      expect(mockedRepo.updateSlotStatus).toHaveBeenCalledWith('slot-1', {
        currentBookings: 0,
        status: 'available',
      });
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

  // ─── Calendar Methods ─────────────────────────────────

  describe('getSlotsForDate', () => {
    it('returns slots for a specific date with next available gap', async () => {
      mockedRepo.findPropertyById.mockResolvedValue({ id: 'prop-1', sellerId: 'seller-1' } as never);
      mockedRepo.findSlotsByPropertyAndDateRange.mockResolvedValue([
        {
          id: 's1',
          startTime: '10:00',
          endTime: '11:00',
          slotType: 'single',
          maxViewers: 1,
          currentBookings: 1,
          status: 'booked',
          viewings: [{ status: 'scheduled' }],
        },
        {
          id: 's2',
          startTime: '14:00',
          endTime: '15:00',
          slotType: 'group',
          maxViewers: 5,
          currentBookings: 2,
          status: 'booked',
          viewings: [{ status: 'scheduled' }, { status: 'scheduled' }],
        },
      ] as never);

      const result = await viewingService.getSlotsForDate('prop-1', '2026-03-17', 'seller-1');

      expect(result.slots).toHaveLength(2);
      expect(result.suggestedStart).toBe('11:00');
      expect(result.suggestedEnd).toBe('12:00');
    });

    it('suggests 10:00-11:00 when no slots exist', async () => {
      mockedRepo.findPropertyById.mockResolvedValue({ id: 'prop-1', sellerId: 'seller-1' } as never);
      mockedRepo.findSlotsByPropertyAndDateRange.mockResolvedValue([] as never);

      const result = await viewingService.getSlotsForDate('prop-1', '2026-03-17', 'seller-1');

      expect(result.slots).toHaveLength(0);
      expect(result.suggestedStart).toBe('10:00');
      expect(result.suggestedEnd).toBe('11:00');
    });

    it('finds gap between non-adjacent slots', async () => {
      mockedRepo.findPropertyById.mockResolvedValue({ id: 'prop-1', sellerId: 'seller-1' } as never);
      mockedRepo.findSlotsByPropertyAndDateRange.mockResolvedValue([
        { id: 's1', startTime: '10:00', endTime: '11:00', slotType: 'single', maxViewers: 1, currentBookings: 0, status: 'available', viewings: [] },
        { id: 's2', startTime: '13:00', endTime: '14:00', slotType: 'single', maxViewers: 1, currentBookings: 0, status: 'available', viewings: [] },
      ] as never);

      const result = await viewingService.getSlotsForDate('prop-1', '2026-03-17', 'seller-1');

      expect(result.suggestedStart).toBe('11:00');
      expect(result.suggestedEnd).toBe('12:00');
    });
  });

  describe('getMonthSlotMeta', () => {
    it('returns slot metadata grouped by date', async () => {
      mockedRepo.findPropertyById.mockResolvedValue({ id: 'prop-1', sellerId: 'seller-1' } as never);
      mockedRepo.findSlotsByPropertyAndMonth.mockResolvedValue([
        { id: 's1', date: new Date('2026-03-17'), status: 'available', slotType: 'single', maxViewers: 1, currentBookings: 0, viewings: [] },
        { id: 's2', date: new Date('2026-03-17'), status: 'full', slotType: 'single', maxViewers: 1, currentBookings: 1, viewings: [{ status: 'scheduled' }] },
        { id: 's3', date: new Date('2026-03-20'), status: 'available', slotType: 'group', maxViewers: 5, currentBookings: 2, viewings: [] },
      ] as never);

      const result = await viewingService.getMonthSlotMeta('prop-1', 2026, 3, 'seller-1');

      expect(result['2026-03-17']).toEqual({ available: 1, full: 1 });
      expect(result['2026-03-20']).toEqual({ available: 1, full: 0 });
    });
  });
});
