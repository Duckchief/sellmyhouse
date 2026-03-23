import type {
  Seller,
  ConsentRecord,
  PropertyStatus,
  OtpStatus,
  TransactionStatus,
  HdbApplicationStatus,
} from '@prisma/client';

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
  seller: Pick<Seller, 'id' | 'name' | 'email' | 'phone' | 'status' | 'onboardingStep' | 'emailVerified'>;
  onboarding: OnboardingStatus;
  propertyStatus: string | null;
  transactionStatus: string | null;
  unreadNotificationCount: number;
  nextSteps: NextStep[];
  property: {
    block: string;
    street: string;
    town: string;
    flatType: string;
    floorAreaSqm: number;
    askingPrice: number;
    status: string;
  } | null;
  caseFlags: Array<{ id: string; flagType: string; description: string }>;
  upcomingViewings: number;
  totalViewings: number;
  showMarketingPrompt: boolean;
}

export interface NextStep {
  label: string;
  description: string;
  href: string;
  priority: number;
  completed: boolean;
}

export interface DashboardStats {
  upcomingViewings: number;
  totalViewings: number;
  unreadNotificationCount: number;
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
  consentHistory: Pick<
    ConsentRecord,
    'id' | 'purposeService' | 'purposeMarketing' | 'consentGivenAt' | 'consentWithdrawnAt'
  >[];
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
  status: 'not_uploaded' | 'uploaded' | 'received_by_agent';
  applicableStages: string[];
}

export interface TimelineMilestone {
  label: string;
  status: 'completed' | 'current' | 'upcoming';
  date: Date | null;
  description: string;
  notApplicable: boolean;
}

export interface TimelineInput {
  sellerCddRecord: { createdAt: Date } | null;
  eaa: { videoCallConfirmedAt: Date | null; signedCopyPath: string | null } | null;
  property: { status: PropertyStatus; listedAt: Date | null } | null;
  firstViewingAt: Date | null;
  acceptedOffer: { createdAt: Date } | null;
  counterpartyCddRecord: { createdAt: Date } | null;
  isCoBroke: boolean;
  otp: {
    status: OtpStatus;
    agentReviewedAt: Date | null;
    issuedAt: Date | null;
    exercisedAt: Date | null;
  } | null;
  transaction: {
    status: TransactionStatus;
    hdbApplicationStatus: HdbApplicationStatus;
    hdbAppSubmittedAt: Date | null;
    hdbAppApprovedAt: Date | null;
    hdbAppointmentDate: Date | null;
    completionDate: Date | null;
  } | null;
}

export interface CompleteOnboardingStepInput {
  sellerId: string;
  step: number;
  data?: Record<string, unknown>;
}

export interface SellerSettings {
  notificationPreference: 'whatsapp_and_email' | 'email_only';
}

export interface UpdateNotificationPreferenceInput {
  sellerId: string;
  preference: 'whatsapp_and_email' | 'email_only';
  agentId?: string;
}

export interface SaleProceedsInput {
  sellerId: string;
  sellingPrice: number;
  outstandingLoan: number;
  cpfSeller1: number;
  cpfSeller2?: number;
  cpfSeller3?: number;
  cpfSeller4?: number;
  resaleLevy: number;
  otherDeductions: number;
  commission: number;
}

// ─── Seller Document Upload ─────────────────────────────────────────────────

export const SELLER_DOC_TYPES = [
  'nric',
  'marriage_cert',
  'eligibility_letter',
  'otp_scan',
  'eaa',
  'other',
] as const;

export type SellerDocType = (typeof SELLER_DOC_TYPES)[number];

export const SELLER_DOC_MAX_FILES: Record<SellerDocType, number> = {
  nric: 2,
  marriage_cert: 3,
  eligibility_letter: 1,
  otp_scan: 1,
  eaa: 1,
  other: 5,
};

export const SELLER_DOC_MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const SELLER_DOC_ALLOWED_MIMES = ['image/jpeg', 'image/png', 'application/pdf'];

export interface UploadSellerDocumentInput {
  sellerId: string;
  docType: SellerDocType;
  fileBuffer: Buffer;
  mimeType: string;
  originalFilename: string;
  uploadedBy: string;
  uploadedByRole: 'seller' | 'agent';
}

export interface SellerDocumentRecord {
  id: string;
  sellerId: string;
  docType: string;
  slotIndex: number | null;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: Date;
  uploadedBy: string;
  downloadedAt: Date | null;
  downloadedBy: string | null;
  deletedAt: Date | null;
}
