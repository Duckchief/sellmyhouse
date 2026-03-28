// src/domains/property/__tests__/portal.router.test.ts
import express from 'express';
import request from 'supertest';
import { portalRouter } from '../portal.router';
import * as portalService from '../portal.service';

jest.mock('../portal.service');
jest.mock('../../profile/profile.service', () => ({
  getHasAvatar: jest.fn().mockResolvedValue(false),
}));
jest.mock(
  'express-rate-limit',
  () => () => (_req: unknown, _res: unknown, next: () => void) => next(),
);

const mockPortalService = jest.mocked(portalService);

// Minimal app with injected agent auth — standard pattern for router tests in this codebase
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    Object.assign(req, {
      isAuthenticated: () => true,
      user: {
        id: 'agent-1',
        role: 'agent',
        name: 'Test Agent',
        email: 'agent@test.com',
        twoFactorEnabled: true,
        twoFactorVerified: true,
      },
    });
    next();
  });
  // Mock Nunjucks render — router tests don't need real template rendering
  app.use((_req, res, next) => {
    res.render = ((_view: string, _data?: unknown) => {
      res.json({ rendered: true });
    }) as never;
    next();
  });
  app.use(portalRouter);
  return app;
}

describe('portal.router', () => {
  let app: express.Application;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /agent/listings/:listingId/portals', () => {
    it('returns 200 with portal listings', async () => {
      mockPortalService.getPortalListings.mockResolvedValue([
        { id: 'pl-1', portalName: 'propertyguru', status: 'ready' } as never,
        { id: 'pl-2', portalName: 'ninety_nine_co', status: 'ready' } as never,
        { id: 'pl-3', portalName: 'srx', status: 'ready' } as never,
      ]);

      const res = await request(app)
        .get('/agent/listings/listing-1/portals')
        .set('HX-Request', 'true');

      expect(res.status).toBe(200);
      expect(mockPortalService.getPortalListings).toHaveBeenCalledWith(
        'listing-1',
        'agent-1',
        'agent',
      );
    });
  });

  describe('POST /agent/portal-listings/:id/mark-posted', () => {
    it('marks portal listing as posted and returns 200', async () => {
      mockPortalService.markAsPosted.mockResolvedValue({
        id: 'pl-1',
        status: 'posted',
        portalListingUrl: 'https://www.propertyguru.com.sg/listing/123',
      } as never);

      const res = await request(app)
        .post('/agent/portal-listings/pl-1/mark-posted')
        .send({ url: 'https://www.propertyguru.com.sg/listing/123' });

      expect(res.status).toBe(200);
    });

    it('passes agent id and role to markAsPosted for ownership check', async () => {
      mockPortalService.markAsPosted.mockResolvedValue({
        id: 'pl-1',
        status: 'posted',
        portalListingUrl: 'https://www.propertyguru.com.sg/listing/123',
      } as never);

      await request(app)
        .post('/agent/portal-listings/pl-1/mark-posted')
        .send({ url: 'https://www.propertyguru.com.sg/listing/123' });

      expect(mockPortalService.markAsPosted).toHaveBeenCalledWith(
        'pl-1',
        'https://www.propertyguru.com.sg/listing/123',
        'agent-1',
        'agent',
      );
    });

    it('returns 400 when url is missing', async () => {
      const res = await request(app).post('/agent/portal-listings/pl-1/mark-posted').send({});

      expect(res.status).toBe(400);
    });
  });

  describe('POST /agent/listings/:listingId/photos/reinstate', () => {
    it('returns 200 and re-renders portal-photos partial on success', async () => {
      mockPortalService.reinstatePhotoUpload.mockResolvedValue(undefined);
      mockPortalService.getListingForPortalsPage.mockResolvedValue({
        id: 'listing-1',
        photos: [],
        photosApprovedAt: null,
      } as never);

      const res = await request(app).post('/agent/listings/listing-1/photos/reinstate');

      expect(res.status).toBe(200);
      expect(mockPortalService.reinstatePhotoUpload).toHaveBeenCalledWith(
        'listing-1',
        'agent-1',
        'agent',
      );
      expect(mockPortalService.getListingForPortalsPage).toHaveBeenCalledWith(
        'listing-1',
        'agent-1',
        'agent',
      );
    });

    it('returns 403 when agent does not own the listing', async () => {
      const { ForbiddenError } = await import('@/domains/shared/errors');
      mockPortalService.reinstatePhotoUpload.mockRejectedValue(
        new ForbiddenError('You are not authorised to manage this listing'),
      );

      const res = await request(app).post('/agent/listings/listing-1/photos/reinstate');

      expect(res.status).toBe(403);
    });
  });
});
