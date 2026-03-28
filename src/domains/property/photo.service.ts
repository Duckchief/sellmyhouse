import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { createId } from '@paralleldrive/cuid2';
import { createHash } from 'crypto';
import { localStorage } from '../../infra/storage/local-storage';
import * as propertyRepo from './property.repository';
import * as auditService from '../shared/audit.service';
import { scanBuffer } from '@/infra/security/virus-scanner';
import { NotFoundError, ValidationError, ForbiddenError } from '../shared/errors';
import type { PhotoRecord } from './property.types';
import {
  ALLOWED_MIME_TYPES,
  JPEG_QUALITY,
  MAX_DIMENSION_PX,
  MAX_PHOTO_SIZE_BYTES,
  MAX_PHOTOS,
  MIN_DIMENSION_PX,
} from './property.types';

// ─── Hash Helper ───────────────────────────────────────────────────────────────

function computeHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

// ─── Validate Image ────────────────────────────────────────────────────────────

export async function validateImage(
  buffer: Buffer,
  mimeType: string,
  sizeBytes: number,
): Promise<{ valid: boolean; error?: string }> {
  // Detect MIME type from actual file bytes — client-supplied Content-Type is not trusted
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !(ALLOWED_MIME_TYPES as readonly string[]).includes(detected.mime)) {
    return { valid: false, error: 'Invalid file type detected' };
  }

  if (sizeBytes > MAX_PHOTO_SIZE_BYTES) {
    return {
      valid: false,
      error: `File size exceeds maximum of ${MAX_PHOTO_SIZE_BYTES / (1024 * 1024)}MB`,
    };
  }

  const metadata = await sharp(buffer).metadata();
  const longestEdge = Math.max(metadata.width ?? 0, metadata.height ?? 0);

  if (longestEdge < MIN_DIMENSION_PX) {
    return {
      valid: false,
      error: `Image dimensions too small. Minimum ${MIN_DIMENSION_PX}px on the longest edge`,
    };
  }

  return { valid: true };
}

// ─── Process and Save Photo ────────────────────────────────────────────────────

export interface ProcessedPhotoMetadata {
  id: string;
  filename: string;
  originalFilename: string;
  path: string;
  optimizedPath: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  hash: string;
}

