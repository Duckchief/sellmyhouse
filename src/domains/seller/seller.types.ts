import type { Seller, ConsentRecord } from '@prisma/client';

// Onboarding step constants
export const ONBOARDING_STEPS = {
  NOT_STARTED: 0,
  WELCOME: 1,
  PROPERTY_DETAILS: 2,
  FINANCIAL_SITUATION: 3,
  PHOTOS: 4,
  AGREEMENT: 5,
} as const;

export const TOTAL_ONBOARDING_STEPS = 5;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[keyof typeof ONBOARDING_STEPS];

export interface OnboardingStatus {
  currentStep: number;
  isComplete: boolean;
  completedSteps: number[];
}

export interface DashboardOverview {
  seller: Pick<Seller, 'id' | 'name' | 'email' | 'phone' | 'status' | 'onboardingStep'>;
  onboarding: OnboardingStatus;
  propertyStatus: string | null;
  transactionStatus: string | null;
  unreadNotificationCount: number;
  nextSteps: NextStep[];
}

export interface NextStep {
  label: string;
  description: string;
  href: string;
  priority: number;
}

export interface SellerMyData {
  personalInfo: {
    name: string;
    email: string | null;
    phone: string;
  };
  consentStatus: {
    service: boolean;
    marketing: boolean;
    consentTimestamp: Date | null;
    withdrawnAt: Date | null;
  };
  consentHistory: Pick<ConsentRecord, 'id' | 'purposeService' | 'purposeMarketing' | 'consentGivenAt' | 'consentWithdrawnAt'>[];
  dataActions: {
    canRequestCorrection: boolean;
    canRequestDeletion: boolean;
    canWithdrawConsent: boolean;
  };
}

export interface DocumentChecklistItem {
  id: string;
  label: string;
  description: string;
  required: boolean;
  status: 'not_uploaded' | 'uploaded' | 'verified';
  applicableStages: string[];
}

export interface TimelineMilestone {
  label: string;
  status: 'completed' | 'current' | 'upcoming';
  date: Date | null;
  description: string;
}

export interface CompleteOnboardingStepInput {
  sellerId: string;
  step: number;
  data?: Record<string, unknown>;
}
