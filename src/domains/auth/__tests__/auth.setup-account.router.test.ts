import request from 'supertest';
import express from 'express';

const mockAuthService = {
  resetPassword: jest.fn(),
  findSellerByResetToken: jest.fn(),
};

const mockAuthRepo = {
  findSellerByResetToken: jest.fn(),
  updateSellerPasswordHash: jest.fn(),
  clearSellerPasswordResetToken: jest.fn(),
  invalidateUserSessions: jest.fn(),
};

jest.mock('../auth.service', () => mockAuthService);
jest.mock('../auth.repository', () => mockAuthRepo);

// Mock passport
jest.mock('passport', () => ({
  authenticate: jest.fn(() => (req: any, res: any, next: any) => {
    req.logIn = jest.fn((user: any, cb: any) => cb(null));
    req.user = { id: 'seller-1', role: 'seller' };
    next();
  }),
}));

import { setupAccountRouter } from '../auth.setup-account.router';

function createApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.set('view engine', 'njk');
  app.use((req, _res, next) => {
    (req as any).logIn = jest.fn((user: any, cb: any) => cb(null));
    next();
  });
  app.use(setupAccountRouter);
  return app;
}

describe('setup-account router', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('GET /auth/setup-account', () => {
    it('returns 400 when no token provided', async () => {
      const app = createApp();
      const res = await request(app).get('/auth/setup-account');
      expect(res.status).toBe(400);
    });
  });
});
