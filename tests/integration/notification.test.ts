import request from 'supertest';
import { testPrisma, cleanDatabase } from '../helpers/prisma';
import { factory } from '../fixtures/factory';
import { createApp } from '../../src/infra/http/app';
import { getCsrfToken } from '../helpers/csrf';

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  app = createApp();
});

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe('Notification Integration', () => {
  describe('GET /api/notifications', () => {
    it('requires authentication', async () => {
      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/notifications/:id/read', () => {
    it('requires authentication', async () => {
      // Must include CSRF token so CSRF check passes; auth check then returns 401
      const agent = request.agent(app);
      const csrfToken = await getCsrfToken(agent);
      const res = await agent
        .post('/api/notifications/some-id/read')
        .set('x-csrf-token', csrfToken);
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/webhook/whatsapp', () => {
    it('returns 403 when signature is missing and token is configured', async () => {
      const savedToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'test-verify-token';

      const res = await request(app)
        .post('/api/webhook/whatsapp')
        .send({
          entry: [{ changes: [{ value: { statuses: [] } }] }],
        });

      expect(res.status).toBe(403);

      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = savedToken;
    });

    it('returns 403 when signature is missing (signature verification is unconditional)', async () => {
      const res = await request(app)
        .post('/api/webhook/whatsapp')
        .send({
          entry: [{ changes: [{ value: { statuses: [] } }] }],
        });

      expect(res.status).toBe(403);
    });
  });

  describe('Notification factory', () => {
    it('creates notification records', async () => {
      const seller = await factory.seller();

      const notification = await factory.notification({
        recipientType: 'seller',
        recipientId: seller.id,
        channel: 'in_app',
        content: 'Test notification',
      });

      expect(notification.id).toBeDefined();
      expect(notification.status).toBe('pending');

      // Mark as read
      const updated = await testPrisma.notification.update({
        where: { id: notification.id },
        data: { status: 'read', readAt: new Date() },
      });

      expect(updated.status).toBe('read');
      expect(updated.readAt).not.toBeNull();
    });
  });
});
