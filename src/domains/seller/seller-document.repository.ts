import { prisma } from '@/infra/database/prisma';
import type { SellerDocument } from '@prisma/client';

export async function create(data: {
  sellerId: string;
  docType: string;
  slotIndex?: number | null;
  path: string;
  wrappedKey: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
}): Promise<SellerDocument> {
  return prisma.sellerDocument.create({ data });
}

export async function findById(id: string): Promise<SellerDocument | null> {
  return prisma.sellerDocument.findFirst({ where: { id } });
}

export async function findActiveBySeller(sellerId: string): Promise<SellerDocument[]> {
  return prisma.sellerDocument.findMany({
    where: { sellerId, deletedAt: null },
    orderBy: [{ docType: 'asc' }, { slotIndex: 'asc' }],
  });
}

export async function findAllBySeller(sellerId: string): Promise<SellerDocument[]> {
  return prisma.sellerDocument.findMany({
    where: { sellerId },
    orderBy: [{ docType: 'asc' }, { slotIndex: 'asc' }],
  });
}

export async function findActiveBySellerAndDocType(
  sellerId: string,
  docType: string,
): Promise<SellerDocument[]> {
  return prisma.sellerDocument.findMany({
    where: { sellerId, docType, deletedAt: null },
    orderBy: { slotIndex: 'asc' },
  });
}

export async function countActiveBySellerAndDocType(
  sellerId: string,
  docType: string,
): Promise<number> {
  return prisma.sellerDocument.count({
    where: { sellerId, docType, deletedAt: null },
  });
}

export async function markDownloadedAndDeleted(
  id: string,
  downloadedBy: string,
): Promise<SellerDocument> {
  const now = new Date();
  return prisma.sellerDocument.update({
    where: { id },
    data: { downloadedAt: now, downloadedBy, deletedAt: now },
  });
}

export async function markPurged(id: string): Promise<void> {
  await prisma.sellerDocument.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

export async function hardDelete(id: string): Promise<void> {
  await prisma.sellerDocument.delete({ where: { id } });
}

export async function findExpiredUnpurged(
  cutoff: Date,
): Promise<{ id: string; path: string; wrappedKey: string; sellerId: string }[]> {
  return prisma.sellerDocument.findMany({
    where: { deletedAt: null, uploadedAt: { lt: cutoff } },
    select: { id: true, path: true, wrappedKey: true, sellerId: true },
  });
}
