import request from 'supertest';
import express from 'express';
import { reviewRouter } from '../review.router';
import * as reviewService from '../review.service';

jest.mock('../review.service');

const mockService = reviewService as jest.Mocked<typeof reviewService>;

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

  app.use(reviewRouter);

  // Error handler
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });

  return app;
}

describe('GET /agent/reviews', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    const app = createTestApp();
    const res = await request(app).get('/agent/reviews');
    expect(res.status).toBe(401);
  });

  it('returns 403 for sellers', async () => {
    const app = createTestApp({ id: 'seller-1', role: 'seller' });
    const res = await request(app).get('/agent/reviews');
    expect(res.status).toBe(403);
  });

  it('returns 200 for agents', async () => {
    const app = createTestApp({ id: 'agent-1', role: 'agent' });
    mockService.getPendingQueue.mockResolvedValue({
      items: [],
      totalCount: 0,
      countByType: {
        financial_report: 0,
        listing_description: 0,
        listing_photos: 0,
        weekly_update: 0,
        market_content: 0,
        document_checklist: 0,
      },
    });

    const res = await request(app).get('/agent/reviews');
    expect(res.status).toBe(200);
    expect(mockService.getPendingQueue).toHaveBeenCalledWith('agent-1');
  });

  it('returns 200 for admins (no agentId filter)', async () => {
    const app = createTestApp({ id: 'admin-1', role: 'admin' });
    mockService.getPendingQueue.mockResolvedValue({
      items: [],
      totalCount: 0,
      countByType: {
        financial_report: 0,
        listing_description: 0,
        listing_photos: 0,
        weekly_update: 0,
        market_content: 0,
        document_checklist: 0,
      },
    });

    const res = await request(app).get('/agent/reviews');
    expect(res.status).toBe(200);
    expect(mockService.getPendingQueue).toHaveBeenCalledWith(undefined);
  });
});
