// src/domains/seller/__tests__/seller.account-delete.router.test.ts
import * as accountDeleteService from '../account-delete.service';
import { UnauthorizedError } from '../../shared/errors';

jest.mock('../account-delete.service');
jest.mock('../../notification/notification.repository', () => ({
  countUnreadForRecipient: jest.fn().mockResolvedValue(0),
  findUnreadForRecipient: jest.fn().mockResolvedValue([]),
}));

const mockService = accountDeleteService as jest.Mocked<typeof accountDeleteService>;

import request from 'supertest';
import express from 'express';
import nunjucks from 'nunjucks';
import path from 'path';
import { sellerRouter } from '../seller.router';

function createTestApp() {
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

  // Mock authenticated seller with session
  app.use((req, res, next) => {
    const user = {
      id: 'seller-1',
      role: 'seller' as const,
      email: 'test@test.local',
      name: 'Test Seller',
      twoFactorEnabled: false,
      twoFactorVerified: false,
    };
    req.user = user;
    res.locals.user = user;
    res.locals.hasAvatar = false;
    req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
    (req as never as { logout: jest.Mock }).logout = jest.fn((cb: () => void) => cb());
    req.session = {
      id: 'test-session-id',
      destroy: jest.fn((cb: (err?: unknown) => void) => cb()),
    } as never;
    next();
  });

  app.use(sellerRouter);
  return app;
}

describe('seller account delete routes', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
  });

  describe('GET /seller/account/delete', () => {
    it('renders the confirmation page', async () => {
      const res = await request(app).get('/seller/account/delete');
      expect(res.status).toBe(200);
    });

    it('page contains the required consequence text', async () => {
      const res = await request(app).get('/seller/account/delete');
      expect(res.text).toContain('permanently deleted');
      expect(res.text).toContain('cannot be undone');
    });
  });

  describe('POST /seller/account/delete', () => {
    it('returns 400 when confirm checkbox is missing', async () => {
      const res = await request(app)
        .post('/seller/account/delete')
        .send({ password: 'mypass' }); // no confirm field
      expect(res.status).toBe(400);
    });

    it('returns 400 when password is missing', async () => {
      const res = await request(app)
        .post('/seller/account/delete')
        .send({ confirm: 'true' }); // no password
      expect(res.status).toBe(400);
    });

    it('returns 400 with error message when password is incorrect', async () => {
      mockService.deleteSellerAccount.mockRejectedValue(
        new UnauthorizedError('Incorrect password'),
      );

      const res = await request(app)
        .post('/seller/account/delete')
        .send({ confirm: 'true', password: 'wrongpassword' });

      expect(res.status).toBe(400);
      expect(mockService.deleteSellerAccount).toHaveBeenCalledWith('seller-1', 'wrongpassword');
    });

    it('calls deleteSellerAccount with seller id and password on valid submission', async () => {
      mockService.deleteSellerAccount.mockResolvedValue(undefined);

      await request(app)
        .post('/seller/account/delete')
        .send({ confirm: 'true', password: 'correctpassword' });

      expect(mockService.deleteSellerAccount).toHaveBeenCalledWith('seller-1', 'correctpassword');
    });

    it('destroys session and redirects to /?account_deleted=1 on success', async () => {
      mockService.deleteSellerAccount.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/seller/account/delete')
        .send({ confirm: 'true', password: 'correctpassword' });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/?account_deleted=1');
    });
  });
});
