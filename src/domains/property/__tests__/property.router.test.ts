import * as propertyService from '../property.service';
import * as photoService from '../photo.service';

jest.mock('../property.service');
jest.mock('../photo.service');

const mockedPropertyService = jest.mocked(propertyService);
const mockedPhotoService = jest.mocked(photoService);

import request from 'supertest';
import express from 'express';
import nunjucks from 'nunjucks';
import path from 'path';
import { propertyRouter } from '../property.router';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const viewsPath = path.resolve('src/views');
  const env = nunjucks.configure(viewsPath, {
    autoescape: true,
    express: app,
  });
  env.addFilter('t', (str: string) => str);
  env.addFilter('date', (d: unknown) => (d ? String(d) : ''));
  env.addFilter('formatPrice', (n: unknown) => String(n));
  app.set('view engine', 'njk');

  // Mock authenticated seller
  app.use((req, _res, next) => {
    req.user = {
      id: 'seller-1',
      role: 'seller',
      email: 'test@test.local',
      name: 'Test',
      twoFactorEnabled: false,
      twoFactorVerified: false,
    };
    req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
    next();
  });

  app.use(propertyRouter);

  // Error handler for NotFoundError (404)
  app.use(
    (
      err: Error & { statusCode?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status = err.statusCode ?? 500;
      res.status(status).json({ error: err.message });
    },
  );

  return app;
}

const mockProperty = {
  id: 'property-1',
  sellerId: 'seller-1',
  town: 'TAMPINES',
  street: 'TAMPINES ST 21',
  block: '123',
  flatType: '4 ROOM',
  storeyRange: '07 TO 09',
  floorAreaSqm: 93,
  flatModel: 'Model A',
  leaseCommenceDate: 1995,
  remainingLease: null,
  askingPrice: null,
  status: 'draft',
  listings: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('property.router', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
  });

  // ─── GET /seller/property ────────────────────────────────────────────────────

  describe('GET /seller/property', () => {
    it('returns 200 with property data', async () => {
      mockedPropertyService.getPropertyForSeller.mockResolvedValue(mockProperty as never);

      const res = await request(app).get('/seller/property');

      expect(res.status).toBe(200);
      expect(mockedPropertyService.getPropertyForSeller).toHaveBeenCalledWith('seller-1');
    });

    it('returns 200 with empty state when property is null', async () => {
      mockedPropertyService.getPropertyForSeller.mockResolvedValue(null);

      const res = await request(app).get('/seller/property');

      expect(res.status).toBe(200);
    });

    it('returns partial for HTMX requests', async () => {
      mockedPropertyService.getPropertyForSeller.mockResolvedValue(mockProperty as never);

      const res = await request(app).get('/seller/property').set('HX-Request', 'true');

      expect(res.status).toBe(200);
    });
  });

  // ─── PUT /seller/property ────────────────────────────────────────────────────

  describe('PUT /seller/property', () => {
    const validBody = {
      town: 'TAMPINES',
      street: 'TAMPINES ST 21',
      block: '123',
      flatType: '4 ROOM',
      storeyRange: '07 TO 09',
      floorAreaSqm: '93',
      flatModel: 'Model A',
      leaseCommenceDate: '1995',
    };

    it('creates property when none exists', async () => {
      mockedPropertyService.getPropertyForSeller.mockResolvedValue(null);
      mockedPropertyService.createProperty.mockResolvedValue(mockProperty as never);

      const res = await request(app).put('/seller/property').send(validBody);

      expect(res.status).toBe(200);
      expect(mockedPropertyService.createProperty).toHaveBeenCalledWith(
        expect.objectContaining({
          sellerId: 'seller-1',
          town: 'TAMPINES',
          flatType: '4 ROOM',
        }),
      );
    });

    it('updates existing property', async () => {
      mockedPropertyService.getPropertyForSeller.mockResolvedValue(mockProperty as never);
      mockedPropertyService.updateProperty.mockResolvedValue(mockProperty as never);

      const res = await request(app).put('/seller/property').send(validBody);

      expect(res.status).toBe(200);
      expect(mockedPropertyService.updateProperty).toHaveBeenCalledWith(
        'property-1',
        'seller-1',
        expect.objectContaining({ town: 'TAMPINES' }),
      );
    });

    it('updates asking price separately when changed', async () => {
      const propertyWithPrice = { ...mockProperty, askingPrice: 500000 };
      mockedPropertyService.getPropertyForSeller.mockResolvedValue(propertyWithPrice as never);
      mockedPropertyService.updateProperty.mockResolvedValue(propertyWithPrice as never);
      mockedPropertyService.updateAskingPrice.mockResolvedValue(propertyWithPrice as never);

      const res = await request(app)
        .put('/seller/property')
        .send({ ...validBody, askingPrice: '550000' });

      expect(res.status).toBe(200);
      expect(mockedPropertyService.updateAskingPrice).toHaveBeenCalledWith(
        'property-1',
        'seller-1',
        550000,
      );
    });

    it('returns 400 for invalid floorAreaSqm', async () => {
      const res = await request(app)
        .put('/seller/property')
        .send({ ...validBody, floorAreaSqm: '10' }); // below min of 20

      expect(res.status).toBe(400);
    });
  });

  // ─── GET /seller/photos ──────────────────────────────────────────────────────

  describe('GET /seller/photos', () => {
    it('returns 200 and renders photos page', async () => {
      mockedPropertyService.getPropertyForSeller.mockResolvedValue(mockProperty as never);
      mockedPhotoService.getPhotosForProperty.mockResolvedValue([]);

      const res = await request(app).get('/seller/photos');

      expect(res.status).toBe(200);
      expect(mockedPhotoService.getPhotosForProperty).toHaveBeenCalledWith('property-1');
    });

    it('returns 404 when no property exists', async () => {
      mockedPropertyService.getPropertyForSeller.mockResolvedValue(null);

      const res = await request(app).get('/seller/photos');

      expect(res.status).toBe(404);
    });

    it('returns partial for HTMX requests', async () => {
      mockedPropertyService.getPropertyForSeller.mockResolvedValue(mockProperty as never);
      mockedPhotoService.getPhotosForProperty.mockResolvedValue([]);

      const res = await request(app).get('/seller/photos').set('HX-Request', 'true');

      expect(res.status).toBe(200);
    });
  });

  // ─── DELETE /seller/photos/:id ───────────────────────────────────────────────

  describe('DELETE /seller/photos/:id', () => {
    it('deletes a photo and returns updated grid', async () => {
      mockedPropertyService.getPropertyForSeller.mockResolvedValue(mockProperty as never);
      mockedPhotoService.removePhoto.mockResolvedValue([]);

      const res = await request(app).delete('/seller/photos/photo-abc123');

      expect(res.status).toBe(200);
      expect(mockedPhotoService.removePhoto).toHaveBeenCalledWith('property-1', 'photo-abc123');
    });

    it('returns 404 when property does not exist', async () => {
      mockedPropertyService.getPropertyForSeller.mockResolvedValue(null);

      const res = await request(app).delete('/seller/photos/photo-abc123');

      expect(res.status).toBe(404);
    });
  });
});
