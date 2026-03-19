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
        phone: '91234567',
        consentService: 'true',
        consentMarketing: 'false',
        leadSource: 'website',
        formLoadedAt: (Date.now() - 10000).toString(),
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    // Verify seller was created
    const seller = await testPrisma.seller.findFirst({ where: { phone: '91234567' } });
    expect(seller).not.toBeNull();
    expect(seller!.status).toBe('lead');
    expect(seller!.consentService).toBe(true);
    expect(seller!.agentId).toBeNull();

    // Verify consent record was created
    const consent = await testPrisma.consentRecord.findFirst({
      where: { subjectId: seller!.id },
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
        phone: '81234567',
        consentService: 'false',
        formLoadedAt: (Date.now() - 10000).toString(),
      });

    expect(res.status).toBe(400);
  });

  it('rejects duplicate phone number', async () => {
    // Create first lead
    const { agent: agent1, csrfToken: token1 } = await csrfAgent();
    await agent1
      .post('/api/leads')
      .set('x-csrf-token', token1)
      .type('form')
      .send({
        name: 'John Tan',
        phone: '91234567',
        consentService: 'true',
        formLoadedAt: (Date.now() - 10000).toString(),
      });

    // Attempt duplicate
    const { agent: agent2, csrfToken: token2 } = await csrfAgent();
    const res = await agent2
      .post('/api/leads')
      .set('x-csrf-token', token2)
      .type('form')
      .send({
        name: 'Another Person',
        phone: '91234567',
        consentService: 'true',
        formLoadedAt: (Date.now() - 10000).toString(),
      });

    expect(res.status).toBe(409);
  });

  it('rejects invalid phone format', async () => {
    const { agent, csrfToken } = await csrfAgent();
    const res = await agent
      .post('/api/leads')
      .set('x-csrf-token', csrfToken)
      .type('form')
      .send({
        name: 'John Tan',
        phone: '61234567',
        consentService: 'true',
        formLoadedAt: (Date.now() - 10000).toString(),
      });

    expect(res.status).toBe(400);
  });
});
