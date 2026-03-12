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
    where: { status: { in: ['flagged', 'pending_review'] as never[] } },
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
