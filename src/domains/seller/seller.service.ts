import * as sellerRepo from './seller.repository';
import * as notificationService from '../notification/notification.service';
import * as auditService from '../shared/audit.service';
import * as authService from '../auth/auth.service';
import * as settingsService from '../shared/settings.service';
import * as viewingService from '../viewing/viewing.service';
import { NotFoundError, ValidationError } from '../shared/errors';
import { logger } from '../../infra/logger';
import type { Seller, SellerStatus } from '@prisma/client';
import {
  TOTAL_ONBOARDING_STEPS,
  type OnboardingStatus,
  type DashboardOverview,
  type DashboardStats,
  type SellerMyData,
  type SellerSettings,
  type UpdateNotificationPreferenceInput,
  type NextStep,
  type CompleteOnboardingStepInput,
  type TimelineMilestone,
  type TimelineInput,
  type DocumentChecklistItem,
  type SaleProceedsInput,
} from './seller.types';
import * as contentService from '@/domains/content/content.service';
import type { Property } from '@prisma/client';

const MARKETING_PROMPT_DELAY_DAYS = 14;

export async function getOnboardingStatus(sellerId: string): Promise<OnboardingStatus> {
  const seller = await sellerRepo.findById(sellerId);
  if (!seller) throw new NotFoundError('Seller', sellerId);

  return buildOnboardingStatus(seller.onboardingStep);
}

export async function completeOnboardingStep(
  input: CompleteOnboardingStepInput,
): Promise<{ onboardingStep: number }> {
  const seller = await sellerRepo.findById(input.sellerId);
  if (!seller) throw new NotFoundError('Seller', input.sellerId);

  // Validate bounds first
  if (input.step < 1 || input.step > TOTAL_ONBOARDING_STEPS) {
    throw new ValidationError(`Step must be between 1 and ${TOTAL_ONBOARDING_STEPS}.`);
  }

  // Validate sequential progression
  const expectedStep = seller.onboardingStep + 1;
  if (input.step !== expectedStep) {
    throw new ValidationError(`Cannot complete step ${input.step}. Expected step ${expectedStep}.`);
  }

  const updated = await sellerRepo.updateOnboardingStep(input.sellerId, input.step);

  await auditService.log({
    action: 'seller.onboarding_step_completed',
    entityType: 'seller',
    entityId: input.sellerId,
    details: { step: input.step },
  });

  return { onboardingStep: updated.onboardingStep };
}

export async function getDashboardOverview(sellerId: string): Promise<DashboardOverview> {
  const seller = await sellerRepo.getSellerWithRelations(sellerId);
  if (!seller) throw new NotFoundError('Seller', sellerId);

  const unreadNotificationCount = await notificationService.countUnreadNotifications(
    'seller',
    sellerId,
  );

  const onboarding = buildOnboardingStatus(seller.onboardingStep);
  const firstProperty = seller.properties?.[0] ?? null;
  const transaction = seller.transactions?.[0] ?? null;
  const nextSteps = buildNextSteps(onboarding, firstProperty);

  const property = firstProperty
    ? {
        block: firstProperty.block,
        street: firstProperty.street,
        town: firstProperty.town,
        flatType: firstProperty.flatType,
        floorAreaSqm: Number(firstProperty.floorAreaSqm),
        askingPrice: Number(firstProperty.askingPrice),
        status: firstProperty.status,
      }
    : null;

  const caseFlags = (seller.caseFlags ?? []).map((f) => ({
    id: f.id,
    flagType: f.flagType as string,
    description: f.description,
  }));

  let upcomingViewings = 0;
  let totalViewings = 0;
  if (firstProperty) {
    const stats = await viewingService.getViewingStats(firstProperty.id, sellerId);
    upcomingViewings = stats.upcomingCount;
    totalViewings = stats.totalViewings;
  }

  const daysSinceCreation = Math.floor(
    (Date.now() - seller.createdAt.getTime()) / (1000 * 60 * 60 * 24),
  );
  const showMarketingPrompt =
    !seller.consentMarketing && daysSinceCreation >= MARKETING_PROMPT_DELAY_DAYS;

  return {
    seller: {
      id: seller.id,
      name: seller.name,
      email: seller.email,
      phone: seller.phone,
      status: seller.status,
      onboardingStep: seller.onboardingStep,
      emailVerified: seller.emailVerified,
    },
    onboarding,
    propertyStatus: firstProperty?.status ?? null,
    transactionStatus: transaction?.status ?? null,
    unreadNotificationCount,
    nextSteps,
    property,
    caseFlags,
    upcomingViewings,
    totalViewings,
    showMarketingPrompt,
  };
}

