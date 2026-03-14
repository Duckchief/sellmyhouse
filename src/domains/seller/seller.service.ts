import * as sellerRepo from './seller.repository';
import * as notificationRepo from '../notification/notification.repository';
import * as notificationService from '../notification/notification.service';
import * as auditService from '../shared/audit.service';
import * as settingsService from '../shared/settings.service';
import { NotFoundError, ValidationError } from '../shared/errors';
import type { Seller, SellerStatus } from '@prisma/client';
import {
  TOTAL_ONBOARDING_STEPS,
  type OnboardingStatus,
  type DashboardOverview,
  type SellerMyData,
  type SellerSettings,
  type UpdateNotificationPreferenceInput,
  type NextStep,
  type CompleteOnboardingStepInput,
  type TimelineMilestone,
  type DocumentChecklistItem,
} from './seller.types';
import * as contentService from '@/domains/content/content.service';
import type { Property } from '@prisma/client';

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

  const unreadNotificationCount = await notificationRepo.countUnreadForRecipient(
    'seller',
    sellerId,
  );

  const onboarding = buildOnboardingStatus(seller.onboardingStep);
  const property = seller.properties?.[0] ?? null;
  const transaction = seller.transactions?.[0] ?? null;
  const nextSteps = buildNextSteps(onboarding, property);

  return {
    seller: {
      id: seller.id,
      name: seller.name,
      email: seller.email,
      phone: seller.phone,
      status: seller.status,
      onboardingStep: seller.onboardingStep,
    },
    onboarding,
    propertyStatus: property?.status ?? null,
    transactionStatus: transaction?.status ?? null,
    unreadNotificationCount,
    nextSteps,
  };
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

export function getTimelineMilestones(
  propertyStatus: string | null,
  _transactionStatus: string | null,
): TimelineMilestone[] {
  const milestones: TimelineMilestone[] = [
    {
      label: 'Property Listed',
      status: 'upcoming',
      date: null,
      description: 'Your property is live on the market',
    },
    { label: 'Viewings', status: 'upcoming', date: null, description: 'Buyers view your home' },
    {
      label: 'Offer Received',
      status: 'upcoming',
      date: null,
      description: 'A buyer makes an offer',
    },
    {
      label: 'OTP Issued',
      status: 'upcoming',
      date: null,
      description: 'Option to Purchase signed',
    },
    {
      label: 'OTP Exercised',
      status: 'upcoming',
      date: null,
      description: 'Buyer exercises the option',
    },
    { label: 'Completion', status: 'upcoming', date: null, description: 'Sale completed' },
  ];

  const propertyStageMap: Record<string, number> = {
    listed: 0,
    offer_received: 2,
    under_option: 3,
    completing: 4,
    completed: 5,
  };

  if (propertyStatus && propertyStatus in propertyStageMap) {
    const completedUpTo = propertyStageMap[propertyStatus];
    for (let i = 0; i <= completedUpTo; i++) {
      milestones[i].status = i === completedUpTo ? 'current' : 'completed';
    }
  }

  return milestones;
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

export async function updateSellerStatus(
  sellerId: string,
  newStatus: string,
  agentId: string,
): Promise<Seller> {
  const seller = await sellerRepo.findById(sellerId);
  if (!seller) throw new NotFoundError('Seller', sellerId);

  const allowed = STATUS_TRANSITIONS[seller.status] ?? [];
  if (!allowed.includes(newStatus)) {
    throw new ValidationError(`Cannot transition seller from '${seller.status}' to '${newStatus}'`);
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
    details: { previousStatus: seller.status, newStatus },
  });

  return updated;
}

// ─── Cron Jobs ──────────────────────────────────────────

export async function checkInactiveSellers() {
  const inactiveDays = await settingsService.getNumber('seller_inactive_alert_days', 14);
  const inactive = await sellerRepo.findInactiveSellers(inactiveDays);

  for (const seller of inactive) {
    if (!seller.agentId) continue;

    const daysSince = Math.floor(
      (Date.now() - seller.updatedAt.getTime()) / (1000 * 60 * 60 * 24),
    );

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
    });
    return steps;
  }

  if (!property) {
    steps.push({
      label: 'Add Property Details',
      description: 'Enter your flat details to get started',
      href: '/seller/property',
      priority: 1,
    });
  } else if (property.status === 'draft') {
    steps.push({
      label: 'Complete Property Listing',
      description: 'Add photos and submit for review',
      href: '/seller/photos',
      priority: 1,
    });
  }

  return steps;
}
