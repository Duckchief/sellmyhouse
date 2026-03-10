import { ValidationError } from '@/domains/shared/errors';
import type {
  CreateSlotInput,
  CreateBulkSlotsInput,
  BookingFormInput,
  VerifyOtpInput,
  ViewingFeedbackInput,
} from './viewing.types';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const SG_PHONE_REGEX = /^[89]\d{7}$/;
const MAX_BULK_WEEKS = 8;

export function validateCreateSlot(body: Record<string, unknown>): CreateSlotInput {
  const propertyId = String(body.propertyId || '');
  if (!propertyId) throw new ValidationError('Property ID is required');

  const dateStr = String(body.date || '');
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) throw new ValidationError('Invalid date');
  if (date < new Date(new Date().toDateString())) throw new ValidationError('Date must be in the future');

  const startTime = String(body.startTime || '');
  if (!TIME_REGEX.test(startTime)) throw new ValidationError('Start time must be HH:MM format');

  const endTime = String(body.endTime || '');
  if (!TIME_REGEX.test(endTime)) throw new ValidationError('End time must be HH:MM format');

  if (endTime <= startTime) throw new ValidationError('End time must be after start time');

  const slotType = (String(body.slotType || 'single')) as 'single' | 'group';
  if (!['single', 'group'].includes(slotType)) throw new ValidationError('Invalid slot type');

  let maxViewers = 1;
  if (slotType === 'group') {
    maxViewers = Number(body.maxViewers);
    if (!body.maxViewers || isNaN(maxViewers) || maxViewers < 2) {
      throw new ValidationError('Group slots require maxViewers >= 2');
    }
  }

  const durationMinutes = Number(body.durationMinutes) || undefined;

  return { propertyId, date, startTime, endTime, durationMinutes, slotType, maxViewers };
}

export function validateCreateBulkSlots(body: Record<string, unknown>): CreateBulkSlotsInput {
  const propertyId = String(body.propertyId || '');
  if (!propertyId) throw new ValidationError('Property ID is required');

  const startDate = new Date(String(body.startDate || ''));
  if (isNaN(startDate.getTime())) throw new ValidationError('Invalid start date');
  if (startDate < new Date(new Date().toDateString())) throw new ValidationError('Start date must be in the future');

  const endDate = new Date(String(body.endDate || ''));
  if (isNaN(endDate.getTime())) throw new ValidationError('Invalid end date');
  if (endDate <= startDate) throw new ValidationError('End date must be after start date');

  const diffWeeks = (endDate.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000);
  if (diffWeeks > MAX_BULK_WEEKS) throw new ValidationError(`Date range cannot exceed ${MAX_BULK_WEEKS} weeks`);

  const dayOfWeek = Number(body.dayOfWeek);
  if (isNaN(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    throw new ValidationError('Day of week must be 0 (Sunday) to 6 (Saturday)');
  }

  const startTime = String(body.startTime || '');
  if (!TIME_REGEX.test(startTime)) throw new ValidationError('Start time must be HH:MM format');

  const endTime = String(body.endTime || '');
  if (!TIME_REGEX.test(endTime)) throw new ValidationError('End time must be HH:MM format');

  if (endTime <= startTime) throw new ValidationError('End time must be after start time');

  const slotDurationMinutes = Number(body.slotDurationMinutes);
  if (isNaN(slotDurationMinutes) || slotDurationMinutes < 5 || slotDurationMinutes > 120) {
    throw new ValidationError('Slot duration must be between 5 and 120 minutes');
  }

  const slotType = (String(body.slotType || 'single')) as 'single' | 'group';
  if (!['single', 'group'].includes(slotType)) throw new ValidationError('Invalid slot type');

  let maxViewers = 1;
  if (slotType === 'group') {
    maxViewers = Number(body.maxViewers);
    if (!body.maxViewers || isNaN(maxViewers) || maxViewers < 2) {
      throw new ValidationError('Group slots require maxViewers >= 2');
    }
  }

  return { propertyId, startDate, endDate, dayOfWeek, startTime, endTime, slotDurationMinutes, slotType, maxViewers };
}

export function validateBookingForm(body: Record<string, unknown>): BookingFormInput {
  const name = String(body.name || '').trim();
  if (!name) throw new ValidationError('Name is required');

  const phone = String(body.phone || '').replace(/\s/g, '');
  if (!SG_PHONE_REGEX.test(phone)) {
    throw new ValidationError('Please enter a valid Singapore mobile number (8 digits starting with 8 or 9)');
  }

  const viewerType = String(body.viewerType || '') as 'buyer' | 'agent';
  if (!['buyer', 'agent'].includes(viewerType)) throw new ValidationError('Viewer type must be buyer or agent');

  let agentName: string | undefined;
  let agentCeaReg: string | undefined;
  let agentAgencyName: string | undefined;

  if (viewerType === 'agent') {
    agentName = String(body.agentName || '').trim();
    agentCeaReg = String(body.agentCeaReg || '').trim();
    agentAgencyName = String(body.agentAgencyName || '').trim();
    if (!agentName || !agentCeaReg || !agentAgencyName) {
      throw new ValidationError('Agent name, CEA registration, and agency name are required for agent viewers');
    }
  }

  const consentService = body.consentService === true || body.consentService === 'true';
  if (!consentService) throw new ValidationError('Service consent is required to book a viewing');

  const slotId = String(body.slotId || '');
  if (!slotId) throw new ValidationError('Slot ID is required');

  const website = body.website ? String(body.website) : undefined;
  const formLoadedAt = body.formLoadedAt ? Number(body.formLoadedAt) : undefined;

  return { name, phone, viewerType, agentName, agentCeaReg, agentAgencyName, consentService, slotId, website, formLoadedAt };
}

export function validateOtp(body: Record<string, unknown>): VerifyOtpInput {
  const phone = String(body.phone || '').replace(/\s/g, '');
  if (!SG_PHONE_REGEX.test(phone)) throw new ValidationError('Invalid phone number');

  const otp = String(body.otp || '');
  if (!/^\d{6}$/.test(otp)) throw new ValidationError('OTP must be 6 digits');

  const bookingId = String(body.bookingId || '');
  if (!bookingId) throw new ValidationError('Booking ID is required');

  return { phone, otp, bookingId };
}

export function validateFeedback(body: Record<string, unknown>): ViewingFeedbackInput {
  const feedback = String(body.feedback || '').trim();
  if (!feedback) throw new ValidationError('Feedback is required');
  if (feedback.length > 1000) throw new ValidationError('Feedback must be 1000 characters or less');

  const interestRating = Number(body.interestRating);
  if (isNaN(interestRating) || interestRating < 1 || interestRating > 5 || !Number.isInteger(interestRating)) {
    throw new ValidationError('Interest rating must be an integer between 1 and 5');
  }

  return { feedback, interestRating };
}
