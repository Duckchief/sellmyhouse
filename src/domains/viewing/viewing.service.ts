import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { createId } from '@paralleldrive/cuid2';
import * as viewingRepo from './viewing.repository';
import * as auditService from '@/domains/shared/audit.service';
import * as notificationService from '@/domains/notification/notification.service';
import * as settingsService from '@/domains/shared/settings.service';
import * as complianceService from '@/domains/compliance/compliance.service';
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
  ConflictError,
  RateLimitError,
} from '@/domains/shared/errors';
import {
  computeSlotStatus,
  canTransitionViewing,
  OTP_EXPIRY_MINUTES,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_REQUESTS_PER_HOUR,
  MIN_FORM_SUBMIT_SECONDS,
  BOOKINGS_PER_PHONE_PER_DAY,
  DEFAULT_SLOT_DURATION_MINUTES,
} from './viewing.types';
import type {
  CreateSlotInput,
  CreateBulkSlotsInput,
  BookingFormInput,
  VerifyOtpInput,
  ViewingFeedbackInput,
  BookingResult,
} from './viewing.types';
import type { ViewingStatus, SlotStatus } from '@prisma/client';

// ─── Slot Management ─────────────────────────────────────

export async function createSlot(input: CreateSlotInput, sellerId: string) {
  await verifyPropertyOwnership(input.propertyId, sellerId);

  const durationMinutes =
    input.durationMinutes ??
    (await settingsService.getNumber('viewing_slot_duration', DEFAULT_SLOT_DURATION_MINUTES));

  const slot = await viewingRepo.createSlot({
    id: createId(),
    propertyId: input.propertyId,
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    durationMinutes,
    slotType: input.slotType ?? 'single',
    maxViewers: input.maxViewers ?? 1,
  });

  await auditService.log({
    action: 'viewing.slot_created',
    entityType: 'viewing_slot',
    entityId: slot.id,
    details: { propertyId: input.propertyId, sellerId },
  });

  return slot;
}

export async function createBulkSlots(input: CreateBulkSlotsInput, sellerId: string) {
  await verifyPropertyOwnership(input.propertyId, sellerId);

  const slots: {
    id: string;
    propertyId: string;
    date: Date;
    startTime: string;
    endTime: string;
    durationMinutes: number;
    slotType: 'single' | 'group';
    maxViewers: number;
  }[] = [];

  const current = new Date(input.startDate);
  const end = new Date(input.endDate);

  while (current <= end) {
    if (current.getDay() === input.dayOfWeek) {
      // Generate time slots within the window
      const [startH, startM] = input.startTime.split(':').map(Number);
      const [endH, endM] = input.endTime.split(':').map(Number);
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;

      for (
        let t = startMinutes;
        t + input.slotDurationMinutes <= endMinutes;
        t += input.slotDurationMinutes
      ) {
        const slotStart = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
        const slotEnd = `${String(Math.floor((t + input.slotDurationMinutes) / 60)).padStart(2, '0')}:${String((t + input.slotDurationMinutes) % 60).padStart(2, '0')}`;

        slots.push({
          id: createId(),
          propertyId: input.propertyId,
          date: new Date(current),
          startTime: slotStart,
          endTime: slotEnd,
          durationMinutes: input.slotDurationMinutes,
          slotType: input.slotType ?? 'single',
          maxViewers: input.maxViewers ?? 1,
        });
      }
    }
    current.setDate(current.getDate() + 1);
  }

  await viewingRepo.createManySlots(slots);

  await auditService.log({
    action: 'viewing.bulk_slots_created',
    entityType: 'viewing_slot',
    entityId: input.propertyId,
    details: { count: slots.length, sellerId },
  });

  return { count: slots.length, slots };
}

