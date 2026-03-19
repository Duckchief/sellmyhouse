// tests/integration/admin.test.ts
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
});

afterAll(async () => {
  await cleanDatabase();
  await testPrisma.$disconnect();
});

/** Create and log in as an admin agent */
async function loginAsAdmin() {
  const password = 'AdminPassword1!';
  const adminRecord = await factory.agent({
    email: `admin-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
    passwordHash: await bcrypt.hash(password, 12),
    role: 'admin',
  });

  const agent = request.agent(app);
  const csrfToken = await getCsrfToken(agent);
  await agent.post('/auth/login/agent').set('x-csrf-token', csrfToken).type('form').send({
    email: adminRecord.email,
    password,
  });

  return { adminRecord, agent: withCsrf(agent, csrfToken) };
}

/** Create and log in as a regular agent */
async function loginAsAgent() {
  const password = 'AgentPassword1!';
  const agentRecord = await factory.agent({
    email: `agent-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
    passwordHash: await bcrypt.hash(password, 12),
    role: 'agent',
  });

  const sessionAgent = request.agent(app);
  const csrfToken = await getCsrfToken(sessionAgent);
  await sessionAgent.post('/auth/login/agent').set('x-csrf-token', csrfToken).type('form').send({
    email: agentRecord.email,
    password,
  });

  return { agentRecord, agent: withCsrf(sessionAgent, csrfToken) };
}

// ─── RBAC ────────────────────────────────────────────────────

describe('RBAC — non-admin cannot access admin routes', () => {
  it('GET /admin/team returns 403 for regular agent', async () => {
    const { agent } = await loginAsAgent();
    const res = await agent.get('/admin/team');
    expect(res.status).toBe(403);
  });

  it('POST /admin/settings/commission_amount returns 403 for regular agent', async () => {
    const { agent } = await loginAsAgent();
    const res = await agent.post('/admin/settings/commission_amount').send({ value: '1499' });
    expect(res.status).toBe(403);
  });

  it('GET /admin/sellers returns 403 for regular agent', async () => {
    const { agent } = await loginAsAgent();
    const res = await agent.get('/admin/sellers');
    expect(res.status).toBe(403);
  });

  it('GET /admin/hdb returns 403 for regular agent', async () => {
    const { agent } = await loginAsAgent();
    const res = await agent.get('/admin/hdb');
    expect(res.status).toBe(403);
  });

  it('GET /admin/team returns 200 for admin', async () => {
    const { agent } = await loginAsAdmin();
    // Use HX-Request so the router returns the partial (avoids needing full page view)
    const res = await agent.get('/admin/team').set('HX-Request', 'true');
    expect(res.status).toBe(200);
  });
});

// ─── Team Management ─────────────────────────────────────────

