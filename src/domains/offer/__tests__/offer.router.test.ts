// src/domains/offer/__tests__/offer.router.test.ts
import express from 'express';
import request from 'supertest';
import { offerRouter } from '../offer.router';
import * as offerService from '../offer.service';

jest.mock('../offer.service');
jest.mock(
  'express-rate-limit',
  () => () => (_req: unknown, _res: unknown, next: () => void) => next(),
);

const mockOfferService = jest.mocked(offerService);

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
  app.use(offerRouter);
  return app;
}

function makeOffer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'offer-1',
    propertyId: 'property-1',
    buyerName: 'Test Buyer',
    buyerPhone: '91234567',
    isCoBroke: false,
    offerAmount: '600000',
    status: 'pending',
    ...overrides,
  };
}

describe('offer.router', () => {
  let app: express.Application;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /agent/properties/:propertyId/offers', () => {
    it('returns 200 with offer chain', async () => {
      mockOfferService.getOffersForProperty.mockResolvedValue([makeOffer()] as never);

      const res = await request(app)
        .get('/agent/properties/property-1/offers')
        .set('HX-Request', 'true');

      expect(res.status).toBe(200);
      expect(mockOfferService.getOffersForProperty).toHaveBeenCalledWith('property-1');
    });
  });

  describe('POST /agent/offers', () => {
    it('creates an offer and returns 201', async () => {
      mockOfferService.createOffer.mockResolvedValue(makeOffer() as never);

      const res = await request(app).post('/agent/offers').send({
        propertyId: 'property-1',
        sellerId: 'seller-1',
        town: 'TAMPINES',
        flatType: '4 ROOM',
        buyerName: 'John Doe',
        buyerPhone: '91234567',
        isCoBroke: false,
        offerAmount: '600000',
      });

      expect(res.status).toBe(201);
    });

    it('returns 400 for missing required fields', async () => {
      const res = await request(app).post('/agent/offers').send({ propertyId: 'property-1' }); // missing buyerName, buyerPhone, etc.

      expect(res.status).toBe(400);
    });
  });

  describe('POST /agent/offers/:id/counter', () => {
    it('records counter-offer and returns 200', async () => {
      mockOfferService.counterOffer.mockResolvedValue(makeOffer({ id: 'offer-2' }) as never);

      const res = await request(app)
        .post('/agent/offers/offer-1/counter')
        .send({ counterAmount: '650000' });

      expect(res.status).toBe(200);
    });
  });

  describe('POST /agent/offers/:id/accept', () => {
    it('accepts offer and returns 200', async () => {
      mockOfferService.acceptOffer.mockResolvedValue(makeOffer({ status: 'accepted' }) as never);

      const res = await request(app).post('/agent/offers/offer-1/accept');

      expect(res.status).toBe(200);
    });
  });

  describe('POST /agent/offers/:id/reject', () => {
    it('rejects offer and returns 200', async () => {
      mockOfferService.rejectOffer.mockResolvedValue(makeOffer({ status: 'rejected' }) as never);

      const res = await request(app).post('/agent/offers/offer-1/reject');

      expect(res.status).toBe(200);
    });
  });

  describe('POST /agent/offers/:id/analysis/review', () => {
    it('marks AI analysis as reviewed', async () => {
      mockOfferService.reviewAiAnalysis.mockResolvedValue(makeOffer() as never);

      const res = await request(app).post('/agent/offers/offer-1/analysis/review');

      expect(res.status).toBe(200);
    });
  });

  describe('POST /agent/offers/:id/analysis/share', () => {
    it('shares AI analysis with seller', async () => {
      mockOfferService.shareAiAnalysis.mockResolvedValue(makeOffer() as never);

      const res = await request(app)
        .post('/agent/offers/offer-1/analysis/share')
        .send({ sellerId: 'seller-1' });

      expect(res.status).toBe(200);
    });
  });
});