export async function cancelSlot(slotId: string, sellerId: string) {
  const slot = await viewingRepo.findSlotById(slotId);
  if (!slot) throw new NotFoundError('ViewingSlot', slotId);
  if ((slot as { property: { sellerId: string } }).property.sellerId !== sellerId) {
    throw new ForbiddenError('You do not own this property');
  }

  // Get viewers to notify before cancelling
  const viewings = await viewingRepo.findViewingsBySlot(slotId);

  await viewingRepo.cancelSlotAndViewings(slotId);

  // Notify all viewers
  const property = (slot as { property: { town: string; street: string } }).property;
  for (const viewing of viewings) {
    const viewer = (viewing as { verifiedViewer: { id: string } }).verifiedViewer;
    await notificationService.send(
      {
        recipientType: 'viewer',
        recipientId: viewer.id,
        templateName: 'viewing_cancelled',
        templateData: {
          address: `${property.town} ${property.street}`,
          date: `${slot.date.toISOString().split('T')[0]} ${slot.startTime}`,
        },
      },
      'system',
    );
  }

  await auditService.log({
    action: 'viewing.slot_cancelled',
    entityType: 'viewing_slot',
    entityId: slotId,
    details: { sellerId, cancelledViewings: viewings.length },
  });
}

export async function cancelSlotsForPropertyCascade(
  propertyId: string,
  agentId: string,
): Promise<void> {
  const slots = await viewingRepo.findActiveSlotsByPropertyId(propertyId);

  for (const slot of slots) {
    const property = (slot as { property: { block: string; street: string; town: string } })
      .property;
    const address = `${property.block} ${property.street}, ${property.town}`;
    const date = `${slot.date.toISOString().split('T')[0]} ${slot.startTime}`;

    // Notify each viewer with a booked/pending viewing before cancelling
    for (const viewing of slot.viewings) {
      const viewer = (viewing as { verifiedViewer: { id: string } }).verifiedViewer;
      await notificationService.send(
        {
          recipientType: 'viewer',
          recipientId: viewer.id,
          templateName: 'viewing_cancelled',
          templateData: { address, date },
        },
        agentId,
      );
    }

    await viewingRepo.cancelSlotAndViewings(slot.id);
  }

  if (slots.length > 0) {
    await auditService.log({
      action: 'viewing.cascade_cancelled',
      entityType: 'property',
      entityId: propertyId,
      details: { slotsCount: slots.length, reason: 'fallen_through', agentId },
    });
  }
}

// ─── Booking Flow ────────────────────────────────────────

