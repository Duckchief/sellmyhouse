import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { createId } from '@paralleldrive/cuid2';
import * as viewingRepo from './viewing.repository';
import * as auditService from '@/domains/shared/audit.service';
import * as notificationService from '@/domains/notification/notification.service';
import * as settingsService from '@/domains/shared/settings.service';
import * as complianceService from '@/domains/compliance/compliance.service';
import * as propertyService from '@/domains/property/property.service';
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
  MAX_SLOTS_PER_DAY,
  MAX_ACTIVE_SLOTS,
} from './viewing.types';
import type {
  CreateSlotInput,
  CreateBulkSlotsInput,
  BookingFormInput,
  VerifyOtpInput,
  ViewingFeedbackInput,
  BookingResult,
  SlotSummary,
  RecurringDayConfig,
  VirtualSlot,
} from './viewing.types';
import { generateRecurringWindowsForRange } from './recurring.utils';
import type { ViewingStatus, SlotStatus } from '@prisma/client';

// ─── Slot Management ─────────────────────────────────────

export async function createSlot(input: CreateSlotInput, sellerId: string) {
  await verifyPropertyOwnership(input.propertyId, sellerId);

  // Check per-day limit
  const existingSlots = (await viewingRepo.findSlotsByPropertyAndDateRange(
    input.propertyId,
    input.date,
    input.date,
  )) as SlotSummary[];
  const activeOnDay = existingSlots.filter((s) => s.status !== 'cancelled');
  if (activeOnDay.length >= MAX_SLOTS_PER_DAY) {
    throw new ValidationError(
      `Maximum ${MAX_SLOTS_PER_DAY} slots per day. Please cancel existing slots first.`,
    );
  }

  // Check total active slots limit
  const allActive = await viewingRepo.findActiveSlotsByPropertyId(input.propertyId);
  if (allActive.length >= MAX_ACTIVE_SLOTS) {
    throw new ValidationError(
      `Maximum ${MAX_ACTIVE_SLOTS} active slots. Please cancel existing slots first.`,
    );
  }

  // Prevent overlapping slots on the same date
  const hasOverlap = activeOnDay.some(
    (s) => input.startTime < s.endTime && input.endTime > s.startTime,
  );
  if (hasOverlap) {
    throw new ConflictError('A slot already exists that overlaps with this time range');
  }

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

  // Check total active slots limit before generating
  const currentActive = await viewingRepo.findActiveSlotsByPropertyId(input.propertyId);
  if (currentActive.length >= MAX_ACTIVE_SLOTS) {
    throw new ValidationError(
      `Maximum ${MAX_ACTIVE_SLOTS} active slots reached. Please cancel existing slots first.`,
    );
  }

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

  // Verify total won't exceed limit
  if (currentActive.length + slots.length > MAX_ACTIVE_SLOTS) {
    const remaining = MAX_ACTIVE_SLOTS - currentActive.length;
    throw new ValidationError(
      `This would create ${slots.length} slots but only ${remaining} more allowed (limit: ${MAX_ACTIVE_SLOTS}).`,
    );
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

export async function saveSchedule(days: RecurringDayConfig[], sellerId: string) {
  const property = await propertyService.getPropertyForSeller(sellerId);
  if (!property) throw new NotFoundError('Property', sellerId);
  const propertyId = property.id;

  return viewingRepo.upsertRecurringSchedule(propertyId, createId(), days);
}

export async function deleteSchedule(sellerId: string) {
  const property = await propertyService.getPropertyForSeller(sellerId);
  if (!property) throw new NotFoundError('Property', sellerId);
  const propertyId = property.id;

  return viewingRepo.deleteRecurringSchedule(propertyId);
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

export async function bulkCancelSlots(slotIds: string[], sellerId: string) {
  if (slotIds.length === 0) return { cancelled: 0 };

  // Verify ownership of ALL requested slots (not just those with viewers)
  const allRequestedSlots = await viewingRepo.findSlotsByIds(slotIds);
  if (allRequestedSlots.length !== slotIds.length) {
    throw new NotFoundError('ViewingSlot', 'one or more slot IDs not found');
  }
  for (const slot of allRequestedSlots) {
    if (slot.property.sellerId !== sellerId) {
      throw new ForbiddenError('You do not own one or more of these slots');
    }
  }

  // Fetch slots that have booked viewers (need notifications)
  const slotsWithViewers = await viewingRepo.findSlotsWithBookedViewers(slotIds);

  // Batch cancel all slots + viewings in one transaction (2 queries)
  await viewingRepo.bulkCancelSlotsAndViewings(slotIds);

  // Send notifications only for slots that had booked viewers
  for (const slot of slotsWithViewers) {
    const property = slot as unknown as { property: { town: string; street: string } };
    const viewings = (slot as unknown as { viewings: { verifiedViewer: { id: string } }[] })
      .viewings;
    for (const viewing of viewings) {
      await notificationService.send(
        {
          recipientType: 'viewer',
          recipientId: viewing.verifiedViewer.id,
          templateName: 'viewing_cancelled',
          templateData: {
            address: `${property.property.town} ${property.property.street}`,
            date: 'bulk cancellation',
          },
        },
        'system',
      );
    }
  }

  await auditService.log({
    action: 'viewing.bulk_slots_cancelled',
    entityType: 'viewing_slot',
    entityId: sellerId,
    details: { slotCount: slotIds.length, sellerId },
  });

  return { cancelled: slotIds.length };
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

  // Delete recurring schedule so no virtual windows are generated for a cancelled property
  await viewingRepo.deleteRecurringSchedule(propertyId);
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

  // ─── Resolve rec: virtual slot to a materialised UUID ──────
  let resolvedSlotId = input.slotId;

  if (input.slotId.startsWith('rec:')) {
    const parts = input.slotId.split(':');
    // Format: rec:YYYY-MM-DD:HH:MM:HH:MM
    // split(':') yields: ["rec", "2026-03-23", "18", "00", "18", "15"]
    if (parts.length !== 6) {
      throw new ValidationError('Invalid recurring slot ID format');
    }
    const dateStr = parts[1];
    const startTime = `${parts[2]}:${parts[3]}`;
    const endTime = `${parts[4]}:${parts[5]}`;
    const slotDate = new Date(dateStr + 'T00:00:00.000Z');

    if (!input.propertyId) {
      throw new ValidationError('propertyId is required for recurring slot bookings');
    }

    const schedule = await viewingRepo.findRecurringSchedule(input.propertyId);
    if (!schedule) throw new NotFoundError('RecurringSchedule', input.propertyId);

    // Verify this exact window is in the schedule (prevents arbitrary slot fabrication)
    const windows = generateRecurringWindowsForRange(schedule, slotDate, slotDate);
    const matchedWindow = windows.find((w) => w.startTime === startTime && w.endTime === endTime);
    if (!matchedWindow) {
      throw new ValidationError('Requested slot is not in the recurring schedule');
    }

    // Materialise the slot row (INSERT ON CONFLICT DO NOTHING + fetch UUID)
    const materialisedSlot = await viewingRepo.materialiseRecurringSlot({
      id: createId(),
      propertyId: input.propertyId,
      date: slotDate,
      startTime,
      endTime,
      slotType: matchedWindow.slotType,
      maxViewers: matchedWindow.maxViewers,
      durationMinutes: DEFAULT_SLOT_DURATION_MINUTES,
    });
    resolvedSlotId = materialisedSlot.id;
  }

  // Spam check 3: Duplicate detection
  const duplicate = await viewingRepo.findDuplicateBooking(input.phone, resolvedSlotId);
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
    otpHash = await bcrypt.hash(otp, 12);
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
  const slot = await viewingRepo.findSlotById(resolvedSlotId);
  if (!slot) throw new NotFoundError('ViewingSlot', resolvedSlotId);

  const slotData = slot as { id: string; propertyId: string; date: Date; startTime: string };
  const [h, m] = slotData.startTime.split(':').map(Number);
  const scheduledAt = new Date(slotData.date);
  scheduledAt.setHours(h, m, 0, 0);

  // Create viewing with row-level lock on slot
  const viewing = await viewingRepo.createViewingWithLock({
    id: createId(),
    propertyId: slotData.propertyId,
    viewingSlotId: resolvedSlotId,
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
    details: { slotId: resolvedSlotId, isReturningViewer, viewerId: viewer.id },
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

export async function getSellerDashboard(
  propertyId: string,
  sellerId: string,
  page: number = 1,
  pageSize: number = 20,
) {
  await verifyPropertyOwnership(propertyId, sellerId);
  const now = new Date();
  const thirtyDaysOut = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const [stats, { slots, total: totalSlots }] = await Promise.all([
    viewingRepo.getViewingStats(propertyId),
    viewingRepo.findActiveSlotsPaginated(
      propertyId,
      now,
      thirtyDaysOut,
      (page - 1) * pageSize,
      pageSize,
    ),
  ]);

  // Build slot metadata for calendar — uses current month via month-meta route
  // for full data; this is just the initial page's slots for quick dot rendering
  const slotsByDate = await getMonthSlotMeta(
    propertyId,
    now.getFullYear(),
    now.getMonth() + 1,
    sellerId,
  );

  return { stats, slots, totalSlots, page, pageSize, slotsByDate };
}

export async function getSlotsForDate(propertyId: string, dateStr: string, sellerId: string) {
  await verifyPropertyOwnership(propertyId, sellerId);

  const date = new Date(dateStr + 'T00:00:00.000Z');

  // Load and merge virtual + real slots for this date
  const schedule = await viewingRepo.findRecurringSchedule(propertyId);
  const virtualSlots = schedule
    ? generateRecurringWindowsForRange(schedule, date, date)
    : [];

  const realSlots = await viewingRepo.findSlotsByPropertyAndDate(propertyId, date);

  // Build real slot lookup by (startTime, endTime)
  const realSlotMap = new Map<
    string,
    { id: string; startTime: string; endTime: string; status: string; slotType: string; maxViewers: number; currentBookings: number }
  >();
  for (const s of realSlots as { id: string; startTime: string; endTime: string; status: string; slotType: string; maxViewers: number; currentBookings: number }[]) {
    realSlotMap.set(`${s.startTime}:${s.endTime}`, s);
  }

  // Merged slot list for the day
  const mergedSlots: { id: string; date: Date; startTime: string; endTime: string; status: string; slotType: string; maxViewers: number; currentBookings: number }[] = [];
  const processedKeys = new Set<string>();

  for (const vs of virtualSlots) {
    const key = `${vs.startTime}:${vs.endTime}`;
    processedKeys.add(key);
    const real = realSlotMap.get(key);
    if (real) {
      mergedSlots.push({ ...real, date });
    } else {
      mergedSlots.push({ id: vs.id, date: vs.date, startTime: vs.startTime, endTime: vs.endTime, status: 'available', slotType: vs.slotType, maxViewers: vs.maxViewers, currentBookings: 0 });
    }
  }

  // Add real slots not covered by virtual windows
  for (const s of realSlots as { id: string; startTime: string; endTime: string; status: string; slotType: string; maxViewers: number; currentBookings: number; date: Date }[]) {
    const key = `${s.startTime}:${s.endTime}`;
    if (!processedKeys.has(key)) {
      mergedSlots.push({ ...s, date });
    }
  }

  // Sort by startTime
  mergedSlots.sort((a, b) => a.startTime.localeCompare(b.startTime));

  const nextGap = findNextAvailableGap(mergedSlots, date);

  return { slots: mergedSlots, date, nextGap };
}

export async function getMonthSlotMeta(
  propertyId: string,
  year: number,
  month: number,
  sellerId: string,
): Promise<Record<string, { available: number; full: number }>> {
  await verifyPropertyOwnership(propertyId, sellerId);

  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 0)); // last day of month

  // Load virtual windows from schedule
  const schedule = await viewingRepo.findRecurringSchedule(propertyId);
  const virtualSlots = schedule
    ? generateRecurringWindowsForRange(schedule, startDate, endDate)
    : [];

  // Load real slots for the month
  const realSlots = await viewingRepo.findSlotsByPropertyAndMonth(propertyId, year, month);

  // Build lookup: "date:startTime:endTime" → real slot status
  const realSlotMap = new Map<string, string>();
  for (const s of realSlots as { date: Date; startTime: string; endTime: string; status: string }[]) {
    const key = `${s.date.toISOString().split('T')[0]}:${s.startTime}:${s.endTime}`;
    realSlotMap.set(key, s.status);
  }

  const meta: Record<string, { available: number; full: number }> = {};
  const processedKeys = new Set<string>();

  // Process virtual slots (may be overridden by real slots)
  for (const vs of virtualSlots) {
    const dateStr = vs.date.toISOString().split('T')[0];
    const key = `${dateStr}:${vs.startTime}:${vs.endTime}`;
    processedKeys.add(key);

    const status = realSlotMap.get(key) ?? 'available';
    if (status === 'cancelled') continue;

    if (!meta[dateStr]) meta[dateStr] = { available: 0, full: 0 };
    if (status === 'full') {
      meta[dateStr].full++;
    } else {
      meta[dateStr].available++;
    }
  }

  // Process manual/materialised real slots NOT covered by a virtual window
  for (const s of realSlots as { date: Date; startTime: string; endTime: string; status: string }[]) {
    const dateStr = s.date.toISOString().split('T')[0];
    const key = `${dateStr}:${s.startTime}:${s.endTime}`;
    if (processedKeys.has(key)) continue; // already counted via virtual slot

    if (s.status === 'cancelled') continue;
    if (!meta[dateStr]) meta[dateStr] = { available: 0, full: 0 };
    if (s.status === 'full') {
      meta[dateStr].full++;
    } else {
      meta[dateStr].available++;
    }
  }

  return meta;
}

const SLOT_BOUND_START = '10:00';
const SLOT_BOUND_END = '20:00';

function findNextAvailableGap(slots: { startTime: string; endTime: string }[], _date?: Date): {
  start: string;
  end: string;
} {
  if (slots.length === 0) return { start: '10:00', end: '11:00' };

  const sorted = [...slots].sort((a, b) => a.startTime.localeCompare(b.startTime));

  // Try gap after each slot (within bounds)
  for (let i = 0; i < sorted.length; i++) {
    const gapStart = sorted[i].endTime;
    if (gapStart >= SLOT_BOUND_END) continue;
    const gapEnd = addMinutes(gapStart, 60);
    const nextSlotStart = sorted[i + 1]?.startTime ?? SLOT_BOUND_END;
    const clampedEnd = gapEnd > SLOT_BOUND_END ? SLOT_BOUND_END : gapEnd;

    if (clampedEnd <= nextSlotStart && clampedEnd > gapStart) {
      return { start: gapStart, end: clampedEnd };
    }
  }

  // Try gap before first slot (within bounds)
  const firstStart = sorted[0].startTime;
  if (firstStart > SLOT_BOUND_START) {
    const beforeStart = firstStart >= '11:00' ? subtractMinutes(firstStart, 60) : SLOT_BOUND_START;
    const clampedStart = beforeStart < SLOT_BOUND_START ? SLOT_BOUND_START : beforeStart;
    if (clampedStart < firstStart) {
      return { start: clampedStart, end: firstStart };
    }
  }

  // Fallback: after last slot, clamped to bounds
  const lastEnd = sorted[sorted.length - 1].endTime;
  if (lastEnd < SLOT_BOUND_END) {
    const fallbackEnd = addMinutes(lastEnd, 60);
    return { start: lastEnd, end: fallbackEnd > SLOT_BOUND_END ? SLOT_BOUND_END : fallbackEnd };
  }

  // Day is fully packed — return default (form validation will catch issues)
  return { start: '10:00', end: '11:00' };
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function subtractMinutes(time: string, minutes: number): string {
  return addMinutes(time, -minutes);
}

export async function getPublicBookingPage(slug: string) {
  const property = await viewingRepo.findPropertyBySlug(slug);
  if (!property) return null;

  const propertyId = property.id;
  const now = new Date();
  const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // Load virtual windows from schedule
  const schedule = await viewingRepo.findRecurringSchedule(propertyId);
  const virtualSlots = schedule
    ? generateRecurringWindowsForRange(schedule, now, endDate)
    : [];

  // Load real slots for next 30 days (available, booked, full — not cancelled)
  const realSlots = (await viewingRepo.findSlotsByPropertyAndDateRange(
    propertyId,
    now,
    endDate,
  )) as SlotSummary[];

  // Build real slot lookup by "date:startTime:endTime"
  const realSlotMap = new Map<string, SlotSummary>();
  for (const s of realSlots) {
    const key = `${s.date.toISOString().split('T')[0]}:${s.startTime}:${s.endTime}`;
    realSlotMap.set(key, s);
  }

  // Merge: manual slot suppresses virtual window for the same window
  const merged: (SlotSummary | (VirtualSlot & { status: string }))[] = [];
  const processedKeys = new Set<string>();

  for (const vs of virtualSlots) {
    const dateStr = vs.date.toISOString().split('T')[0];
    const key = `${dateStr}:${vs.startTime}:${vs.endTime}`;
    processedKeys.add(key);

    const real = realSlotMap.get(key);
    if (real) {
      // Manual/materialised slot takes precedence
      if (real.status !== 'cancelled') merged.push(real);
    } else {
      // Virtual slot — available by definition
      merged.push({ ...vs, status: 'available' });
    }
  }

  // Add manual real slots not covered by any virtual window
  for (const s of realSlots) {
    const key = `${s.date.toISOString().split('T')[0]}:${s.startTime}:${s.endTime}`;
    if (!processedKeys.has(key) && s.status !== 'cancelled') {
      merged.push(s);
    }
  }

  // 'booked' slots are included because group slots accept multiple bookings
  // while in 'booked' state (not yet 'full'). Single-slot 'booked' entries
  // prevent double-booking at the DB layer via currentBookings check.
  const availableSlots = merged.filter(
    (s) => s.status === 'available' || s.status === 'booked',
  );

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
