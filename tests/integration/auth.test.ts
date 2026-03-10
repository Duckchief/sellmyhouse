import request from 'supertest';
import bcrypt from 'bcrypt';
import { testPrisma, cleanDatabase } from '../helpers/prisma';
import { factory } from '../fixtures/factory';
import { createApp } from '../../src/infra/http/app';

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

describe('Auth Integration', () => {
  describe('POST /auth/register', () => {
    it('creates seller + consent record + audit log', async () => {
      const res = await request(app).post('/auth/register').type('form').send({
        name: 'Integration Seller',
        email: 'integration@test.local',
        phone: '91234567',
        password: 'password123',
        consentService: 'true',
        consentMarketing: 'true',
      });

      expect(res.status).toBe(302); // redirect after success

      // Verify seller created
      const seller = await testPrisma.seller.findUnique({
        where: { email: 'integration@test.local' },
      });
      expect(seller).not.toBeNull();
      expect(seller!.name).toBe('Integration Seller');
      expect(seller!.consentService).toBe(true);
      expect(seller!.consentMarketing).toBe(true);

      // Verify password is hashed
      const passwordValid = await bcrypt.compare('password123', seller!.passwordHash!);
      expect(passwordValid).toBe(true);

      // Verify consent record created
      const consent = await testPrisma.consentRecord.findFirst({
        where: { subjectId: seller!.id },
      });
      expect(consent).not.toBeNull();
      expect(consent!.purposeService).toBe(true);
      expect(consent!.purposeMarketing).toBe(true);

      // Verify audit log created
      const audit = await testPrisma.auditLog.findFirst({
        where: { entityId: seller!.id, action: 'seller.registered' },
      });
      expect(audit).not.toBeNull();
    });

    it('returns 409 on duplicate email', async () => {
      await factory.seller({
        email: 'dupe@test.local',
        passwordHash: await bcrypt.hash('password', 12),
      });

      const res = await request(app).post('/auth/register').type('form').send({
        name: 'Dupe Seller',
        email: 'dupe@test.local',
        phone: '92345678',
        password: 'password123',
        consentService: 'true',
      });

      expect(res.status).toBe(409);
    });

    it('returns 400 when consent is missing', async () => {
      const res = await request(app).post('/auth/register').type('form').send({
        name: 'No Consent',
        email: 'noconsent@test.local',
        phone: '93456789',
        password: 'password123',
      });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /auth/login/seller', () => {
    it('sets session cookie on valid login', async () => {
      await factory.seller({
        email: 'login@test.local',
        passwordHash: await bcrypt.hash('password123', 12),
      });

      const res = await request(app)
        .post('/auth/login/seller')
        .type('form')
        .send({ email: 'login@test.local', password: 'password123' });

      expect(res.status).toBe(302);
      expect(res.headers['set-cookie']).toBeDefined();
      expect(res.headers.location).toBe('/seller/dashboard');
    });

    it('returns 401 on wrong password', async () => {
      await factory.seller({
        email: 'wrong@test.local',
        passwordHash: await bcrypt.hash('correct', 12),
      });

      const res = await request(app)
        .post('/auth/login/seller')
        .type('form')
        .send({ email: 'wrong@test.local', password: 'incorrect' });

      expect(res.status).toBe(401);
    });
  });

  describe('POST /auth/login/agent', () => {
    it('redirects to agent dashboard on valid login', async () => {
      await factory.agent({
        email: 'agent@test.local',
        passwordHash: await bcrypt.hash('agentpass', 12),
      });

      const res = await request(app)
        .post('/auth/login/agent')
        .type('form')
        .send({ email: 'agent@test.local', password: 'agentpass' });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/agent/dashboard');
    });
  });
});