export async function getDashboardStats(sellerId: string): Promise<DashboardStats> {
  const seller = await sellerRepo.getSellerWithRelations(sellerId);
  if (!seller) throw new NotFoundError('Seller', sellerId);

  const firstProperty = seller.properties[0] ?? null;
  let upcomingViewings = 0;
  let totalViewings = 0;
  if (firstProperty) {
    const stats = await viewingService.getViewingStats(firstProperty.id, sellerId);
    upcomingViewings = stats.upcomingCount;
    totalViewings = stats.totalViewings;
  }

  const unreadNotificationCount = await notificationService.countUnreadNotifications(
    'seller',
    sellerId,
  );

  return { upcomingViewings, totalViewings, unreadNotificationCount };
}

export async function getMyData(sellerId: string): Promise<SellerMyData> {
  const seller = await sellerRepo.findById(sellerId);
  if (!seller) throw new NotFoundError('Seller', sellerId);

  const consentHistory = await sellerRepo.getConsentHistory(sellerId);

  return {
    personalInfo: {
      name: seller.name,
      email: seller.email,
      phone: seller.phone,
    },
    consentStatus: {
      service: seller.consentService,
      marketing: seller.consentMarketing,
      consentTimestamp: seller.consentTimestamp,
      withdrawnAt: seller.consentWithdrawnAt,
    },
    consentHistory: consentHistory.map((c) => ({
      id: c.id,
      purposeService: c.purposeService,
      purposeMarketing: c.purposeMarketing,
      consentGivenAt: c.consentGivenAt,
      consentWithdrawnAt: c.consentWithdrawnAt,
    })),
    dataActions: {
      canRequestCorrection: true,
      canRequestDeletion: seller.status !== 'active',
      canWithdrawConsent: seller.consentService || seller.consentMarketing,
    },
  };
}

export async function getTutorialsGrouped() {
  return contentService.getTutorialsGrouped();
}

const OTP_STATUS_ORDER = [
  'prepared',
  'sent_to_seller',
  'signed_by_seller',
  'returned',
  'issued_to_buyer',
  'exercised',
] as const;

const HDB_STATUS_ORDER = [
  'not_started',
  'application_submitted',
  'approval_in_principle',
  'approval_granted',
  'resale_checklist_submitted',
  'hdb_appointment_booked',
  'completed',
] as const;

const PROPERTY_STATUS_ORDER = [
  'draft',
  'listed',
  'offer_received',
  'under_option',
  'completing',
  'completed',
  'withdrawn',
];

function otpStatusGte(current: string, target: string): boolean {
  if (current === 'expired') return false; // expired is terminal failure, no sub-step is "completed"
  return (
    OTP_STATUS_ORDER.indexOf(current as (typeof OTP_STATUS_ORDER)[number]) >=
    OTP_STATUS_ORDER.indexOf(target as (typeof OTP_STATUS_ORDER)[number])
  );
}

function hdbStatusGte(current: string, target: string): boolean {
  return (
    HDB_STATUS_ORDER.indexOf(current as (typeof HDB_STATUS_ORDER)[number]) >=
    HDB_STATUS_ORDER.indexOf(target as (typeof HDB_STATUS_ORDER)[number])
  );
}

type RawMilestone = Omit<TimelineMilestone, 'status'> & { completed: boolean };

