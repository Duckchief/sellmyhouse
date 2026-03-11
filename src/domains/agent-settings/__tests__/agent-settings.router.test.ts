import express from 'express';
import request from 'supertest';
import session from 'express-session';
import passport from 'passport';
import nunjucks from 'nunjucks';
import path from 'path';
import { agentSettingsRouter } from '../agent-settings.router';
import { configurePassport } from '../../../infra/http/middleware/passport';
import { errorHandler } from '../../../infra/http/middleware/error-handler';

jest.mock('../agent-settings.service');
jest.mock('../../shared/audit.service');

function createTestApp() {
  const app = express();

  const viewsPath = path.resolve('src/views');
  const env = nunjucks.configure(viewsPath, { autoescape: true, express: app });
  env.addFilter('t', (str: string) => str);
  env.addFilter('date', (str: string) => (str === 'now' ? '2026' : str));
  app.set('view engine', 'njk');

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));
  configurePassport();
  app.use(passport.initialize());
  app.use(passport.session());
  app.use(agentSettingsRouter);
  app.use(errorHandler);

  return app;
}

function createAuthenticatedApp(role: 'agent' | 'admin' | 'seller' = 'agent') {
  const app = express();

  const viewsPath = path.resolve('src/views');
  const env = nunjucks.configure(viewsPath, { autoescape: true, express: app });
  env.addFilter('t', (str: string) => str);
  env.addFilter('date', (str: string) => (str === 'now' ? '2026' : str));
  app.set('view engine', 'njk');

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Inject authenticated user
  app.use((req, _res, next) => {
    req.user = {
      id: 'agent-1',
      role,
      email: 'agent@test.local',
      name: 'Test Agent',
      twoFactorEnabled: false,
      twoFactorVerified: false,
    };
    req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
    next();
  });

  app.use(agentSettingsRouter);
  app.use(errorHandler);

  return app;
}

describe('AgentSettingsRouter', () => {
  describe('unauthenticated requests', () => {
    let app: express.Express;

    beforeEach(() => {
      jest.clearAllMocks();
      app = createTestApp();
    });

    describe('GET /agent/settings', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app).get('/agent/settings');
        expect(res.status).toBe(401);
      });
    });

    describe('POST /agent/settings/whatsapp', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .post('/agent/settings/whatsapp')
          .send({
            whatsapp_phone_number_id: '123',
            whatsapp_api_token: 'tok',
            whatsapp_business_account_id: 'biz',
          });
        expect(res.status).toBe(401);
      });
    });

    describe('POST /agent/settings/email', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .post('/agent/settings/email')
          .send({
            smtp_host: 'smtp.test.local',
            smtp_port: '587',
            smtp_user: 'user@test.local',
            smtp_pass: 'password',
            smtp_from_email: 'from@test.local',
            smtp_from_name: 'Test Agent',
          });
        expect(res.status).toBe(401);
      });
    });

    describe('POST /agent/settings/test/whatsapp', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app).post('/agent/settings/test/whatsapp');
        expect(res.status).toBe(401);
      });
    });

    describe('POST /agent/settings/test/email', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app).post('/agent/settings/test/email');
        expect(res.status).toBe(401);
      });
    });
  });

  describe('seller role is forbidden', () => {
    let app: express.Express;

    beforeEach(() => {
      jest.clearAllMocks();
      app = createAuthenticatedApp('seller');
    });

    it('GET /agent/settings returns 403 for seller role', async () => {
      const res = await request(app).get('/agent/settings');
      expect(res.status).toBe(403);
    });

    it('POST /agent/settings/whatsapp returns 403 for seller role', async () => {
      const res = await request(app)
        .post('/agent/settings/whatsapp')
        .send({
          whatsapp_phone_number_id: '123',
          whatsapp_api_token: 'tok',
          whatsapp_business_account_id: 'biz',
        });
      expect(res.status).toBe(403);
    });
  });
});