export async function initiateBooking(
  input: BookingFormInput,
  consentMeta: { ipAddress?: string; userAgent?: string } = {},
): Promise<BookingResult | { spam: true }> {
  // Spam check 1: Honeypot
  if (input.website) return { spam: true };

  // Spam check 2: Time-based
  if (input.formLoadedAt) {
    const elapsed = (Date.now() - input.formLoadedAt) / 1000;
    if (elapsed < MIN_FORM_SUBMIT_SECONDS) return { spam: true };
  }

  // Spam check 3: Duplicate detection
  const duplicate = await viewingRepo.findDuplicateBooking(input.phone, input.slotId);
  if (duplicate) throw new ConflictError('You have already booked this slot');

  // Spam check 4: Daily booking limit
  const todayCount = await viewingRepo.countBookingsToday(input.phone);
  if (todayCount >= BOOKINGS_PER_PHONE_PER_DAY) {
    throw new ValidationError(
      'Maximum booking limit reached for today. Please try again tomorrow.',
    );
  }

  // Find or create verified viewer
  let viewer = await viewingRepo.findVerifiedViewerByPhone(input.phone);
  const isReturningViewer = !!(viewer as { phoneVerifiedAt?: Date } | null)?.phoneVerifiedAt;

  if (!viewer) {
    const retentionDays = await settingsService.getNumber('transaction_anonymisation_days', 30);
    const retentionExpiresAt = new Date();
    retentionExpiresAt.setDate(retentionExpiresAt.getDate() + retentionDays);

    viewer = await viewingRepo.createVerifiedViewer({
      id: createId(),
      name: input.name,
      phone: input.phone,
      viewerType: input.viewerType,
      agentName: input.agentName,
      agentCeaReg: input.agentCeaReg,
      agentAgencyName: input.agentAgencyName,
      consentService: input.consentService,
      consentTimestamp: new Date(),
      consentIpAddress: consentMeta.ipAddress,
      consentUserAgent: consentMeta.userAgent,
      retentionExpiresAt,
    });
  }

  const noShowWarning =
    (viewer as { noShowCount?: number }).noShowCount &&
    (viewer as { noShowCount: number }).noShowCount > 0
      ? { count: (viewer as { noShowCount: number }).noShowCount }
      : undefined;

  // Determine status based on returning viewer
  const status: ViewingStatus = isReturningViewer ? 'scheduled' : 'pending_otp';

  // Generate OTP for new viewers
  let otpHash: string | undefined;
  let otpExpiresAt: Date | undefined;

  if (!isReturningViewer) {
    // Rate-limit OTP requests per phone number to prevent abuse
    const otpRequestsThisHour = await viewingRepo.countOtpRequestsThisHour(input.phone);
    if (otpRequestsThisHour >= OTP_MAX_REQUESTS_PER_HOUR) {
      throw new RateLimitError('Too many verification requests. Please try again in an hour.');
    }

    const otp = generateOtp();
    otpHash = await bcrypt.hash(otp, 10);
    otpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // Send OTP via WhatsApp
    await notificationService.send(
      {
        recipientType: 'viewer',
        recipientId: viewer.id,
        templateName: 'generic',
        templateData: {
          message: `Your SellMyHomeNow viewing verification code is: ${otp}. Valid for ${OTP_EXPIRY_MINUTES} minutes.`,
        },
        preferredChannel: 'whatsapp',
      },
      'system',
    );
  }

  const cancelToken = crypto.randomBytes(32).toString('hex');

  // Look up slot to get propertyId and compute scheduledAt
  const slot = await viewingRepo.findSlotById(input.slotId);
  if (!slot) throw new NotFoundError('ViewingSlot', input.slotId);

  const slotData = slot as { id: string; propertyId: string; date: Date; startTime: string };
  const [h, m] = slotData.startTime.split(':').map(Number);
  const scheduledAt = new Date(slotData.date);
  scheduledAt.setHours(h, m, 0, 0);

  // Create viewing with row-level lock on slot
  const viewing = await viewingRepo.createViewingWithLock({
    id: createId(),
    propertyId: slotData.propertyId,
    viewingSlotId: input.slotId,
    verifiedViewerId: viewer.id,
    cancelToken,
    status,
    scheduledAt,
    otpHash,
    otpExpiresAt,
  });

  if (isReturningViewer) {
    await viewingRepo.incrementBookings(viewer.id);

    // Notify seller about booking
    const fullViewing = await viewingRepo.findViewingById(viewing.id);
    if (fullViewing) {
      const property = (
        fullViewing as { property: { sellerId: string; town: string; street: string } }
      ).property;
      const viewingSlot = (fullViewing as { viewingSlot: { date: Date; startTime: string } })
        .viewingSlot;
      const vw = (fullViewing as { verifiedViewer: { name: string; viewerType: string } })
        .verifiedViewer;

      const noShowNote = noShowWarning
        ? ` Warning: This viewer has ${noShowWarning.count} previous no-show(s).`
        : '';

      await notificationService.send(
        {
          recipientType: 'seller',
          recipientId: property.sellerId,
          templateName: 'viewing_booked_seller',
          templateData: {
            address: `${property.town} ${property.street}`,
            date: viewingSlot.date.toISOString().split('T')[0],
            time: viewingSlot.startTime,
            viewerName: vw.name,
            viewerType: vw.viewerType,
            noShowWarning: noShowNote,
          },
        },
        'system',
      );

      // Booking confirmation to viewer
      await notificationService.send(
        {
          recipientType: 'viewer',
          recipientId: viewer.id,
          templateName: 'viewing_booked',
          templateData: {
            address: `${property.town} ${property.street}`,
            date: `${viewingSlot.date.toISOString().split('T')[0]} ${viewingSlot.startTime}`,
          },
          preferredChannel: 'whatsapp',
        },
        'system',
      );
    }
  }

  await auditService.log({
    action: 'viewing.booking_initiated',
    entityType: 'viewing',
    entityId: viewing.id,
    details: { slotId: input.slotId, isReturningViewer, viewerId: viewer.id },
  });

  return {
    viewingId: viewing.id,
    status: status as 'pending_otp' | 'scheduled',
    isReturningViewer,
    noShowWarning,
  };
}