export function getTimelineMilestones(
  data: TimelineInput,
  role: 'agent' | 'admin' | 'seller',
): TimelineMilestone[] {
  const raw: RawMilestone[] = [];

  // Infer whether we are past the pre-offer phase. If an OTP or transaction
  // exists, earlier milestones (CDD, EAA, listing, viewings) must have already been completed.
  const isPostOffer = !!data.otp || !!data.transaction;

  // 1. Seller CDD Done
  raw.push({
    label: 'Seller CDD Done',
    description: 'Customer due diligence completed for seller',
    completed: !!data.sellerCddRecord || isPostOffer,
    date: data.sellerCddRecord?.createdAt ?? null,
    notApplicable: false,
  });

  // 2. Estate Agency Agreement Signed
  raw.push({
    label: 'Estate Agency Agreement Signed',
    description: 'Agency agreement executed with video call explanation',
    completed: !!data.eaa?.signedCopyPath || isPostOffer,
    date: data.eaa?.videoCallConfirmedAt ?? null,
    notApplicable: false,
  });

  // 3. Property Listed
  raw.push({
    label: 'Property Listed',
    description: 'Property is live on the market',
    completed: (!!data.property && data.property.status !== 'draft') || isPostOffer,
    date: data.property?.listedAt ?? null,
    notApplicable: false,
  });

  // 4. Viewings — current while listed, completed when property reaches offer_received or beyond,
  //    or when an accepted offer / transaction exists (implying viewings already occurred).
  //    Withdrawn is a terminal failure state — do not treat it as post-offer completion.
  const propertyStatusIndex = data.property
    ? PROPERTY_STATUS_ORDER.indexOf(data.property.status)
    : -1;
  const offerReceivedIndex = PROPERTY_STATUS_ORDER.indexOf('offer_received');
  const viewingsCompleted =
    (propertyStatusIndex >= offerReceivedIndex &&
      propertyStatusIndex !== -1 &&
      data.property?.status !== 'withdrawn') ||
    !!data.acceptedOffer ||
    !!data.otp ||
    !!data.transaction;

  raw.push({
    label: 'Viewings',
    description: 'Buyers view your home',
    completed: viewingsCompleted,
    date: data.firstViewingAt ?? null,
    notApplicable: false,
  });

  // 5. Offer Received
  const hasOffer = !!data.acceptedOffer || !!data.transaction || !!data.otp;
  raw.push({
    label: 'Offer Received',
    description: 'A buyer has made an accepted offer',
    completed: hasOffer,
    date: data.acceptedOffer?.createdAt ?? null,
    notApplicable: false,
  });

  // Admin-only: OTP sub-steps (between Offer Received and Counterparty CDD)
  if (role === 'admin' && data.otp) {
    const otpStatus = data.otp.status;
    raw.push({
      label: 'OTP Prepared',
      description: 'Option to Purchase prepared by agent',
      completed: otpStatusGte(otpStatus, 'sent_to_seller'),
      date: null,
      notApplicable: false,
    });
    raw.push({
      label: 'OTP Sent to Seller',
      description: 'OTP sent to seller for signing',
      completed: otpStatusGte(otpStatus, 'signed_by_seller'),
      date: null,
      notApplicable: false,
    });
    raw.push({
      label: 'OTP Signed by Seller',
      description: 'OTP signed by seller and returned to agent',
      completed: otpStatusGte(otpStatus, 'returned'),
      date: null,
      notApplicable: false,
    });
    raw.push({
      label: 'OTP Returned to Agent',
      description: 'OTP returned to agent for review before issuing',
      completed: otpStatusGte(otpStatus, 'issued_to_buyer'),
      date: null,
      notApplicable: false,
    });
  }

  // 6. Counterparty CDD (agent/admin only — not shown to sellers)
  if (role !== 'seller') {
    raw.push({
      label: 'Counterparty CDD',
      description: data.isCoBroke
        ? 'Not required — co-broke transaction'
        : 'Due diligence completed on buyer',
      completed: !data.isCoBroke && !!data.counterpartyCddRecord,
      date: data.isCoBroke ? null : (data.counterpartyCddRecord?.createdAt ?? null),
      notApplicable: data.isCoBroke,
    });
  }

  // 7. OTP Review (agent/admin only — not shown to sellers)
  if (role !== 'seller') {
    raw.push({
      label: 'OTP Review',
      description: 'Agent reviews OTP terms before issuing to buyer',
      completed: !!data.otp?.agentReviewedAt,
      date: data.otp?.agentReviewedAt ?? null,
      notApplicable: false,
    });
  }

  // 8. OTP Issued
  raw.push({
    label: 'OTP Issued',
    description: 'Option to Purchase issued to buyer',
    completed: !!data.otp?.issuedAt,
    date: data.otp?.issuedAt ?? null,
    notApplicable: false,
  });

  // 9. OTP Exercised
  raw.push({
    label: 'OTP Exercised',
    description: 'Buyer has exercised the Option to Purchase',
    completed: !!data.otp?.exercisedAt,
    date: data.otp?.exercisedAt ?? null,
    notApplicable: false,
  });

  // 10. HDB Resale Submission
  const hdbStatus = data.transaction?.hdbApplicationStatus ?? 'not_started';
  raw.push({
    label: 'HDB Resale Submission',
    description: 'Buyer and seller submit documents via HDB portal',
    completed: hdbStatus !== 'not_started',
    date: data.transaction?.hdbAppSubmittedAt ?? null,
    notApplicable: false,
  });

  // Admin-only: HDB sub-steps (between HDB Resale Submission and Completion)
  if (role === 'admin' && data.transaction) {
    const hdb = data.transaction.hdbApplicationStatus;
    raw.push({
      label: 'HDB Approval in Principle',
      description: 'HDB grants approval in principle',
      completed: hdbStatusGte(hdb, 'approval_in_principle'),
      date: null,
      notApplicable: false,
    });
    raw.push({
      label: 'HDB Approval Granted',
      description: 'HDB grants full approval for resale',
      completed: hdbStatusGte(hdb, 'approval_granted'),
      date: data.transaction.hdbAppApprovedAt ?? null,
      notApplicable: false,
    });
    raw.push({
      label: 'Resale Checklist Submitted',
      description: 'Resale checklist submitted to HDB',
      completed: hdbStatusGte(hdb, 'resale_checklist_submitted'),
      date: null,
      notApplicable: false,
    });
    raw.push({
      label: 'HDB Appointment Booked',
      description: 'Final HDB completion appointment scheduled',
      completed: hdbStatusGte(hdb, 'hdb_appointment_booked'),
      date: data.transaction.hdbAppointmentDate ?? null,
      notApplicable: false,
    });
  }

  // 11. Completion
  raw.push({
    label: 'Completion',
    description: 'Sale completed successfully',
    completed: data.transaction?.status === 'completed',
    date: data.transaction?.completionDate ?? null,
    notApplicable: false,
  });

  // Assign statuses: first non-completed non-N/A milestone = 'current'
  let currentSet = false;
  return raw.map((m): TimelineMilestone => {
    if (m.notApplicable) {
      const { completed: _, ...rest } = m;
      return { ...rest, status: 'upcoming' };
    }
    if (m.completed) {
      const { completed: _, ...rest } = m;
      return { ...rest, status: 'completed' };
    }
    if (!currentSet) {
      currentSet = true;
      const { completed: _, ...rest } = m;
      return { ...rest, status: 'current' };
    }
    const { completed: _, ...rest } = m;
    return { ...rest, status: 'upcoming' };
  });
}

