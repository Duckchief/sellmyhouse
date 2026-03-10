import * as photoService from '../photo.service';
import * as propertyRepo from '../property.repository';
import * as auditService from '../../shared/audit.service';
import { localStorage } from '../../../infra/storage/local-storage';
import { NotFoundError, ValidationError } from '../../shared/errors';
import type { PhotoRecord } from '../property.types';

// ─── Mock sharp ────────────────────────────────────────────────────────────────

jest.mock('sharp', () => {
  const mockSharp = jest.fn(() => ({
    metadata: jest.fn().mockResolvedValue({ width: 1200, height: 900, format: 'jpeg' }),
    resize: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('optimized-image')),
  }));
  return mockSharp;
});

// ─── Mock dependencies ────────────────────────────────────────────────────────

jest.mock('../property.repository');
jest.mock('../../shared/audit.service');
jest.mock('../../../infra/storage/local-storage', () => ({
  localStorage: {
    save: jest.fn().mockResolvedValue(undefined),
    read: jest.fn().mockResolvedValue(Buffer.from('data')),
    delete: jest.fn().mockResolvedValue(undefined),
    exists: jest.fn().mockResolvedValue(true),
  },
}));

// ─── Mock @paralleldrive/cuid2 ────────────────────────────────────────────────

jest.mock('@paralleldrive/cuid2', () => ({
  createId: jest.fn().mockReturnValue('test-photo-id'),
}));

