// tests/integration/content.test.ts
import request from 'supertest';
import bcrypt from 'bcrypt';
import { testPrisma, cleanDatabase } from '../helpers/prisma';
import { factory } from '../fixtures/factory';
import { createApp } from '../../src/infra/http/app';
import { getIsoWeekPeriod } from '../../src/domains/content/content.service';

jest.mock('@/domains/shared/ai/ai.facade', () => ({
  generateText: jest.fn().mockResolvedValue({
    text: JSON.stringify({
      narrative: 'HDB prices rose this week.',
      tiktok: 'Prices up! #HDB #Singapore #Property',
      instagram: 'Market update. Based on HDB resale data — sellmyhomenow.sg #HDB #SG',
      linkedin: 'The Singapore HDB market shows strength. Based on HDB resale data — sellmyhomenow.sg',
    }),
    provider: 'anthropic',
    model: 'claude-test',
  }),
}));

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

async function loginAsAdmin() {
  const password = 'AdminPassword1!';
  const adminRecord = await factory.agent({
    email: `admin-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
    passwordHash: await bcrypt.hash(password, 12),
    role: 'admin',
  });
  const agent = request.agent(app);
  await agent.post('/auth/login/agent').type('form').send({ email: adminRecord.email, password });
  return { adminRecord, agent };
}

async function loginAsAgent() {
  const password = 'AgentPassword1!';
  const agentRecord = await factory.agent({
    email: `agent-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
    passwordHash: await bcrypt.hash(password, 12),
    role: 'agent',
  });
  const agent = request.agent(app);
  await agent.post('/auth/login/agent').type('form').send({ email: agentRecord.email, password });
  return { agentRecord, agent };
}

// ─── Section 2: Video Tutorial Management ────────────────────────────────────

describe('GET /admin/tutorials — list', () => {
  it('returns 200 for admin', async () => {
    const { agent } = await loginAsAdmin();
    const res = await agent.get('/admin/tutorials').set('HX-Request', 'true');
    expect(res.status).toBe(200);
  });

  it('returns 403 for regular agent', async () => {
    const { agent } = await loginAsAgent();
    const res = await agent.get('/admin/tutorials');
    expect(res.status).toBe(403);
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app).get('/admin/tutorials');
    expect(res.status).toBe(401);
  });
});

