// src/domains/compliance/compliance.repository.ts
import { createId } from '@paralleldrive/cuid2';
import { Prisma } from '@prisma/client';
import { prisma } from '@/infra/database/prisma';
import type { ConsentRecord, DataDeletionRequest } from './compliance.types';

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
  return prisma.dataDeletionRequest.findUnique({ where: { id } }) as Promise<DataDeletionRequest | null>;
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

export async function findSellerWithTransactions(
  sellerId: string,
): Promise<{ status: string; transactions: { completionDate: Date | null; status: string }[] } | null> {
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