const mockedRepo = jest.mocked(propertyRepo);
const mockedAudit = jest.mocked(auditService);
const mockedStorage = jest.mocked(localStorage);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePhotoRecord(overrides: Partial<PhotoRecord> = {}): PhotoRecord {
  return {
    id: 'photo-1',
    filename: 'photo-1.jpg',
    originalFilename: 'original.jpg',
    path: 'photos/seller-1/prop-1/original/photo-1.jpg',
    optimizedPath: 'photos/seller-1/prop-1/optimized/photo-1.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 100000,
    width: 1200,
    height: 900,
    displayOrder: 0,
    status: 'uploaded',
    uploadedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeListing(photos: PhotoRecord[] = []) {
  return {
    id: 'listing-1',
    propertyId: 'prop-1',
    status: 'draft',
    photos: JSON.stringify(photos),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('photo.service', () => {
  beforeEach(() => jest.clearAllMocks());

  // ─── validateImage ──────────────────────────────────────────

  describe('validateImage', () => {
    it('accepts a valid JPEG image', async () => {
      const buffer = Buffer.from('fake-jpeg-data');
      const result = await photoService.validateImage(buffer, 'image/jpeg', 500000);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('accepts a valid PNG image', async () => {
      const buffer = Buffer.from('fake-png-data');
      const result = await photoService.validateImage(buffer, 'image/png', 500000);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('rejects a non-image mime type', async () => {
      const buffer = Buffer.from('fake-pdf-data');
      const result = await photoService.validateImage(buffer, 'application/pdf', 500000);

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Invalid file type');
    });

    it('rejects a file exceeding 5MB', async () => {
      const buffer = Buffer.from('fake-jpeg-data');
      const overLimitSize = 5 * 1024 * 1024 + 1;
      const result = await photoService.validateImage(buffer, 'image/jpeg', overLimitSize);

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('exceeds maximum');
    });

    it('rejects an image smaller than 800px on the longest edge', async () => {
      const sharp = require('sharp');
      sharp.mockImplementationOnce(() => ({
        metadata: jest.fn().mockResolvedValue({ width: 600, height: 400, format: 'jpeg' }),
        resize: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(Buffer.from('optimized-image')),
      }));

      const buffer = Buffer.from('fake-small-jpeg');
      const result = await photoService.validateImage(buffer, 'image/jpeg', 100000);

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('too small');
    });

    it('accepts image exactly at 800px minimum', async () => {
      const sharp = require('sharp');
      sharp.mockImplementationOnce(() => ({
        metadata: jest.fn().mockResolvedValue({ width: 800, height: 600, format: 'jpeg' }),
        resize: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(Buffer.from('optimized-image')),
      }));

      const buffer = Buffer.from('fake-jpeg');
      const result = await photoService.validateImage(buffer, 'image/jpeg', 100000);

      expect(result.valid).toBe(true);
    });
  });

  // ─── processAndSavePhoto ────────────────────────────────────

  describe('processAndSavePhoto', () => {
    it('saves original and optimized files (localStorage.save called twice)', async () => {
      const buffer = Buffer.from('fake-image-data');
      const result = await photoService.processAndSavePhoto(
        buffer,
        'my-photo.jpg',
        'image/jpeg',
        'seller-1',
        'prop-1',
      );

      expect(mockedStorage.save).toHaveBeenCalledTimes(2);
      expect(mockedStorage.save).toHaveBeenCalledWith(
        expect.stringContaining('original'),
        buffer,
      );
      expect(mockedStorage.save).toHaveBeenCalledWith(
        expect.stringContaining('optimized'),
        expect.any(Buffer),
      );
    });

    it('returns correct photo metadata', async () => {
      const buffer = Buffer.from('fake-image-data');
      const result = await photoService.processAndSavePhoto(
        buffer,
        'my-photo.jpg',
        'image/jpeg',
        'seller-1',
        'prop-1',
      );

      expect(result.id).toBe('test-photo-id');
      expect(result.filename).toBe('test-photo-id.jpg');
      expect(result.originalFilename).toBe('my-photo.jpg');
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.sizeBytes).toBe(buffer.length);
      expect(result.path).toContain('photos/seller-1/prop-1/original');
      expect(result.optimizedPath).toContain('photos/seller-1/prop-1/optimized');
      expect(result.width).toBe(1200);
      expect(result.height).toBe(900);
    });

    it('uses sharp to resize and convert to JPEG', async () => {
      const sharp = require('sharp');
      const buffer = Buffer.from('fake-image-data');
      await photoService.processAndSavePhoto(buffer, 'photo.jpg', 'image/jpeg', 'seller-1', 'prop-1');

      // sharp is called at least twice (once for optimize, once for metadata)
      expect(sharp).toHaveBeenCalled();
    });
  });

  // ─── addPhotoToListing ──────────────────────────────────────

  describe('addPhotoToListing', () => {
    it('adds a photo to the listing photos array', async () => {
      const existingPhoto = makePhotoRecord({ id: 'photo-existing', displayOrder: 0 });
      const listing = makeListing([existingPhoto]);
      mockedRepo.findActiveListingForProperty.mockResolvedValue(listing as any);
      mockedRepo.updateListingPhotos.mockResolvedValue(listing as any);

      const newPhoto = makePhotoRecord({ id: 'photo-new', displayOrder: 1 });
      const result = await photoService.addPhotoToListing('prop-1', newPhoto);

      expect(result).toHaveLength(2);
      expect(result[1].id).toBe('photo-new');
      expect(mockedRepo.updateListingPhotos).toHaveBeenCalledWith(
        'listing-1',
        expect.arrayContaining([
          expect.objectContaining({ id: 'photo-existing' }),
          expect.objectContaining({ id: 'photo-new' }),
        ]),
      );
    });

    it('rejects when MAX_PHOTOS (20) limit is reached', async () => {
      const photos = Array.from({ length: 20 }, (_, i) =>
        makePhotoRecord({ id: `photo-${i}`, displayOrder: i }),
      );
      const listing = makeListing(photos);
      mockedRepo.findActiveListingForProperty.mockResolvedValue(listing as any);

      const newPhoto = makePhotoRecord({ id: 'photo-new' });

      await expect(photoService.addPhotoToListing('prop-1', newPhoto)).rejects.toThrow(
        ValidationError,
      );
    });

    it('adds photo to empty listing', async () => {
      const listing = makeListing([]);
      mockedRepo.findActiveListingForProperty.mockResolvedValue(listing as any);
      mockedRepo.updateListingPhotos.mockResolvedValue(listing as any);

      const newPhoto = makePhotoRecord({ id: 'photo-new' });
      const result = await photoService.addPhotoToListing('prop-1', newPhoto);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('photo-new');
    });

    it('throws NotFoundError when no active listing exists', async () => {
      mockedRepo.findActiveListingForProperty.mockResolvedValue(null);

      const newPhoto = makePhotoRecord();

      await expect(photoService.addPhotoToListing('bad-prop', newPhoto)).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  // ─── removePhoto ────────────────────────────────────────────

  describe('removePhoto', () => {
    it('removes photo from listing and deletes both files', async () => {
      const photo1 = makePhotoRecord({ id: 'photo-1', displayOrder: 0 });
      const photo2 = makePhotoRecord({ id: 'photo-2', displayOrder: 1 });
      const listing = makeListing([photo1, photo2]);
      mockedRepo.findActiveListingForProperty.mockResolvedValue(listing as any);
      mockedRepo.updateListingPhotos.mockResolvedValue(listing as any);
      mockedAudit.log.mockResolvedValue(undefined);

      const result = await photoService.removePhoto('prop-1', 'photo-1');

      expect(mockedStorage.delete).toHaveBeenCalledTimes(2);
      expect(mockedStorage.delete).toHaveBeenCalledWith(photo1.path);
      expect(mockedStorage.delete).toHaveBeenCalledWith(photo1.optimizedPath);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('photo-2');
    });

    it('reindexes displayOrder after removal', async () => {
      const photo1 = makePhotoRecord({ id: 'photo-1', displayOrder: 0 });
      const photo2 = makePhotoRecord({ id: 'photo-2', displayOrder: 1 });
      const photo3 = makePhotoRecord({ id: 'photo-3', displayOrder: 2 });
      const listing = makeListing([photo1, photo2, photo3]);
      mockedRepo.findActiveListingForProperty.mockResolvedValue(listing as any);
      mockedRepo.updateListingPhotos.mockResolvedValue(listing as any);
      mockedAudit.log.mockResolvedValue(undefined);

      const result = await photoService.removePhoto('prop-1', 'photo-1');

      expect(result[0].displayOrder).toBe(0);
      expect(result[1].displayOrder).toBe(1);
    });

    it('throws NotFoundError for missing photo', async () => {
      const listing = makeListing([makePhotoRecord({ id: 'photo-1' })]);
      mockedRepo.findActiveListingForProperty.mockResolvedValue(listing as any);

      await expect(photoService.removePhoto('prop-1', 'nonexistent-photo')).rejects.toThrow(
        NotFoundError,
      );
    });

    it('throws NotFoundError when no active listing exists', async () => {
      mockedRepo.findActiveListingForProperty.mockResolvedValue(null);

      await expect(photoService.removePhoto('bad-prop', 'photo-1')).rejects.toThrow(NotFoundError);
    });

    it('logs audit after removing photo', async () => {
      const photo = makePhotoRecord({ id: 'photo-1' });
      const listing = makeListing([photo]);
      mockedRepo.findActiveListingForProperty.mockResolvedValue(listing as any);
      mockedRepo.updateListingPhotos.mockResolvedValue(listing as any);
      mockedAudit.log.mockResolvedValue(undefined);

      await photoService.removePhoto('prop-1', 'photo-1');

      expect(mockedAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'photo.removed',
          entityType: 'listing',
          entityId: 'listing-1',
          details: expect.objectContaining({ photoId: 'photo-1' }),
        }),
      );
    });
  });

  // ─── reorderPhotos ──────────────────────────────────────────

  describe('reorderPhotos', () => {
    it('reorders photos by the provided ID list', async () => {
      const photo1 = makePhotoRecord({ id: 'photo-1', displayOrder: 0 });
      const photo2 = makePhotoRecord({ id: 'photo-2', displayOrder: 1 });
      const photo3 = makePhotoRecord({ id: 'photo-3', displayOrder: 2 });
      const listing = makeListing([photo1, photo2, photo3]);
      mockedRepo.findActiveListingForProperty.mockResolvedValue(listing as any);
      mockedRepo.updateListingPhotos.mockResolvedValue(listing as any);

      const result = await photoService.reorderPhotos('prop-1', ['photo-3', 'photo-1', 'photo-2']);

      expect(result[0].id).toBe('photo-3');
      expect(result[0].displayOrder).toBe(0);
      expect(result[1].id).toBe('photo-1');
      expect(result[1].displayOrder).toBe(1);
      expect(result[2].id).toBe('photo-2');
      expect(result[2].displayOrder).toBe(2);
    });

    it('saves reordered photos to the repository', async () => {
      const photo1 = makePhotoRecord({ id: 'photo-1', displayOrder: 0 });
      const photo2 = makePhotoRecord({ id: 'photo-2', displayOrder: 1 });
      const listing = makeListing([photo1, photo2]);
      mockedRepo.findActiveListingForProperty.mockResolvedValue(listing as any);
      mockedRepo.updateListingPhotos.mockResolvedValue(listing as any);

      await photoService.reorderPhotos('prop-1', ['photo-2', 'photo-1']);

      expect(mockedRepo.updateListingPhotos).toHaveBeenCalledWith(
        'listing-1',
        expect.arrayContaining([
          expect.objectContaining({ id: 'photo-2', displayOrder: 0 }),
          expect.objectContaining({ id: 'photo-1', displayOrder: 1 }),
        ]),
      );
    });

    it('throws NotFoundError when no active listing exists', async () => {
      mockedRepo.findActiveListingForProperty.mockResolvedValue(null);

      await expect(
        photoService.reorderPhotos('bad-prop', ['photo-1']),
      ).rejects.toThrow(NotFoundError);
    });
  });

  // ─── getPhotosForProperty ───────────────────────────────────

  describe('getPhotosForProperty', () => {
    it('returns photos sorted by displayOrder', async () => {
      const photo1 = makePhotoRecord({ id: 'photo-1', displayOrder: 2 });
      const photo2 = makePhotoRecord({ id: 'photo-2', displayOrder: 0 });
      const photo3 = makePhotoRecord({ id: 'photo-3', displayOrder: 1 });
      const listing = makeListing([photo1, photo2, photo3]);
      mockedRepo.findActiveListingForProperty.mockResolvedValue(listing as any);

      const result = await photoService.getPhotosForProperty('prop-1');

      expect(result[0].id).toBe('photo-2');
      expect(result[1].id).toBe('photo-3');
      expect(result[2].id).toBe('photo-1');
    });

    it('returns empty array when listing has no photos', async () => {
      const listing = makeListing([]);
      mockedRepo.findActiveListingForProperty.mockResolvedValue(listing as any);

      const result = await photoService.getPhotosForProperty('prop-1');

      expect(result).toEqual([]);
    });

    it('throws NotFoundError when no active listing exists', async () => {
      mockedRepo.findActiveListingForProperty.mockResolvedValue(null);

      await expect(photoService.getPhotosForProperty('bad-prop')).rejects.toThrow(NotFoundError);
    });
  });
});