export async function verifyOtp(input: VerifyOtpInput) {
  const viewing = await viewingRepo.findViewingById(input.bookingId);
  if (!viewing) throw new NotFoundError('Viewing', input.bookingId);

  const v = viewing as {
    id: string;
    status: string;
    otpHash: string | null;
    otpExpiresAt: Date | null;
    otpAttempts: number;
    verifiedViewerId: string;
    property: { sellerId: string; town: string; street: string };
    viewingSlot: { date: Date; startTime: string };
    verifiedViewer: { id: string; name: string; viewerType: string; noShowCount?: number };
  };

  if (v.status !== 'pending_otp') {
    throw new ValidationError('This booking is not awaiting OTP verification');
  }

  if (v.otpAttempts >= OTP_MAX_ATTEMPTS) {
    throw new ValidationError('Maximum OTP attempts exceeded. Please request a new booking.');
  }

  if (!v.otpExpiresAt || v.otpExpiresAt < new Date()) {
    throw new ValidationError('OTP has expired. Please request a new booking.');
  }

  const isValid = await bcrypt.compare(input.otp, v.otpHash!);

  if (!isValid) {
    await viewingRepo.updateViewingStatus(v.id, { otpAttempts: v.otpAttempts + 1 });
    throw new ValidationError('Invalid OTP');
  }

  // OTP valid — transition to scheduled and mark phone as verified
  await viewingRepo.updateViewingStatus(v.id, { status: 'scheduled' });
  await viewingRepo.setPhoneVerified(v.verifiedViewerId);
  await viewingRepo.incrementBookings(v.verifiedViewerId);

  // Create consent record for viewer OTP verification (PDPA — records consent at verification time)
  await complianceService.createViewerConsentRecord({
    viewerId: v.verifiedViewerId,
    subjectId: v.verifiedViewerId,
  });

  await auditService.log({
    action: 'viewer.consent_captured',
    entityType: 'VerifiedViewer',
    entityId: v.verifiedViewerId,
    details: { purposeService: true },
  });

  // Notify seller
  const noShowCount = v.verifiedViewer.noShowCount ?? 0;
  const noShowNote =
    noShowCount > 0 ? ` Warning: This viewer has ${noShowCount} previous no-show(s).` : '';

  await notificationService.send(
    {
      recipientType: 'seller',
      recipientId: v.property.sellerId,
      templateName: 'viewing_booked_seller',
      templateData: {
        address: `${v.property.town} ${v.property.street}`,
        date: v.viewingSlot.date.toISOString().split('T')[0],
        time: v.viewingSlot.startTime,
        viewerName: v.verifiedViewer.name,
        viewerType: v.verifiedViewer.viewerType,
        noShowWarning: noShowNote,
      },
    },
    'system',
  );

  // Send booking confirmation to viewer
  await notificationService.send(
    {
      recipientType: 'viewer',
      recipientId: v.verifiedViewerId,
      templateName: 'viewing_booked',
      templateData: {
        address: `${v.property.town} ${v.property.street}`,
        date: `${v.viewingSlot.date.toISOString().split('T')[0]} ${v.viewingSlot.startTime}`,
      },
      preferredChannel: 'whatsapp',
    },
    'system',
  );

  await auditService.log({
    action: 'viewing.otp_verified',
    entityType: 'viewing',
    entityId: v.id,
    details: { viewerId: v.verifiedViewerId },
  });
}

// ─── Cancellation ────────────────────────────────────────

export async function cancelViewing(viewingId: string, cancelToken: string) {
  const viewing = await viewingRepo.findViewingByCancelToken(cancelToken);
  if (!viewing) throw new NotFoundError('Viewing', viewingId);

  const v = viewing as {
    id: string;
    status: string;
    viewingSlotId: string;
    viewingSlot: { id: string; currentBookings: number; maxViewers: number; slotType: string };
    property: { sellerId: string; town: string; street: string };
    verifiedViewer: { name: string };
  };

  if (v.status === 'cancelled' || v.status === 'completed' || v.status === 'no_show') {
    throw new ValidationError('This viewing cannot be cancelled');
  }

  await viewingRepo.updateViewingStatus(v.id, { status: 'cancelled' as ViewingStatus });

  // Decrement slot bookings and recalculate status
  const newBookings = Math.max(0, v.viewingSlot.currentBookings - 1);
  const newStatus = computeSlotStatus(
    newBookings,
    v.viewingSlot.maxViewers,
    v.viewingSlot.slotType,
  ) as SlotStatus;
  await viewingRepo.updateSlotStatus(v.viewingSlotId, {
    currentBookings: newBookings,
    status: newStatus,
  });

  // Notify seller
  await notificationService.send(
    {
      recipientType: 'seller',
      recipientId: v.property.sellerId,
      templateName: 'viewing_cancelled',
      templateData: {
        address: `${v.property.town} ${v.property.street}`,
        date: `cancelled by ${v.verifiedViewer.name}`,
      },
    },
    'system',
  );

  await auditService.log({
    action: 'viewing.cancelled',
    entityType: 'viewing',
    entityId: v.id,
    details: { cancelledBy: 'viewer' },
  });
}

