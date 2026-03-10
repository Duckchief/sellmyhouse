import request from 'supertest';
import { createApp } from '../../src/infra/http/app';

const app = createApp();

describe('Public routes', () => {
  describe('GET /', () => {
    it('returns 200 with homepage', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.text).toContain('SellMyHomeNow');
    });
  });

  describe('GET /market-report', () => {
    it('returns 200 with market report page', async () => {
      const res = await request(app).get('/market-report');
      expect(res.status).toBe(200);
      expect(res.text).toContain('HDB Market Report');
    });
  });

  describe('GET /privacy', () => {
    it('returns 200 with privacy policy', async () => {
      const res = await request(app).get('/privacy');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Privacy Policy');
    });
  });

  describe('GET /terms', () => {
    it('returns 200 with terms of service', async () => {
      const res = await request(app).get('/terms');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Terms of Service');
    });
  });

  describe('GET /manifest.json', () => {
    it('returns valid PWA manifest', async () => {
      const res = await request(app).get('/manifest.json');
      expect(res.status).toBe(200);
      const manifest = JSON.parse(res.text);
      expect(manifest.name).toBe('SellMyHomeNow.sg');
      expect(manifest.start_url).toBe('/');
      expect(manifest.display).toBe('standalone');
    });
  });

  describe('GET /api/hdb/report', () => {
    it('returns report data for known town/type', async () => {
      const res = await request(app).get(
        '/api/hdb/report?town=ANG+MO+KIO&flatType=4+ROOM&months=24',
      );
      // May return 200 with empty report if no data in test DB
      expect(res.status).toBe(200);
    });

    it('handles unknown town gracefully', async () => {
      const res = await request(app).get(
        '/api/hdb/report?town=NONEXISTENT&flatType=4+ROOM&months=24',
      );
      expect(res.status).toBe(200);
    });

    it('requires town and flatType parameters', async () => {
      const res = await request(app).get('/api/hdb/report');
      expect(res.status).toBe(400);
    });
  });
});
