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

  // Mock res.render for template routes
  app.use((_req, res, next) => {
    const originalRender = res.render.bind(res);
    res.render = function (
      view: string,
      options?: object,
      callback?: (err: Error, html: string) => void,
    ) {
      if (typeof callback === 'function') {
        return originalRender(view, options, callback);
      }
      return res.status(200).json({ _view: view, ...options });
    } as typeof res.render;
    next();
  });

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

  describe('POST /seller/viewings/slots/bulk-delete', () => {
    it('bulk cancels slots and returns count', async () => {
      mockService.bulkCancelSlots.mockResolvedValue({ cancelled: 3 });

      const res = await request(app)
        .post('/seller/viewings/slots/bulk-delete')
        .send({ slotIds: ['slot-1', 'slot-2', 'slot-3'] });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, cancelled: 3 });
      expect(mockService.bulkCancelSlots).toHaveBeenCalledWith(
        ['slot-1', 'slot-2', 'slot-3'],
        'seller-1',
      );
    });

    it('returns 400 when slotIds is missing', async () => {
      const res = await request(app).post('/seller/viewings/slots/bulk-delete').send({});

      expect(res.status).toBe(400);
    });

    it('returns 400 when slotIds is empty', async () => {
      const res = await request(app)
        .post('/seller/viewings/slots/bulk-delete')
        .send({ slotIds: [] });

      expect(res.status).toBe(400);
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

  describe('POST /seller/viewings/schedule', () => {
    it('saves schedule and returns 200', async () => {
      mockService.saveSchedule.mockResolvedValue({
        id: 'sched-1',
        propertyId: 'prop-1',
        days: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

      const res = await request(app)
        .post('/seller/viewings/schedule')
        .send({
          days: [
            {
              dayOfWeek: 1,
              timeslots: [{ startTime: '18:00', endTime: '20:00', slotType: 'single' }],
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(mockService.saveSchedule).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ dayOfWeek: 1 })]),
        expect.any(String), // sellerId
      );
    });

    it('returns 400 for invalid days', async () => {
      const res = await request(app).post('/seller/viewings/schedule').send({ days: [] }); // empty array
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /seller/viewings/schedule', () => {
    it('deletes schedule and returns 200', async () => {
      mockService.deleteSchedule.mockResolvedValue(undefined);

      const res = await request(app).delete('/seller/viewings/schedule');

      expect(res.status).toBe(200);
      expect(mockService.deleteSchedule).toHaveBeenCalledWith(expect.any(String)); // sellerId
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

  describe('GET /seller/viewings/slots/date-sidebar', () => {
    it('returns 200 with sidebar data', async () => {
      mockService.getSlotsForDate.mockResolvedValue({
        slots: [],
        nextGap: { start: '10:00', end: '11:00' },
        date: new Date('2026-03-17T00:00:00.000Z'),
      } as never);

      const res = await request(app).get(
        '/seller/viewings/slots/date-sidebar?date=2026-03-17&propertyId=prop-1',
      );

      expect(res.status).toBe(200);
      expect(mockService.getSlotsForDate).toHaveBeenCalledWith('prop-1', '2026-03-17', 'seller-1');
    });

    it('returns 400 when date is missing', async () => {
      const res = await request(app).get('/seller/viewings/slots/date-sidebar?propertyId=prop-1');

      expect(res.status).toBe(400);
    });

    it('returns 400 when propertyId is missing', async () => {
      const res = await request(app).get('/seller/viewings/slots/date-sidebar?date=2026-03-17');

      expect(res.status).toBe(400);
    });
  });

  describe('GET /seller/viewings/slots/month-meta', () => {
    it('returns JSON slot metadata for a month', async () => {
      mockService.getMonthSlotMeta.mockResolvedValue({
        '2026-03-17': { available: 2, full: 1 },
      });

      const res = await request(app).get(
        '/seller/viewings/slots/month-meta?month=2026-03&propertyId=prop-1',
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ '2026-03-17': { available: 2, full: 1 } });
      expect(mockService.getMonthSlotMeta).toHaveBeenCalledWith('prop-1', 2026, 3, 'seller-1');
    });

    it('returns 400 when month format is invalid', async () => {
      const res = await request(app).get(
        '/seller/viewings/slots/month-meta?month=invalid&propertyId=prop-1',
      );

      expect(res.status).toBe(400);
    });
  });

  // ─── Role Enforcement ──────────────────────────────────

  describe('seller routes reject non-seller users', () => {
    let agentApp: express.Application;

    beforeAll(() => {
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
      app.use(viewingRouter);
      agentApp = app;
    });

    it.each([
      ['GET', '/seller/viewings'],
      ['GET', '/seller/viewings/slots/date-sidebar'],
      ['GET', '/seller/viewings/slots/month-meta'],
      ['POST', '/seller/viewings/slots'],
      ['POST', '/seller/viewings/slots/bulk-delete'],
      ['POST', '/seller/viewings/schedule'],
      ['DELETE', '/seller/viewings/schedule'],
      ['DELETE', '/seller/viewings/slots/slot-1'],
      ['POST', '/seller/viewings/v-1/feedback'],
      ['POST', '/seller/viewings/v-1/no-show'],
      ['POST', '/seller/viewings/v-1/complete'],
    ])('%s %s returns 403 for agent role', async (method, path) => {
      const res = await (request(agentApp) as never as Record<string, (p: string) => request.Test>)[
        method.toLowerCase()
      ](path);
      expect(res.status).toBe(403);
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
