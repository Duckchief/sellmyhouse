import request from 'supertest';
import express from 'express';
import { agentRouter } from '../agent.router';
import * as agentService from '../agent.service';
import { NotFoundError } from '@/domains/shared/errors';

jest.mock('../agent.service');

const mockService = agentService as jest.Mocked<typeof agentService>;

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
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });

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
      } as any);

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
      mockService.getLeadQueue.mockResolvedValue([]);

      const res = await request(app).get('/agent/leads');
      expect(res.status).toBe(200);
      expect(mockService.getLeadQueue).toHaveBeenCalledWith('agent-1');
    });
  });
});