export async function processAndSavePhoto(
  buffer: Buffer,
  originalFilename: string,
  mimeType: string,
  sellerId: string,
  propertyId: string,
): Promise<ProcessedPhotoMetadata> {
  // Check for duplicate before any processing or disk writes
  const hash = computeHash(buffer);
  const listing = await propertyRepo.findActiveListingForProperty(propertyId);
  if (listing) {
    const existing: PhotoRecord[] = listing.photos
      ? (JSON.parse(listing.photos as string) as PhotoRecord[])
      : [];
    if (existing.some((p) => p.hash === hash)) {
      throw new ValidationError('This photo has already been uploaded.');
    }
  }

  // Virus scan before processing
  const scanResult = await scanBuffer(buffer, originalFilename);
  if (!scanResult.isClean) {
    await auditService.log({
      action: 'upload.virus_detected',
      entityType: 'property',
      entityId: propertyId,
      details: { filename: originalFilename, viruses: scanResult.viruses },
    });
    throw new ValidationError('File rejected: security scan failed');
  }

  const id = createId();
  const filename = `${id}.jpg`;

  const originalPath = `photos/${sellerId}/${propertyId}/original/${filename}`;
  const optimizedPath = `photos/${sellerId}/${propertyId}/optimized/${filename}`;

  // Save original
  await localStorage.save(originalPath, buffer);

  // Process: resize to max 2000px (fit inside, no enlargement), convert to JPEG at quality 80
  // Delete original if sharp processing fails to avoid orphaned files (B2b)
  let optimizedBuffer: Buffer;
  let metadata: import('sharp').Metadata;
  try {
    optimizedBuffer = await sharp(buffer)
      .resize(MAX_DIMENSION_PX, MAX_DIMENSION_PX, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
    metadata = await sharp(buffer).metadata();
  } catch (err) {
    await localStorage.delete(originalPath);
    throw err;
  }

  await localStorage.save(optimizedPath, optimizedBuffer);

  // A3: Audit photo upload
  await auditService.log({
    action: 'photo.uploaded',
    entityType: 'property',
    entityId: propertyId,
    details: { filename, sellerId },
  });

  return {
    id,
    filename,
    originalFilename,
    path: originalPath,
    optimizedPath,
    mimeType,
    sizeBytes: buffer.length,
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    hash,
  };
}

// ─── Add Photo to Listing ──────────────────────────────────────────────────────

export async function addPhotoToListing(
  propertyId: string,
  photo: PhotoRecord,
): Promise<PhotoRecord[]> {
  const listing = await propertyRepo.findActiveListingForProperty(propertyId);
  if (!listing) {
    throw new NotFoundError('Listing', propertyId);
  }

  const photos: PhotoRecord[] = listing.photos
    ? (JSON.parse(listing.photos as string) as PhotoRecord[])
    : [];

  if (photos.length >= MAX_PHOTOS) {
    throw new ValidationError(`Maximum of ${MAX_PHOTOS} photos allowed per listing`);
  }

  const photoWithOrder = { ...photo, displayOrder: photos.length };
  const updatedPhotos = [...photos, photoWithOrder];
  await propertyRepo.updateListingPhotos(listing.id, updatedPhotos);

  return updatedPhotos;
}

// ─── Remove Photo ──────────────────────────────────────────────────────────────

export async function removePhoto(propertyId: string, photoId: string): Promise<PhotoRecord[]> {
  const listing = await propertyRepo.findActiveListingForProperty(propertyId);
  if (!listing) {
    throw new NotFoundError('Listing', propertyId);
  }

  const photos: PhotoRecord[] = listing.photos
    ? (JSON.parse(listing.photos as string) as PhotoRecord[])
    : [];

  const photoIndex = photos.findIndex((p) => p.id === photoId);
  if (photoIndex === -1) {
    throw new NotFoundError('Photo', photoId);
  }

  const photo = photos[photoIndex];

  // Delete both original and optimized files
  await localStorage.delete(photo.path);
  await localStorage.delete(photo.optimizedPath);

  // Remove photo from array and reindex displayOrder
  const remaining = photos.filter((p) => p.id !== photoId);
  const reindexed = remaining.map((p, index) => ({ ...p, displayOrder: index }));

  await propertyRepo.updateListingPhotos(listing.id, reindexed);

  await auditService.log({
    action: 'photo.removed',
    entityType: 'listing',
    entityId: listing.id,
    details: { photoId, propertyId },
  });

  return reindexed;
}

// ─── Reorder Photos ────────────────────────────────────────────────────────────

export async function reorderPhotos(
  propertyId: string,
  photoIds: string[],
): Promise<PhotoRecord[]> {
  const listing = await propertyRepo.findActiveListingForProperty(propertyId);
  if (!listing) {
    throw new NotFoundError('Listing', propertyId);
  }

  const photos: PhotoRecord[] = listing.photos
    ? (JSON.parse(listing.photos as string) as PhotoRecord[])
    : [];

  // Build a map of id -> photo for quick lookup
  const photoMap = new Map(photos.map((p) => [p.id, p]));

  // L23: Validate that photoIds contains exactly the same set of IDs as existing photos
  const existingIds = new Set(photos.map((p) => p.id));
  const providedIds = new Set(photoIds);
  if (
    existingIds.size !== providedIds.size ||
    [...existingIds].some((id) => !providedIds.has(id))
  ) {
    throw new ValidationError(
      'Photo IDs must contain exactly the same set of photos. No photos may be added or omitted.',
    );
  }

  // Reorder by the provided ID array, assigning new displayOrder
  const reordered = photoIds.map((id, index) => ({
    ...photoMap.get(id)!,
    displayOrder: index,
  }));

  await propertyRepo.updateListingPhotos(listing.id, reordered);

  return reordered;
}

// ─── Get Photos for Property ───────────────────────────────────────────────────

export async function getPhotosForProperty(
  propertyId: string,
): Promise<{ photos: PhotoRecord[]; photosDownloaded: boolean }> {
  const listing = await propertyRepo.findActiveListingForProperty(propertyId);
  if (!listing) {
    return { photos: [], photosDownloaded: false };
  }

  const photos: PhotoRecord[] = listing.photos
    ? (JSON.parse(listing.photos as string) as PhotoRecord[]).sort(
        (a, b) => a.displayOrder - b.displayOrder,
      )
    : [];

  const photosDownloaded =
    listing.photosApprovedAt !== null &&
    listing.photosApprovedAt !== undefined &&
    photos.length === 0;

  return { photos, photosDownloaded };
}

// ─── Get Photo for Agent Review ────────────────────────────────────────────────

/**
 * Agents may view photos for listings assigned to them.
 * Admins may view any listing's photos.
 */
export async function getPhotoForAgent(
  listingId: string,
  photoId: string,
  callerAgentId: string,
  callerRole: string,
): Promise<{ photo: PhotoRecord; buffer: Buffer }> {
  const listing = await propertyRepo.findListingWithSeller(listingId);
  if (!listing) throw new NotFoundError('Listing', listingId);

  if (callerRole !== 'admin') {
    const assignedAgentId = listing.property?.seller?.agentId ?? null;
    if (assignedAgentId !== callerAgentId) {
      throw new ForbiddenError('You are not authorised to view this listing');
    }
  }

  const photos: PhotoRecord[] = listing.photos
    ? (JSON.parse(listing.photos as string) as PhotoRecord[])
    : [];

  const photo = photos.find((p) => p.id === photoId);
  if (!photo) throw new NotFoundError('Photo', photoId);

  const buffer = await localStorage.read(photo.optimizedPath);
  return { photo, buffer };
}
