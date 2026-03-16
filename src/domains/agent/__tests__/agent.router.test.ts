import request from 'supertest';
import express, { NextFunction, Request, Response } from 'express';
import { agentRouter } from '../agent.router';
import * as agentService from '../agent.service';
import * as sellerService from '@/domains/seller/seller.service';
import * as caseFlagService from '@/domains/seller/case-flag.service';
import { NotFoundError, ValidationError } from '@/domains/shared/errors';

jest.mock('../agent.service');
jest.mock('@/domains/seller/seller.service');
jest.mock('@/domains/seller/case-flag.service');

const mockService = agentService as jest.Mocked<typeof agentService>;
const mockSellerService = sellerService as jest.Mocked<typeof sellerService>;
const mockCaseFlagService = caseFlagService as jest.Mocked<typeof caseFlagService>;

// Minimal test app with mock auth
function createTestApp(user?: { id: string; role: string }) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Mock auth middleware
  app.use((req, _res, next) => {
    if (user) {
      Object.assign(req, {
        isAuthenticated: () => true,
        user: {
          id: user.id,
          role: user.role,
          email: 'test@test.local',
          name: 'Test User',
          twoFactorEnabled: true,
          twoFactorVerified: true,
        },
      });
    } else {
      Object.assign(req, {
        isAuthenticated: () => false,
      });
    }
    next();
  });

  // Override res.render to avoid view lookup issues in tests
  app.use((_req, res, next) => {
    const originalRender = res.render.bind(res);
    res.render = ((_view: string, _options?: object) => {
      res.status(200).send('<html></html>');
    }) as typeof res.render;
    void originalRender; // suppress unused
    next();
  });

  app.use(agentRouter);

  // Error handler
  app.use(
    (err: Error & { statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
      res.status(err.statusCode || 500).json({ error: err.message });
    },
  );

  return app;
}

