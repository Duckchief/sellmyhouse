// src/domains/admin/__tests__/admin.router.test.ts
import request from 'supertest';
import express, { NextFunction, Request, Response } from 'express';
import { adminRouter } from '../admin.router';
import * as contentService from '../../content/content.service';
import * as adminService from '../admin.service';

jest.mock('../../content/content.service');
jest.mock('../admin.service');
jest.mock('@/domains/profile/profile.service', () => ({
  getHasAvatar: jest.fn().mockResolvedValue(false),
}));

const mockAdminService = adminService as jest.Mocked<typeof adminService>;

const mockTutorials = {
  photography: [
    {
      id: '1',
      title: 'Photo A',
      slug: 'photo-a',
      orderIndex: 1,
      category: 'photography',
      youtubeUrl: 'https://youtube.com/1',
    },
    {
      id: '2',
      title: 'Photo B',
      slug: 'photo-b',
      orderIndex: 2,
      category: 'photography',
      youtubeUrl: 'https://youtube.com/2',
    },
  ],
  forms: [
    {
      id: '3',
      title: 'Form A',
      slug: 'form-a',
      orderIndex: 1,
      category: 'forms',
      youtubeUrl: 'https://youtube.com/3',
    },
  ],
  process: [],
  financial: [],
};

function makeApp() {
  const app = express();
  app.use(express.urlencoded({ extended: true }));

  // Mock auth
  app.use((req, _res, next) => {
    Object.assign(req, {
      isAuthenticated: () => true,
      user: { id: 'admin-1', role: 'admin', twoFactorEnabled: false, twoFactorVerified: true },
    });
    next();
  });

  // Stub res.render to avoid real view lookup
  app.use((_req, res, next) => {
    res.render = ((_view: string, _options?: object) => {
      res.status(200).send('<html></html>');
    }) as typeof res.render;
    next();
  });

  app.use(adminRouter);

  // Error handler
  app.use(
    (err: Error & { statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
      res.status(err.statusCode || 500).json({ error: err.message });
    },
  );

  return app;
}

describe('GET /admin/tutorials — tab param', () => {
  beforeEach(() => {
    jest.mocked(contentService.getTutorialsGrouped).mockResolvedValue(mockTutorials as any);
  });

  it('defaults activeTab to photography when no tab param', async () => {
    const app = makeApp();
    const res = await request(app).get('/admin/tutorials');
    expect(res.status).toBe(200);
  });

  it('accepts a valid tab param', async () => {
    const app = makeApp();
    const res = await request(app).get('/admin/tutorials?tab=forms');
    expect(res.status).toBe(200);
  });

  it('falls back to photography for an invalid tab param', async () => {
    const app = makeApp();
    const res = await request(app).get('/admin/tutorials?tab=invalid');
    expect(res.status).toBe(200);
  });

  it('returns partial for HTMX request', async () => {
    const app = makeApp();
    const res = await request(app).get('/admin/tutorials?tab=forms').set('HX-Request', 'true');
    expect(res.status).toBe(200);
  });
});

describe('POST /admin/content/testimonials — manual testimonial creation', () => {
  const mockTestimonials = [
    {
      id: 't-1',
      clientName: 'Alice Tan',
      clientTown: 'Ang Mo Kio',
      rating: 5,
      content: 'Great service from start to finish.',
      source: null,
      status: 'approved',
    },
  ];

  // makeApp stubs res.render to always send 200. For the 422 test we need a
  // variant that preserves the status code set before render is called.
  function makeAppStatusPreserving() {
    const app = express();
    app.use(express.urlencoded({ extended: true }));

    app.use((req, _res, next) => {
      Object.assign(req, {
        isAuthenticated: () => true,
        user: { id: 'admin-1', role: 'admin', twoFactorEnabled: false, twoFactorVerified: true },
      });
      next();
    });

    app.use((_req, res, next) => {
      res.render = ((_view: string, _options?: object) => {
        // Preserve whatever status was set by the route before calling render.
        const current = res.statusCode;
        res.status(current).send('<html></html>');
      }) as typeof res.render;
      next();
    });

    app.use(adminRouter);

    app.use(
      (err: Error & { statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
        res.status(err.statusCode || 500).json({ error: err.message });
      },
    );

    return app;
  }

  beforeEach(() => {
    jest.mocked(contentService.createManualTestimonial).mockResolvedValue(undefined as any);
    jest.mocked(contentService.listTestimonials).mockResolvedValue(mockTestimonials as any);
  });

  it('returns 200 and renders testimonial list on valid HTMX request', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/admin/content/testimonials')
      .set('HX-Request', 'true')
      .type('form')
      .send({
        clientName: 'Alice Tan',
        clientTown: 'Ang Mo Kio',
        rating: '5',
        content: 'Great service from start to finish.',
        source: 'Google',
      });
    expect(res.status).toBe(200);
    expect(contentService.createManualTestimonial).toHaveBeenCalled();
  });

  it('returns 422 when required fields are missing on HTMX request', async () => {
    const app = makeAppStatusPreserving();
    const res = await request(app)
      .post('/admin/content/testimonials')
      .set('HX-Request', 'true')
      .type('form')
      .send({
        clientName: '',
        clientTown: '',
        rating: '',
        content: '',
      });
    expect(res.status).toBe(422);
    expect(contentService.createManualTestimonial).not.toHaveBeenCalled();
  });
});

describe('GET /admin/content/testimonials/new — drawer form partial', () => {
  it('returns 200 with drawer form content', async () => {
    const app = makeApp();
    const res = await request(app).get('/admin/content/testimonials/new').set('HX-Request', 'true');
    expect(res.status).toBe(200);
  });
});

describe('GET /admin/content/testimonials/:id', () => {
  it('returns 200 with drawer partial for a known testimonial', async () => {
    jest.mocked(contentService.getTestimonialById).mockResolvedValue({
      id: 't-1',
      clientName: 'Mary L.',
      clientTown: 'Bishan',
      rating: 5,
      content: 'Great service!',
      source: null,
      isManual: false,
      status: 'approved',
      displayOnWebsite: true,
    } as any);

    const app = makeApp();
    const res = await request(app).get('/admin/content/testimonials/t-1').set('HX-Request', 'true');
    expect(res.status).toBe(200);
    expect(contentService.getTestimonialById).toHaveBeenCalledWith('t-1');
  });

  it('returns 404 for an unknown testimonial', async () => {
    const { NotFoundError } = await import('@/domains/shared/errors');
    jest
      .mocked(contentService.getTestimonialById)
      .mockRejectedValue(new NotFoundError('Testimonial', 'bad-id'));

    const app = makeApp();
    const res = await request(app).get('/admin/content/testimonials/bad-id');
    expect(res.status).toBe(404);
  });

  it('redirects to list on non-HTMX request', async () => {
    jest.mocked(contentService.getTestimonialById).mockResolvedValue({
      id: 't-1',
      clientName: 'Mary L.',
      status: 'approved',
    } as any);

    const app = makeApp();
    const res = await request(app).get('/admin/content/testimonials/t-1');
    // No HX-Request header — should redirect
    expect(res.status).toBe(302);
  });
});

describe('POST /admin/content/testimonials/:id/approve — HTMX', () => {
  it('returns 200 with list partial on HTMX request', async () => {
    jest.mocked(contentService.approveTestimonial).mockResolvedValue(undefined as any);
    jest.mocked(contentService.listTestimonials).mockResolvedValue([]);

    const app = makeApp();
    const res = await request(app)
      .post('/admin/content/testimonials/t-1/approve')
      .set('HX-Request', 'true');
    expect(res.status).toBe(200);
    expect(contentService.approveTestimonial).toHaveBeenCalledWith('t-1', 'admin-1');
  });

  it('still redirects on non-HTMX request', async () => {
    jest.mocked(contentService.approveTestimonial).mockResolvedValue(undefined as any);

    const app = makeApp();
    const res = await request(app).post('/admin/content/testimonials/t-1/approve');
    expect(res.status).toBe(302);
  });
});

describe('POST /admin/content/testimonials/:id/reject — HTMX', () => {
  it('returns 200 with list partial on HTMX request', async () => {
    jest.mocked(contentService.rejectTestimonial).mockResolvedValue(undefined as any);
    jest.mocked(contentService.listTestimonials).mockResolvedValue([]);

    const app = makeApp();
    const res = await request(app)
      .post('/admin/content/testimonials/t-1/reject')
      .set('HX-Request', 'true');
    expect(res.status).toBe(200);
    expect(contentService.rejectTestimonial).toHaveBeenCalledWith('t-1', 'admin-1');
  });

  it('still redirects on non-HTMX request', async () => {
    jest.mocked(contentService.rejectTestimonial).mockResolvedValue(undefined as any);

    const app = makeApp();
    const res = await request(app).post('/admin/content/testimonials/t-1/reject');
    expect(res.status).toBe(302);
  });
});

describe('POST /admin/content/testimonials/:id/feature — HTMX', () => {
  it('returns 200 with list partial on HTMX request', async () => {
    jest.mocked(contentService.featureTestimonial).mockResolvedValue(undefined as any);
    jest.mocked(contentService.listTestimonials).mockResolvedValue([]);

    const app = makeApp();
    const res = await request(app)
      .post('/admin/content/testimonials/t-1/feature')
      .send('displayOnWebsite=true')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .set('HX-Request', 'true');
    expect(res.status).toBe(200);
    expect(contentService.featureTestimonial).toHaveBeenCalledWith('t-1', true);
  });

  it('still redirects on non-HTMX request', async () => {
    jest.mocked(contentService.featureTestimonial).mockResolvedValue(undefined as any);

    const app = makeApp();
    const res = await request(app)
      .post('/admin/content/testimonials/t-1/feature')
      .send('displayOnWebsite=false')
      .set('Content-Type', 'application/x-www-form-urlencoded');
    expect(res.status).toBe(302);
  });
});

describe('GET /admin/content/market — list handler', () => {
  const mockRecords = [
    { id: 'mc-1', period: '2026-03', status: 'approved', rawData: {} },
    { id: 'mc-2', period: '2026-02', status: 'pending_review', rawData: {} },
  ];

  beforeEach(() => {
    jest.mocked(contentService.listMarketContent).mockResolvedValue(mockRecords as any);
  });

  it('no filter — calls listMarketContent once with no args and passes activeStatus as empty string', async () => {
    const app = makeApp();
    const res = await request(app).get('/admin/content/market');
    expect(res.status).toBe(200);
    expect(contentService.listMarketContent).toHaveBeenCalledTimes(1);
    expect(contentService.listMarketContent).toHaveBeenCalledWith(undefined);
  });

  it('with status filter — calls listMarketContent twice: once filtered, once for hasPendingReview', async () => {
    const app = makeApp();
    const res = await request(app).get('/admin/content/market?status=pending_review');
    expect(res.status).toBe(200);
    expect(contentService.listMarketContent).toHaveBeenCalledTimes(2);
    expect(contentService.listMarketContent).toHaveBeenNthCalledWith(1, 'pending_review');
    expect(contentService.listMarketContent).toHaveBeenNthCalledWith(2);
  });

  it('HTMX partial request — returns 200 with activeStatus and hasPendingReview in render context', async () => {
    let capturedOptions: Record<string, unknown> = {};
    const app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use((req, _res, next) => {
      Object.assign(req, {
        isAuthenticated: () => true,
        user: { id: 'admin-1', role: 'admin', twoFactorEnabled: false, twoFactorVerified: true },
      });
      next();
    });
    app.use((_req, res, next) => {
      res.render = ((_view: string, options?: object) => {
        capturedOptions = (options ?? {}) as Record<string, unknown>;
        res.status(200).send('<html></html>');
      }) as typeof res.render;
      next();
    });
    app.use(adminRouter);
    app.use(
      (
        err: Error & { statusCode?: number },
        _req: Request,
        res: Response,
        _next: NextFunction,
      ) => {
        res.status(err.statusCode || 500).json({ error: err.message });
      },
    );

    const res = await request(app).get('/admin/content/market').set('HX-Request', 'true');
    expect(res.status).toBe(200);
    expect(capturedOptions).toHaveProperty('activeStatus', '');
    expect(capturedOptions).toHaveProperty('hasPendingReview', true);
  });
});

describe('GET /admin/content/market/:id/detail — slide-out panel', () => {
  it('renders the detail panel partial with record and statusColors', async () => {
    jest.mocked(contentService.getMarketContentById).mockResolvedValue({
      id: 'mc-1',
      period: '2026-03',
      status: 'pending_review',
      aiNarrative: 'Market is strong.',
      rawData: {},
      createdAt: new Date('2026-03-01'),
      approvedAt: null,
    } as any);

    const app = makeApp();
    const res = await request(app)
      .get('/admin/content/market/mc-1/detail')
      .set('HX-Request', 'true');
    expect(res.status).toBe(200);
    expect(contentService.getMarketContentById).toHaveBeenCalledWith('mc-1');
  });

  it('returns 404 for an unknown record', async () => {
    const { NotFoundError } = await import('@/domains/shared/errors');
    jest
      .mocked(contentService.getMarketContentById)
      .mockRejectedValue(new NotFoundError('MarketContent', 'bad-id'));

    const app = makeApp();
    const res = await request(app).get('/admin/content/market/bad-id/detail');
    expect(res.status).toBe(404);
  });
});

describe('POST /admin/content/market/:id/approve', () => {
  it('renders the row partial on HTMX request', async () => {
    jest.mocked(contentService.approveMarketContent).mockResolvedValue(undefined as any);
    jest.mocked(contentService.getMarketContentById).mockResolvedValue({
      id: 'mc-1',
      period: '2026-03',
      status: 'approved',
      rawData: {},
    } as any);

    const app = makeApp();
    const res = await request(app)
      .post('/admin/content/market/mc-1/approve')
      .set('HX-Request', 'true');
    expect(res.status).toBe(200);
    expect(contentService.approveMarketContent).toHaveBeenCalledWith('mc-1', 'admin-1');
    expect(contentService.getMarketContentById).toHaveBeenCalledWith('mc-1');
  });

  it('redirects to list on non-HTMX request', async () => {
    jest.mocked(contentService.approveMarketContent).mockResolvedValue(undefined as any);

    const app = makeApp();
    const res = await request(app).post('/admin/content/market/mc-1/approve');
    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('/admin/content/market');
  });
});

describe('POST /admin/content/market/:id/reject', () => {
  it('renders the row partial on HTMX request', async () => {
    jest.mocked(contentService.rejectMarketContent).mockResolvedValue(undefined as any);
    jest.mocked(contentService.getMarketContentById).mockResolvedValue({
      id: 'mc-1',
      period: '2026-03',
      status: 'rejected',
      rawData: {},
    } as any);

    const app = makeApp();
    const res = await request(app)
      .post('/admin/content/market/mc-1/reject')
      .set('HX-Request', 'true');
    expect(res.status).toBe(200);
    expect(contentService.rejectMarketContent).toHaveBeenCalledWith('mc-1');
    expect(contentService.getMarketContentById).toHaveBeenCalledWith('mc-1');
  });

  it('redirects to list on non-HTMX request', async () => {
    jest.mocked(contentService.rejectMarketContent).mockResolvedValue(undefined as any);

    const app = makeApp();
    const res = await request(app).post('/admin/content/market/mc-1/reject');
    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('/admin/content/market');
  });
});

describe('GET /admin/dashboard — preset param', () => {
  beforeEach(() => {
    mockAdminService.getAnalytics.mockResolvedValue({
      revenue: {
        totalRevenue: 0,
        completedCount: 0,
        pipelineValue: 0,
        activeTransactions: 0,
        pendingInvoices: 0,
        commissionPerTransaction: 0,
      },
      funnel: { lead: 0, engaged: 0, active: 0, completed: 0, archived: 0 },
      timeToClose: { averageDays: 0, count: 0, byFlatType: {} },
      leadSources: {},
      viewings: { totalViewings: 0, completed: 0, noShowRate: 0, cancellationRate: 0 },
      referrals: {
        totalLinks: 0,
        totalClicks: 0,
        leadsCreated: 0,
        transactionsCompleted: 0,
        conversionRate: 0,
        topReferrers: [],
      },
    } as any);
  });

  it('passes preset param through to getAnalytics', async () => {
    const app = makeApp();
    await request(app).get('/admin/dashboard?preset=this-month');
    expect(mockAdminService.getAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({ preset: 'this-month' }),
    );
  });

  it('passes undefined preset when not provided', async () => {
    const app = makeApp();
    await request(app).get('/admin/dashboard');
    expect(mockAdminService.getAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({ preset: undefined }),
    );
  });
});
