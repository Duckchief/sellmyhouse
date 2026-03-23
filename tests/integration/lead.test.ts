import request from 'supertest';
import { createApp } from '../../src/infra/http/app';
import { testPrisma, cleanDatabase } from '../helpers/prisma';
import { getCsrfToken } from '../helpers/csrf';

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

/** One-off agent with CSRF cookie established. */
async function csrfAgent() {
  const agent = request.agent(app);
  const csrfToken = await getCsrfToken(agent);
  return { agent, csrfToken };
}

describe('POST /api/leads', () => {
  it('creates a lead with valid input and service consent', async () => {
    const { agent, csrfToken } = await csrfAgent();
    const res = await agent
      .post('/api/leads')
      .set('x-csrf-token', csrfToken)
      .type('form')
      .send({
        name: 'John Tan',
        countryCode: '+65',
        nationalNumber: '91234567',
        consentService: 'true',
        consentMarketing: 'false',
        leadSource: 'website',
        email: 'test@example.com',
        formLoadedAt: (Date.now() - 10000).toString(),
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    // Verify seller was created with E.164 phone
    const seller = await testPrisma.seller.findFirst({ where: { phone: '+6591234567' } });
    expect(seller).not.toBeNull();
    expect(seller!.status).toBe('lead');
    expect(seller!.countryCode).toBe('+65');
    expect(seller!.nationalNumber).toBe('91234567');
    expect(seller!.consentService).toBe(true);
    expect(seller!.agentId).toBeNull();

    // Verify consent record was created (PDPA compliance)
    const consent = await testPrisma.consentRecord.findFirst({
      where: { sellerId: seller!.id },
    });
    expect(consent).not.toBeNull();
    expect(consent!.purposeService).toBe(true);
  });

  it('rejects submission without service consent', async () => {
    const { agent, csrfToken } = await csrfAgent();
    const res = await agent
      .post('/api/leads')
      .set('x-csrf-token', csrfToken)
      .type('form')
      .send({
        name: 'Jane Lim',
        countryCode: '+65',
        nationalNumber: '81234567',
        consentService: 'false',
        email: 'test@example.com',
        formLoadedAt: (Date.now() - 10000).toString(),
      });

    expect(res.status).toBe(400);
  });

  it('rejects duplicate phone number', async () => {
    const { agent: agent1, csrfToken: token1 } = await csrfAgent();
    await agent1
      .post('/api/leads')
      .set('x-csrf-token', token1)
      .type('form')
      .send({
        name: 'John Tan',
        countryCode: '+65',
        nationalNumber: '91234567',
        consentService: 'true',
        email: 'test@example.com',
        formLoadedAt: (Date.now() - 10000).toString(),
      });

    const { agent: agent2, csrfToken: token2 } = await csrfAgent();
    const res = await agent2
      .post('/api/leads')
      .set('x-csrf-token', token2)
      .type('form')
      .send({
        name: 'Another Person',
        countryCode: '+65',
        nationalNumber: '91234567',
        consentService: 'true',
        email: 'another@example.com',
        formLoadedAt: (Date.now() - 10000).toString(),
      });

    // Duplicate phone returns 200 with alreadyRegistered flag (anti-enumeration UX)
    expect(res.status).toBe(200);
    expect(res.body.alreadyRegistered).toBe(true);
  });

  it('rejects invalid Singapore phone format', async () => {
    const { agent, csrfToken } = await csrfAgent();
    const res = await agent
      .post('/api/leads')
      .set('x-csrf-token', csrfToken)
      .type('form')
      .send({
        name: 'John Tan',
        countryCode: '+65',
        nationalNumber: '61234567',
        consentService: 'true',
        email: 'test@example.com',
        formLoadedAt: (Date.now() - 10000).toString(),
      });

    expect(res.status).toBe(400);
  });

  it('creates a lead with Malaysian phone number', async () => {
    const { agent, csrfToken } = await csrfAgent();
    const res = await agent
      .post('/api/leads')
      .set('x-csrf-token', csrfToken)
      .type('form')
      .send({
        name: 'Ahmad Bin Ali',
        countryCode: '+60',
        nationalNumber: '123456789',
        consentService: 'true',
        consentMarketing: 'false',
        leadSource: 'website',
        email: 'ahmad@example.com',
        formLoadedAt: (Date.now() - 10000).toString(),
      });

    expect(res.status).toBe(201);

    const seller = await testPrisma.seller.findFirst({ where: { phone: '+60123456789' } });
    expect(seller).not.toBeNull();
    expect(seller!.countryCode).toBe('+60');
    expect(seller!.nationalNumber).toBe('123456789');
  });
});