describe('agent.router', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('GET /agent/dashboard', () => {
    it('returns 401 for unauthenticated users', async () => {
      const app = createTestApp();
      const res = await request(app).get('/agent/dashboard');
      expect(res.status).toBe(401);
    });

    it('returns 403 for sellers', async () => {
      const app = createTestApp({ id: 'seller-1', role: 'seller' });
      const res = await request(app).get('/agent/dashboard');
      expect(res.status).toBe(403);
    });

    it('returns 200 for agents', async () => {
      const app = createTestApp({ id: 'agent-1', role: 'agent' });
      mockService.getPipelineOverview.mockResolvedValue({
        stages: [],
        recentActivity: [],
        pendingReviewCount: 0,
        unassignedLeadCount: 0,
      });

      const res = await request(app).get('/agent/dashboard');
      expect(res.status).toBe(200);
      expect(mockService.getPipelineOverview).toHaveBeenCalledWith('agent-1');
    });

    it('returns 200 for admins (no agentId filter)', async () => {
      const app = createTestApp({ id: 'admin-1', role: 'admin' });
      mockService.getPipelineOverview.mockResolvedValue({
        stages: [],
        recentActivity: [],
        pendingReviewCount: 0,
        unassignedLeadCount: 0,
      });

      const res = await request(app).get('/agent/dashboard');
      expect(res.status).toBe(200);
      expect(mockService.getPipelineOverview).toHaveBeenCalledWith(undefined);
    });
  });

  describe('GET /agent/sellers', () => {
    it('passes filter query params to service', async () => {
      const app = createTestApp({ id: 'agent-1', role: 'agent' });
      mockService.getSellerList.mockResolvedValue({
        sellers: [],
        total: 0,
        page: 1,
        limit: 25,
        totalPages: 0,
      });

      await request(app).get('/agent/sellers?status=active&town=TAMPINES');

      expect(mockService.getSellerList).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'active', town: 'TAMPINES' }),
        'agent-1',
      );
    });
  });

  describe('GET /agent/sellers/:id', () => {
    it("returns seller detail for agent's own seller", async () => {
      const app = createTestApp({ id: 'agent-1', role: 'agent' });
      mockService.getSellerDetail.mockResolvedValue({
        id: 'seller-1',
        name: 'John',
        status: 'active',
      } as unknown as Awaited<ReturnType<typeof agentService.getSellerDetail>>);

      const res = await request(app).get('/agent/sellers/seller-1');
      expect(res.status).toBe(200);
      expect(mockService.getSellerDetail).toHaveBeenCalledWith('seller-1', 'agent-1');
    });

    it('returns 404 when seller not found', async () => {
      const app = createTestApp({ id: 'agent-1', role: 'agent' });
      mockService.getSellerDetail.mockRejectedValue(new NotFoundError('Seller', 'nonexistent'));

      const res = await request(app).get('/agent/sellers/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /agent/leads', () => {
    it('returns lead queue for agent', async () => {
      const app = createTestApp({ id: 'agent-1', role: 'agent' });
      mockService.getLeadQueue.mockResolvedValue({ unassigned: [], all: [] });

      const res = await request(app).get('/agent/leads');
      expect(res.status).toBe(200);
      expect(mockService.getLeadQueue).toHaveBeenCalledWith('agent-1');
    });
  });

  describe('POST /agent/sellers/:id/case-flags', () => {
    it('creates a case flag and returns 201', async () => {
      const app = createTestApp({ id: 'agent-1', role: 'agent' });
      mockCaseFlagService.createCaseFlag.mockResolvedValue({
        id: 'flag-1',
        flagType: 'mop_not_met',
        status: 'identified',
      } as never);

      const res = await request(app)
        .post('/agent/sellers/seller-1/case-flags')
        .send({ flagType: 'mop_not_met', description: 'MOP date is 2027-01' });

      expect(res.status).toBe(201);
      expect(res.body.flag).toMatchObject({ id: 'flag-1' });
    });

    it('returns 400 for invalid flagType', async () => {
      const app = createTestApp({ id: 'agent-1', role: 'agent' });

      const res = await request(app)
        .post('/agent/sellers/seller-1/case-flags')
        .send({ flagType: 'not_a_valid_type', description: 'test' });

      expect(res.status).toBe(400);
    });

    it('returns 401 for unauthenticated users', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/agent/sellers/seller-1/case-flags')
        .send({ flagType: 'other', description: 'test' });
      expect(res.status).toBe(401);
    });
  });

  describe('PUT /agent/sellers/:id/case-flags/:flagId', () => {
    it('updates a case flag and returns 200', async () => {
      const app = createTestApp({ id: 'agent-1', role: 'agent' });
      mockCaseFlagService.updateCaseFlag.mockResolvedValue({
        id: 'flag-1',
        status: 'in_progress',
      } as never);

      const res = await request(app)
        .put('/agent/sellers/seller-1/case-flags/flag-1')
        .send({ status: 'in_progress', guidanceProvided: 'Waiting for probate' });

      expect(res.status).toBe(200);
      expect(res.body.flag).toMatchObject({ status: 'in_progress' });
    });

    it('returns 400 for invalid status', async () => {
      const app = createTestApp({ id: 'agent-1', role: 'agent' });

      const res = await request(app)
        .put('/agent/sellers/seller-1/case-flags/flag-1')
        .send({ status: 'not_valid' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /agent/sellers/:id/status-modal', () => {
    it('returns 200 with advance modal for a lead seller', async () => {
      const app = createTestApp({ id: 'agent-1', role: 'agent' });
      mockService.getSellerDetail.mockResolvedValue({
        id: 'seller-1',
        status: 'lead',
      } as unknown as Awaited<ReturnType<typeof agentService.getSellerDetail>>);

      const res = await request(app).get('/agent/sellers/seller-1/status-modal?action=advance');
      expect(res.status).toBe(200);
    });

    it('returns 400 when action=advance and seller status is archived', async () => {
      const app = createTestApp({ id: 'agent-1', role: 'agent' });
      mockService.getSellerDetail.mockResolvedValue({
        id: 'seller-1',
        status: 'archived',
      } as unknown as Awaited<ReturnType<typeof agentService.getSellerDetail>>);

      const res = await request(app).get('/agent/sellers/seller-1/status-modal?action=advance');
      expect(res.status).toBe(400);
    });

    it('returns 400 when action=advance and seller status is completed', async () => {
      const app = createTestApp({ id: 'agent-1', role: 'agent' });
      mockService.getSellerDetail.mockResolvedValue({
        id: 'seller-1',
        status: 'completed',
      } as unknown as Awaited<ReturnType<typeof agentService.getSellerDetail>>);

      const res = await request(app).get('/agent/sellers/seller-1/status-modal?action=advance');
      expect(res.status).toBe(400);
    });

    it('returns 200 for archive action on an engaged seller', async () => {
      const app = createTestApp({ id: 'agent-1', role: 'agent' });
      mockService.getSellerDetail.mockResolvedValue({
        id: 'seller-1',
        status: 'engaged',
      } as unknown as Awaited<ReturnType<typeof agentService.getSellerDetail>>);

      const res = await request(app).get('/agent/sellers/seller-1/status-modal?action=archive');
      expect(res.status).toBe(200);
    });

    it('returns 404 when seller not found', async () => {
      const app = createTestApp({ id: 'agent-1', role: 'agent' });
      mockService.getSellerDetail.mockRejectedValue(new NotFoundError('Seller', 'bad-id'));

      const res = await request(app).get('/agent/sellers/bad-id/status-modal?action=advance');
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /agent/sellers/:id/status — note threading', () => {
    it('passes note to sellerService.updateSellerStatus', async () => {
      const app = createTestApp({ id: 'agent-1', role: 'agent' });
      mockSellerService.updateSellerStatus.mockResolvedValue({
        id: 'seller-1',
        status: 'engaged',
      } as never);

      await request(app)
        .put('/agent/sellers/seller-1/status')
        .send({ status: 'engaged', note: 'Consultation done' });

      expect(mockSellerService.updateSellerStatus).toHaveBeenCalledWith(
        'seller-1',
        'engaged',
        'agent-1',
        'Consultation done',
      );
    });

    it('returns 400 when service throws ValidationError for missing note', async () => {
      const app = createTestApp({ id: 'agent-1', role: 'agent' });
      mockSellerService.updateSellerStatus.mockRejectedValue(
        new ValidationError('A note is required for this status transition'),
      );

      const res = await request(app)
        .put('/agent/sellers/seller-1/status')
        .send({ status: 'engaged' });

      expect(res.status).toBe(400);
    });

    it('returns 200 for a valid status update without note (active→completed)', async () => {
      const app = createTestApp({ id: 'agent-1', role: 'agent' });
      mockSellerService.updateSellerStatus.mockResolvedValue({
        id: 'seller-1',
        status: 'completed',
      } as never);

      const res = await request(app)
        .put('/agent/sellers/seller-1/status')
        .send({ status: 'completed' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ seller: { id: 'seller-1', status: 'completed' } });
    });

    it('returns 200 with re-rendered header for HTMX requests', async () => {
      const app = createTestApp({ id: 'agent-1', role: 'agent' });
      mockSellerService.updateSellerStatus.mockResolvedValue({
        id: 'seller-1',
        status: 'engaged',
      } as never);
      mockService.getSellerDetail.mockResolvedValue({
        id: 'seller-1',
        status: 'engaged',
      } as unknown as Awaited<ReturnType<typeof agentService.getSellerDetail>>);

      const res = await request(app)
        .put('/agent/sellers/seller-1/status')
        .set('HX-Request', 'true')
        .send({ status: 'engaged', note: 'Consultation done' });

      expect(res.status).toBe(200);
      expect(mockService.getSellerDetail).toHaveBeenCalledWith('seller-1', 'agent-1');
    });
  });
});
