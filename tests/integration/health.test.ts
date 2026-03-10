import request from 'supertest';
import { createApp } from '../../src/infra/http/app';

const app = createApp();

describe('GET /health', () => {
  it('returns 200 with ok status when DB is available', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
  });
});
