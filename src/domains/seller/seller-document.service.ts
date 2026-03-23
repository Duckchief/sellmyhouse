import * as path from 'path';
import { createId } from '@paralleldrive/cuid2';
import { fileTypeFromBuffer } from 'file-type';
import * as sellerDocRepo from './seller-document.repository';
import * as sellerRepo from './seller.repository';
import { encryptedStorage } from '@/infra/storage/encrypted-storage';
import { scanBuffer } from '@/infra/security/virus-scanner';
import * as auditService from '../shared/audit.service';
import * as notificationService from '../notification/notification.service';
import { ValidationError, NotFoundError, ForbiddenError } from '../shared/errors';
import {
  SELLER_DOC_TYPES,
  SELLER_DOC_MAX_FILES,
  SELLER_DOC_ALLOWED_MIMES,
  type SellerDocType,
  type UploadSellerDocumentInput,
  type SellerDocumentRecord,
} from './seller.types';
import type { SellerDocument } from '@prisma/client';

export async function uploadSellerDocument(
  input: UploadSellerDocumentInput,
): Promise<SellerDocumentRecord> {
  // Validate docType
  if (!SELLER_DOC_TYPES.includes(input.docType)) {
    throw new ValidationError('Invalid document type');
  }

  // Check file count limit
  const maxFiles = SELLER_DOC_MAX_FILES[input.docType];
  const currentCount = await sellerDocRepo.countActiveBySellerAndDocType(
    input.sellerId,
    input.docType,
  );
  if (currentCount >= maxFiles) {
    throw new ValidationError(`Maximum ${maxFiles} files allowed for ${input.docType}`);
  }

  // Verify MIME from actual bytes
  const detected = await fileTypeFromBuffer(input.fileBuffer);
  if (!detected || !SELLER_DOC_ALLOWED_MIMES.includes(detected.mime)) {
    throw new ValidationError('File content does not match a valid image or PDF');
  }

  // Virus scan — fail-closed
  const scan = await scanBuffer(input.fileBuffer, input.originalFilename);
  if (!scan.isClean) {
    await auditService.log({
      actorType: input.uploadedByRole,
      actorId: input.uploadedBy,
      action: 'seller_document.scan_rejected',
      entityType: 'seller',
      entityId: input.sellerId,
      details: { filename: input.originalFilename, viruses: scan.viruses },
    });
    throw new ValidationError('File rejected: security scan failed');
  }

  // Encrypt + save
  const docId = createId();
  const ext = path.extname(input.originalFilename).toLowerCase() || '.bin';
  const filePath = `seller-docs/${input.sellerId}/${input.docType}-${docId}${ext}.enc`;
  const { path: savedPath, wrappedKey } = await encryptedStorage.save(filePath, input.fileBuffer);

  // Determine slot index
  const slotIndex = maxFiles > 1 ? currentCount : null;

  // Persist to DB
  const doc = await sellerDocRepo.create({
    sellerId: input.sellerId,
    docType: input.docType,
    slotIndex,
    path: savedPath,
    wrappedKey,
    mimeType: detected.mime,
    sizeBytes: input.fileBuffer.length,
    uploadedBy: input.uploadedBy,
  });

  // Notify agent (in-app only)
  const seller = await sellerRepo.findById(input.sellerId);
  if (seller?.agentId) {
    await notificationService.createInAppNotification({
      recipientType: 'agent',
      recipientId: seller.agentId,
      templateName: 'seller_document_uploaded',
      content: `${seller.name} uploaded a document (${input.docType})`,
    });
  }

  // Audit log
  await auditService.log({
    actorType: input.uploadedByRole,
    actorId: input.uploadedBy,
    action: 'seller_document.uploaded',
    entityType: 'seller',
    entityId: input.sellerId,
    details: {
      documentId: doc.id,
      docType: input.docType,
      sizeBytes: doc.sizeBytes,
      uploadedByRole: input.uploadedByRole,
    },
  });

  return doc;
}

export async function downloadAndDeleteSellerDocument(
  documentId: string,
  agentId: string,
): Promise<{ buffer: Buffer; mimeType: string; docType: string }> {
  const doc = await sellerDocRepo.findById(documentId);
  if (!doc) throw new NotFoundError('SellerDocument', documentId);
  if (doc.deletedAt) throw new ForbiddenError('This document has already been deleted');

  // Decrypt in memory
  const buffer = await encryptedStorage.read(doc.path, doc.wrappedKey);

  // Hard-delete file from disk
  await encryptedStorage.delete(doc.path);

  // Mark row as downloaded + deleted
  await sellerDocRepo.markDownloadedAndDeleted(documentId, agentId);

  await auditService.log({
    agentId,
    action: 'seller_document.downloaded_and_deleted',
    entityType: 'seller',
    entityId: doc.sellerId,
    details: { documentId, docType: doc.docType },
  });

  return { buffer, mimeType: doc.mimeType, docType: doc.docType };
}

