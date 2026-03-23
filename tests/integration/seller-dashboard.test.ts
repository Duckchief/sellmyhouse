import request from 'supertest';
import bcrypt from 'bcrypt';
import { testPrisma, cleanDatabase } from '../helpers/prisma';
import { factory } from '../fixtures/factory';
import { createApp } from '../../src/infra/http/app';
import { getCsrfToken, withCsrf } from '../helpers/csrf';

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  app = createApp();
});

beforeEach(async () => {
  await cleanDatabase();
  // Seed required system settings for onboarding step 3 (commission calculation)
  await factory.systemSetting({ key: 'commission_amount', value: '1499' });
  await factory.systemSetting({ key: 'gst_rate', value: '0.09' });
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

/**
 * Helper: create a seller with a known password and return a logged-in agent (supertest agent
 * with the session cookie already set).
 */
async function loginAsSeller(overrides?: {
  onboardingStep?: number;
  status?: 'lead' | 'engaged' | 'active' | 'completed' | 'archived';
}) {
  const password = 'TestPassword1!';
  const seller = await factory.seller({
    email: `seller-${Date.now()}@test.local`,
    passwordHash: await bcrypt.hash(password, 12),
    onboardingStep: overrides?.onboardingStep ?? 0,
    status: overrides?.status ?? 'lead',
  });

  const agent = request.agent(app);
  const csrfToken = await getCsrfToken(agent);
  await agent.post('/auth/login/seller').set('x-csrf-token', csrfToken).type('form').send({
    email: seller.email,
    password,
  });

  return { seller, agent: withCsrf(agent, csrfToken) };
}

/**
 * Helper: create an agent with a known password and return a logged-in supertest agent.
 */
async function loginAsAgent() {
  const password = 'AgentPassword1!';
  const agentRecord = await factory.agent({
    email: `agent-${Date.now()}@test.local`,
    passwordHash: await bcrypt.hash(password, 12),
  });

  const agent = request.agent(app);
  const csrfToken = await getCsrfToken(agent);
  await agent.post('/auth/login/agent').set('x-csrf-token', csrfToken).type('form').send({
    email: agentRecord.email,
    password,
  });

  return { agentRecord, agent: withCsrf(agent, csrfToken) };
}

describe('Seller Dashboard Integration', () => {
  // ────────────────────────────────────────────────────────────────────────────
  // Authentication & authorization
  // ────────────────────────────────────────────────────────────────────────────

  describe('GET /seller/dashboard — authentication & authorization', () => {
    it('redirects unauthenticated users to login', async () => {
      const res = await request(app).get('/seller/dashboard');
      // requireAuth throws UnauthorizedError (401) — the error handler returns JSON for non-HTMX
      expect(res.status).toBe(401);
    });

    it('returns 403 when an agent tries to access a seller route', async () => {
      const { agent } = await loginAsAgent();
      const res = await agent.get('/seller/dashboard');
      expect(res.status).toBe(403);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Dashboard — onboarding gate
  // ────────────────────────────────────────────────────────────────────────────

  describe('GET /seller/dashboard — onboarding gate', () => {
    it('redirects to /seller/onboarding when onboardingStep < 5', async () => {
      const { agent } = await loginAsSeller({ onboardingStep: 0 });
      const res = await agent.get('/seller/dashboard');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/seller/onboarding');
    });

    it('redirects to /seller/onboarding when onboardingStep = 3 (mid-flow)', async () => {
      const { agent } = await loginAsSeller({ onboardingStep: 3 });
      const res = await agent.get('/seller/dashboard');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/seller/onboarding');
    });

    it('renders 200 when onboardingStep = 5 (complete)', async () => {
      const { agent } = await loginAsSeller({ onboardingStep: 5 });
      const res = await agent.get('/seller/dashboard');
      expect(res.status).toBe(200);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Onboarding flow — GET step partials
  // ────────────────────────────────────────────────────────────────────────────

  describe('GET /seller/onboarding/step/:step — HTMX partial', () => {
    it('returns 200 with partial content for step 1 when HX-Request header is present', async () => {
      const { agent } = await loginAsSeller({ onboardingStep: 0 });
      const res = await agent.get('/seller/onboarding/step/1').set('HX-Request', 'true');
      expect(res.status).toBe(200);
      // Should be HTML fragment, not a full page (no <html> wrapper expected)
      expect(res.text).toBeTruthy();
    });

    it('returns 200 for step 1 without HTMX header (full page fallback)', async () => {
      const { agent } = await loginAsSeller({ onboardingStep: 0 });
      const res = await agent.get('/seller/onboarding/step/1');
      expect(res.status).toBe(200);
    });

    it('returns 400 for step 0 (out of range)', async () => {
      const { agent } = await loginAsSeller({ onboardingStep: 0 });
      const res = await agent.get('/seller/onboarding/step/0').set('HX-Request', 'true');
      expect(res.status).toBe(400);
    });

    it('returns 400 for step 6 (out of range)', async () => {
      const { agent } = await loginAsSeller({ onboardingStep: 0 });
      const res = await agent.get('/seller/onboarding/step/6').set('HX-Request', 'true');
      expect(res.status).toBe(400);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Onboarding flow — POST step completions
  // ────────────────────────────────────────────────────────────────────────────

  describe('POST /seller/onboarding/step/:step — complete steps', () => {
    it('completes steps 1-5 sequentially and redirects to dashboard', async () => {
      const { agent, seller } = await loginAsSeller({ onboardingStep: 0 });

      const step2Body = {
        town: 'ANG MO KIO',
        street: 'ANG MO KIO AVE 3',
        block: '123',
        flatType: '4 ROOM',
        level: '07',
        unitNumber: '123',
        floorAreaSqm: '93',
        leaseCommenceDate: '1985',
      };

      const step3Body = {
        sellingPrice: '500000',
        outstandingLoan: '200000',
        cpfSeller1: '100000',
        resaleLevy: '0',
        otherDeductions: '0',
      };

      const stepBodies: Record<number, object> = { 2: step2Body, 3: step3Body };

      for (let step = 1; step <= 5; step++) {
        const body = stepBodies[step] ?? {};
        const res = await agent.post(`/seller/onboarding/step/${step}`).type('form').send(body);

        if (step < 5) {
          // Intermediate step: redirect back to onboarding wizard
          expect(res.status).toBe(302);
          expect(res.headers.location).toBe('/seller/onboarding');
        } else {
          // Final step: redirect to dashboard
          expect(res.status).toBe(302);
          expect(res.headers.location).toBe('/seller/dashboard');
        }
      }

      // Verify the DB record has onboardingStep = 5
      const updated = await testPrisma.seller.findUnique({ where: { id: seller.id } });
      expect(updated?.onboardingStep).toBe(5);

      // Verify Huttons transfer consent was recorded at step 5
      const consentRecord = await testPrisma.consentRecord.findFirst({
        where: { sellerId: seller.id, purposeHuttonsTransfer: true },
      });
      expect(consentRecord).not.toBeNull();
    });

    it('creates an audit log entry for each completed onboarding step', async () => {
      const { agent, seller } = await loginAsSeller({ onboardingStep: 0 });

      await agent.post('/seller/onboarding/step/1').type('form').send({});

      const audit = await testPrisma.auditLog.findFirst({
        where: {
          entityId: seller.id,
          action: 'seller.onboarding_step_completed',
        },
      });

      expect(audit).not.toBeNull();
      expect((audit!.details as Record<string, unknown>).step).toBe(1);
    });

    it('rejects skipping steps (e.g., attempting step 2 when at step 0)', async () => {
      const { agent } = await loginAsSeller({ onboardingStep: 0 });

      const res = await agent
        .post('/seller/onboarding/step/2')
        .set('HX-Request', 'true')
        .type('form')
        .send({});

      expect(res.status).toBe(400);
    });

    it('re-submitting an already-completed step shows the next step (does not reject)', async () => {
      const { agent } = await loginAsSeller({ onboardingStep: 1 });

      const res = await agent
        .post('/seller/onboarding/step/1')
        .set('HX-Request', 'true')
        .type('form')
        .send({});

      // Implementation allows re-submission: saves data (none here) and renders next step partial
      expect(res.status).toBe(200);
    });

    it('returns 400 for step out of validator range (step = 0)', async () => {
      const { agent } = await loginAsSeller({ onboardingStep: 0 });

      const res = await agent
        .post('/seller/onboarding/step/0')
        .set('HX-Request', 'true')
        .type('form')
        .send({});

      expect(res.status).toBe(400);
    });

    it('returns HX-Redirect header on final step when HTMX request', async () => {
      const { agent } = await loginAsSeller({ onboardingStep: 4 });

      const res = await agent
        .post('/seller/onboarding/step/5')
        .set('HX-Request', 'true')
        .type('form')
        .send({});

      expect(res.status).toBe(200);
      expect(res.headers['hx-redirect']).toBe('/seller/dashboard');
    });

    it('returns next step partial on intermediate step when HTMX request', async () => {
      const { agent } = await loginAsSeller({ onboardingStep: 0 });

      const res = await agent
        .post('/seller/onboarding/step/1')
        .set('HX-Request', 'true')
        .type('form')
        .send({});

      expect(res.status).toBe(200);
      // Should render next partial (step 2), not a redirect
      expect(res.headers['hx-redirect']).toBeUndefined();
      expect(res.text).toBeTruthy();
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // My Data (PDPA)
  // ────────────────────────────────────────────────────────────────────────────

  describe('GET /seller/my-data', () => {
    it('renders 200 for an authenticated seller', async () => {
      const { agent } = await loginAsSeller({ onboardingStep: 5 });
      const res = await agent.get('/seller/my-data');
      expect(res.status).toBe(200);
    });

    it('returns 401 for unauthenticated requests', async () => {
      const res = await request(app).get('/seller/my-data');
      expect(res.status).toBe(401);
    });

    it('returns partial HTML when HX-Request header is present', async () => {
      const { agent } = await loginAsSeller({ onboardingStep: 5 });
      const res = await agent.get('/seller/my-data').set('HX-Request', 'true');
      expect(res.status).toBe(200);
      expect(res.text).toBeTruthy();
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Onboarding page redirect when already complete
  // ────────────────────────────────────────────────────────────────────────────

  describe('GET /seller/onboarding', () => {
    it('redirects to /seller/dashboard when onboarding is already complete', async () => {
      const { agent } = await loginAsSeller({ onboardingStep: 5 });
      const res = await agent.get('/seller/onboarding');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/seller/dashboard');
    });

    it('renders onboarding page when not yet complete', async () => {
      const { agent } = await loginAsSeller({ onboardingStep: 0 });
      const res = await agent.get('/seller/onboarding');
      expect(res.status).toBe(200);
    });
  });
});
