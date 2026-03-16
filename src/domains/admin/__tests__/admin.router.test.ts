// src/domains/admin/__tests__/admin.router.test.ts
import request from 'supertest';
import express, { NextFunction, Request, Response } from 'express';
import { adminRouter } from '../admin.router';
import * as contentService from '../../content/content.service';

jest.mock('../../content/content.service');

const mockTutorials = {
  photography: [
    { id: '1', title: 'Photo A', slug: 'photo-a', orderIndex: 1, category: 'photography', youtubeUrl: 'https://youtube.com/1' },
    { id: '2', title: 'Photo B', slug: 'photo-b', orderIndex: 2, category: 'photography', youtubeUrl: 'https://youtube.com/2' },
  ],
  forms: [
    { id: '3', title: 'Form A', slug: 'form-a', orderIndex: 1, category: 'forms', youtubeUrl: 'https://youtube.com/3' },
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
  app.use((err: Error & { statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });

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
    const res = await request(app)
      .get('/admin/tutorials?tab=forms')
      .set('HX-Request', 'true');
    expect(res.status).toBe(200);
  });
});
