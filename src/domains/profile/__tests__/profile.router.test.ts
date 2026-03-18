// src/domains/profile/__tests__/profile.router.test.ts
import request from 'supertest';
import { createApp } from '../../../infra/http/app';

jest.mock('../profile.service');

describe('ProfileRouter — unauthenticated redirects', () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    app = createApp();
  });

  it('GET /profile redirects to /auth/login when not authenticated', async () => {
    const res = await request(app).get('/profile').set('Accept', 'text/html');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/auth\/login/);
  });

  it('POST /profile/password redirects to /auth/login when not authenticated', async () => {
    const res = await request(app)
      .post('/profile/password')
      .set('Accept', 'text/html')
      .send({ currentPassword: 'x', newPassword: 'newpass1', confirmPassword: 'newpass1' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/auth\/login/);
  });

  it('POST /profile/avatar redirects to /auth/login when not authenticated', async () => {
    const res = await request(app).post('/profile/avatar').set('Accept', 'text/html');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/auth\/login/);
  });

  it('DELETE /profile/avatar redirects to /auth/login when not authenticated', async () => {
    const res = await request(app).delete('/profile/avatar').set('Accept', 'text/html');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/auth\/login/);
  });

  it('GET /profile/avatar/:agentId redirects to /auth/login when not authenticated', async () => {
    const res = await request(app)
      .get('/profile/avatar/agent123456789')
      .set('Accept', 'text/html');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/auth\/login/);
  });
});
