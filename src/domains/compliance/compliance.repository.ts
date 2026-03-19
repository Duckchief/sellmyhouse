// src/domains/compliance/compliance.repository.ts
import { createId } from '@paralleldrive/cuid2';
import { Prisma, SubjectType } from '@prisma/client';
import { prisma } from '@/infra/database/prisma';
import type {
  ConsentRecord,
  DataDeletionRequest,
  DataCorrectionRequest,
  CreateCorrectionRequestInput,
  CreateCddRecordInput,
  CddRecord,
  CreateEaaInput,
  EaaRecord,
  ConfirmEaaExplanationInput,
  CddDocument,
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
      subjectId: data.subjectId, // legacy column — kept for data continuity
      sellerId: data.subjectId,
      purposeService: data.purposeService,
      purposeMarketing: data.purposeMarketing,
      consentWithdrawnAt: data.consentWithdrawnAt ?? null,
      withdrawalChannel: data.withdrawalChannel ?? null,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
    },
  });
}

export async function createViewerConsentRecord(data: {
  viewerId: string;
  subjectId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<ConsentRecord> {
  return prisma.consentRecord.create({
    data: {
      id: createId(),
      subjectType: 'viewer',
      subjectId: data.subjectId,
      viewerId: data.viewerId,
      purposeService: true,
      purposeMarketing: false,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
    },
  });
}

export async function findLatestConsentRecord(sellerId: string): Promise<ConsentRecord | null> {
  return prisma.consentRecord.findFirst({
    // Legacy: subjectId/subjectType retained in DB until explicit FK migration is complete
    where: { sellerId },
    orderBy: { consentGivenAt: 'desc' },
  });
}

export async function findLatestSellerCddRecord(sellerId: string) {
  return prisma.cddRecord.findFirst({
    where: { subjectType: SubjectType.seller, subjectId: sellerId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function findCddRecordByTransactionAndSubjectType(
  transactionId: string,
  subjectType: string,
) {
  return prisma.cddRecord.findFirst({
    where: {
      subjectType: subjectType as SubjectType,
      subjectId: transactionId,
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createCddRecord(data: CreateCddRecordInput): Promise<CddRecord> {
  const retentionExpiresAt = new Date();
  retentionExpiresAt.setDate(retentionExpiresAt.getDate() + 7); // 7-day post-processing retention
  return prisma.cddRecord.create({
    data: {
      id: createId(),
      subjectType: data.subjectType as SubjectType,
      subjectId: data.subjectId,
      fullName: data.fullName,
      nricLast4: data.nricLast4,
      verifiedByAgentId: data.verifiedByAgentId,
      dateOfBirth: data.dateOfBirth ?? null,
      nationality: data.nationality ?? null,
      occupation: data.occupation ?? null,
      documents: (data.documents ?? []) as Prisma.InputJsonValue,
      riskLevel: data.riskLevel ?? undefined,
      notes: data.notes ?? null,
      retentionExpiresAt,
    },
  }) as unknown as Promise<CddRecord>;
}

export async function upsertCddStatus(
  sellerId: string,
  agentId: string,
  status: 'pending' | 'verified',
): Promise<void> {
  const identityVerified = status === 'verified';
  const verifiedAt = status === 'verified' ? new Date() : null;

  const existing = await prisma.cddRecord.findFirst({
    where: { subjectType: SubjectType.seller, subjectId: sellerId },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) {
    await prisma.cddRecord.update({
      where: { id: existing.id },
      data: { identityVerified, verifiedAt, verifiedByAgentId: agentId },
    });
  } else {
    const retentionExpiresAt = new Date();
    retentionExpiresAt.setDate(retentionExpiresAt.getDate() + 7);
    await prisma.cddRecord.create({
      data: {
        id: createId(),
        subjectType: SubjectType.seller,
        subjectId: sellerId,
        fullName: '–',
        nricLast4: '0000',
        verifiedByAgentId: agentId,
        identityVerified,
        verifiedAt,
        retentionExpiresAt,
      },
    });
  }
}

export async function findSellerCddRecord(
  sellerId: string,
): Promise<{ id: string; identityVerified: boolean } | null> {
  return prisma.cddRecord.findFirst({
    where: { subjectType: SubjectType.seller, subjectId: sellerId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, identityVerified: true },
  });
}

export async function deleteCddRecord(sellerId: string): Promise<void> {
  const existing = await prisma.cddRecord.findFirst({
    where: { subjectType: SubjectType.seller, subjectId: sellerId },
    orderBy: { createdAt: 'desc' },
  });
  if (!existing) return;
  await prisma.cddRecord.delete({ where: { id: existing.id } });
}

export async function refreshCddRetentionOnCompletion(
  transactionId: string,
  sellerId: string,
): Promise<void> {
  const newExpiry = new Date();
  newExpiry.setDate(newExpiry.getDate() + 7);
  await prisma.cddRecord.updateMany({
    where: {
      OR: [{ subjectId: transactionId }, { subjectType: SubjectType.seller, subjectId: sellerId }],
    },
    data: { retentionExpiresAt: newExpiry },
  });
}

export async function findAllConsentRecords(sellerId: string): Promise<ConsentRecord[]> {
  return prisma.consentRecord.findMany({
    // Legacy: subjectId/subjectType retained in DB until explicit FK migration is complete
    where: { sellerId },
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

// ─── Tier 1: Sensitive Document Purge ────────────────────────────────────────

export async function findCompletedTransactionsForDocPurge(cutoffDate: Date) {
  return prisma.transaction.findMany({
    where: {
      status: { in: ['completed', 'fallen_through'] },
      completionDate: { lt: cutoffDate, not: null },
    },
    select: {
      id: true,
      sellerId: true,
      completionDate: true,
      otp: {
        select: {
          id: true,
          scannedCopyPathSeller: true,
          scannedCopyPathReturned: true,
        },
      },
      commissionInvoice: {
        select: { id: true, invoiceFilePath: true },
      },
    },
  });
}

export async function purgeTransactionSensitiveDocs(
  transactionId: string,
  sellerId: string,
): Promise<{ filePaths: string[] }> {
  const filePaths: string[] = [];

  // Null OTP scan paths
  const otp = await prisma.otp.findUnique({
    where: { transactionId },
    select: { id: true, scannedCopyPathSeller: true, scannedCopyPathReturned: true },
  });
  if (otp) {
    if (otp.scannedCopyPathSeller) filePaths.push(otp.scannedCopyPathSeller);
    if (otp.scannedCopyPathReturned) filePaths.push(otp.scannedCopyPathReturned);
    await prisma.otp.update({
      where: { id: otp.id },
      data: {
        scannedCopyPathSeller: null,
        scannedCopyPathReturned: null,
        scannedCopyDeletedAt: new Date(),
      },
    });
  }

  // Null invoice path
  const invoice = await prisma.commissionInvoice.findUnique({
    where: { transactionId },
    select: { id: true, invoiceFilePath: true },
  });
  if (invoice?.invoiceFilePath) {
    filePaths.push(invoice.invoiceFilePath);
    await prisma.commissionInvoice.update({
      where: { id: invoice.id },
      data: { invoiceFilePath: null, invoiceDeletedAt: new Date() },
    });
  }

  // Clear CDD documents and redact NRIC for seller
  const cddRecords = await prisma.cddRecord.findMany({
    where: { subjectType: SubjectType.seller, subjectId: sellerId },
    select: { id: true, documents: true, nricLast4: true },
  });
  for (const cdd of cddRecords) {
    const docs = (cdd.documents as { path?: string }[] | null) ?? [];
    for (const doc of docs) {
      if (doc.path) filePaths.push(doc.path);
    }
    await prisma.cddRecord.update({
      where: { id: cdd.id },
      data: {
        documents: [],
        nricLast4: 'XXXX',
      },
    });
  }

  // Clear counterparty CDD documents too
  const counterpartyCdd = await prisma.cddRecord.findMany({
    where: { subjectType: SubjectType.counterparty, subjectId: transactionId },
    select: { id: true, documents: true, nricLast4: true },
  });
  for (const cdd of counterpartyCdd) {
    const docs = (cdd.documents as { path?: string }[] | null) ?? [];
    for (const doc of docs) {
      if (doc.path) filePaths.push(doc.path);
    }
    await prisma.cddRecord.update({
      where: { id: cdd.id },
      data: {
        documents: [],
        nricLast4: 'XXXX',
      },
    });
  }

  return { filePaths };
}

// ─── Tier 2: Financial Data Redaction ───────────────────────────────────────

export async function findCompletedTransactionsForFinancialRedaction(cutoffDate: Date) {
  return prisma.transaction.findMany({
    where: {
      status: { in: ['completed', 'fallen_through'] },
      completionDate: { lt: cutoffDate, not: null },
      agreedPrice: { not: 0 },
    },
    select: { id: true, sellerId: true, offerId: true },
  });
}

export async function redactTransactionFinancialData(transactionId: string): Promise<void> {
  await prisma.transaction.update({
    where: { id: transactionId },
    data: { agreedPrice: 0, optionFee: null },
  });

  // Redact all offers for the transaction's property
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { propertyId: true },
  });
  if (tx) {
    await prisma.offer.updateMany({
      where: { propertyId: tx.propertyId },
      data: { offerAmount: 0, counterAmount: null },
    });
  }
}

// ─── Tier 3: Seller PII Anonymisation ───────────────────────────────────────

export async function findCompletedTransactionsForAnonymisation(cutoffDate: Date) {
  // Group by seller — only anonymise when ALL transactions for that seller are past cutoff
  const transactions = await prisma.transaction.findMany({
    where: {
      status: { in: ['completed', 'fallen_through'] },
      completionDate: { lt: cutoffDate, not: null },
      anonymisedAt: null,
    },
    select: {
      id: true,
      sellerId: true,
      completionDate: true,
      seller: {
        select: {
          id: true,
          name: true,
          transactions: {
            select: { id: true, completionDate: true, anonymisedAt: true, status: true },
          },
        },
      },
    },
  });

  // Filter: only include transactions where ALL of the seller's transactions are past cutoff
  return transactions.filter((tx) => {
    return tx.seller.transactions.every(
      (t) =>
        t.anonymisedAt !== null ||
        ((t.status === 'completed' || t.status === 'fallen_through') &&
          t.completionDate !== null &&
          t.completionDate < cutoffDate),
    );
  });
}

export async function anonymiseTransactionSeller(
  transactionId: string,
  sellerId: string,
): Promise<void> {
  // Anonymise seller PII
  await prisma.seller.update({
    where: { id: sellerId },
    data: { name: 'Anonymised Seller', email: null, phone: '' },
  });

  // Anonymise offer counterparty PII
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { propertyId: true },
  });
  if (tx) {
    await prisma.offer.updateMany({
      where: { propertyId: tx.propertyId },
      data: { buyerName: null, buyerPhone: null },
    });
  }

  // Set anonymisedAt
  await prisma.transaction.update({
    where: { id: transactionId },
    data: { anonymisedAt: new Date() },
  });
}

// ─── Dashboard: Pending Document Downloads ──────────────────────────────────

export async function findPendingDocumentDownloads(cutoffDate: Date, agentId?: string) {
  return prisma.transaction.findMany({
    where: {
      status: { in: ['completed', 'fallen_through'] },
      completionDate: { gte: cutoffDate, not: null },
      OR: [
        { otp: { scannedCopyPathSeller: { not: null } } },
        { otp: { scannedCopyPathReturned: { not: null } } },
        { commissionInvoice: { invoiceFilePath: { not: null } } },
      ],
      ...(agentId ? { seller: { agentId } } : {}),
    },
    select: {
      id: true,
      completionDate: true,
      property: {
        select: { block: true, street: true, town: true },
      },
      otp: {
        select: {
          scannedCopyPathSeller: true,
          scannedCopyPathReturned: true,
        },
      },
      commissionInvoice: {
        select: { invoiceFilePath: true },
      },
    },
    orderBy: { completionDate: 'asc' },
  });
}

// ─── EAA Management ──────────────────────────────────────────────────────────

export async function createEaa(data: CreateEaaInput): Promise<EaaRecord> {
  return prisma.estateAgencyAgreement.create({
    data: {
      id: createId(),
      sellerId: data.sellerId,
      agentId: data.agentId,
      agreementType: (data.agreementType ?? 'non_exclusive') as never,
      commissionAmount: data.commissionAmount ?? 1499,
      commissionGstInclusive: data.commissionGstInclusive ?? false,
      coBrokingAllowed: data.coBrokingAllowed ?? true,
      coBrokingTerms:
        data.coBrokingTerms ??
        "Co-broking welcomed. Commission is not shared. Buyer's agent is paid by their own client.",
      expiryDate: data.expiryDate ?? null,
      status: 'draft' as never,
    },
  }) as unknown as Promise<EaaRecord>;
}

export async function findEaaBySellerId(sellerId: string): Promise<EaaRecord | null> {
  return prisma.estateAgencyAgreement.findFirst({
    where: { sellerId },
    orderBy: { createdAt: 'desc' },
  }) as unknown as Promise<EaaRecord | null>;
}

export async function updateEaaStatus(
  eaaId: string,
  status: string,
  signedAt?: Date,
): Promise<EaaRecord> {
  return prisma.estateAgencyAgreement.update({
    where: { id: eaaId },
    data: {
      status: status as never,
      ...(signedAt ? { signedAt } : {}),
    },
  }) as unknown as Promise<EaaRecord>;
}

export async function updateEaaExplanation(input: ConfirmEaaExplanationInput): Promise<EaaRecord> {
  return prisma.estateAgencyAgreement.update({
    where: { id: input.eaaId },
    data: {
      videoCallConfirmedAt: new Date(),
      videoCallNotes: `${input.method}${input.notes ? ': ' + input.notes : ''}`,
    },
  }) as unknown as Promise<EaaRecord>;
}

export async function findEaaById(eaaId: string): Promise<EaaRecord | null> {
  return prisma.estateAgencyAgreement.findUnique({
    where: { id: eaaId },
  }) as unknown as Promise<EaaRecord | null>;
}

// ─── Retention Scanning ───────────────────────────────────────────────────────

export async function findLeadsForRetention(
  cutoffDate: Date,
): Promise<{ id: string; name: string; updatedAt: Date }[]> {
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

export async function findServiceWithdrawnForDeletion(
  cutoffDate: Date,
): Promise<{ id: string; name: string; consentWithdrawnAt: Date | null }[]> {
  return prisma.seller.findMany({
    where: {
      consentService: false,
      consentWithdrawnAt: { lt: cutoffDate, not: null },
      transactions: { none: {} },
    },
    select: { id: true, name: true, consentWithdrawnAt: true },
  });
}

export async function findTransactionsForRetention(
  cutoffDate: Date,
): Promise<{ id: string; sellerId: string; completionDate: Date | null }[]> {
  // Completed transactions with completion date > 5 years ago
  return prisma.transaction.findMany({
    where: {
      status: 'completed',
      completionDate: { lt: cutoffDate },
    },
    select: { id: true, sellerId: true, completionDate: true },
  });
}

export async function findTransactionsCompletedBeforeForNric(
  cutoffDate: Date,
): Promise<{ id: string; sellerId: string }[]> {
  // Completed transactions whose completionDate is older than cutoffDate (30 days ago)
  return prisma.transaction.findMany({
    where: {
      status: 'completed',
      completionDate: { lt: cutoffDate, not: null },
    },
    select: { id: true, sellerId: true },
  });
}

export async function redactNricFromCddRecord(cddRecordId: string): Promise<void> {
  // Overwrite nricLast4 with a redacted placeholder — field is NOT NULL so cannot be nulled
  await prisma.cddRecord.update({
    where: { id: cddRecordId },
    data: { nricLast4: 'XXXX' },
  });
}

export async function findCddRecordsForRetention(
  cutoffDate: Date,
): Promise<{ id: string; subjectId: string; documents: unknown; verifiedAt: Date | null }[]> {
  // CDD records with verifiedAt > 5 years ago and documents still on disk
  return prisma.cddRecord.findMany({
    where: {
      verifiedAt: { lt: cutoffDate },
      documents: { not: '[]' },
    },
    select: { id: true, subjectId: true, documents: true, verifiedAt: true },
  });
}

export async function findConsentRecordsForDeletion(
  cutoffDate: Date,
): Promise<
  { id: string; sellerId: string | null; subjectId: string; consentWithdrawnAt: Date | null }[]
> {
  // Withdrawn consent records older than 1 year post-withdrawal
  return prisma.consentRecord.findMany({
    where: {
      consentWithdrawnAt: { lt: cutoffDate, not: null },
    },
    select: { id: true, sellerId: true, subjectId: true, consentWithdrawnAt: true },
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

export async function findStaleCorrectionRequests(cutoffDate: Date): Promise<
  {
    id: string;
    sellerId: string;
    fieldName: string;
    createdAt: Date;
    seller: { agentId: string | null } | null;
  }[]
> {
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
  // Delete in FK dependency order — none of these have schema-level cascade to seller
  // 1. Testimonial references both seller and transaction
  await prisma.testimonial.deleteMany({ where: { sellerId } });
  // 2. Otp and CommissionInvoice reference transaction (which references seller)
  const txIds = await prisma.transaction.findMany({
    where: { sellerId },
    select: { id: true },
  });
  if (txIds.length > 0) {
    const ids = txIds.map((t) => t.id);
    await prisma.otp.deleteMany({ where: { transactionId: { in: ids } } });
    await prisma.commissionInvoice.deleteMany({ where: { transactionId: { in: ids } } });
    await prisma.transaction.deleteMany({ where: { sellerId } });
  }
  await prisma.estateAgencyAgreement.deleteMany({ where: { sellerId } });
  await prisma.property.deleteMany({ where: { sellerId } });
  // 3. Referrals: delete referrals given by this seller; nullify referredSellerId on referrals received
  await prisma.referral.deleteMany({ where: { referrerSellerId: sellerId } });
  await prisma.referral.updateMany({
    where: { referredSellerId: sellerId },
    data: { referredSellerId: null },
  });
  await prisma.seller.delete({ where: { id: sellerId } });
}

export async function hardDeleteCddDocuments(cddRecordId: string): Promise<void> {
  // Physical files already deleted by service via fs.unlink() before this is called
  // Clear the documents JSON to empty array — no PII retained
  await prisma.cddRecord.update({
    where: { id: cddRecordId },
    data: { documents: [] },
  });
}

export async function hardDeleteConsentRecord(consentRecordId: string): Promise<void> {
  await prisma.consentRecord.delete({ where: { id: consentRecordId } });
}

export async function hardDeleteTransaction(transactionId: string): Promise<void> {
  // Delete child records in FK-safe order — no schema-level cascade configured
  await prisma.testimonial.deleteMany({ where: { transactionId } });
  await prisma.otp.deleteMany({ where: { transactionId } });
  await prisma.commissionInvoice.deleteMany({ where: { transactionId } });
  await prisma.transaction.delete({ where: { id: transactionId } });
}

// ─── File Path Collection (for PDPA hard-delete) ──────────────────────────────

/**
 * Collects all file paths associated with a seller before the delete cascade runs.
 * Returns an array of storage-relative paths suitable for localStorage.delete().
 */
export async function collectSellerFilePaths(sellerId: string): Promise<string[]> {
  const paths: string[] = [];

  // 1. Property listing photos (stored as JSON array of PhotoRecord objects)
  const properties = await prisma.property.findMany({
    where: { sellerId },
    select: {
      listings: {
        select: { photos: true },
      },
    },
  });
  for (const property of properties) {
    for (const listing of property.listings) {
      const photos = (listing.photos ?? []) as { path?: string; optimizedPath?: string }[];
      for (const photo of photos) {
        if (photo.path) paths.push(photo.path);
        if (photo.optimizedPath) paths.push(photo.optimizedPath);
      }
    }
  }

  // 2. OTP scanned copies (seller copy + returned copy)
  const otps = await prisma.otp.findMany({
    where: { transaction: { sellerId } },
    select: { scannedCopyPathSeller: true, scannedCopyPathReturned: true },
  });
  for (const otp of otps) {
    if (otp.scannedCopyPathSeller) paths.push(otp.scannedCopyPathSeller);
    if (otp.scannedCopyPathReturned) paths.push(otp.scannedCopyPathReturned);
  }

  // 3. Commission invoice PDFs
  const invoices = await prisma.commissionInvoice.findMany({
    where: { transaction: { sellerId } },
    select: { invoiceFilePath: true },
  });
  for (const invoice of invoices) {
    if (invoice.invoiceFilePath) paths.push(invoice.invoiceFilePath);
  }

  // 4. CDD document .enc files (seller CDD records only)
  const cddRecords = await prisma.cddRecord.findMany({
    where: { subjectType: SubjectType.seller, subjectId: sellerId },
    select: { documents: true },
  });
  for (const cdd of cddRecords) {
    const docs = (cdd.documents as { path?: string }[] | null) ?? [];
    for (const doc of docs) {
      if (doc.path) paths.push(doc.path);
    }
  }

  return paths;
}

/**
 * Collects file paths associated with a single transaction before hard-delete.
 * Returns an array of storage-relative paths suitable for localStorage.delete().
 */
export async function collectTransactionFilePaths(transactionId: string): Promise<string[]> {
  const paths: string[] = [];

  const otp = await prisma.otp.findUnique({
    where: { transactionId },
    select: { scannedCopyPathSeller: true, scannedCopyPathReturned: true },
  });
  if (otp) {
    if (otp.scannedCopyPathSeller) paths.push(otp.scannedCopyPathSeller);
    if (otp.scannedCopyPathReturned) paths.push(otp.scannedCopyPathReturned);
  }

  const invoice = await prisma.commissionInvoice.findUnique({
    where: { transactionId },
    select: { invoiceFilePath: true },
  });
  if (invoice?.invoiceFilePath) paths.push(invoice.invoiceFilePath);

  return paths;
}

// ─── Secure Document Access ───────────────────────────────────────────────────

export async function findTransactionDocuments(transactionId: string) {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: {
      id: true,
      status: true,
      sellerId: true,
      seller: { select: { agentId: true } },
      otp: {
        select: {
          id: true,
          scannedCopyPathSeller: true,
          scannedCopyPathReturned: true,
          scannedCopyDeletedAt: true,
        },
      },
      commissionInvoice: {
        select: {
          id: true,
          invoiceFilePath: true,
          invoiceDeletedAt: true,
        },
      },
      estateAgencyAgreement: {
        select: {
          id: true,
        },
      },
    },
  });
  return tx;
}

export async function findCddRecordsByTransaction(transactionId: string) {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { sellerId: true },
  });
  if (!tx) return [];
  return prisma.cddRecord.findMany({
    where: { subjectId: tx.sellerId, subjectType: 'seller' },
    select: { id: true, documents: true },
  });
}

export async function markOtpScannedCopyDeleted(otpId: string): Promise<void> {
  await prisma.otp.update({
    where: { id: otpId },
    data: {
      scannedCopyPathSeller: null,
      scannedCopyPathReturned: null,
      scannedCopyDeletedAt: new Date(),
    },
  });
}

export async function markInvoiceDeleted(invoiceId: string): Promise<void> {
  await prisma.commissionInvoice.update({
    where: { id: invoiceId },
    data: { invoiceFilePath: null, invoiceDeletedAt: new Date() },
  });
}

// ─── Viewer and Buyer Retention ───────────────────────────────────────────────

export async function findVerifiedViewersForRetention(
  cutoffDate: Date,
): Promise<{ id: string; name: string; phone: string }[]> {
  return prisma.verifiedViewer.findMany({
    where: {
      retentionExpiresAt: { lt: cutoffDate },
      phoneVerifiedAt: { not: null },
    },
    select: { id: true, name: true, phone: true },
  });
}

export async function anonymiseVerifiedViewerRecords(viewerIds: string[]): Promise<void> {
  if (viewerIds.length === 0) return;
  await prisma.verifiedViewer.updateMany({
    where: { id: { in: viewerIds } },
    data: { name: 'Anonymised Viewer', phone: '' },
  });
}

export async function findBuyersForRetention(
  cutoffDate: Date,
): Promise<{ id: string; name: string; email: string | null; phone: string }[]> {
  return prisma.buyer.findMany({
    where: { retentionExpiresAt: { lt: cutoffDate } },
    select: { id: true, name: true, email: true, phone: true },
  });
}

export async function anonymiseBuyerRecords(buyerIds: string[]): Promise<void> {
  if (buyerIds.length === 0) return;
  await prisma.buyer.updateMany({
    where: { id: { in: buyerIds } },
    data: { name: 'Anonymised Buyer', email: null, phone: '' },
  });
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

export async function findSensitiveCaseBySellerId(sellerId: string): Promise<boolean> {
  const cdd = await prisma.cddRecord.findFirst({
    where: { subjectType: 'seller', subjectId: sellerId, sensitiveCase: true },
    select: { id: true },
  });
  return !!cdd;
}

export async function findAgentById(
  agentId: string,
): Promise<{ id: string; name: string; email: string; phone: string; isActive: boolean } | null> {
  return prisma.agent.findUnique({
    where: { id: agentId },
    select: { id: true, name: true, email: true, phone: true, isActive: true },
  });
}

// ─── CDD Document Management ──────────────────────────────────────────────────

export async function findCddRecordById(id: string): Promise<CddRecord | null> {
  return prisma.cddRecord.findUnique({
    where: { id },
  }) as unknown as Promise<CddRecord | null>;
}

export async function addCddDocument(cddRecordId: string, doc: CddDocument): Promise<void> {
  const record = await prisma.cddRecord.findUnique({
    where: { id: cddRecordId },
    select: { documents: true },
  });
  const existing = (record?.documents as unknown as CddDocument[]) ?? [];
  await prisma.cddRecord.update({
    where: { id: cddRecordId },
    data: { documents: [...existing, doc] as unknown as Prisma.InputJsonValue },
  });
}

export async function removeCddDocument(
  cddRecordId: string,
  documentId: string,
): Promise<string | null> {
  const record = await prisma.cddRecord.findUnique({
    where: { id: cddRecordId },
    select: { documents: true },
  });
  const existing = (record?.documents as unknown as CddDocument[]) ?? [];
  const target = existing.find((d) => d.id === documentId);
  if (!target) return null;

  await prisma.cddRecord.update({
    where: { id: cddRecordId },
    data: {
      documents: existing.filter((d) => d.id !== documentId) as unknown as Prisma.InputJsonValue,
    },
  });
  return target.path;
}

export async function findCddRecordWithDocument(
  cddRecordId: string,
  documentId: string,
): Promise<{ verifiedByAgentId: string; document: CddDocument | null } | null> {
  const record = await prisma.cddRecord.findUnique({
    where: { id: cddRecordId },
    select: { verifiedByAgentId: true, documents: true },
  });
  if (!record) return null;
  const docs = (record.documents as unknown as CddDocument[]) ?? [];
  return {
    verifiedByAgentId: record.verifiedByAgentId,
    document: docs.find((d) => d.id === documentId) ?? null,
  };
}

// ─── Retention: Listings ────────────────────────────────────────────────────

export async function findClosedListingsForRetention(
  cutoffDate: Date,
): Promise<{ id: string; propertyId: string; updatedAt: Date; photos: unknown }[]> {
  return prisma.listing.findMany({
    where: { status: 'closed', updatedAt: { lt: cutoffDate } },
    select: { id: true, propertyId: true, updatedAt: true, photos: true },
  });
}

export async function hardDeleteListing(listingId: string): Promise<void> {
  // Delete child PortalListings before the Listing (FK RESTRICT)
  await prisma.portalListing.deleteMany({ where: { listingId } });
  await prisma.listing.delete({ where: { id: listingId } });
}

// ─── Retention: ViewingSlots ─────────────────────────────────────────────────

export async function findOldViewingSlotsForClosedProperties(
  cutoffDate: Date,
): Promise<{ id: string; propertyId: string; date: Date }[]> {
  // Slots whose date passed the cutoff AND whose property has at least one closed listing
  return prisma.viewingSlot.findMany({
    where: {
      date: { lt: cutoffDate },
      property: { listings: { some: { status: 'closed' } } },
    },
    select: { id: true, propertyId: true, date: true },
  });
}

export async function deleteOldViewingSlotsWithViewings(slotIds: string[]): Promise<number> {
  if (slotIds.length === 0) return 0;
  // Finding #5 (PASS): Viewing records are deleted here before ViewingSlots.
  // Viewings reference ViewingSlots with ON DELETE RESTRICT — must delete children first.
  // This ensures feedback/interest rating PII in Viewing rows is removed along with the slot.
  await prisma.viewing.deleteMany({ where: { viewingSlotId: { in: slotIds } } });
  const result = await prisma.viewingSlot.deleteMany({ where: { id: { in: slotIds } } });
  return result.count;
}

// ─── Retention: WeeklyUpdates ────────────────────────────────────────────────

export async function findOldWeeklyUpdates(
  cutoffDate: Date,
): Promise<{ id: string; sellerId: string; createdAt: Date }[]> {
  return prisma.weeklyUpdate.findMany({
    where: { createdAt: { lt: cutoffDate } },
    select: { id: true, sellerId: true, createdAt: true },
  });
}

export async function deleteOldWeeklyUpdates(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await prisma.weeklyUpdate.deleteMany({ where: { id: { in: ids } } });
  return result.count;
}

// ─── SAR: Audit Trail for Data Export (Finding #3) ───────────────────────────

export async function findAuditLogsForSeller(
  sellerId: string,
): Promise<{ id: string; action: string; entityType: string; details: unknown; createdAt: Date }[]> {
  return prisma.auditLog.findMany({
    where: { entityId: sellerId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, action: true, entityType: true, details: true, createdAt: true },
  });
}

// ─── Retention: Inactive Agents (Finding #4) ─────────────────────────────────

export async function findInactiveAgentsForRetention(
  cutoffDate: Date,
): Promise<{ id: string; name: string; email: string }[]> {
  // Targets deactivated agents with no recent activity across all tracked dimensions:
  // - updatedAt proxy covers logins (auth updates failedLoginAttempts, lockouts, password resets)
  // - sellers: no recently active seller assigned to them
  // - hdbSubmissions: no HDB application submissions since cutoff
  return prisma.agent.findMany({
    where: {
      isActive: false,
      updatedAt: { lt: cutoffDate },
      email: { not: { endsWith: '@deleted.local' } }, // skip already-anonymised records
      hdbSubmissions: { none: { createdAt: { gte: cutoffDate } } },
      sellers: { none: { updatedAt: { gte: cutoffDate } } },
    },
    select: { id: true, name: true, email: true },
  });
}
