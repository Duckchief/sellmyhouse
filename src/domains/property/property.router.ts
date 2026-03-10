import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { validationResult } from 'express-validator';
import * as propertyService from './property.service';
import * as photoService from './photo.service';
import {
  validatePropertyUpdate,
  validatePhotoReorder,
  validatePhotoId,
} from './property.validator';
import { HDB_TOWNS, HDB_FLAT_TYPES } from './property.types';
import type { PhotoRecord } from './property.types';
import { requireAuth, requireRole } from '@/infra/http/middleware/require-auth';
import { localStorage } from '@/infra/storage/local-storage';
import type { AuthenticatedUser } from '@/domains/auth/auth.types';
import { NotFoundError } from '@/domains/shared/errors';

export const propertyRouter = Router();

const sellerAuth = [requireAuth(), requireRole('seller')];

// Multer — memory storage, 5MB limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// ─── Property Routes ──────────────────────────────────────────────────────────

// GET /seller/property — property details page
propertyRouter.get(
  '/seller/property',
  ...sellerAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const property = await propertyService.getPropertyForSeller(user.id);

      const templateData = { property, towns: HDB_TOWNS, flatTypes: HDB_FLAT_TYPES };

      if (req.headers['hx-request']) {
        return res.render('partials/seller/property-form', templateData);
      }
      res.render('pages/seller/property', templateData);
    } catch (err) {
      next(err);
    }
  },
);

// PUT /seller/property — create or update property
propertyRouter.put(
  '/seller/property',
  ...sellerAuth,
  ...validatePropertyUpdate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        const message = Object.values(errors.mapped())[0]?.msg ?? 'Validation error';
        return res.status(400).render('partials/seller/property-form', {
          property: null,
          towns: HDB_TOWNS,
          flatTypes: HDB_FLAT_TYPES,
          error: message,
        });
      }

      const user = req.user as AuthenticatedUser;
      const {
        askingPrice,
        town,
        street,
        block,
        flatType,
        storeyRange,
        floorAreaSqm,
        flatModel,
        leaseCommenceDate,
        remainingLease,
      } = req.body as Record<string, string>;

      const existingProperty = await propertyService.getPropertyForSeller(user.id);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let property: any;

      if (!existingProperty) {
        // Create property — requires all mandatory fields
        property = await propertyService.createProperty({
          sellerId: user.id,
          town: town ?? '',
          street: street ?? '',
          block: block ?? '',
          flatType: flatType ?? '',
          storeyRange: storeyRange ?? '',
          floorAreaSqm: parseFloat(floorAreaSqm ?? '0'),
          flatModel: flatModel ?? '',
          leaseCommenceDate: parseInt(leaseCommenceDate ?? '0', 10),
          remainingLease: remainingLease ?? undefined,
          askingPrice: askingPrice !== undefined ? parseFloat(askingPrice) : undefined,
        });
      } else {
        property = existingProperty;

        // Update non-price fields
        const updateData: Record<string, unknown> = {};
        if (town !== undefined) updateData['town'] = town;
        if (street !== undefined) updateData['street'] = street;
        if (block !== undefined) updateData['block'] = block;
        if (flatType !== undefined) updateData['flatType'] = flatType;
        if (storeyRange !== undefined) updateData['storeyRange'] = storeyRange;
        if (floorAreaSqm !== undefined) updateData['floorAreaSqm'] = parseFloat(floorAreaSqm);
        if (flatModel !== undefined) updateData['flatModel'] = flatModel;
        if (leaseCommenceDate !== undefined)
          updateData['leaseCommenceDate'] = parseInt(leaseCommenceDate, 10);
        if (remainingLease !== undefined) updateData['remainingLease'] = remainingLease;

        if (Object.keys(updateData).length > 0) {
          property = await propertyService.updateProperty(property.id, user.id, updateData);
        }

        // Handle asking price separately — compare numerically
        if (askingPrice !== undefined) {
          const newPrice = parseFloat(askingPrice);
          const currentPrice = property.askingPrice !== null ? Number(property.askingPrice) : null;
          if (currentPrice !== newPrice) {
            property = await propertyService.updateAskingPrice(property.id, user.id, newPrice);
          }
        }
      }

      res.render('partials/seller/property-form', {
        property,
        towns: HDB_TOWNS,
        flatTypes: HDB_FLAT_TYPES,
        success: 'Property details saved successfully.',
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Photo Routes ─────────────────────────────────────────────────────────────

// GET /seller/photos — photo management page
propertyRouter.get(
  '/seller/photos',
  ...sellerAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const property = await propertyService.getPropertyForSeller(user.id);
      if (!property) {
        throw new NotFoundError('Property', user.id);
      }

      const photos = await photoService.getPhotosForProperty(property.id);
      const templateData = { photos, photoCount: photos.length };

      if (req.headers['hx-request']) {
        return res.render('partials/seller/photo-grid', templateData);
      }
      res.render('pages/seller/photos', templateData);
    } catch (err) {
      next(err);
    }
  },
);

