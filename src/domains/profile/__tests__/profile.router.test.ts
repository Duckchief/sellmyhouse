// src/domains/profile/__tests__/profile.router.test.ts
import request from 'supertest';
import express from 'express';
import { profileRouter } from '../profile.router';
import { errorHandler } from '../../../infra/http/middleware/error-handler';

jest.mock('../profile.service');

function createTestApp(user?: { id: string; role: string }) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

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
      Object.assign(req, { isAuthenticated: () => false });
    }
    next();
  });

  app.use((_req, res, next) => {
    res.render = ((_view: string, _options?: object) => {
      res.status(200).send('<html></html>');
    }) as typeof res.render;
    next();
  });

  app.use(profileRouter);
  app.use(errorHandler);

  return app;
}

describe('ProfileRouter — unauthenticated redirects', () => {
  it('GET /profile redirects to /auth/login when not authenticated', async () => {
    const res = await request(createTestApp()).get('/profile').set('Accept', 'text/html');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/auth\/login/);
  });

  it('POST /profile/password redirects to /auth/login when not authenticated', async () => {
    const res = await request(createTestApp())
      .post('/profile/password')
      .set('Accept', 'text/html')
      .send({ currentPassword: 'x', newPassword: 'newpass1', confirmPassword: 'newpass1' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/auth\/login/);
  });

  it('POST /profile/avatar redirects to /auth/login when not authenticated', async () => {
    const res = await request(createTestApp()).post('/profile/avatar').set('Accept', 'text/html');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/auth\/login/);
  });

  it('DELETE /profile/avatar redirects to /auth/login when not authenticated', async () => {
    const res = await request(createTestApp()).delete('/profile/avatar').set('Accept', 'text/html');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/auth\/login/);
  });

  it('GET /profile/avatar/:agentId redirects to /auth/login when not authenticated', async () => {
    const res = await request(createTestApp())
      .get('/profile/avatar/agent123456789')
      .set('Accept', 'text/html');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/auth\/login/);
  });
});
