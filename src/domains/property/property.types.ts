import type { Property, Listing } from '@prisma/client';

// ─── Listing State Machine ────────────────────────────────

export const LISTING_STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ['pending_review'],
  pending_review: ['approved', 'draft'],
  approved: ['live', 'draft'],
  live: ['paused', 'pending_review', 'closed'],
  paused: ['live', 'closed'],
  closed: [],
};

export function canTransitionListing(from: string, to: string): boolean {
  return LISTING_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

// ─── Photo Types ──────────────────────────────────────────

export interface PhotoRecord {
  id: string;
  filename: string;
  originalFilename: string;
  path: string;
  optimizedPath: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  displayOrder: number;
  status: PhotoStatus;
  uploadedAt: Date;
  hash?: string;
}

export type PhotoStatus = 'uploaded' | 'pending_review' | 'approved' | 'rejected';

export const MAX_PHOTOS = 20;
export const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
export const MIN_DIMENSION_PX = 800;
export const MAX_DIMENSION_PX = 2000;
export const JPEG_QUALITY = 80;
export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'] as const;

// ─── Property Types ───────────────────────────────────────

export interface CreatePropertyInput {
  sellerId: string;
  town: string;
  street: string;
  block: string;
  flatType: string;
  level: string;
  unitNumber: string;
  floorAreaSqm: number;
  leaseCommenceDate: number;
  remainingLease?: string;
  askingPrice?: number;
  slug?: string;
  mopOverrideReason?: string;
  agentId?: string;
}

export interface UpdatePropertyInput {
  town?: string;
  street?: string;
  block?: string;
  flatType?: string;
  level?: string;
  unitNumber?: string;
  floorAreaSqm?: number;
  leaseCommenceDate?: number;
  remainingLease?: string;
  askingPrice?: number;
}

export interface PriceHistoryEntry {
  price: number;
  changedAt: string;
  changedBy: string;
}

export interface PropertyWithListing extends Property {
  listings: Listing[];
}

// ─── HDB Reference Data ──────────────────────────────────

export const HDB_TOWNS = [
  'ANG MO KIO',
  'BEDOK',
  'BISHAN',
  'BUKIT BATOK',
  'BUKIT MERAH',
  'BUKIT PANJANG',
  'BUKIT TIMAH',
  'CENTRAL AREA',
  'CHOA CHU KANG',
  'CLEMENTI',
  'GEYLANG',
  'HOUGANG',
  'JURONG EAST',
  'JURONG WEST',
  'KALLANG/WHAMPOA',
  'MARINE PARADE',
  'PASIR RIS',
  'PUNGGOL',
  'QUEENSTOWN',
  'SEMBAWANG',
  'SENGKANG',
  'SERANGOON',
  'TAMPINES',
  'TOA PAYOH',
  'WOODLANDS',
  'YISHUN',
] as const;

export const HDB_FLAT_TYPES = [
  '1 ROOM',
  '2 ROOM',
  '3 ROOM',
  '4 ROOM',
  '5 ROOM',
  'EXECUTIVE',
  'MULTI-GENERATION',
] as const;

export const HDB_FLAT_MODELS = [
  'Improved',
  'New Generation',
  'Model A',
  'Standard',
  'Simplified',
  'Model A2',
  'DBSS',
  'Type S1',
  'Type S2',
  'Adjoined flat',
  'Terrace',
  'Premium Apartment',
  'Maisonette',
  'Multi Generation',
  'Premium Apartment Loft',
  'Improved-Maisonette',
  'Premium Maisonette',
  '2-room',
  '3Gen',
] as const;
