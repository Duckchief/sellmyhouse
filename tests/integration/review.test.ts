import request from 'supertest';
import bcrypt from 'bcrypt';
import { testPrisma, cleanDatabase } from '../helpers/prisma';
import { factory } from '../fixtures/factory';
import { createApp } from '../../src/infra/http/app';
import * as propertyService from '../../src/domains/property/property.service';

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  app = createApp();
});

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await cleanDatabase();
  await testPrisma.$disconnect();
});

/**
 * Helper: create an agent with a known password and return a logged-in supertest agent.
 * twoFactorEnabled defaults to false, so requireTwoFactor() passes through.
 */
async function loginAsAgent(overrides?: { role?: 'agent' | 'admin' }) {
  const password = 'AgentPassword1!';
  const agentRecord = await factory.agent({
    email: `agent-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
    passwordHash: await bcrypt.hash(password, 12),
    role: overrides?.role ?? 'agent',
  });

  const agent = request.agent(app);
  await agent.post('/auth/login/agent').type('form').send({
    email: agentRecord.email,
    password,
  });

  return { agentRecord, agent };
}

describe('Review Queue Integration', () => {
  // ────────────────────────────────────────────────────────────────────────────
  // GET /agent/reviews
  // ────────────────────────────────────────────────────────────────────────────

  describe('GET /agent/reviews', () => {
    it('returns 401 when not authenticated', async () => {
      const res = await request(app).get('/agent/reviews');
      expect(res.status).toBe(401);
    });

    it('returns 200 for authenticated agent', async () => {
      const { agent } = await loginAsAgent();
      const res = await agent.get('/agent/reviews');
      expect(res.status).toBe(200);
    });

    it('returns 200 for HTMX partial request', async () => {
      const { agent } = await loginAsAgent();
      const res = await agent.get('/agent/reviews').set('HX-Request', 'true');
      expect(res.status).toBe(200);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // POST /agent/reviews/:entityType/:entityId/approve
  // ────────────────────────────────────────────────────────────────────────────

  describe('POST /agent/reviews/:entityType/:entityId/approve', () => {
    it('returns 400 for invalid entityType', async () => {
      const { agent } = await loginAsAgent();
      const res = await agent.post('/agent/reviews/invalid_type/some-id/approve');
      expect(res.status).toBe(400);
    });

    it('approves financial report → status becomes approved + audit log created', async () => {
      const { agentRecord, agent } = await loginAsAgent();

      const seller = await factory.seller({ agentId: agentRecord.id, status: 'active' });
      const property = await factory.property({ sellerId: seller.id });
      const report = await factory.financialReport({
        sellerId: seller.id,
        propertyId: property.id,
        status: 'pending_review',
      });

      const res = await agent.post(
        `/agent/reviews/financial_report/${report.id}/approve`,
      );
      expect(res.status).toBe(200);

      // Verify status updated in DB
      const fromDb = await testPrisma.financialReport.findUnique({ where: { id: report.id } });
      expect(fromDb?.status).toBe('approved');
      expect(fromDb?.approvedAt).not.toBeNull();
      expect(fromDb?.reviewedByAgentId).toBe(agentRecord.id);

      // Verify audit log created
      const logs = await testPrisma.auditLog.findMany({
        where: { action: 'financial_report.reviewed', entityId: report.id },
      });
      expect(logs.length).toBeGreaterThan(0);
      const logDetails = logs[0]?.details as Record<string, unknown>;
      expect(logDetails?.decision).toBe('approved');
    });

    it('rejects financial report with notes → status becomes rejected + audit logged', async () => {
      const { agentRecord, agent } = await loginAsAgent();

      const seller = await factory.seller({ agentId: agentRecord.id, status: 'active' });
      const property = await factory.property({ sellerId: seller.id });
      const report = await factory.financialReport({
        sellerId: seller.id,
        propertyId: property.id,
        status: 'pending_review',
      });

      const reviewNotes = 'Numbers do not add up — please recalculate CPF accrued interest.';
      const res = await agent
        .post(`/agent/reviews/financial_report/${report.id}/reject`)
        .type('form')
        .send({ reviewNotes });
      expect(res.status).toBe(200);

      // Verify status updated in DB
      const fromDb = await testPrisma.financialReport.findUnique({ where: { id: report.id } });
      expect(fromDb?.status).toBe('rejected');
      expect(fromDb?.reviewNotes).toBe(reviewNotes);
      expect(fromDb?.reviewedByAgentId).toBe(agentRecord.id);

      // Verify audit log
      const logs = await testPrisma.auditLog.findMany({
        where: { action: 'financial_report.reviewed', entityId: report.id },
      });
      expect(logs.length).toBeGreaterThan(0);
      const logDetails = logs[0]?.details as Record<string, unknown>;
      expect(logDetails?.decision).toBe('rejected');
    });

    it('returns 400 when rejecting without notes', async () => {
      const { agentRecord, agent } = await loginAsAgent();

      const seller = await factory.seller({ agentId: agentRecord.id, status: 'active' });
      const property = await factory.property({ sellerId: seller.id });
      const report = await factory.financialReport({
        sellerId: seller.id,
        propertyId: property.id,
        status: 'pending_review',
      });

      const res = await agent
        .post(`/agent/reviews/financial_report/${report.id}/reject`)
        .type('form')
        .send({ reviewNotes: '' });
      expect(res.status).toBe(400);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Compliance gate: EAA required for listing to go live
  // Tested at the service layer — no HTTP route yet for listing status changes.
  // ────────────────────────────────────────────────────────────────────────────

  describe('Compliance gate: EAA required for listing live', () => {
    it('blocks listing going live without signed EAA → throws ComplianceError', async () => {
      const agentRecord = await factory.agent();
      const seller = await factory.seller({ agentId: agentRecord.id, status: 'active' });
      const property = await factory.property({ sellerId: seller.id });

      // Create a listing with status 'approved' so transition to 'live' is valid
      await factory.listing({ propertyId: property.id, status: 'approved' });

      // No EAA created — compliance gate should fire
      await expect(
        propertyService.updateListingStatus(property.id, 'live'),
      ).rejects.toMatchObject({
        name: 'ComplianceError',
        statusCode: 403,
      });
    });

    it('allows listing going live when signed EAA exists', async () => {
      const agentRecord = await factory.agent();
      const seller = await factory.seller({ agentId: agentRecord.id, status: 'active' });
      const property = await factory.property({ sellerId: seller.id });

      await factory.listing({ propertyId: property.id, status: 'approved' });

      // Create a signed EAA to satisfy the compliance gate
      await factory.estateAgencyAgreement({
        sellerId: seller.id,
        agentId: agentRecord.id,
        status: 'signed',
        signedAt: new Date(),
      });

      // Should not throw
      await expect(
        propertyService.updateListingStatus(property.id, 'live'),
      ).resolves.toMatchObject({ status: 'live' });
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // document_checklist terminal state
  // ────────────────────────────────────────────────────────────────────────────

  describe('document_checklist terminal state', () => {
    it('approves document_checklist → status becomes approved', async () => {
      const { agentRecord, agent } = await loginAsAgent();

      const seller = await factory.seller({ agentId: agentRecord.id, status: 'active' });
      const property = await factory.property({ sellerId: seller.id });
      const checklist = await factory.documentChecklist({
        sellerId: seller.id,
        propertyId: property.id,
        status: 'pending_review',
      });

      const res = await agent.post(
        `/agent/reviews/document_checklist/${checklist.id}/approve`,
      );
      expect(res.status).toBe(200);

      const fromDb = await testPrisma.documentChecklist.findUnique({
        where: { id: checklist.id },
      });
      expect(fromDb?.status).toBe('approved');
      expect(fromDb?.approvedAt).not.toBeNull();
      expect(fromDb?.reviewedByAgentId).toBe(agentRecord.id);
    });
  });
});