export async function downloadAllAndDeleteSellerDocuments(
  sellerId: string,
  agentId: string,
): Promise<{ files: { buffer: Buffer; filename: string }[]; sellerId: string }> {
  const docs = await sellerDocRepo.findActiveBySeller(sellerId);
  if (docs.length === 0) throw new NotFoundError('SellerDocuments', sellerId);

  const files: { buffer: Buffer; filename: string }[] = [];

  for (const doc of docs) {
    const buffer = await encryptedStorage.read(doc.path, doc.wrappedKey);
    const ext = path.extname(doc.path).replace('.enc', '');
    files.push({ buffer, filename: `${doc.docType}-${doc.id}${ext}` });

    await encryptedStorage.delete(doc.path);
    await sellerDocRepo.markDownloadedAndDeleted(doc.id, agentId);
  }

  await auditService.log({
    agentId,
    action: 'seller_document.bulk_downloaded_and_deleted',
    entityType: 'seller',
    entityId: sellerId,
    details: { documentCount: docs.length, docTypes: docs.map((d) => d.docType) },
  });

  return { files, sellerId };
}

export async function deleteSellerDocumentBySeller(
  documentId: string,
  sellerId: string,
): Promise<void> {
  const doc = await sellerDocRepo.findById(documentId);
  if (!doc) throw new NotFoundError('SellerDocument', documentId);
  if (doc.sellerId !== sellerId) throw new ForbiddenError('You do not own this document');
  if (doc.downloadedAt) throw new ForbiddenError('This document has already been received by your agent');

  await encryptedStorage.delete(doc.path);
  await sellerDocRepo.hardDelete(documentId);

  await auditService.log({
    actorType: 'seller',
    actorId: sellerId,
    action: 'seller_document.deleted_by_seller',
    entityType: 'seller',
    entityId: sellerId,
    details: { documentId, docType: doc.docType },
  });
}

export async function getActiveDocumentsForSeller(
  sellerId: string,
): Promise<SellerDocument[]> {
  return sellerDocRepo.findActiveBySeller(sellerId);
}

// ─── Checklist Status Derivation ─────────────────────────────────────────────

const DOC_TYPE_TO_CHECKLIST_ID: Record<string, string> = {
  nric: 'nric',
  marriage_cert: 'marriage-cert',
  eligibility_letter: 'eligibility-letter',
  otp_scan: 'otp-scan',
  eaa: 'estate-agency-agreement',
};

const CHECKLIST_ID_TO_DOC_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(DOC_TYPE_TO_CHECKLIST_ID).map(([k, v]) => [v, k]),
);

export async function getDocumentChecklistWithStatus(
  sellerId: string,
  propertyStatus: string | null,
): Promise<import('./seller.types').DocumentChecklistItem[]> {
  // Get base checklist (filtered by stage)
  const { getDocumentChecklist } = await import('./seller.service');
  const checklist = getDocumentChecklist(propertyStatus);

  // Get all documents (including deleted) for status derivation
  const allDocs = await sellerDocRepo.findAllBySeller(sellerId);

  // Derive status per checklist item
  return checklist.map((item) => {
    const docType = CHECKLIST_ID_TO_DOC_TYPE[item.id];
    if (!docType) return item; // 'other' has no checklist entry

    const docsForType = allDocs.filter((d) => d.docType === docType);
    if (docsForType.length === 0) return { ...item, status: 'not_uploaded' as const };

    const hasActive = docsForType.some((d) => d.deletedAt === null);
    if (hasActive) return { ...item, status: 'uploaded' as const };

    return { ...item, status: 'received_by_agent' as const };
  });
}

// ─── Auto-Purge (7-day backstop) ────────────────────────────────────────────

export async function purgeExpiredSellerDocuments(retentionDays: number): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  const expired = await sellerDocRepo.findExpiredUnpurged(cutoff);

  for (const doc of expired) {
    try {
      await encryptedStorage.delete(doc.path);
    } catch {
      // File may already be gone — continue with DB cleanup
    }
    await sellerDocRepo.markPurged(doc.id);
  }

  if (expired.length > 0) {
    await auditService.log({
      actorType: 'system',
      action: 'seller_document.auto_purged',
      entityType: 'system',
      entityId: 'seller_document_purge',
      details: { count: expired.length, cutoffDate: cutoff.toISOString() },
    });
  }

  return expired.length;
}
