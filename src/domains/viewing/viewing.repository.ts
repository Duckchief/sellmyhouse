import { prisma } from '@/infra/database/prisma';
import type { SlotType, SlotStatus, ViewingStatus } from '@prisma/client';
import { NotFoundError, ConflictError } from '@/domains/shared/errors';

// ─── Slots ───────────────────────────────────────────────

export async function createSlot(data: {
  id: string;
  propertyId: string;
  date: Date;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  slotType: SlotType;
  maxViewers: number;
}) {
  return prisma.viewingSlot.create({ data });
}

export async function createManySlots(
  data: {
    id: string;
    propertyId: string;
    date: Date;
    startTime: string;
    endTime: string;
    durationMinutes: number;
    slotType: SlotType;
    maxViewers: number;
  }[],
) {
  return prisma.viewingSlot.createMany({ data });
}

export async function findSlotById(id: string) {
  return prisma.viewingSlot.findUnique({
    where: { id },
    include: { viewings: { include: { verifiedViewer: true } }, property: true },
  });
}

export async function findSlotsByPropertyAndDateRange(
  propertyId: string,
  startDate: Date,
  endDate: Date,
) {
  return prisma.viewingSlot.findMany({
    where: {
      propertyId,
      date: { gte: startDate, lte: endDate },
    },
    include: { viewings: { include: { verifiedViewer: true } } },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  });
}

export async function findSlotsByPropertyAndMonth(
  propertyId: string,
  year: number,
  month: number, // 1-12
) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return prisma.viewingSlot.findMany({
    where: {
      propertyId,
      date: { gte: start, lt: end },
    },
    include: { viewings: { where: { status: { not: 'cancelled' } } } },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  });
}

export async function updateSlotStatus(
  id: string,
  data: { status?: SlotStatus; currentBookings?: number },
) {
  return prisma.viewingSlot.update({ where: { id }, data });
}

export async function findActiveSlotsByPropertyId(propertyId: string) {
  return prisma.viewingSlot.findMany({
    where: {
      propertyId,
      status: { in: ['available', 'booked', 'full'] as SlotStatus[] },
    },
    include: {
      viewings: {
        where: { status: { in: ['scheduled', 'pending_otp'] as ViewingStatus[] } },
        include: { verifiedViewer: true },
      },
      property: { select: { block: true, street: true, town: true } },
    },
  });
}

export async function cancelSlotAndViewings(slotId: string) {
  return prisma.$transaction(async (tx) => {
    // Cancel all viewings for this slot
    await tx.viewing.updateMany({
      where: { viewingSlotId: slotId, status: { notIn: ['cancelled'] } },
      data: { status: 'cancelled' },
    });

    // Cancel the slot and reset bookings
    return tx.viewingSlot.update({
      where: { id: slotId },
      data: { status: 'cancelled', currentBookings: 0 },
    });
  });
}

export async function bulkCancelSlotsAndViewings(slotIds: string[]) {
  return prisma.$transaction(async (tx) => {
    // Cancel all viewings across all slots in one query
    await tx.viewing.updateMany({
      where: { viewingSlotId: { in: slotIds }, status: { notIn: ['cancelled'] } },
      data: { status: 'cancelled' },
    });

    // Cancel all slots in one query
    await tx.viewingSlot.updateMany({
      where: { id: { in: slotIds } },
      data: { status: 'cancelled', currentBookings: 0 },
    });

    return { cancelled: slotIds.length };
  });
}

export async function findSlotsWithBookedViewers(slotIds: string[]) {
  return prisma.viewingSlot.findMany({
    where: {
      id: { in: slotIds },
      viewings: { some: { status: { notIn: ['cancelled'] } } },
    },
    include: {
      viewings: {
        where: { status: { notIn: ['cancelled'] } },
        include: { verifiedViewer: true },
      },
      property: { select: { town: true, street: true, sellerId: true } },
    },
  });
}

// ─── Bookings ────────────────────────────────────────────