// ─── Post-Viewing ────────────────────────────────────────

export async function submitFeedback(
  viewingId: string,
  sellerId: string,
  input: ViewingFeedbackInput,
) {
  const viewing = await viewingRepo.findViewingById(viewingId);
  if (!viewing) throw new NotFoundError('Viewing', viewingId);

  const v = viewing as { property: { sellerId: string } };
  if (v.property.sellerId !== sellerId) {
    throw new ForbiddenError('You do not own this property');
  }

  await viewingRepo.updateViewingStatus(viewingId, {
    feedback: input.feedback,
    interestRating: input.interestRating,
  });

  await auditService.log({
    action: 'viewing.feedback_submitted',
    entityType: 'viewing',
    entityId: viewingId,
    details: { sellerId, interestRating: input.interestRating },
  });
}

export async function markNoShow(viewingId: string, sellerId: string) {
  const viewing = await viewingRepo.findViewingById(viewingId);
  if (!viewing) throw new NotFoundError('Viewing', viewingId);

  const v = viewing as { status: string; verifiedViewerId: string; property: { sellerId: string } };
  if (v.property.sellerId !== sellerId) {
    throw new ForbiddenError('You do not own this property');
  }
  if (!canTransitionViewing(v.status, 'no_show')) {
    throw new ValidationError(`Cannot mark as no-show from status: ${v.status}`);
  }

  await viewingRepo.updateViewingStatus(viewingId, { status: 'no_show' as ViewingStatus });
  await viewingRepo.incrementNoShow(v.verifiedViewerId);

  await auditService.log({
    action: 'viewing.marked_no_show',
    entityType: 'viewing',
    entityId: viewingId,
    details: { sellerId, viewerId: v.verifiedViewerId },
  });
}

export async function markCompleted(viewingId: string, sellerId: string) {
  const viewing = await viewingRepo.findViewingById(viewingId);
  if (!viewing) throw new NotFoundError('Viewing', viewingId);

  const v = viewing as { status: string; property: { sellerId: string } };
  if (v.property.sellerId !== sellerId) {
    throw new ForbiddenError('You do not own this property');
  }
  if (!canTransitionViewing(v.status, 'completed')) {
    throw new ValidationError(`Cannot mark as completed from status: ${v.status}`);
  }

  await viewingRepo.updateViewingStatus(viewingId, {
    status: 'completed' as ViewingStatus,
    completedAt: new Date(),
  });

  await auditService.log({
    action: 'viewing.marked_completed',
    entityType: 'viewing',
    entityId: viewingId,
    details: { sellerId },
  });
}

// ─── Reminders ───────────────────────────────────────────

export async function sendMorningReminders() {
  const viewings = await viewingRepo.findTodaysViewingsGroupedBySeller();

  // Group by seller
  const bySeller = new Map<string, typeof viewings>();
  for (const v of viewings) {
    const sellerId = (v as { property: { sellerId: string } }).property.sellerId;
    if (!bySeller.has(sellerId)) bySeller.set(sellerId, []);
    bySeller.get(sellerId)!.push(v);
  }

  for (const [sellerId, sellerViewings] of bySeller) {
    const lines = sellerViewings.map((v) => {
      const slot = (v as { viewingSlot: { startTime: string } }).viewingSlot;
      const viewer = (v as { verifiedViewer: { name: string } }).verifiedViewer;
      return `${slot.startTime} - ${viewer.name}`;
    });

    await notificationService.send(
      {
        recipientType: 'seller',
        recipientId: sellerId,
        templateName: 'viewing_reminder',
        templateData: {
          address: 'your property',
          date: `Today's viewings:\n${lines.join('\n')}`,
        },
      },
      'system',
    );
  }
}

