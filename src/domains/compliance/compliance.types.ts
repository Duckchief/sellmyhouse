// src/domains/compliance/compliance.types.ts

export type DncChannel = 'whatsapp' | 'phone' | 'email';
export type MessageType = 'service' | 'marketing';

export interface DncAllowedResult {
  allowed: boolean;
  reason?: string;
}

export type ConsentType = 'service' | 'marketing';

export interface WithdrawConsentInput {
  sellerId: string;
  type: ConsentType;
  channel: string; // 'web' | 'email' | 'whatsapp' | 'phone' | 'in_person'
  ipAddress?: string;
  userAgent?: string;
}

export interface ConsentWithdrawalResult {
  consentRecordId: string;
  deletionRequestId?: string; // set if service consent withdrawn
  deletionBlocked: boolean; // true if AML/CFT prevents deletion
  retentionRule?: string;
}

export interface ConsentRecord {
  id: string;
  subjectType: string;
  subjectId: string; // legacy column — retained during migration period
  sellerId: string | null;
  buyerId: string | null;
  purposeService: boolean;
  purposeMarketing: boolean;
  consentGivenAt: Date;
  consentWithdrawnAt: Date | null;
  withdrawalChannel: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export interface DataDeletionRequest {
  id: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  retentionRule: string | null;
  flaggedAt: Date;
  reviewedByAgentId: string | null;
  reviewedAt: Date | null;
  reviewNotes: string | null;
  executedAt: Date | null;
  status: string;
  details: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DataCorrectionRequest {
  id: string;
  sellerId: string;
  fieldName: string;
  currentValue: string | null;
  requestedValue: string;
  reason: string | null;
  status: string;
  processedByAgentId: string | null;
  processedAt: Date | null;
  processNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCorrectionRequestInput {
  sellerId: string;
  fieldName: string;
  currentValue?: string;
  requestedValue: string;
  reason?: string;
}

// Fields that can be auto-applied by the system on agent approval
export const AUTO_APPLY_FIELDS = ['name', 'email', 'phone', 'notificationPreference'] as const;
export type AutoApplyField = (typeof AUTO_APPLY_FIELDS)[number];

export interface CreateCddRecordInput {
  subjectType: string;
  subjectId: string;
  fullName: string;
  nricLast4: string;
  verifiedByAgentId: string;
  dateOfBirth?: Date;
  nationality?: string;
  occupation?: string;
  documents?: object;
  riskLevel?: 'standard' | 'enhanced';
  notes?: string;
}

export interface UpdateCddStatusInput {
  sellerId: string;
  agentId: string;
  status: 'not_started' | 'pending' | 'verified';
}

export interface CreateEaaInput {
  sellerId: string;
  agentId: string;
  agreementType?: 'exclusive' | 'non_exclusive';
  commissionAmount?: number;
  commissionGstInclusive?: boolean;
  coBrokingAllowed?: boolean;
  coBrokingTerms?: string;
  expiryDate?: Date;
}

export interface ConfirmEaaExplanationInput {
  eaaId: string;
  method: 'video_call' | 'in_person';
  notes?: string;
  agentId: string;
}

export interface EaaRecord {
  id: string;
  sellerId: string;
  agentId: string;
  agreementType: string;
  formType: string;
  commissionAmount: number;
  commissionGstInclusive: boolean;
  coBrokingAllowed: boolean;
  coBrokingTerms: string;
  signedAt: Date | null;
  signedCopyPath: string | null;
  signedCopyDeletedAt: Date | null;
  videoCallConfirmedAt: Date | null;
  videoCallNotes: string | null;
  expiryDate: Date | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CddRecord {
  id: string;
  subjectType: string;
  subjectId: string;
  fullName: string;
  nricLast4: string;
  dateOfBirth: Date | null;
  nationality: string | null;
  occupation: string | null;
  documents: unknown;
  riskLevel: string;
  identityVerified: boolean;
  verifiedByAgentId: string;
  verifiedAt: Date | null;
  retentionExpiresAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── CDD Document Upload ──────────────────────────────────────────────────────

export const CDD_DOCUMENT_TYPES = [
  'nric',
  'passport',
  'work_pass',
  'proof_of_address',
  'source_of_funds',
  'acra_bizfile',
  'death_certificate',
  'will',
  'letters_of_administration',
  'grant_of_probate',
  'hdb_transmission_approval',
  'other',
] as const;

export type CddDocumentType = (typeof CDD_DOCUMENT_TYPES)[number];

/**
 * One entry in the CddRecord.documents JSON array.
 * path + wrappedKey are required to decrypt the .enc file.
 * wrappedKey is the per-file data key encrypted by the active KeyProvider.
 */
export interface CddDocument {
  id: string;
  docType: CddDocumentType;
  label: string | null; // required when docType === 'other'
  path: string; // relative: cdd/{cddRecordId}/{docType}-{uuid}.enc
  wrappedKey: string; // base64 — data key encrypted by master key
  mimeType: string;
  sizeBytes: number; // plaintext size (for UI display)
  uploadedAt: string; // ISO timestamp
  uploadedByAgentId: string;
}

export interface UploadCddDocumentInput {
  cddRecordId: string;
  agentId: string;
  isAdmin: boolean;
  fileBuffer: Buffer;
  originalFilename: string;
  mimeType: string;
  docType: CddDocumentType;
  label?: string;
}

export interface DownloadCddDocumentInput {
  cddRecordId: string;
  documentId: string;
  agentId: string;
  isAdmin: boolean;
}

export interface DeleteCddDocumentInput {
  cddRecordId: string;
  documentId: string;
  agentId: string;
  isAdmin: boolean;
}