export function getDocumentChecklist(propertyStatus: string | null): DocumentChecklistItem[] {
  const items: DocumentChecklistItem[] = [
    {
      id: 'nric',
      label: 'NRIC',
      description: 'Identity document for verification',
      required: true,
      status: 'not_uploaded',
      applicableStages: ['draft', 'listed'],
    },
    {
      id: 'marriage-cert',
      label: 'Marriage Certificate',
      description: 'If property is jointly owned',
      required: false,
      status: 'not_uploaded',
      applicableStages: ['draft', 'listed'],
    },
    {
      id: 'eligibility-letter',
      label: 'HDB Eligibility Letter',
      description: 'From HDB after resale application',
      required: true,
      status: 'not_uploaded',
      applicableStages: ['under_option', 'completing'],
    },
    {
      id: 'otp-scan',
      label: 'Signed OTP',
      description: 'Scanned copy of signed Option to Purchase',
      required: true,
      status: 'not_uploaded',
      applicableStages: ['under_option'],
    },
    {
      id: 'estate-agency-agreement',
      label: 'Estate Agency Agreement',
      description: 'CEA Form 1 signed with agent',
      required: true,
      status: 'not_uploaded',
      applicableStages: ['draft', 'listed'],
    },
  ];

  if (!propertyStatus) return items;
  return items.filter((item) => item.applicableStages.includes(propertyStatus));
}