// POST /seller/photos — upload a photo
propertyRouter.post(
  '/seller/photos',
  ...sellerAuth,
  upload.single('photo'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const property = await propertyService.getPropertyForSeller(user.id);
      if (!property) {
        throw new NotFoundError('Property', user.id);
      }

      const file = req.file;
      if (!file) {
        return res.status(400).render('partials/seller/photo-grid', {
          photos: [],
          photoCount: 0,
          error: 'No file uploaded.',
        });
      }

      const validation = await photoService.validateImage(file.buffer, file.mimetype, file.size);

      if (!validation.valid) {
        const photos = await photoService.getPhotosForProperty(property.id);
        return res.status(400).render('partials/seller/photo-grid', {
          photos,
          photoCount: photos.length,
          error: validation.error,
        });
      }

      const processed = await photoService.processAndSavePhoto(
        file.buffer,
        file.originalname,
        file.mimetype,
        user.id,
        property.id,
      );

      const photoRecord: PhotoRecord = {
        id: processed.id,
        filename: processed.filename,
        originalFilename: processed.originalFilename,
        path: processed.path,
        optimizedPath: processed.optimizedPath,
        mimeType: processed.mimeType,
        sizeBytes: processed.sizeBytes,
        width: processed.width,
        height: processed.height,
        displayOrder: 0,
        status: 'uploaded',
        uploadedAt: new Date(),
      };

      const photos = await photoService.addPhotoToListing(property.id, photoRecord);

      res.render('partials/seller/photo-grid', { photos, photoCount: photos.length });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /seller/photos/:id — remove a photo
propertyRouter.delete(
  '/seller/photos/:id',
  ...sellerAuth,
  ...validatePhotoId,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        const message = Object.values(errors.mapped())[0]?.msg ?? 'Validation error';
        return res.status(400).render('partials/seller/photo-grid', {
          photos: [],
          photoCount: 0,
          error: message,
        });
      }

      const user = req.user as AuthenticatedUser;
      const property = await propertyService.getPropertyForSeller(user.id);
      if (!property) {
        throw new NotFoundError('Property', user.id);
      }

      const photoId = req.params['id'] as string;
      const photos = await photoService.removePhoto(property.id, photoId);

      res.render('partials/seller/photo-grid', { photos, photoCount: photos.length });
    } catch (err) {
      next(err);
    }
  },
);

// PUT /seller/photos/reorder — reorder photos
propertyRouter.put(
  '/seller/photos/reorder',
  ...sellerAuth,
  ...validatePhotoReorder,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        const message = Object.values(errors.mapped())[0]?.msg ?? 'Validation error';
        return res.status(400).render('partials/seller/photo-grid', {
          photos: [],
          photoCount: 0,
          error: message,
        });
      }

      const user = req.user as AuthenticatedUser;
      const property = await propertyService.getPropertyForSeller(user.id);
      if (!property) {
        throw new NotFoundError('Property', user.id);
      }

      const { photoIds } = req.body as { photoIds: string[] };
      const photos = await photoService.reorderPhotos(property.id, photoIds);

      res.render('partials/seller/photo-grid', { photos, photoCount: photos.length });
    } catch (err) {
      next(err);
    }
  },
);

// GET /seller/photos/:id/thumbnail — serve optimized image (auth-gated)
propertyRouter.get(
  '/seller/photos/:id/thumbnail',
  ...sellerAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const property = await propertyService.getPropertyForSeller(user.id);
      if (!property) {
        throw new NotFoundError('Property', user.id);
      }

      const photoId = req.params['id'] as string;
      const photos = await photoService.getPhotosForProperty(property.id);
      const photo = photos.find((p) => p.id === photoId);

      if (!photo) {
        throw new NotFoundError('Photo', photoId);
      }

      const buffer = await localStorage.read(photo.optimizedPath);

      res.set('Content-Type', 'image/jpeg');
      res.set('Cache-Control', 'private, max-age=3600');
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  },
);
