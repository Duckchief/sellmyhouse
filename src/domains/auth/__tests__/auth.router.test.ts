import express from 'express';
import request from 'supertest';
import session from 'express-session';
import passport from 'passport';
import nunjucks from 'nunjucks';
import path from 'path';
import { authRouter } from '../auth.router';
import { configurePassport } from '../../../infra/http/middleware/passport';
import { errorHandler } from '../../../infra/http/middleware/error-handler';
import { ConflictError } from '../../shared/errors';

// Mock auth service
jest.mock('../auth.service');
const authService = jest.requireMock('../auth.service');

// Disable rate limiter in tests
jest.mock('../../../infra/http/middleware/rate-limit', () => ({
  authRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  apiRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

function createTestApp() {
  const app = express();

  const viewsPath = path.resolve('src/views');
  const env = nunjucks.configure(viewsPath, {
    autoescape: true,
    express: app,
  });
  env.addFilter('t', (str: string) => str);
  env.addFilter('date', (str: string) => (str === 'now' ? '2026' : str));
  app.set('view engine', 'njk');

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(
    session({
      secret: 'test-session-secret',
      resave: false,
      saveUninitialized: false,
    }),
  );
  configurePassport();
  app.use(passport.initialize());
  app.use(passport.session());
  app.use(authRouter);
  app.use(errorHandler);

  return app;
}

describe('AuthRouter', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
  });

  describe('GET /auth/register', () => {
    it('returns 200 with registration page', async () => {
      const res = await request(app).get('/auth/register');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Create Your Account');
    });
  });

  describe('POST /auth/register', () => {
    it('returns 400 on validation failure', async () => {
      const res = await request(app)
        .post('/auth/register')
        .type('form')
        .send({ name: '', email: 'bad', phone: '123', password: 'short', consentService: 'false' });

      expect(res.status).toBe(400);
    });

    it('returns 409 on duplicate email', async () => {
      authService.registerSeller = jest.fn().mockRejectedValue(
        Object.assign(new Error('An account with this email already exists'), {
          statusCode: 409,
          code: 'CONFLICT',
          name: 'AppError',
        }),
      );

      authService.registerSeller = jest
        .fn()
        .mockRejectedValue(new ConflictError('An account with this email already exists'));

      const res = await request(app).post('/auth/register').type('form').send({
        name: 'Test',
        email: 'test@example.com',
        phone: '91234567',
        password: 'password123',
        consentService: 'true',
      });

      expect(res.status).toBe(409);
    });
  });

  describe('GET /auth/login', () => {
    it('returns 200 with login page', async () => {
      const res = await request(app).get('/auth/login');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Log In');
    });
  });

  describe('POST /auth/login/seller', () => {
    it('returns 401 on invalid credentials', async () => {
      authService.loginSeller = jest.fn().mockResolvedValue(null);

      const res = await request(app)
        .post('/auth/login/seller')
        .type('form')
        .send({ email: 'test@example.com', password: 'wrong' });

      expect(res.status).toBe(401);
    });

    it('redirects on successful login', async () => {
      authService.loginSeller = jest.fn().mockResolvedValue({
        id: 's1',
        email: 'test@example.com',
        name: 'Test',
        twoFactorEnabled: false,
      });

      const res = await request(app)
        .post('/auth/login/seller')
        .type('form')
        .send({ email: 'test@example.com', password: 'password' });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/seller/dashboard');
    });

    it('sets session cookie on successful login', async () => {
      authService.loginSeller = jest.fn().mockResolvedValue({
        id: 's1',
        email: 'test@example.com',
        name: 'Test',
        twoFactorEnabled: false,
      });

      const res = await request(app)
        .post('/auth/login/seller')
        .type('form')
        .send({ email: 'test@example.com', password: 'password' });

      expect(res.headers['set-cookie']).toBeDefined();
    });
  });

  describe('POST /auth/logout', () => {
    it('redirects to home', async () => {
      const res = await request(app).post('/auth/logout');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/');
    });
  });

  describe('agent 2FA enforcement', () => {
    it('redirects agent without 2FA to /auth/2fa/setup on login', async () => {
      authService.loginAgent = jest.fn().mockResolvedValue({
        id: 'a1',
        email: 'agent@test.com',
        name: 'Agent',
        twoFactorEnabled: false,
        isActive: true,
        role: 'agent',
      });

      const res = await request(app)
        .post('/auth/login/agent')
        .type('form')
        .send({ email: 'agent@test.com', password: 'pass123' });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/auth/2fa/setup');
    });

    it('redirects agent with 2FA to /auth/2fa/verify on login', async () => {
      authService.loginAgent = jest.fn().mockResolvedValue({
        id: 'a1',
        email: 'agent@test.com',
        name: 'Agent',
        twoFactorEnabled: true,
        isActive: true,
        role: 'agent',
      });

      const res = await request(app)
        .post('/auth/login/agent')
        .type('form')
        .send({ email: 'agent@test.com', password: 'pass123' });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/auth/2fa/verify');
    });
  });
});
