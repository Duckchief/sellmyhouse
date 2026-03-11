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
  await cleanDatabase();
  await testPrisma.$disconnect();
});

/**
 * Helper: create an agent with a known password and return a logged-in supertest agent.
 * Since twoFactorEnabled defaults to false, the requireTwoFactor() middleware passes through.
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

/**
 * Helper: create a seller with a known password and return a logged-in supertest agent.
 */
async function loginAsSeller() {
  const password = 'SellerPassword1!';
  const seller = await factory.seller({
    email: `seller-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
    passwordHash: await bcrypt.hash(password, 12),
    onboardingStep: 5,
    status: 'active',
  });

  const agent = request.agent(app);
  await agent.post('/auth/login/seller').type('form').send({
    email: seller.email,
    password,
  });

  return { seller, agent };
}

describe('Agent Dashboard Integration', () => {
  // ────────────────────────────────────────────────────────────────────────────
  // Authentication & RBAC
  // ────────────────────────────────────────────────────────────────────────────

  describe('Authentication & RBAC', () => {
    it('returns 401 for unauthenticated access to /agent/dashboard', async () => {
      const res = await request(app).get('/agent/dashboard');
      expect(res.status).toBe(401);
    });

    it('returns 403 for sellers accessing /agent/dashboard', async () => {
      const { agent } = await loginAsSeller();
      const res = await agent.get('/agent/dashboard');
      expect(res.status).toBe(403);
    });

    it('returns 200 for agents accessing /agent/dashboard', async () => {
      const { agent } = await loginAsAgent();
      const res = await agent.get('/agent/dashboard');
      expect(res.status).toBe(200);
    });

    it('returns 200 for admins accessing /agent/dashboard', async () => {
      const { agent } = await loginAsAgent({ role: 'admin' });
      const res = await agent.get('/agent/dashboard');
      expect(res.status).toBe(200);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // RBAC — agent sees only own sellers
  // ────────────────────────────────────────────────────────────────────────────

  describe('RBAC — agent sees only own sellers', () => {
    it('agent sees only their assigned sellers in seller list', async () => {
      const { agentRecord, agent } = await loginAsAgent();

      // Create a second agent with their own seller
      const otherAgent = await factory.agent({
        email: `other-agent-${Date.now()}@test.local`,
        passwordHash: await bcrypt.hash('OtherPass1!', 12),
      });

      // Create sellers assigned to each agent
      const ownSeller = await factory.seller({
        name: 'Own Seller',
        agentId: agentRecord.id,
        status: 'active',
      });
      await factory.seller({
        name: 'Other Seller',
        agentId: otherAgent.id,
        status: 'active',
      });

      const res = await agent.get('/agent/sellers').set('HX-Request', 'true');
      expect(res.status).toBe(200);
      expect(res.text).toContain(ownSeller.name);
      expect(res.text).not.toContain('Other Seller');
    });

    it('admin sees all sellers in seller list', async () => {
      const { agent } = await loginAsAgent({ role: 'admin' });

      const agent1 = await factory.agent({
        email: `agent1-${Date.now()}@test.local`,
        passwordHash: await bcrypt.hash('Pass1!', 12),
      });
      const agent2 = await factory.agent({
        email: `agent2-${Date.now()}@test.local`,
        passwordHash: await bcrypt.hash('Pass2!', 12),
      });

      const seller1 = await factory.seller({
        name: 'Seller One',
        agentId: agent1.id,
        status: 'active',
      });
      const seller2 = await factory.seller({
        name: 'Seller Two',
        agentId: agent2.id,
        status: 'active',
      });

      const res = await agent.get('/agent/sellers').set('HX-Request', 'true');
      expect(res.status).toBe(200);
      expect(res.text).toContain(seller1.name);
      expect(res.text).toContain(seller2.name);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Seller Detail
  // ────────────────────────────────────────────────────────────────────────────

  describe('Seller Detail', () => {
    it('agent can view their own seller detail', async () => {
      const { agentRecord, agent } = await loginAsAgent();

      const seller = await factory.seller({
        name: 'My Seller',
        agentId: agentRecord.id,
        status: 'active',
      });

      const res = await agent.get(`/agent/sellers/${seller.id}`);
      expect(res.status).toBe(200);
      expect(res.text).toContain(seller.name);
    });

    it("agent cannot view another agent's seller (404)", async () => {
      const { agent } = await loginAsAgent();

      const otherAgent = await factory.agent({
        email: `other-${Date.now()}@test.local`,
        passwordHash: await bcrypt.hash('Pass1!', 12),
      });

      const otherSeller = await factory.seller({
        name: 'Not My Seller',
        agentId: otherAgent.id,
        status: 'active',
      });

      const res = await agent.get(`/agent/sellers/${otherSeller.id}`);
      expect(res.status).toBe(404);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // HTMX Partials
  // ────────────────────────────────────────────────────────────────────────────

  describe('HTMX Partials', () => {
    it('returns partial for timeline tab', async () => {
      const { agentRecord, agent } = await loginAsAgent();

      const seller = await factory.seller({
        name: 'Timeline Seller',
        agentId: agentRecord.id,
        status: 'active',
      });

      const res = await agent.get(`/agent/sellers/${seller.id}/timeline`).set('HX-Request', 'true');
      expect(res.status).toBe(200);
      expect(res.text).toBeTruthy();
    });

    it('returns partial for compliance tab', async () => {
      const { agentRecord, agent } = await loginAsAgent();

      const seller = await factory.seller({
        name: 'Compliance Seller',
        agentId: agentRecord.id,
        status: 'active',
      });

      const res = await agent
        .get(`/agent/sellers/${seller.id}/compliance`)
        .set('HX-Request', 'true');
      expect(res.status).toBe(200);
      expect(res.text).toBeTruthy();
    });

    it('returns partial for notifications tab', async () => {
      const { agentRecord, agent } = await loginAsAgent();

      const seller = await factory.seller({
        name: 'Notifications Seller',
        agentId: agentRecord.id,
        status: 'active',
      });

      const res = await agent
        .get(`/agent/sellers/${seller.id}/notifications`)
        .set('HX-Request', 'true');
      expect(res.status).toBe(200);
      expect(res.text).toBeTruthy();
    });
  });
});
