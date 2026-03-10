import express from 'express';
import request from 'supertest';
import { viewingRouter } from '../viewing.router';
import * as viewingService from '../viewing.service';

jest.mock('../viewing.service');
jest.mock(
  'express-rate-limit',
  () => () => (_req: unknown, _res: unknown, next: () => void) => next(),
);

const mockService = viewingService as jest.Mocked<typeof viewingService>;

// Minimal app with seller auth
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use((req, _res, next) => {
    Object.assign(req, {
      isAuthenticated: () => true,
      user: {
        id: 'seller-1',
        role: 'seller',
        name: 'Test Seller',
        email: 'test@test.com',
        twoFactorEnabled: false,
        twoFactorVerified: false,
      },
    });
    next();
  });

  app.use(viewingRouter);
  return app;
}

describe('viewing.router', () => {
  let app: express.Application;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => jest.clearAllMocks());

  // ─── Seller Routes ─────────────────────────────────────

  describe('POST /seller/viewings/slots', () => {
    it('creates a single slot', async () => {
      mockService.createSlot.mockResolvedValue({
        id: 'slot-1',
        status: 'available',
      } as never);

      const res = await request(app).post('/seller/viewings/slots').send({
        propertyId: 'prop-1',
        date: '2026-04-15',
        startTime: '10:00',
        endTime: '10:15',
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('creates bulk slots', async () => {
      mockService.createBulkSlots.mockResolvedValue({
        count: 32,
        slots: [],
      } as never);

      const res = await request(app).post('/seller/viewings/slots').send({
        bulk: 'true',
        propertyId: 'prop-1',
        startDate: '2026-04-04',
        endDate: '2026-04-25',
        dayOfWeek: '6',
        startTime: '10:00',
        endTime: '12:00',
        slotDurationMinutes: '15',
      });

      expect(res.status).toBe(201);
      expect(res.body.count).toBe(32);
    });
  });

  describe('DELETE /seller/viewings/slots/:id', () => {
    it('cancels a slot', async () => {
      mockService.cancelSlot.mockResolvedValue(undefined);

      const res = await request(app).delete('/seller/viewings/slots/slot-1');

      expect(res.status).toBe(200);
      expect(mockService.cancelSlot).toHaveBeenCalledWith('slot-1', 'seller-1');
    });
  });

  describe('POST /seller/viewings/:id/feedback', () => {
    it('submits feedback with rating', async () => {
      mockService.submitFeedback.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/seller/viewings/v-1/feedback')
        .send({ feedback: 'Good viewing', interestRating: '4' });

      expect(res.status).toBe(200);
      expect(mockService.submitFeedback).toHaveBeenCalledWith('v-1', 'seller-1', {
        feedback: 'Good viewing',
        interestRating: 4,
      });
    });
  });

  describe('POST /seller/viewings/:id/no-show', () => {
    it('marks viewing as no-show', async () => {
      mockService.markNoShow.mockResolvedValue(undefined);

      const res = await request(app).post('/seller/viewings/v-1/no-show');

      expect(res.status).toBe(200);
    });
  });

  describe('POST /seller/viewings/:id/complete', () => {
    it('marks viewing as completed', async () => {
      mockService.markCompleted.mockResolvedValue(undefined);

      const res = await request(app).post('/seller/viewings/v-1/complete');

      expect(res.status).toBe(200);
    });
  });

  // ─── Public Routes ─────────────────────────────────────

  describe('POST /view/:propertySlug/book', () => {
    it('returns fake success for honeypot-filled form', async () => {
      mockService.initiateBooking.mockResolvedValue({ spam: true });

      const res = await request(app)
        .post('/view/test-slug/book')
        .send({
          name: 'Bot',
          phone: '91234567',
          viewerType: 'buyer',
          consentService: 'true',
          slotId: 'slot-1',
          website: 'spam.com',
          formLoadedAt: String(Date.now() - 10000),
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns OTP form for new viewer', async () => {
      mockService.initiateBooking.mockResolvedValue({
        viewingId: 'v-1',
        status: 'pending_otp',
        isReturningViewer: false,
      });

      const res = await request(app)
        .post('/view/test-slug/book')
        .send({
          name: 'John',
          phone: '91234567',
          viewerType: 'buyer',
          consentService: 'true',
          slotId: 'slot-1',
          formLoadedAt: String(Date.now() - 10000),
        });

      expect(res.status).toBe(200);
      expect(res.body.requiresOtp).toBe(true);
    });
  });

  describe('POST /view/:propertySlug/verify-otp', () => {
    it('confirms booking after OTP', async () => {
      mockService.verifyOtp.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/view/test-slug/verify-otp')
        .send({ phone: '91234567', otp: '123456', bookingId: 'v-1' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('POST /view/cancel/:viewingId/:cancelToken', () => {
    it('cancels the viewing', async () => {
      mockService.cancelViewing.mockResolvedValue(undefined);

      await request(app).post('/view/cancel/v-1/token-123');

      expect(mockService.cancelViewing).toHaveBeenCalledWith('v-1', 'token-123');
    });
  });
});