export async function getSellerSettings(sellerId: string): Promise<SellerSettings> {
  const seller = await sellerRepo.findById(sellerId);
  if (!seller) throw new NotFoundError('Seller', sellerId);
  return { notificationPreference: seller.notificationPreference };
}

export async function updateNotificationPreference(
  input: UpdateNotificationPreferenceInput,
): Promise<SellerSettings> {
  const seller = await sellerRepo.findById(input.sellerId);
  if (!seller) throw new NotFoundError('Seller', input.sellerId);

  const updated = await sellerRepo.updateNotificationPreference(input.sellerId, input.preference);

  await auditService.log({
    agentId: input.agentId,
    action: 'seller.notification_preference_changed',
    entityType: 'seller',
    entityId: input.sellerId,
    details: { newPreference: input.preference, actorType: input.agentId ? 'agent' : 'seller' },
  });

  return { notificationPreference: updated.notificationPreference };
}

const STATUS_TRANSITIONS: Record<string, string[]> = {
  lead: ['engaged', 'archived'],
  engaged: ['active', 'archived'],
  active: ['completed', 'archived'],
  completed: ['archived'],
  archived: [],
};

const NOTE_REQUIRED_TRANSITIONS = new Set([
  'lead→engaged',
  'lead→archived',
  'engaged→archived',
  'active→archived',
  'completed→archived',
]);

export async function updateSellerStatus(
  sellerId: string,
  newStatus: string,
  agentId: string,
  note?: string,
): Promise<Seller> {
  const seller = await sellerRepo.findById(sellerId);
  if (!seller) throw new NotFoundError('Seller', sellerId);

  const allowed = STATUS_TRANSITIONS[seller.status] ?? [];
  if (!allowed.includes(newStatus)) {
    throw new ValidationError(`Cannot transition seller from '${seller.status}' to '${newStatus}'`);
  }

  const transitionKey = `${seller.status}→${newStatus}`;
  if (NOTE_REQUIRED_TRANSITIONS.has(transitionKey) && !note?.trim()) {
    throw new ValidationError('A note is required for this status transition');
  }

  const updateData: { status: SellerStatus; consultationCompletedAt?: Date } = {
    status: newStatus as SellerStatus,
  };
  if (newStatus === 'engaged') {
    updateData.consultationCompletedAt = new Date();
  }

  const updated = await sellerRepo.updateSellerStatus(sellerId, updateData);

  await auditService.log({
    agentId,
    action: 'seller.status_changed',
    entityType: 'seller',
    entityId: sellerId,
    details: { previousStatus: seller.status, newStatus, ...(note ? { note } : {}) },
  });

  // Send account setup email when transitioning lead→engaged with verified email
  if (seller.status === 'lead' && newStatus === 'engaged' && seller.emailVerified && seller.email) {
    try {
      await authService.sendAccountSetupEmail(seller.id, seller.name, seller.email);
    } catch (err) {
      logger.warn({ sellerId, err }, 'Failed to send account setup email');
    }
  }

  return updated;
}

// ─── Cron Jobs ──────────────────────────────────────────