describe('POST /admin/tutorials — create', () => {
  it('creates a tutorial and redirects to list', async () => {
    const { agent } = await loginAsAdmin();

    const res = await agent.post('/admin/tutorials').type('form').send({
      title: 'How to Take Great Photos',
      youtubeUrl: 'https://www.youtube.com/watch?v=abc123',
      category: 'photography',
      description: 'Tips for sellers',
    });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/tutorials');

    const tutorial = await testPrisma.videoTutorial.findFirst({
      where: { title: 'How to Take Great Photos' },
    });
    expect(tutorial).not.toBeNull();
    expect(tutorial!.slug).toBe('how-to-take-great-photos');
    expect(tutorial!.category).toBe('photography');
  });

  it('returns 400 when title is missing', async () => {
    const { agent } = await loginAsAdmin();
    const res = await agent.post('/admin/tutorials').type('form').send({
      youtubeUrl: 'https://www.youtube.com/watch?v=abc123',
      category: 'photography',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when youtubeUrl is missing', async () => {
    const { agent } = await loginAsAdmin();
    const res = await agent.post('/admin/tutorials').type('form').send({
      title: 'A Tutorial',
      category: 'photography',
    });
    expect(res.status).toBe(400);
  });

  it('returns 409 when slug already exists', async () => {
    const { agent } = await loginAsAdmin();
    await factory.videoTutorial({ slug: 'duplicate-slug' });

    const res = await agent.post('/admin/tutorials').type('form').send({
      title: 'Duplicate Slug',
      slug: 'duplicate-slug',
      youtubeUrl: 'https://www.youtube.com/watch?v=xyz',
      category: 'forms',
    });
    expect(res.status).toBe(409);
  });
});

describe('GET /admin/tutorials/new — create form', () => {
  it('returns 200 for admin', async () => {
    const { agent } = await loginAsAdmin();
    const res = await agent.get('/admin/tutorials/new');
    expect(res.status).toBe(200);
  });
});

describe('GET /admin/tutorials/:id/edit — edit form', () => {
  it('returns 200 with tutorial data for admin', async () => {
    const { agent } = await loginAsAdmin();
    const tutorial = await factory.videoTutorial({ title: 'Existing Tutorial' });

    const res = await agent.get(`/admin/tutorials/${tutorial.id}/edit`);
    expect(res.status).toBe(200);
  });

  it('returns 404 for unknown tutorial', async () => {
    const { agent } = await loginAsAdmin();
    const res = await agent.get('/admin/tutorials/nonexistent/edit');
    expect(res.status).toBe(404);
  });
});

describe('POST /admin/tutorials/:id — update', () => {
  it('updates tutorial and redirects', async () => {
    const { agent } = await loginAsAdmin();
    const tutorial = await factory.videoTutorial({ title: 'Old Title', category: 'forms' });

    const res = await agent.post(`/admin/tutorials/${tutorial.id}`).type('form').send({
      title: 'New Title',
      slug: tutorial.slug,
      youtubeUrl: 'https://www.youtube.com/watch?v=updated',
      category: 'process',
    });

    expect(res.status).toBe(302);
    const updated = await testPrisma.videoTutorial.findUnique({ where: { id: tutorial.id } });
    expect(updated!.title).toBe('New Title');
    expect(updated!.category).toBe('process');
  });

  it('returns 404 for unknown tutorial', async () => {
    const { agent } = await loginAsAdmin();
    const res = await agent.post('/admin/tutorials/nonexistent').type('form').send({
      title: 'X',
      slug: 'x',
      youtubeUrl: 'https://www.youtube.com/watch?v=x',
      category: 'forms',
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /admin/tutorials/:id/delete — delete', () => {
  it('deletes tutorial and redirects', async () => {
    const { agent } = await loginAsAdmin();
    const tutorial = await factory.videoTutorial();

    const res = await agent.post(`/admin/tutorials/${tutorial.id}/delete`);
    expect(res.status).toBe(302);

    const deleted = await testPrisma.videoTutorial.findUnique({ where: { id: tutorial.id } });
    expect(deleted).toBeNull();
  });

  it('returns 404 for unknown tutorial', async () => {
    const { agent } = await loginAsAdmin();
    const res = await agent.post('/admin/tutorials/nonexistent/delete');
    expect(res.status).toBe(404);
  });
});

describe('POST /admin/tutorials/reorder — reorder', () => {
  it('updates orderIndex for multiple tutorials', async () => {
    const { agent } = await loginAsAdmin();
    const t1 = await factory.videoTutorial({ orderIndex: 0 });
    const t2 = await factory.videoTutorial({ orderIndex: 1 });

    const res = await agent
      .post('/admin/tutorials/reorder')
      .set('HX-Request', 'true')
      .type('form')
      .send(`items[0][id]=${t1.id}&items[0][orderIndex]=1&items[1][id]=${t2.id}&items[1][orderIndex]=0`);

    expect(res.status).toBe(200);

    const updated1 = await testPrisma.videoTutorial.findUnique({ where: { id: t1.id } });
    const updated2 = await testPrisma.videoTutorial.findUnique({ where: { id: t2.id } });
    expect(updated1!.orderIndex).toBe(1);
    expect(updated2!.orderIndex).toBe(0);
  });
});

// ─── Section 3: Market Content Engine ────────────────────────────────────────

describe('GET /admin/content/market — list', () => {
  it('returns 200 for admin', async () => {
    const { agent } = await loginAsAdmin();
    await factory.marketContent({ status: 'pending_review' });
    const res = await agent.get('/admin/content/market');
    expect(res.status).toBe(200);
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app).get('/admin/content/market');
    expect(res.status).toBe(401);
  });

  it('returns 403 for regular agent', async () => {
    const { agent } = await loginAsAgent();
    const res = await agent.get('/admin/content/market');
    expect(res.status).toBe(403);
  });
});

describe('GET /admin/content/market/:id — detail', () => {
  it('returns 200 with market content detail for admin', async () => {
    const { agent } = await loginAsAdmin();
    const mc = await factory.marketContent({ status: 'approved', aiNarrative: 'Test narrative.' });
    const res = await agent.get(`/admin/content/market/${mc.id}`);
    expect(res.status).toBe(200);
  });

  it('returns 404 for unknown market content id', async () => {
    const { agent } = await loginAsAdmin();
    const res = await agent.get('/admin/content/market/nonexistent-id');
    expect(res.status).toBe(404);
  });
});

describe('POST /admin/content/market/run — manual trigger', () => {
  it('returns 409 when non-rejected record already exists for current period', async () => {
    const { agent } = await loginAsAdmin();
    const period = getIsoWeekPeriod();
    await factory.marketContent({ period, status: 'pending_review' });

    const res = await agent.post('/admin/content/market/run');
    expect(res.status).toBe(409);
  });

  it('returns 302 redirect on success when sufficient HDB data exists', async () => {
    const { agent } = await loginAsAdmin();
    // 12 HDB transactions within the last 3 months
    const recentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        factory.hdbTransaction({
          month: recentMonth,
          town: i < 6 ? 'TAMPINES' : 'BISHAN',
          resalePrice: 500_000,
        }),
      ),
    );

    const res = await agent.post('/admin/content/market/run');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/content/market');

    const created = await testPrisma.marketContent.findFirst({
      where: { status: 'pending_review' },
    });
    expect(created).not.toBeNull();
    expect(created!.town).toBe('ALL');
    expect(created!.flatType).toBe('ALL');
  });

  it('redirects with notice when insufficient HDB data (< 10 transactions)', async () => {
    const { agent } = await loginAsAdmin();
    // Only 3 transactions — not enough
    await factory.hdbTransaction({ resalePrice: 500_000 });
    await factory.hdbTransaction({ resalePrice: 600_000 });
    await factory.hdbTransaction({ resalePrice: 700_000 });

    const res = await agent.post('/admin/content/market/run');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('notice=no_data');
  });
});

// ─── Section 4: Testimonial Management ───────────────────────────────────────

async function loginAsSeller() {
  const agentRecord = await factory.agent();
  const password = 'SellerPass1!';
  const sellerRecord = await factory.seller({
    agentId: agentRecord.id,
    passwordHash: await bcrypt.hash(password, 12),
  });
  const sellerAgent = request.agent(app);
  await sellerAgent.post('/auth/login/seller').type('form').send({ email: sellerRecord.email, password });
  return { sellerRecord, agentRecord, sellerAgent };
}

describe('GET /testimonial/:token — public submission form', () => {
  it('returns 200 with form for a valid unexpired token', async () => {
    const agentRecord = await factory.agent();
    const sellerRecord = await factory.seller({ agentId: agentRecord.id });
    const property = await factory.property({ sellerId: sellerRecord.id });
    const transaction = await factory.transaction({ sellerId: sellerRecord.id, propertyId: property.id });
    const testimonial = await factory.testimonial({
      sellerId: sellerRecord.id,
      transactionId: transaction.id,
      submissionToken: 'valid-token-abc',
      tokenExpiresAt: new Date(Date.now() + 86_400_000),
    });

    const res = await request(app).get(`/testimonial/${testimonial.submissionToken}`);
    expect(res.status).toBe(200);
  });

  it('returns 404 for unknown token', async () => {
    const res = await request(app).get('/testimonial/totally-unknown-token');
    expect(res.status).toBe(404);
  });

  it('returns 410 for expired token', async () => {
    const agentRecord = await factory.agent();
    const sellerRecord = await factory.seller({ agentId: agentRecord.id });
    const property = await factory.property({ sellerId: sellerRecord.id });
    const transaction = await factory.transaction({ sellerId: sellerRecord.id, propertyId: property.id });
    const testimonial = await factory.testimonial({
      sellerId: sellerRecord.id,
      transactionId: transaction.id,
      submissionToken: 'expired-token-xyz',
      tokenExpiresAt: new Date(Date.now() - 1000),
    });

    const res = await request(app).get(`/testimonial/${testimonial.submissionToken}`);
    expect(res.status).toBe(410);
  });
});

describe('POST /testimonial/:token — submit', () => {
  it('returns 302 redirect on successful submission', async () => {
    const agentRecord = await factory.agent();
    const sellerRecord = await factory.seller({ agentId: agentRecord.id });
    const property = await factory.property({ sellerId: sellerRecord.id });
    const transaction = await factory.transaction({ sellerId: sellerRecord.id, propertyId: property.id });
    const testimonial = await factory.testimonial({
      sellerId: sellerRecord.id,
      transactionId: transaction.id,
      submissionToken: 'submit-token-123',
      tokenExpiresAt: new Date(Date.now() + 86_400_000),
    });

    const res = await request(app)
      .post(`/testimonial/${testimonial.submissionToken}`)
      .type('form')
      .send({ content: 'Excellent service!', rating: '5', sellerName: 'John T.', sellerTown: 'Tampines' });

    expect(res.status).toBe(302);

    const updated = await testPrisma.testimonial.findUnique({ where: { id: testimonial.id } });
    expect(updated!.status).toBe('pending_review');
    expect(updated!.content).toBe('Excellent service!');
  });

  it('returns 422 when required fields are missing', async () => {
    const agentRecord = await factory.agent();
    const sellerRecord = await factory.seller({ agentId: agentRecord.id });
    const property = await factory.property({ sellerId: sellerRecord.id });
    const transaction = await factory.transaction({ sellerId: sellerRecord.id, propertyId: property.id });
    const testimonial = await factory.testimonial({
      sellerId: sellerRecord.id,
      transactionId: transaction.id,
      submissionToken: 'validation-token-456',
      tokenExpiresAt: new Date(Date.now() + 86_400_000),
    });

    const res = await request(app)
      .post(`/testimonial/${testimonial.submissionToken}`)
      .type('form')
      .send({ content: '' });

    expect(res.status).toBe(422);
  });
});

describe('GET /admin/content/testimonials — admin list', () => {
  it('returns 200 for admin', async () => {
    const { agent } = await loginAsAdmin();
    const res = await agent.get('/admin/content/testimonials');
    expect(res.status).toBe(200);
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app).get('/admin/content/testimonials');
    expect(res.status).toBe(401);
  });
});

describe('POST /admin/content/testimonials/:id/approve — approve', () => {
  it('sets status to approved and redirects', async () => {
    const { agent, adminRecord } = await loginAsAdmin();
    const agentRecord = await factory.agent();
    const sellerRecord = await factory.seller({ agentId: agentRecord.id });
    const property = await factory.property({ sellerId: sellerRecord.id });
    const transaction = await factory.transaction({ sellerId: sellerRecord.id, propertyId: property.id });
    const testimonial = await factory.testimonial({
      sellerId: sellerRecord.id,
      transactionId: transaction.id,
      status: 'pending_review',
    });

    const res = await agent.post(`/admin/content/testimonials/${testimonial.id}/approve`);
    expect(res.status).toBe(302);

    const updated = await testPrisma.testimonial.findUnique({ where: { id: testimonial.id } });
    expect(updated!.status).toBe('approved');
    expect(updated!.approvedByAgentId).toBe(adminRecord.id);
  });
});

describe('POST /admin/content/testimonials/:id/reject — reject', () => {
  it('sets status to rejected and redirects', async () => {
    const { agent } = await loginAsAdmin();
    const agentRecord = await factory.agent();
    const sellerRecord = await factory.seller({ agentId: agentRecord.id });
    const property = await factory.property({ sellerId: sellerRecord.id });
    const transaction = await factory.transaction({ sellerId: sellerRecord.id, propertyId: property.id });
    const testimonial = await factory.testimonial({
      sellerId: sellerRecord.id,
      transactionId: transaction.id,
      status: 'pending_review',
    });

    const res = await agent.post(`/admin/content/testimonials/${testimonial.id}/reject`);
    expect(res.status).toBe(302);

    const updated = await testPrisma.testimonial.findUnique({ where: { id: testimonial.id } });
    expect(updated!.status).toBe('rejected');
  });
});

describe('POST /admin/content/testimonials/:id/feature — feature toggle', () => {
  it('toggles displayOnWebsite and redirects', async () => {
    const { agent } = await loginAsAdmin();
    const agentRecord = await factory.agent();
    const sellerRecord = await factory.seller({ agentId: agentRecord.id });
    const property = await factory.property({ sellerId: sellerRecord.id });
    const transaction = await factory.transaction({ sellerId: sellerRecord.id, propertyId: property.id });
    const testimonial = await factory.testimonial({
      sellerId: sellerRecord.id,
      transactionId: transaction.id,
      status: 'approved',
      displayOnWebsite: false,
    });

    const res = await agent
      .post(`/admin/content/testimonials/${testimonial.id}/feature`)
      .type('form')
      .send({ displayOnWebsite: 'true' });
    expect(res.status).toBe(302);

    const updated = await testPrisma.testimonial.findUnique({ where: { id: testimonial.id } });
    expect(updated!.displayOnWebsite).toBe(true);
  });
});

describe('POST /seller/testimonial/remove — PDPA testimonial removal', () => {
  it('hard-deletes the testimonial and redirects', async () => {
    const { sellerRecord, agentRecord, sellerAgent } = await loginAsSeller();
    const property = await factory.property({ sellerId: sellerRecord.id });
    const transaction = await factory.transaction({ sellerId: sellerRecord.id, propertyId: property.id });
    await factory.testimonial({ sellerId: sellerRecord.id, transactionId: transaction.id });

    const res = await sellerAgent.post('/seller/testimonial/remove');
    expect(res.status).toBe(302);

    const testimonial = await testPrisma.testimonial.findFirst({ where: { sellerId: sellerRecord.id } });
    expect(testimonial).toBeNull();
    void agentRecord; // used above
  });
});

describe('PDPA cascade — hardDeleteSeller removes testimonial without FK error', () => {
  it('deletes seller with an associated testimonial without foreign key constraint error', async () => {
    const { hardDeleteSeller } = await import('../../src/domains/compliance/compliance.repository');

    const agentRecord = await factory.agent();
    const sellerRecord = await factory.seller({ agentId: agentRecord.id });
    const property = await factory.property({ sellerId: sellerRecord.id });
    const transaction = await factory.transaction({ sellerId: sellerRecord.id, propertyId: property.id });
    await factory.testimonial({ sellerId: sellerRecord.id, transactionId: transaction.id });

    // hardDeleteSeller now handles the full FK chain: testimonial → otp/invoice → transaction → property → seller
    await expect(hardDeleteSeller(sellerRecord.id)).resolves.not.toThrow();

    const deletedSeller = await testPrisma.seller.findUnique({ where: { id: sellerRecord.id } });
    expect(deletedSeller).toBeNull();
    const deletedTestimonial = await testPrisma.testimonial.findFirst({ where: { sellerId: sellerRecord.id } });
    expect(deletedTestimonial).toBeNull();
  });
});

describe('GET / — homepage with featured testimonials', () => {
  it('returns 200 and renders testimonials section', async () => {
    const agentRecord = await factory.agent();
    const sellerRecord = await factory.seller({ agentId: agentRecord.id });
    const property = await factory.property({ sellerId: sellerRecord.id });
    const transaction = await factory.transaction({ sellerId: sellerRecord.id, propertyId: property.id });
    await factory.testimonial({
      sellerId: sellerRecord.id,
      transactionId: transaction.id,
      status: 'approved',
      displayOnWebsite: true,
      content: 'Amazing experience selling my flat!',
      rating: 5,
    });

    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Amazing experience selling my flat!');
  });
});

describe('GET /seller/tutorials — seller view still works after refactor', () => {
  it('returns 200 with grouped tutorials for authenticated seller', async () => {
    const agentRecord = await factory.agent();
    const sellerRecord = await factory.seller({ agentId: agentRecord.id });
    await factory.videoTutorial({ category: 'photography', orderIndex: 0 });
    await factory.videoTutorial({ category: 'forms', orderIndex: 0 });

    const password = 'SellerPass1!';
    await testPrisma.seller.update({
      where: { id: sellerRecord.id },
      data: { passwordHash: await bcrypt.hash(password, 12) },
    });

    const sellerAgent = request.agent(app);
    await sellerAgent.post('/auth/login/seller').type('form').send({
      email: sellerRecord.email,
      password,
    });

    const res = await sellerAgent.get('/seller/tutorials').set('HX-Request', 'true');
    expect(res.status).toBe(200);
  });
});
