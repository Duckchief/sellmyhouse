// src/domains/compliance/__tests__/compliance.router.test.ts
import * as complianceService from '../compliance.service';

jest.mock('../compliance.service');

const mockService = complianceService as jest.Mocked<typeof complianceService>;

import request from 'supertest';
import express from 'express';
import nunjucks from 'nunjucks';
import path from 'path';
import { complianceRouter } from '../compliance.router';

function createTestApp(authenticated = false) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const viewsPath = path.resolve('src/views');
  const env = nunjucks.configure(viewsPath, {
    autoescape: true,
    express: app,
  });
  env.addFilter('t', (str: string) => str);
  env.addFilter('date', (d: unknown) => (d ? String(d) : ''));
  app.set('view engine', 'njk');

  if (authenticated) {
    app.use((req, _res, next) => {
      req.user = {
        id: 'seller-1',
        role: 'seller',
        email: 'test@test.local',
        name: 'Test',
        twoFactorEnabled: false,
        twoFactorVerified: false,
      };
      req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
      next();
    });
  }

  app.use(complianceRouter);
  return app;
}

describe('POST /seller/compliance/consent/withdraw', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when not authenticated as seller', async () => {
    const app = createTestApp(false);
    const res = await request(app)
      .post('/seller/compliance/consent/withdraw')
      .send({ type: 'marketing' });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid consent type', async () => {
    const app = createTestApp(true);
    const res = await request(app)
      .post('/seller/compliance/consent/withdraw')
      .send({ type: 'invalid' });
    expect([400, 401]).toContain(res.status);
  });

  it('redirects on successful marketing consent withdrawal', async () => {
    mockService.withdrawConsent.mockResolvedValue({
      consentRecordId: 'cr-1',
      deletionBlocked: false,
    });

    const app = createTestApp(true);
    const res = await request(app)
      .post('/seller/compliance/consent/withdraw')
      .send({ type: 'marketing', channel: 'web' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/seller/my-data?consent_withdrawn=true');
  });

  it('returns HTMX partial on successful withdrawal when hx-request header set', async () => {
    mockService.withdrawConsent.mockResolvedValue({
      consentRecordId: 'cr-2',
      deletionBlocked: false,
    });

    const app = createTestApp(true);
    const res = await request(app)
      .post('/seller/compliance/consent/withdraw')
      .set('hx-request', 'true')
      .send({ type: 'marketing', channel: 'web' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Marketing consent withdrawn');
  });
});
