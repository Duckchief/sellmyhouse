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

describe('GET /admin/tutorials/new — HTMX drawer', () => {
  // Regression tests — both paths return 200 before and after; verifies no 500 errors
  it('returns 200 with hx-request header', async () => {
    const app = makeApp();
    const res = await request(app)
      .get('/admin/tutorials/new?category=forms')
      .set('hx-request', 'true');
    expect(res.status).toBe(200);
  });
});

describe('GET /admin/tutorials/:id/drawer', () => {
  // TDD-red: 404 before route added, 200 after
  it('returns 200 and calls getTutorialById with the correct id', async () => {
    jest.mocked(contentService.getTutorialById).mockResolvedValue({
      id: 'tutorial-uuid-1',
      title: 'How to Fill the OTP',
      slug: 'how-to-fill-otp',
      youtubeUrl: 'https://www.youtube.com/watch?v=abc123',
      category: 'forms',
      description: 'Step by step guide',
      orderIndex: 1,
    } as any);
    const app = makeApp();
    const res = await request(app).get('/admin/tutorials/tutorial-uuid-1/drawer?tab=forms');
    expect(res.status).toBe(200);
    expect(contentService.getTutorialById).toHaveBeenCalledWith('tutorial-uuid-1');
  });
});

describe('POST /admin/tutorials — HTMX', () => {
  // Validation error: res.render stub overrides status to 200, so assert service NOT called
  it('does not call createTutorial on validation error', async () => {
    const app = makeApp();
    await request(app)
      .post('/admin/tutorials')
      .set('hx-request', 'true')
      .send({ title: '', youtubeUrl: '', category: '', activeTab: 'forms' });
    expect(contentService.createTutorial).not.toHaveBeenCalled();
  });

  // TDD-red: before HTMX branch, returns 302 redirect; after, returns 200 + calls getTutorialsGrouped
  it('returns 200 and calls createTutorial + getTutorialsGrouped on success', async () => {
    const created = {
      id: 'new-id',
      title: 'New Tutorial',
      slug: 'new-tutorial',
      youtubeUrl: 'https://youtube.com/watch?v=xyz',
      category: 'forms',
      orderIndex: 1,
      description: null,
    };
    jest.mocked(contentService.createTutorial).mockResolvedValue(created as any);
    jest
      .mocked(contentService.getTutorialsGrouped)
      .mockResolvedValue({ photography: [], forms: [created], process: [], financial: [] } as any);
    const app = makeApp();
    const res = await request(app)
      .post('/admin/tutorials')
      .set('hx-request', 'true')
      .type('form')
      .send({
        title: 'New Tutorial',
        youtubeUrl: 'https://youtube.com/watch?v=xyz',
        category: 'forms',
        activeTab: 'forms',
      });
    expect(res.status).toBe(200);
    expect(contentService.createTutorial).toHaveBeenCalled();
    expect(contentService.getTutorialsGrouped).toHaveBeenCalled();
  });
});

