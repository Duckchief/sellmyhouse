// src/domains/compliance/compliance.repository.ts
import { createId } from '@paralleldrive/cuid2';
import { Prisma, SubjectType } from '@prisma/client';
import { prisma } from '@/infra/database/prisma';
import type {
  ConsentRecord,
  DataDeletionRequest,
  DataCorrectionRequest,
  CreateCorrectionRequestInput,
} from './compliance.types';

export async function createConsentRecord(data: {
  subjectId: string;
  purposeService: boolean;
  purposeMarketing: boolean;
  consentWithdrawnAt?: Date;
  withdrawalChannel?: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<ConsentRecord> {
  return prisma.consentRecord.create({
    data: {
      id: createId(),
      subjectType: 'seller',
      subjectId: data.subjectId,
      purposeService: data.purposeService,
      purposeMarketing: data.purposeMarketing,
      consentWithdrawnAt: data.consentWithdrawnAt ?? null,
      withdrawalChannel: data.withdrawalChannel ?? null,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
    },
  });
}

export async function findLatestConsentRecord(sellerId: string): Promise<ConsentRecord | null> {
  return prisma.consentRecord.findFirst({
    where: { subjectType: 'seller', subjectId: sellerId },
    orderBy: { consentGivenAt: 'desc' },
  });
}

export async function findAllConsentRecords(sellerId: string): Promise<ConsentRecord[]> {
  return prisma.consentRecord.findMany({
    where: { subjectType: 'seller', subjectId: sellerId },
    orderBy: { consentGivenAt: 'asc' },
  });
}

export async function createDeletionRequest(data: {
  targetType: string;
  targetId: string;
  reason: string;
  retentionRule: string;
  status: string;
  details?: Record<string, unknown>;
}): Promise<DataDeletionRequest> {
  return prisma.dataDeletionRequest.create({
    data: {
      id: createId(),
      targetType: data.targetType as never,
      targetId: data.targetId,
      reason: data.reason,
      retentionRule: data.retentionRule,
      status: data.status as never,
      details: (data.details ?? {}) as Prisma.InputJsonValue,
    },
  }) as Promise<DataDeletionRequest>;
}

export async function findDeletionRequest(id: string): Promise<DataDeletionRequest | null> {
  return prisma.dataDeletionRequest.findUnique({
    where: { id },
  }) as Promise<DataDeletionRequest | null>;
}

export async function updateDeletionRequest(
  id: string,
  data: Partial<{
    status: string;
    reviewedByAgentId: string;
    reviewedAt: Date;
    reviewNotes: string;
    executedAt: Date;
  }>,
): Promise<DataDeletionRequest> {
  return prisma.dataDeletionRequest.update({
    where: { id },
    data: data as never,
  }) as Promise<DataDeletionRequest>;
}

export async function findPendingDeletionRequests(): Promise<DataDeletionRequest[]> {
  return prisma.dataDeletionRequest.findMany({
    where: { status: { in: ['flagged', 'blocked', 'pending_review'] as never[] } },
    orderBy: { flaggedAt: 'asc' },
  }) as Promise<DataDeletionRequest[]>;
}

export async function findSellerWithTransactions(sellerId: string): Promise<{
  status: string;
  transactions: { completionDate: Date | null; status: string }[];
} | null> {
  return prisma.seller.findUnique({
    where: { id: sellerId },
    select: {
      status: true,
      transactions: {
        select: { completionDate: true, status: true },
        orderBy: { completionDate: 'desc' },
      },
    },
  });
}

export async function updateSellerConsent(
  sellerId: string,
  data: { consentService?: boolean; consentMarketing?: boolean },
): Promise<void> {
  await prisma.seller.update({ where: { id: sellerId }, data });
}

export async function findSellerConsent(
  sellerId: string,
): Promise<{ consentService: boolean; consentMarketing: boolean } | null> {
  return prisma.seller.findUnique({
    where: { id: sellerId },
    select: { consentService: true, consentMarketing: true },
  });
}

export async function createCorrectionRequest(
  data: CreateCorrectionRequestInput,
): Promise<DataCorrectionRequest> {
  return prisma.dataCorrectionRequest.create({
    data: {
      id: createId(),
      sellerId: data.sellerId,
      fieldName: data.fieldName,
      currentValue: data.currentValue ?? null,
      requestedValue: data.requestedValue,
      reason: data.reason ?? null,
      status: 'pending',
    },
  }) as Promise<DataCorrectionRequest>;
}

export async function findCorrectionRequest(id: string): Promise<DataCorrectionRequest | null> {
  return prisma.dataCorrectionRequest.findUnique({
    where: { id },
  }) as Promise<DataCorrectionRequest | null>;
}

export async function findCorrectionRequestsBySeller(
  sellerId: string,
): Promise<DataCorrectionRequest[]> {
  return prisma.dataCorrectionRequest.findMany({
    where: { sellerId },
    orderBy: { createdAt: 'desc' },
  }) as Promise<DataCorrectionRequest[]>;
}

export async function findPendingCorrectionRequests(): Promise<DataCorrectionRequest[]> {
  return prisma.dataCorrectionRequest.findMany({
    where: { status: { in: ['pending', 'in_progress'] } },
    orderBy: { createdAt: 'asc' },
  }) as Promise<DataCorrectionRequest[]>;
}

export async function updateCorrectionRequest(
  id: string,
  data: {
    status: string;
    processedByAgentId?: string;
    processedAt?: Date;
    processNotes?: string;
  },
): Promise<DataCorrectionRequest> {
  return prisma.dataCorrectionRequest.update({
    where: { id },
    data: data as never,
  }) as Promise<DataCorrectionRequest>;
}

// Used by compliance.service to auto-apply approved corrections without service calling Prisma directly
export async function updateSellerField(
  sellerId: string,
  field: string,
  value: string,
): Promise<void> {
  await prisma.seller.update({
    where: { id: sellerId },
    data: { [field]: value },
  });
}

export async function getSellerPersonalData(sellerId: string) {
  const seller = await prisma.seller.findUnique({
    where: { id: sellerId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,
      consentService: true,
      consentMarketing: true,
      notificationPreference: true,
      createdAt: true,
      consentRecords: {
        orderBy: { consentGivenAt: 'asc' },
      },
      properties: {
        select: {
          id: true,
          town: true,
          street: true,
          block: true,
          flatType: true,
          askingPrice: true,
          status: true,
          viewings: {
            select: {
              scheduledAt: true,
              status: true,
            },
            orderBy: { scheduledAt: 'desc' },
            take: 20,
          },
        },
      },
    },
  });

  if (!seller) return null;

  // CddRecord uses polymorphic subjectType/subjectId — not a direct Seller relation
  const cddRecords = await prisma.cddRecord.findMany({
    where: { subjectType: SubjectType.seller, subjectId: sellerId },
    select: { nricLast4: true, identityVerified: true, verifiedAt: true },
    orderBy: { createdAt: 'desc' },
    take: 1,
  });

  return { ...seller, cddRecords };
}

// ─── Retention Scanning ───────────────────────────────────────────────────────

export async function findLeadsForRetention(cutoffDate: Date) {
  // Leads (no transaction) with no activity since cutoffDate
  return prisma.seller.findMany({
    where: {
      status: { in: ['lead', 'engaged'] },
      transactions: { none: {} },
      updatedAt: { lt: cutoffDate },
    },
    select: { id: true, name: true, updatedAt: true },
  });
}

export async function findServiceWithdrawnForDeletion(cutoffDate: Date) {
  // Sellers with service consent withdrawn > 30 days ago and no transactions
  return prisma.seller.findMany({
    where: {
      consentService: false,
      transactions: { none: {} },
      updatedAt: { lt: cutoffDate },
    },
    select: { id: true, name: true, updatedAt: true },
  });
}

export async function findTransactionsForRetention(cutoffDate: Date) {
  // Completed transactions with completion date > 5 years ago
  return prisma.transaction.findMany({
    where: {
      status: 'completed',
      completionDate: { lt: cutoffDate },
    },
    select: { id: true, sellerId: true, completionDate: true },
  });
}

export async function findCddRecordsForRetention(cutoffDate: Date) {
  // CDD records with verifiedAt > 5 years ago and documents still on disk
  return prisma.cddRecord.findMany({
    where: {
      verifiedAt: { lt: cutoffDate },
      documents: { not: '[]' },
    },
    select: { id: true, subjectId: true, documents: true, verifiedAt: true },
  });
}

export async function findConsentRecordsForDeletion(cutoffDate: Date) {
  // Withdrawn consent records older than 1 year post-withdrawal
  return prisma.consentRecord.findMany({
    where: {
      consentWithdrawnAt: { lt: cutoffDate, not: null },
    },
    select: { id: true, subjectId: true, consentWithdrawnAt: true },
  });
}

export async function findExistingDeletionRequest(
  targetType: string,
  targetId: string,
): Promise<{ id: string; status: string } | null> {
  return prisma.dataDeletionRequest.findFirst({
    where: { targetType: targetType as never, targetId },
    select: { id: true, status: true },
  });
}

export async function findStaleCorrectionRequests(cutoffDate: Date) {
  return prisma.dataCorrectionRequest.findMany({
    where: {
      status: { in: ['pending', 'in_progress'] },
      createdAt: { lt: cutoffDate },
    },
    select: {
      id: true,
      sellerId: true,
      fieldName: true,
      createdAt: true,
      seller: { select: { agentId: true } },
    },
  });
}

// ─── Hard Delete ─────────────────────────────────────────────────────────────

export async function hardDeleteSeller(sellerId: string): Promise<void> {
  // Cascades to related personal data entities via Prisma cascades defined in schema
  await prisma.seller.delete({ where: { id: sellerId } });
}

export async function hardDeleteCddDocuments(
  cddRecordId: string,
  documentPaths: string[],
): Promise<void> {
  // Removes document file paths from the JSON array — marks them as deleted
  const deletedAt = new Date().toISOString();
  const updatedDocs = documentPaths.map((path) => ({
    deletedFromServer: true,
    deletedAt,
    originalPath: path,
  }));
  await prisma.cddRecord.update({
    where: { id: cddRecordId },
    data: { documents: updatedDocs },
  });
}

export async function hardDeleteConsentRecord(consentRecordId: string): Promise<void> {
  await prisma.consentRecord.delete({ where: { id: consentRecordId } });
}

export async function hardDeleteTransaction(transactionId: string): Promise<void> {
  // Cascades to OTP, CommissionInvoice, EstateAgencyAgreement via Prisma schema cascades
  await prisma.transaction.delete({ where: { id: transactionId } });
}

// ─── Agent Anonymisation ──────────────────────────────────────────────────────

export async function anonymiseAgentRecord(agentId: string): Promise<void> {
  await prisma.agent.update({
    where: { id: agentId },
    data: {
      name: `Former Agent ${agentId}`,
      email: `anonymised-${agentId}@deleted.local`,
      phone: `anonymised-${agentId}`,
    },
  });
}

export async function findAgentById(agentId: string) {
  return prisma.agent.findUnique({
    where: { id: agentId },
    select: { id: true, name: true, email: true, phone: true, isActive: true },
  });
}
