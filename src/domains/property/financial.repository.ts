import { prisma } from '@/infra/database/prisma';
import type { Prisma } from '@prisma/client';
import { encrypt, decrypt } from '@/domains/shared/encryption';

// ─── reportData encryption helpers ───────────────────────────────────────────
// Financial data (salePrice, outstandingLoan, CPF refunds) is encrypted at rest
// using AES-256-GCM via the shared encryption module (ENCRYPTION_KEY env var).
// The encrypted string is stored in the Prisma Json column as a JSON string value.
//
// NOTE: Records created before this change contain plaintext JSON objects.
// decryptReportData handles both formats transparently. A one-time migration
// script should be run to encrypt existing plaintext records in production.

function encryptReportData(data: unknown): string {
  return encrypt(JSON.stringify(data));
}

function decryptReportData(reportData: unknown): unknown {
  // Legacy plaintext records are stored as JSON objects — return as-is
  if (typeof reportData !== 'string') return reportData;
  return JSON.parse(decrypt(reportData));
}

function withDecryptedReportData<T extends { reportData: unknown }>(record: T): T {
  return { ...record, reportData: decryptReportData(record.reportData) };
}

// ─── Repository functions ────────────────────────────────────────────────────

export async function create(data: {
  id: string;
  sellerId: string;
  propertyId: string;
  reportData: unknown;
  version?: number;
}) {
  const record = await prisma.financialReport.create({
    data: {
      id: data.id,
      sellerId: data.sellerId,
      propertyId: data.propertyId,
      reportData: encryptReportData(data.reportData) as unknown as Prisma.InputJsonValue,
      version: data.version,
    },
  });
  return withDecryptedReportData(record);
}

export async function findById(id: string) {
  const record = await prisma.financialReport.findUnique({ where: { id } });
  return record ? withDecryptedReportData(record) : null;
}

export async function findLatestForProperty(sellerId: string, propertyId: string) {
  const record = await prisma.financialReport.findFirst({
    where: { sellerId, propertyId },
    orderBy: { version: 'desc' },
  });
  return record ? withDecryptedReportData(record) : null;
}

export async function findAllForSeller(sellerId: string) {
  const records = await prisma.financialReport.findMany({
    where: { sellerId },
    orderBy: { version: 'desc' },
  });
  return records.map(withDecryptedReportData);
}

export async function updateNarrative(
  id: string,
  data: { aiNarrative: string; aiProvider: string; aiModel: string },
) {
  return prisma.financialReport.update({
    where: { id },
    data: {
      aiNarrative: data.aiNarrative,
      aiProvider: data.aiProvider,
      aiModel: data.aiModel,
      status: 'pending_review',
    },
  });
}

export async function approve(id: string, agentId: string, reviewNotes?: string) {
  const now = new Date();
  return prisma.financialReport.update({
    where: { id },
    data: {
      reviewedByAgentId: agentId,
      reviewedAt: now,
      reviewNotes: reviewNotes ?? null,
      approvedAt: now,
      status: 'approved',
    },
  });
}

export async function markSent(id: string, channel: string) {
  return prisma.financialReport.update({
    where: { id },
    data: {
      sentToSellerAt: new Date(),
      sentVia: channel,
      status: 'sent',
    },
  });
}