export async function createViewingWithLock(data: {
  id: string;
  propertyId: string;
  viewingSlotId: string;
  verifiedViewerId: string;
  cancelToken: string;
  status: ViewingStatus;
  scheduledAt: Date;
  otpHash?: string;
  otpExpiresAt?: Date;
}) {
  return prisma.$transaction(async (tx) => {
    // Lock the slot row to prevent concurrent bookings
    const [slot] = await tx.$queryRaw<
      {
        id: string;
        current_bookings: number;
        max_viewers: number;
        slot_type: string;
        status: string;
      }[]
    >`SELECT id, current_bookings, max_viewers, slot_type, status FROM viewing_slots WHERE id = ${data.viewingSlotId} FOR UPDATE`;

    if (!slot) throw new NotFoundError('ViewingSlot', data.viewingSlotId);
    if (slot.status === 'cancelled') throw new ConflictError('Viewing slot has been cancelled');
    if (slot.status === 'full') throw new ConflictError('Viewing slot is full');
    if (slot.slot_type === 'single' && slot.current_bookings >= 1)
      throw new ConflictError('Viewing slot is full');
    if (slot.current_bookings >= slot.max_viewers) throw new ConflictError('Viewing slot is full');

    // Create the viewing
    const viewing = await tx.viewing.create({ data });

    // Increment bookings and update status
    const newBookings = slot.current_bookings + 1;
    let newStatus: SlotStatus = 'booked';
    if (slot.slot_type === 'single') {
      newStatus = 'booked';
    } else if (newBookings >= slot.max_viewers) {
      newStatus = 'full';
    }

    await tx.viewingSlot.update({
      where: { id: data.viewingSlotId },
      data: { currentBookings: { increment: 1 }, status: newStatus },
    });

    return viewing;
  });
}

export async function findViewingById(id: string) {
  return prisma.viewing.findUnique({
    where: { id },
    include: { viewingSlot: true, verifiedViewer: true, property: true },
  });
}

export async function findViewingByCancelToken(cancelToken: string) {
  return prisma.viewing.findUnique({
    where: { cancelToken },
    include: { viewingSlot: true, verifiedViewer: true, property: true },
  });
}

export async function updateViewingStatus(
  id: string,
  data: {
    status?: ViewingStatus;
    completedAt?: Date;
    feedback?: string;
    interestRating?: number;
    otpHash?: string;
    otpExpiresAt?: Date;
    otpAttempts?: number;
  },
) {
  return prisma.viewing.update({ where: { id }, data });
}

export async function findViewingsBySlot(slotId: string) {
  return prisma.viewing.findMany({
    where: { viewingSlotId: slotId, status: { notIn: ['cancelled'] } },
    include: { verifiedViewer: true },
  });
}

export async function findDuplicateBooking(phone: string, slotId: string) {
  return prisma.viewing.findFirst({
    where: {
      viewingSlotId: slotId,
      verifiedViewer: { phone },
      status: { notIn: ['cancelled'] },
    },
  });
}

export async function countBookingsToday(phone: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  return prisma.viewing.count({
    where: {
      verifiedViewer: { phone },
      createdAt: { gte: today, lt: tomorrow },
      status: { notIn: ['cancelled'] },
    },
  });
}

// ─── Viewers ─────────────────────────────────────────────

export async function findVerifiedViewerByPhone(phone: string) {
  return prisma.verifiedViewer.findUnique({ where: { phone } });
}

export async function createVerifiedViewer(data: {
  id: string;
  name: string;
  phone: string;
  viewerType: 'buyer' | 'agent';
  agentName?: string;
  agentCeaReg?: string;
  agentAgencyName?: string;
  consentService: boolean;
  consentTimestamp?: Date;
  consentIpAddress?: string;
  consentUserAgent?: string;
  retentionExpiresAt?: Date;
}) {
  return prisma.verifiedViewer.create({ data });
}

export async function incrementNoShow(viewerId: string) {
  return prisma.verifiedViewer.update({
    where: { id: viewerId },
    data: { noShowCount: { increment: 1 } },
  });
}

export async function incrementBookings(viewerId: string) {
  return prisma.verifiedViewer.update({
    where: { id: viewerId },
    data: {
      totalBookings: { increment: 1 },
      lastBookingAt: new Date(),
    },
  });
}

export async function setPhoneVerified(viewerId: string): Promise<void> {
  await prisma.verifiedViewer.update({
    where: { id: viewerId },
    data: { phoneVerifiedAt: new Date() },
  });
}

export async function countOtpRequestsThisHour(phone: string): Promise<number> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  return prisma.viewing.count({
    where: {
      verifiedViewer: { phone },
      createdAt: { gte: oneHourAgo },
      otpHash: { not: null },
    },
  });
}

// ─── Queries ─────────────────────────────────────────────

export async function findUpcomingViewingsForProperty(propertyId: string) {
  return prisma.viewing.findMany({
    where: {
      propertyId,
      status: 'scheduled',
      scheduledAt: { gte: new Date() },
    },
    include: { viewingSlot: true, verifiedViewer: true },
    orderBy: { scheduledAt: 'asc' },
  });
}

export async function getViewingStats(propertyId: string) {
  const totalViewings = await prisma.viewing.count({
    where: { propertyId, status: { notIn: ['cancelled', 'pending_otp'] } },
  });

  const upcomingCount = await prisma.viewing.count({
    where: { propertyId, status: 'scheduled', scheduledAt: { gte: new Date() } },
  });

  const noShowCount = await prisma.viewing.count({
    where: { propertyId, status: 'no_show' },
  });

  const avgRating = await prisma.$queryRaw<{ avg: number | null }[]>`
    SELECT AVG(interest_rating)::float as avg
    FROM viewings
    WHERE property_id = ${propertyId}
      AND interest_rating IS NOT NULL
  `;

  return {
    totalViewings,
    upcomingCount,
    noShowCount,
    averageInterestRating: avgRating[0]?.avg ?? null,
  };
}