export async function checkInactiveSellers() {
  const inactiveDays = await settingsService.getNumber('seller_inactive_alert_days', 14);
  const inactive = await sellerRepo.findInactiveSellers(inactiveDays);

  for (const seller of inactive) {
    if (!seller.agentId) continue;

    const daysSince = Math.floor((Date.now() - seller.updatedAt.getTime()) / (1000 * 60 * 60 * 24));

    await notificationService.send(
      {
        recipientType: 'agent',
        recipientId: seller.agentId,
        templateName: 'generic',
        templateData: {
          subject: `Inactive seller: ${seller.name}`,
          message: `${seller.name} (${seller.email}) has had no activity for ${daysSince} days. Status: ${seller.status}. Consider following up.`,
        },
      },
      'system',
    );

    await auditService.log({
      action: 'seller.inactive_alert',
      entityType: 'seller',
      entityId: seller.id,
      details: { daysSince, agentId: seller.agentId },
    });
  }

  return { checked: inactive.length };
}

export async function recordCpfDisclaimerShown(sellerId: string): Promise<void> {
  await sellerRepo.recordCpfDisclaimerShown(sellerId);
  await auditService.log({
    action: 'seller.cpf_disclaimer_shown',
    entityType: 'seller',
    entityId: sellerId,
    details: {},
  });
}

export async function findById(sellerId: string) {
  return sellerRepo.findById(sellerId);
}

export async function saveSaleProceeds(input: SaleProceedsInput) {
  const cpfTotal =
    input.cpfSeller1 + (input.cpfSeller2 ?? 0) + (input.cpfSeller3 ?? 0) + (input.cpfSeller4 ?? 0);

  const netProceeds =
    input.sellingPrice -
    input.outstandingLoan -
    cpfTotal -
    input.resaleLevy -
    input.otherDeductions -
    input.commission -
    (input.buyerDeposit ?? 0);

  return sellerRepo.upsertSaleProceeds({
    ...input,
    netProceeds: Math.round(netProceeds * 100) / 100,
  });
}

export async function getSaleProceeds(sellerId: string) {
  const record = await sellerRepo.findSaleProceedsBySellerId(sellerId);
  if (!record) return null;

  return {
    sellingPrice: Number(record.sellingPrice),
    outstandingLoan: Number(record.outstandingLoan),
    cpfSeller1: Number(record.cpfSeller1),
    cpfSeller2: record.cpfSeller2 ? Number(record.cpfSeller2) : null,
    cpfSeller3: record.cpfSeller3 ? Number(record.cpfSeller3) : null,
    cpfSeller4: record.cpfSeller4 ? Number(record.cpfSeller4) : null,
    resaleLevy: Number(record.resaleLevy),
    otherDeductions: Number(record.otherDeductions),
    commission: Number(record.commission),
    buyerDeposit: Number(record.buyerDeposit),
    netProceeds: Number(record.netProceeds),
  };
}

// --- Private helpers ---

function buildOnboardingStatus(step: number): OnboardingStatus {
  const completedSteps: number[] = [];
  for (let i = 1; i <= step; i++) {
    completedSteps.push(i);
  }
  return {
    currentStep: step,
    isComplete: step >= TOTAL_ONBOARDING_STEPS,
    completedSteps,
  };
}

function buildNextSteps(onboarding: OnboardingStatus, property: Property | null): NextStep[] {
  const steps: NextStep[] = [];

  if (!onboarding.isComplete) {
    steps.push({
      label: 'Complete Onboarding',
      description: `Step ${onboarding.currentStep + 1} of ${TOTAL_ONBOARDING_STEPS}`,
      href: '/seller/onboarding',
      priority: 1,
      completed: false,
    });
    return steps;
  }

  if (!property) {
    steps.push({
      label: 'Add Property Details',
      description: 'Enter your flat details to get started',
      href: '/seller/property',
      priority: 1,
      completed: false,
    });
  } else if (property.status === 'draft') {
    steps.push({
      label: 'Complete Property Listing',
      description: 'Add photos and submit for review',
      href: '/seller/photos',
      priority: 1,
      completed: false,
    });
  } else {
    // Property is listed or beyond — onboarding and listing steps are complete
    steps.push({
      label: 'Complete Onboarding',
      description: 'Onboarding complete',
      href: '/seller/onboarding',
      priority: 1,
      completed: true,
    });
    steps.push({
      label: 'Add Property Details',
      description: 'Property details submitted',
      href: '/seller/property',
      priority: 2,
      completed: true,
    });
  }

  return steps;
}