describe('POST /admin/team — create agent', () => {
  it('creates agent and returns success', async () => {
    const { agent } = await loginAsAdmin();
    const ceaRegNo = `R0${Date.now().toString().slice(-5)}A`;

    const res = await agent
      .post('/admin/team')
      .type('form')
      .send({
        name: 'New Agent',
        email: `newagent-${Date.now()}@test.local`,
        phone: '91234567',
        ceaRegNo,
      });

    expect([200, 302]).toContain(res.status);

    const created = await testPrisma.agent.findFirst({ where: { ceaRegNo } });
    expect(created).not.toBeNull();
    expect(created?.role).toBe('agent');
    expect(created?.isActive).toBe(true);
  });

  it('logs agent.created audit entry', async () => {
    const { agent } = await loginAsAdmin();
    const ceaRegNo = `R1${Date.now().toString().slice(-5)}B`;

    await agent
      .post('/admin/team')
      .type('form')
      .send({
        name: 'Audit Agent',
        email: `audit-${Date.now()}@test.local`,
        phone: '91234568',
        ceaRegNo,
      });

    const auditEntry = await testPrisma.auditLog.findFirst({
      where: { action: 'agent.created' },
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry?.entityType).toBe('agent');
  });

  it('returns 409 when email already taken', async () => {
    const { agent, adminRecord } = await loginAsAdmin();

    const res = await agent.post('/admin/team').type('form').send({
      name: 'Duplicate',
      email: adminRecord.email,
      phone: '91234567',
      ceaRegNo: 'R000001A',
    });

    expect(res.status).toBe(409);
  });
});

describe('POST /admin/team/:id/deactivate', () => {
  it('returns 400 when agent has active sellers', async () => {
    const { agent } = await loginAsAdmin();

    const targetAgent = await factory.agent({
      email: `target-${Date.now()}@test.local`,
    });
    await factory.seller({ agentId: targetAgent.id, status: 'active' });

    const res = await agent.post(`/admin/team/${targetAgent.id}/deactivate`).type('form').send({});

    expect(res.status).toBe(400);

    const stillActive = await testPrisma.agent.findUnique({ where: { id: targetAgent.id } });
    expect(stillActive?.isActive).toBe(true);
  });

  it('deactivates agent and logs audit when no active sellers', async () => {
    const { agent } = await loginAsAdmin();

    const targetAgent = await factory.agent({
      email: `target2-${Date.now()}@test.local`,
    });
    await factory.seller({ agentId: targetAgent.id, status: 'completed' });

    const res = await agent.post(`/admin/team/${targetAgent.id}/deactivate`).type('form').send({});

    expect([200, 302]).toContain(res.status);

    const deactivated = await testPrisma.agent.findUnique({ where: { id: targetAgent.id } });
    expect(deactivated?.isActive).toBe(false);

    const auditEntry = await testPrisma.auditLog.findFirst({
      where: { action: 'agent.deactivated', entityId: targetAgent.id },
    });
    expect(auditEntry).not.toBeNull();
  });
});

describe('POST /admin/team/:id/reactivate', () => {
  it('reactivates agent and logs audit', async () => {
    const { agent } = await loginAsAdmin();

    const targetAgent = await factory.agent({
      email: `inactive-${Date.now()}@test.local`,
      isActive: false,
    });

    const res = await agent.post(`/admin/team/${targetAgent.id}/reactivate`).type('form').send({});

    expect([200, 302]).toContain(res.status);

    const reactivated = await testPrisma.agent.findUnique({ where: { id: targetAgent.id } });
    expect(reactivated?.isActive).toBe(true);

    const auditEntry = await testPrisma.auditLog.findFirst({
      where: { action: 'agent.reactivated', entityId: targetAgent.id },
    });
    expect(auditEntry).not.toBeNull();
  });
});

describe('POST /admin/team/:id/anonymise', () => {
  it('anonymises agent fields and logs audit', async () => {
    const { agent } = await loginAsAdmin();

    const targetAgent = await factory.agent({
      email: `toanonymise-${Date.now()}@test.local`,
      name: 'Real Name',
    });
    await factory.seller({ agentId: targetAgent.id, status: 'completed' });

    const res = await agent.post(`/admin/team/${targetAgent.id}/anonymise`).type('form').send({});

    expect([200, 302]).toContain(res.status);

    const anonymised = await testPrisma.agent.findUnique({ where: { id: targetAgent.id } });
    expect(anonymised?.name).toBe(`Former Agent [${targetAgent.id}]`);
    expect(anonymised?.email).toBe(`anonymised-${targetAgent.id}@deleted.local`);
    // phone is non-nullable in schema — anonymised to placeholder
    expect(anonymised?.phone).toBe('anonymised');
    expect(anonymised?.isActive).toBe(false);

    const auditEntry = await testPrisma.auditLog.findFirst({
      where: { action: 'agent.anonymised', entityId: targetAgent.id },
    });
    expect(auditEntry).not.toBeNull();
  });
});

// ─── Seller Reassignment ─────────────────────────────────────

describe('POST /admin/sellers/:id/reassign', () => {
  it('updates agentId and logs lead.reassigned audit with from/to', async () => {
    const { agent } = await loginAsAdmin();

    const agentA = await factory.agent({ email: `agenta-${Date.now()}@test.local` });
    const agentB = await factory.agent({ email: `agentb-${Date.now()}@test.local` });
    const seller = await factory.seller({ agentId: agentA.id, status: 'active' });

    const res = await agent
      .post(`/admin/sellers/${seller.id}/reassign`)
      .type('form')
      .send({ agentId: agentB.id });

    expect([200, 302]).toContain(res.status);

    const updated = await testPrisma.seller.findUnique({ where: { id: seller.id } });
    expect(updated?.agentId).toBe(agentB.id);

    const auditEntry = await testPrisma.auditLog.findFirst({
      where: { action: 'lead.reassigned', entityId: seller.id },
    });
    expect(auditEntry).not.toBeNull();
    const details = auditEntry?.details as Record<string, unknown>;
    expect(details.fromAgentId).toBe(agentA.id);
    expect(details.toAgentId).toBe(agentB.id);
    expect(details.reason).toBe('admin_reassignment');
  });
});

// ─── System Settings ─────────────────────────────────────────

describe('POST /admin/settings/:key', () => {
  it('saves valid commission_amount and logs setting.changed with old+new values', async () => {
    const { agent } = await loginAsAdmin();
    await factory.systemSetting({ key: 'commission_amount', value: '1499' });

    const res = await agent
      .post('/admin/settings/commission_amount')
      .type('form')
      .send({ value: '1600' });

    expect([200, 302]).toContain(res.status);

    const updated = await testPrisma.systemSetting.findUnique({
      where: { key: 'commission_amount' },
    });
    expect(updated?.value).toBe('1600');

    const auditEntry = await testPrisma.auditLog.findFirst({
      where: { action: 'setting.changed', entityId: 'commission_amount' },
    });
    expect(auditEntry).not.toBeNull();
    const details = auditEntry?.details as Record<string, unknown>;
    expect(details.oldValue).toBe('1499');
    expect(details.newValue).toBe('1600');
  });

  it('returns 400 for invalid commission_amount (negative)', async () => {
    const { agent } = await loginAsAdmin();

    const res = await agent
      .post('/admin/settings/commission_amount')
      .type('form')
      .send({ value: '-500' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for transaction_retention_years < 5 (AML/CFT minimum)', async () => {
    const { agent } = await loginAsAdmin();

    const res = await agent
      .post('/admin/settings/transaction_retention_years')
      .type('form')
      .send({ value: '3' });

    expect(res.status).toBe(400);
  });
});

// ─── HDB Management ──────────────────────────────────────────

describe('POST /admin/hdb/sync', () => {
  it('logs hdb_sync.triggered_manually audit entry', async () => {
    const { agent } = await loginAsAdmin();

    const res = await agent.post('/admin/hdb/sync').type('form').send({});

    expect([200, 302]).toContain(res.status);

    const auditEntry = await testPrisma.auditLog.findFirst({
      where: { action: 'hdb_sync.triggered_manually' },
    });
    expect(auditEntry).not.toBeNull();
  });
});