export async function findViewingsNeedingReminder(fromMinutes: number, toMinutes: number) {
  const now = new Date();
  const from = new Date(now.getTime() + fromMinutes * 60000);
  const to = new Date(now.getTime() + toMinutes * 60000);

  return prisma.viewing.findMany({
    where: {
      status: 'scheduled',
      scheduledAt: { gte: from, lte: to },
    },
    include: { viewingSlot: true, verifiedViewer: true, property: true },
  });
}

export async function findTodaysViewingsGroupedBySeller() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  return prisma.viewing.findMany({
    where: {
      status: 'scheduled',
      scheduledAt: { gte: today, lt: tomorrow },
    },
    include: {
      viewingSlot: true,
      verifiedViewer: true,
      property: { include: { seller: true } },
    },
    orderBy: { scheduledAt: 'asc' },
  });
}

export async function findViewingsNeedingFeedbackPrompt() {
  const oneHourAgoIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  return prisma.$queryRaw`
    SELECT v.*, vs.date, vs.end_time, vs.start_time,
           p.seller_id, p.town, p.street
    FROM viewings v
    JOIN viewing_slots vs ON v.viewing_slot_id = vs.id
    JOIN properties p ON v.property_id = p.id
    WHERE v.status = 'completed'
      AND v.feedback IS NULL
      AND (vs.date + vs.end_time::time) < ${oneHourAgoIso}::timestamptz
  `;
}

/**
 * Find completed viewings from approximately 24 hours ago that haven't
 * had a follow-up sent yet.
 */
export async function findViewingsNeedingFollowup() {
  const now = new Date();
  const windowStart = new Date(now.getTime() - 25 * 60 * 60 * 1000); // 25 hours ago
  const windowEnd = new Date(now.getTime() - 23 * 60 * 60 * 1000); // 23 hours ago

  return prisma.viewing.findMany({
    where: {
      status: 'completed',
      followupSentAt: null,
      completedAt: { gte: windowStart, lte: windowEnd },
    },
    include: {
      verifiedViewer: true,
      viewingSlot: {
        include: {
          property: {
            select: {
              town: true,
              street: true,
              sellerId: true,
              seller: { select: { agentId: true } },
            },
          },
        },
      },
    },
  });
}

export async function markFollowupSent(viewingId: string) {
  return prisma.viewing.update({
    where: { id: viewingId },
    data: { followupSentAt: new Date() },
  });
}

/**
 * Find VerifiedViewers who have booked viewings for 2+ different properties.
 * Returns viewer details and the list of properties they've viewed.
 */
export async function findRepeatViewers(minProperties: number = 2) {
  const results = await prisma.$queryRaw<
    Array<{
      viewer_id: string;
      viewer_name: string;
      viewer_phone: string;
      property_count: bigint;
      property_ids: string;
    }>
  >`
    SELECT
      vv.id AS viewer_id,
      vv.name AS viewer_name,
      vv.phone AS viewer_phone,
      COUNT(DISTINCT vs.property_id) AS property_count,
      STRING_AGG(DISTINCT vs.property_id, ',') AS property_ids
    FROM verified_viewers vv
    JOIN viewings v ON v.verified_viewer_id = vv.id
    JOIN viewing_slots vs ON v.viewing_slot_id = vs.id
    WHERE v.status IN ('scheduled', 'completed')
    GROUP BY vv.id, vv.name, vv.phone
    HAVING COUNT(DISTINCT vs.property_id) >= ${minProperties}
    ORDER BY property_count DESC
  `;

  return results.map((r) => ({
    viewerId: r.viewer_id,
    viewerName: r.viewer_name,
    viewerPhone: r.viewer_phone,
    propertyCount: Number(r.property_count),
    propertyIds: r.property_ids.split(','),
  }));
}

export async function findPropertyById(id: string) {
  return prisma.property.findUnique({ where: { id } });
}

export async function findPropertyBySlug(slug: string) {
  return prisma.property.findFirst({
    where: { slug, status: 'listed' },
  });
}

export async function findFirstViewingDateForProperty(propertyId: string): Promise<Date | null> {
  const viewing = await prisma.viewing.findFirst({
    where: {
      propertyId,
      status: { in: ['scheduled', 'completed'] as ViewingStatus[] },
    },
    orderBy: { scheduledAt: 'asc' },
    select: { scheduledAt: true },
  });
  return viewing?.scheduledAt ?? null;
}