export async function sendOneHourReminders() {
  const viewings = await viewingRepo.findViewingsNeedingReminder(60, 75);

  for (const v of viewings) {
    const viewing = v as {
      property: { sellerId: string; town: string; street: string };
      viewingSlot: { startTime: string; date: Date };
      verifiedViewer: { id: string; name: string };
    };

    // Notify viewer
    await notificationService.send(
      {
        recipientType: 'viewer',
        recipientId: viewing.verifiedViewer.id,
        templateName: 'viewing_reminder_viewer',
        templateData: {
          address: `${viewing.property.town} ${viewing.property.street}`,
          time: viewing.viewingSlot.startTime,
        },
        preferredChannel: 'whatsapp',
      },
      'system',
    );

    // Notify seller
    await notificationService.send(
      {
        recipientType: 'seller',
        recipientId: viewing.property.sellerId,
        templateName: 'viewing_reminder',
        templateData: {
          address: `${viewing.property.town} ${viewing.property.street}`,
          date: `${viewing.viewingSlot.startTime} - ${viewing.verifiedViewer.name}`,
        },
      },
      'system',
    );
  }
}

export async function sendFeedbackPrompts() {
  const viewings = await viewingRepo.findViewingsNeedingFeedbackPrompt();

  for (const v of viewings as {
    property: { sellerId: string; town: string; street: string };
    viewingSlot: { date: Date };
  }[]) {
    await notificationService.send(
      {
        recipientType: 'seller',
        recipientId: v.property.sellerId,
        templateName: 'viewing_feedback_prompt',
        templateData: {
          address: `${v.property.town} ${v.property.street}`,
          date: v.viewingSlot.date.toISOString().split('T')[0],
        },
      },
      'system',
    );
  }
}

// ─── Viewer Follow-up ───────────────────────────────────

export async function sendViewerFollowups() {
  const viewings = await viewingRepo.findViewingsNeedingFollowup();

  for (const v of viewings) {
    const viewing = v as {
      id: string;
      verifiedViewer: { id: string; phone: string };
      viewingSlot: {
        property: {
          town: string;
          street: string;
          sellerId: string;
          seller: { agentId: string | null };
        };
      };
    };

    const agentPhone = 'our agent';

    await notificationService.send(
      {
        recipientType: 'viewer',
        recipientId: viewing.verifiedViewer.id,
        templateName: 'viewing_followup_viewer',
        templateData: {
          address: `${viewing.viewingSlot.property.town} ${viewing.viewingSlot.property.street}`,
          agentPhone,
        },
        preferredChannel: 'whatsapp',
      },
      'system',
    );

    await viewingRepo.markFollowupSent(viewing.id);
  }

  return { sent: viewings.length };
}

// ─── Stats ───────────────────────────────────────────────

export async function getViewingStats(propertyId: string, sellerId: string) {
  await verifyPropertyOwnership(propertyId, sellerId);
  return viewingRepo.getViewingStats(propertyId);
}

export async function getSellerDashboard(propertyId: string, sellerId: string) {
  await verifyPropertyOwnership(propertyId, sellerId);
  const stats = await viewingRepo.getViewingStats(propertyId);
  const slots = await viewingRepo.findSlotsByPropertyAndDateRange(
    propertyId,
    new Date(),
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  );
  return { stats, slots };
}

export async function getPublicBookingPage(slug: string) {
  const property = await viewingRepo.findPropertyBySlug(slug);
  if (!property) return null;

  const slots = await viewingRepo.findSlotsByPropertyAndDateRange(
    (property as { id: string }).id,
    new Date(),
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  );

  const availableSlots = slots.filter((s) => (s as { status: string }).status === 'available');

  return { property, availableSlots };
}

export async function getViewingByCancelToken(cancelToken: string) {
  return viewingRepo.findViewingByCancelToken(cancelToken);
}

// ─── Repeat Viewers ─────────────────────────────────────

export async function getRepeatViewers(minProperties: number = 2) {
  return viewingRepo.findRepeatViewers(minProperties);
}

export async function findFirstViewingDateForProperty(propertyId: string): Promise<Date | null> {
  return viewingRepo.findFirstViewingDateForProperty(propertyId);
}

// ─── Helpers ─────────────────────────────────────────────

async function verifyPropertyOwnership(propertyId: string, sellerId: string) {
  const property = await viewingRepo.findPropertyById(propertyId);
  if (!property) throw new NotFoundError('Property', propertyId);
  if ((property as { sellerId: string }).sellerId !== sellerId) {
    throw new ForbiddenError('You do not own this property');
  }
}

function generateOtp(): string {
  return crypto.randomInt(100000, 999999).toString();
}