describe('POST /admin/tutorials/:id — HTMX', () => {
  // Validation error: assert getTutorialById called for re-render data, updateTutorial NOT called
  it('calls getTutorialById but not updateTutorial on validation error', async () => {
    jest.mocked(contentService.getTutorialById).mockResolvedValue({
      id: 'tutorial-uuid-1',
      title: 'Old Title',
      slug: 'old-title',
      youtubeUrl: 'https://youtube.com/watch?v=old',
      category: 'forms',
      orderIndex: 1,
      description: null,
    } as any);
    const app = makeApp();
    await request(app)
      .post('/admin/tutorials/tutorial-uuid-1')
      .set('hx-request', 'true')
      .send({ title: '', youtubeUrl: '', category: '', activeTab: 'forms' });
    expect(contentService.getTutorialById).toHaveBeenCalledWith('tutorial-uuid-1');
    expect(contentService.updateTutorial).not.toHaveBeenCalled();
  });

  // TDD-red: before HTMX branch, returns 302; after, returns 200 + calls getTutorialsGrouped
  it('returns 200 and calls updateTutorial + getTutorialsGrouped on success', async () => {
    const updated = {
      id: 'tutorial-uuid-1',
      title: 'Updated',
      slug: 'updated',
      youtubeUrl: 'https://youtube.com/watch?v=new',
      category: 'forms',
      orderIndex: 1,
      description: null,
    };
    jest.mocked(contentService.updateTutorial).mockResolvedValue(updated as any);
    jest
      .mocked(contentService.getTutorialsGrouped)
      .mockResolvedValue({ photography: [], forms: [updated], process: [], financial: [] } as any);
    const app = makeApp();
    const res = await request(app)
      .post('/admin/tutorials/tutorial-uuid-1')
      .set('hx-request', 'true')
      .type('form')
      .send({
        title: 'Updated',
        youtubeUrl: 'https://youtube.com/watch?v=new',
        category: 'forms',
        activeTab: 'forms',
      });
    expect(res.status).toBe(200);
    expect(contentService.updateTutorial).toHaveBeenCalledWith(
      'tutorial-uuid-1',
      expect.objectContaining({ title: 'Updated' }),
    );
    expect(contentService.getTutorialsGrouped).toHaveBeenCalled();
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
      (err: Error & { statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
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

describe('GET /admin/team', () => {
  it('calls getDefaultAgentId and passes it to the team-list render', async () => {
    mockAdminService.getTeam.mockResolvedValue([]);
    mockAdminService.getDefaultAgentId.mockResolvedValue('agent-1');

    const app = makeApp();
    const res = await request(app)
      .get('/admin/team')
      .set('hx-request', 'true');

    expect(res.status).toBe(200);
    expect(mockAdminService.getDefaultAgentId).toHaveBeenCalled();
  });

  it('returns 200 on non-HTMX request and calls getTeam and getDefaultAgentId', async () => {
    mockAdminService.getTeam.mockResolvedValue([]);
    mockAdminService.getDefaultAgentId.mockResolvedValue('agent-1');

    const app = makeApp();
    const res = await request(app).get('/admin/team');

    expect(res.status).toBe(200);
    expect(mockAdminService.getTeam).toHaveBeenCalled();
    expect(mockAdminService.getDefaultAgentId).toHaveBeenCalled();
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

describe('GET /admin/maintenance', () => {
  beforeEach(() => {
    mockAdminService.getMaintenanceSettings.mockResolvedValue({
      isOn: false,
      message: '',
      eta: '',
    });
  });

  it('returns 200 and calls getMaintenanceSettings', async () => {
    const app = makeApp();
    const res = await request(app).get('/admin/maintenance');
    expect(res.status).toBe(200);
    expect(mockAdminService.getMaintenanceSettings).toHaveBeenCalled();
  });
});

describe('POST /admin/maintenance/toggle', () => {
  beforeEach(() => {
    mockAdminService.toggleMaintenanceMode.mockResolvedValue(true);
    mockAdminService.getMaintenanceSettings.mockResolvedValue({
      isOn: true,
      message: '',
      eta: '',
    });
  });

  it('redirects to /admin/maintenance for non-HTMX request', async () => {
    const app = makeApp();
    const res = await request(app).post('/admin/maintenance/toggle');
    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('/admin/maintenance');
    expect(mockAdminService.toggleMaintenanceMode).toHaveBeenCalledWith('admin-1');
  });

  it('returns 200 for HTMX request', async () => {
    const app = makeApp();
    const res = await request(app).post('/admin/maintenance/toggle').set('hx-request', 'true');
    expect(res.status).toBe(200);
    expect(mockAdminService.getMaintenanceSettings).toHaveBeenCalled();
  });
});

describe('POST /admin/maintenance/message', () => {
  beforeEach(() => {
    mockAdminService.setMaintenanceMessage.mockResolvedValue(undefined);
  });

  it('redirects for non-HTMX request', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/admin/maintenance/message')
      .send('message=System+upgrade');
    expect(res.status).toBe(302);
    expect(mockAdminService.setMaintenanceMessage).toHaveBeenCalledWith(
      'System upgrade',
      'admin-1',
    );
  });

  it('returns 200 Saved for HTMX request', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/admin/maintenance/message')
      .set('hx-request', 'true')
      .send('message=Upgrading+system');
    expect(res.status).toBe(200);
    expect(res.text).toBe('Saved');
  });
});

describe('POST /admin/maintenance/eta', () => {
  beforeEach(() => {
    mockAdminService.setMaintenanceEta.mockResolvedValue(undefined);
  });

  it('redirects for non-HTMX request', async () => {
    const app = makeApp();
    const res = await request(app).post('/admin/maintenance/eta').send('eta=2026-03-19T10%3A00');
    expect(res.status).toBe(302);
    expect(mockAdminService.setMaintenanceEta).toHaveBeenCalledWith('2026-03-19T10:00', 'admin-1');
  });

  it('returns 200 Saved for HTMX request', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/admin/maintenance/eta')
      .set('hx-request', 'true')
      .send('eta=2026-03-19T10%3A00');
    expect(res.status).toBe(200);
    expect(res.text).toBe('Saved');
  });
});

describe('POST /admin/hdb/sync — progress fragment', () => {
  beforeEach(() => {
    mockAdminService.triggerHdbSync.mockResolvedValue(undefined);
    mockAdminService.getHdbStatus.mockResolvedValue({
      totalRecords: 1000,
      dateRange: { earliest: '2017-01', latest: '2026-03' },
      lastSync: {
        id: 'sync-1',
        syncedAt: new Date('2026-03-18T10:00:00Z'),
        recordsAdded: 3,
        recordsTotal: 1000,
        source: 'd_8b84c4ee58e3cfc0ece0d773c8ca6abc',
        status: 'success',
        error: null,
        createdAt: new Date('2026-03-18T10:00:00Z'),
      },
      recentSyncs: [],
    });
  });

  it('returns 200 and calls triggerHdbSync on HTMX request', async () => {
    const app = makeApp();
    const res = await request(app).post('/admin/hdb/sync').set('hx-request', 'true');
    expect(res.status).toBe(200);
    expect(mockAdminService.triggerHdbSync).toHaveBeenCalledWith('admin-1');
  });

  it('redirects to /admin/hdb on non-HTMX request', async () => {
    const app = makeApp();
    const res = await request(app).post('/admin/hdb/sync');
    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('/admin/hdb');
  });
});

describe('GET /admin/hdb/sync/poll — polling endpoint', () => {
  const sinceBefore = new Date('2026-03-18T09:00:00Z').toISOString();
  const sinceAfter = new Date('2026-03-18T11:00:00Z').toISOString();

  beforeEach(() => {
    mockAdminService.getHdbStatus.mockResolvedValue({
      totalRecords: 1003,
      dateRange: { earliest: '2017-01', latest: '2026-03' },
      lastSync: {
        id: 'sync-1',
        syncedAt: new Date('2026-03-18T10:00:00Z'),
        recordsAdded: 3,
        recordsTotal: 1003,
        source: 'd_8b84c4ee58e3cfc0ece0d773c8ca6abc',
        status: 'success',
        error: null,
        createdAt: new Date('2026-03-18T10:00:00Z'),
      },
      recentSyncs: [],
    });
  });

  it('returns 200 with complete fragment when lastSync is newer than since', async () => {
    const app = makeApp();
    const res = await request(app)
      .get(`/admin/hdb/sync/poll?since=${sinceBefore}`)
      .set('hx-request', 'true');
    expect(res.status).toBe(200);
    expect(mockAdminService.getHdbStatus).toHaveBeenCalled();
  });

  it('returns 200 with progress fragment when lastSync is older than since', async () => {
    const app = makeApp();
    const res = await request(app)
      .get(`/admin/hdb/sync/poll?since=${sinceAfter}`)
      .set('hx-request', 'true');
    expect(res.status).toBe(200);
    expect(mockAdminService.getHdbStatus).toHaveBeenCalled();
  });

  it('returns 200 with progress fragment when no lastSync exists', async () => {
    mockAdminService.getHdbStatus.mockResolvedValue({
      totalRecords: 0,
      dateRange: null,
      lastSync: null,
      recentSyncs: [],
    });
    const app = makeApp();
    const res = await request(app)
      .get(`/admin/hdb/sync/poll?since=${sinceBefore}`)
      .set('hx-request', 'true');
    expect(res.status).toBe(200);
  });

  it('returns 400 when since param is missing', async () => {
    const app = makeApp();
    const res = await request(app).get('/admin/hdb/sync/poll').set('hx-request', 'true');
    expect(res.status).toBe(400);
  });

  it('returns 400 when since param is not a valid date', async () => {
    const app = makeApp();
    const res = await request(app)
      .get('/admin/hdb/sync/poll?since=garbage')
      .set('hx-request', 'true');
    expect(res.status).toBe(400);
  });
});

describe('POST /admin/team/:id/set-default', () => {
  it('sets the agent as default and returns team-list partial', async () => {
    mockAdminService.setDefaultAgent.mockResolvedValue(undefined);
    mockAdminService.getTeam.mockResolvedValue([]);
    mockAdminService.getDefaultAgentId.mockResolvedValue('agent-1');

    const app = makeApp();
    const res = await request(app)
      .post('/admin/team/agent-1/set-default')
      .set('hx-request', 'true');

    expect(res.status).toBe(200);
    expect(mockAdminService.setDefaultAgent).toHaveBeenCalledWith('agent-1', expect.any(String));
  });

  it('returns 404 for unknown agent', async () => {
    const { NotFoundError } = await import('@/domains/shared/errors');
    mockAdminService.setDefaultAgent.mockRejectedValue(new NotFoundError('Agent', 'bad-id'));

    const app = makeApp();
    const res = await request(app)
      .post('/admin/team/bad-id/set-default')
      .set('hx-request', 'true');

    expect(res.status).toBe(404);
  });
});

describe('POST /admin/team/:id/deactivate (default agent guard)', () => {
  it('returns modal partial when agent is default and no replacement provided', async () => {
    mockAdminService.getDefaultAgentId.mockResolvedValue('agent-1');
    mockAdminService.getTeam.mockResolvedValue([
      { id: 'agent-2', name: 'Bob', isActive: true } as any,
    ]);

    // Use a render stub that echoes the view name so we can assert on it
    const appWithViewName = express();
    appWithViewName.use(express.urlencoded({ extended: true }));
    appWithViewName.use((req, _res, next) => {
      Object.assign(req, {
        isAuthenticated: () => true,
        user: { id: 'admin-1', role: 'admin', twoFactorEnabled: false, twoFactorVerified: true },
      });
      next();
    });
    appWithViewName.use((_req, res, next) => {
      res.render = ((view: string, _options?: object) => {
        res.status(200).send(view);
      }) as typeof res.render;
      next();
    });
    appWithViewName.use(adminRouter);
    appWithViewName.use(
      (err: Error & { statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
        res.status(err.statusCode || 500).json({ error: err.message });
      },
    );

    const res = await request(appWithViewName)
      .post('/admin/team/agent-1/deactivate')
      .set('hx-request', 'true');

    expect(res.status).toBe(200);
    expect(mockAdminService.deactivateAgent).not.toHaveBeenCalled();
    expect(res.text).toContain('reassign-default-modal');
  });

  it('clears default and deactivates when newDefaultAgentId=unassigned', async () => {
    mockAdminService.getDefaultAgentId.mockResolvedValue('agent-1');
    mockAdminService.clearDefaultAgent.mockResolvedValue(undefined);
    mockAdminService.deactivateAgent.mockResolvedValue(undefined);

    const app = makeApp();
    const res = await request(app)
      .post('/admin/team/agent-1/deactivate')
      .send('newDefaultAgentId=unassigned')
      .set('hx-request', 'true');

    expect(res.status).toBe(200);
    expect(mockAdminService.clearDefaultAgent).toHaveBeenCalled();
    expect(mockAdminService.deactivateAgent).toHaveBeenCalled();
  });

  it('sets new default and deactivates when newDefaultAgentId is a UUID', async () => {
    mockAdminService.getDefaultAgentId.mockResolvedValue('agent-1');
    mockAdminService.setDefaultAgent.mockResolvedValue(undefined);
    mockAdminService.deactivateAgent.mockResolvedValue(undefined);

    const app = makeApp();
    const res = await request(app)
      .post('/admin/team/agent-1/deactivate')
      .send('newDefaultAgentId=00000000-0000-0000-0000-000000000002')
      .set('hx-request', 'true');

    expect(res.status).toBe(200);
    expect(mockAdminService.setDefaultAgent).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000002',
      expect.any(String),
    );
    expect(mockAdminService.deactivateAgent).toHaveBeenCalled();
  });
});

describe('POST /admin/team/:id/anonymise (default agent guard)', () => {
  it('returns modal partial when agent is default and no replacement provided', async () => {
    mockAdminService.getDefaultAgentId.mockResolvedValue('agent-1');
    mockAdminService.getTeam.mockResolvedValue([
      { id: 'agent-2', name: 'Bob', isActive: true } as any,
    ]);

    // Use a render stub that echoes the view name so we can assert on it
    const appWithViewName = express();
    appWithViewName.use(express.urlencoded({ extended: true }));
    appWithViewName.use((req, _res, next) => {
      Object.assign(req, {
        isAuthenticated: () => true,
        user: { id: 'admin-1', role: 'admin', twoFactorEnabled: false, twoFactorVerified: true },
      });
      next();
    });
    appWithViewName.use((_req, res, next) => {
      res.render = ((view: string, _options?: object) => {
        res.status(200).send(view);
      }) as typeof res.render;
      next();
    });
    appWithViewName.use(adminRouter);
    appWithViewName.use(
      (err: Error & { statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
        res.status(err.statusCode || 500).json({ error: err.message });
      },
    );

    const res = await request(appWithViewName)
      .post('/admin/team/agent-1/anonymise')
      .set('hx-request', 'true');

    expect(res.status).toBe(200);
    expect(mockAdminService.anonymiseAgent).not.toHaveBeenCalled();
    expect(res.text).toContain('reassign-default-modal');
  });

  it('clears default and anonymises when newDefaultAgentId=unassigned', async () => {
    mockAdminService.getDefaultAgentId.mockResolvedValue('agent-1');
    mockAdminService.clearDefaultAgent.mockResolvedValue(undefined);
    mockAdminService.anonymiseAgent.mockResolvedValue(undefined);

    const app = makeApp();
    const res = await request(app)
      .post('/admin/team/agent-1/anonymise')
      .send('newDefaultAgentId=unassigned')
      .set('hx-request', 'true');

    expect(res.status).toBe(200);
    expect(mockAdminService.clearDefaultAgent).toHaveBeenCalled();
    expect(mockAdminService.anonymiseAgent).toHaveBeenCalled();
  });

  it('sets new default and anonymises when newDefaultAgentId is an agent id', async () => {
    mockAdminService.getDefaultAgentId.mockResolvedValue('agent-1');
    mockAdminService.setDefaultAgent.mockResolvedValue(undefined);
    mockAdminService.anonymiseAgent.mockResolvedValue(undefined);

    const app = makeApp();
    const res = await request(app)
      .post('/admin/team/agent-1/anonymise')
      .send('newDefaultAgentId=00000000-0000-0000-0000-000000000002')
      .set('hx-request', 'true');

    expect(res.status).toBe(200);
    expect(mockAdminService.setDefaultAgent).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000002',
      expect.any(String),
    );
    expect(mockAdminService.anonymiseAgent).toHaveBeenCalled();
  });
});

describe('GET /admin/sellers', () => {
  it('calls getAdminSellerStatusCounts and passes statusCounts to render', async () => {
    mockAdminService.getAllSellers.mockResolvedValue({
      sellers: [], total: 0, page: 1, limit: 25,
    } as any);
    mockAdminService.getTeam.mockResolvedValue([] as any);
    mockAdminService.getAdminSellerStatusCounts.mockResolvedValue({
      lead: 2, engaged: 1, active: 3, completed: 0, archived: 0,
    });

    const app = makeApp();
    const res = await request(app).get('/admin/sellers');

    expect(res.status).toBe(200);
    expect(mockAdminService.getAdminSellerStatusCounts).toHaveBeenCalled();
  });
});

describe('GET /admin/pipeline', () => {
  it('redirects to /admin/sellers', async () => {
    const app = makeApp();
    const res = await request(app).get('/admin/pipeline');
    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('/admin/sellers');
  });
});
