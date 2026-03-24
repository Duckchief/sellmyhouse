// ─── Slot Status State Machine ─────────────────────────────
// available → booked (first booking on single slot)
// available → full (group slot reaches maxViewers)
// available/booked/full → cancelled (seller cancels)

export const SLOT_STATUS_TRANSITIONS: Record<string, string[]> = {
  available: ['booked', 'full', 'cancelled'],
  booked: ['available', 'full', 'cancelled'],
  full: ['booked', 'available', 'cancelled'],
  cancelled: [],
};

export function canTransitionSlot(from: string, to: string): boolean {
  return SLOT_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

// ─── Viewing Status State Machine ──────────────────────────
// pending_otp → scheduled (OTP verified or returning viewer)
// scheduled → completed | cancelled | no_show

export const VIEWING_STATUS_TRANSITIONS: Record<string, string[]> = {
  pending_otp: ['scheduled', 'cancelled'],
  scheduled: ['completed', 'cancelled', 'no_show'],
  completed: [],
  cancelled: [],
  no_show: [],
};

export function canTransitionViewing(from: string, to: string): boolean {
  return VIEWING_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

// ─── Input Types ──────────────────────────────────────────

export interface CreateSlotInput {
  propertyId: string;
  date: Date;
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  durationMinutes?: number;
  slotType?: 'single' | 'group';
  maxViewers?: number;
}

export interface CreateBulkSlotsInput {
  propertyId: string;
  startDate: Date;
  endDate: Date;
  dayOfWeek: number; // 0=Sunday, 6=Saturday
  startTime: string;
  endTime: string;
  slotDurationMinutes: number;
  slotType?: 'single' | 'group';
  maxViewers?: number;
}

export interface RecurringTimeslotConfig {
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  slotType: 'single' | 'group';
}

export interface RecurringDayConfig {
  dayOfWeek: number; // 0=Sunday, 6=Saturday
  timeslots: RecurringTimeslotConfig[];
}

export interface CreateRecurringSlotsInput {
  propertyId: string;
  days: RecurringDayConfig[];
}

export interface BookingFormInput {
  name: string;
  phone: string;
  viewerType: 'buyer' | 'agent';
  agentName?: string;
  agentCeaReg?: string;
  agentAgencyName?: string;
  consentService: boolean;
  slotId: string;
  propertyId?: string; // Required for rec: IDs; resolved server-side from property slug
  // Anti-spam
  website?: string; // Honeypot field
  formLoadedAt?: number; // Timestamp for time-based validation
}

export interface VerifyOtpInput {
  phone: string;
  otp: string;
  bookingId: string;
}

export interface ViewingFeedbackInput {
  feedback: string;
  interestRating: number; // 1-5
}

export interface BookingResult {
  viewingId: string;
  status: 'pending_otp' | 'scheduled';
  isReturningViewer: boolean;
  noShowWarning?: { count: number };
}

export interface ViewingStatsResult {
  totalViewings: number;
  upcomingCount: number;
  averageInterestRating: number | null;
  noShowCount: number;
}

// ─── Computed Slot Status ─────────────────────────────────

export function computeSlotStatus(
  currentBookings: number,
  maxViewers: number,
  slotType: string,
): string {
  if (currentBookings <= 0) return 'available';
  if (slotType === 'single') return 'booked';
  if (currentBookings >= maxViewers) return 'full';
  return 'booked';
}

// ─── Repository Return Types ─────────────────────────────
// Lightweight interfaces matching Prisma return shapes, used in the service
// layer to avoid `as unknown as` casts.

export interface SlotSummary {
  id: string;
  date: Date;
  startTime: string;
  endTime: string;
  slotType: string;
  maxViewers: number;
  currentBookings: number;
  status: string;
}

// ─── Schedule Types ────────────────────────────────────────

export type SlotSource = 'manual' | 'recurring';

export interface VirtualSlot {
  id: string; // 'rec:{YYYY-MM-DD}:{HH:MM}:{HH:MM}'
  date: Date;
  startTime: string; // HH:MM
  endTime: string;   // HH:MM
  slotType: 'single' | 'group';
  maxViewers: number;
}

export interface RecurringScheduleRow {
  id: string;
  propertyId: string;
  days: unknown; // RecurringDayConfig[] at runtime — cast before use
  createdAt: Date;
  updatedAt: Date;
}

// ─── Constants ────────────────────────────────────────────

export const DEFAULT_SLOT_DURATION_MINUTES = 15;
export const DEFAULT_MAX_GROUP_SIZE = 5;
export const OTP_LENGTH = 6;
export const OTP_EXPIRY_MINUTES = 5;
export const OTP_MAX_ATTEMPTS = 3;
export const OTP_MAX_REQUESTS_PER_HOUR = 3;
export const BOOKINGS_PER_PHONE_PER_DAY = 3;
export const BOOKING_ATTEMPTS_PER_IP_PER_HOUR = 10;
export const MIN_FORM_SUBMIT_SECONDS = 3;
export const MAX_SLOTS_PER_DAY = 10;
export const MAX_ACTIVE_SLOTS = 200;
