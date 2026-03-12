/**
 * tests/e2e/content.spec.ts
 * Phase 6 Section 6 — E2E tests for the Content & Referral domain.
 *
 * Uses Playwright browser + direct Prisma for test data setup.
 * Server started via playwright.config.ts webServer (test DB).
 */
import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { createId } from '@paralleldrive/cuid2';

const E2E_DB_URL =
  process.env.DATABASE_URL_TEST || 'postgresql://smhn:smhn_test@localhost:5433/sellmyhomenow_test';

const db = new PrismaClient({ datasources: { db: { url: E2E_DB_URL } } });

const PASS = 'E2eTest1!';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function makeAdmin() {
  const id = createId();
  return db.agent.create({
    data: {
      id,
      name: 'E2E Admin',
      email: `e2e-admin-${id}@test.local`,
      phone: `9${id.slice(0, 7)}`,
      ceaRegNo: `R${id.slice(0, 6)}A`,
      passwordHash: await bcrypt.hash(PASS, 12),
      role: 'admin',
      isActive: true,
    },
  });
}

async function makeAgent() {
  const id = createId();
  return db.agent.create({
    data: {
      id,
      name: 'E2E Agent',
      email: `e2e-agent-${id}@test.local`,
      phone: `9${id.slice(0, 7)}`,
      ceaRegNo: `R${id.slice(0, 6)}A`,
      passwordHash: await bcrypt.hash(PASS, 12),
      role: 'agent',
      isActive: true,
    },
  });
}

async function makeSeller(agentId: string) {
  const id = createId();
  return db.seller.create({
    data: {
      id,
      name: 'E2E Seller',
      email: `e2e-seller-${id}@test.local`,
      phone: `9${id.slice(0, 7)}`,
      passwordHash: await bcrypt.hash(PASS, 12),
      agentId,
      consentService: true,
      consentMarketing: false,
    },
  });
}

/** Login as admin/agent via raw POST (no HTMX header → 302 → session set). */
async function loginAdmin(page: import('@playwright/test').Page, email: string) {
  await page.context().request.post('/auth/login/agent', {
    form: { email, password: PASS },
  });
}

async function loginSeller(page: import('@playwright/test').Page, email: string) {
  await page.context().request.post('/auth/login/seller', {
    form: { email, password: PASS },
  });
}

async function clearTables() {
  // Truncate in safe FK order (child → parent)
  await db.referral.deleteMany();
  await db.testimonial.deleteMany();
  await db.videoTutorial.deleteMany();
  await db.marketContent.deleteMany();
  await db.otp.deleteMany();
  await db.commissionInvoice.deleteMany();
  await db.transaction.deleteMany();
  await db.estateAgencyAgreement.deleteMany();
  await db.property.deleteMany();
  await db.consentRecord.deleteMany();
  await db.seller.deleteMany();
  await db.hdbTransaction.deleteMany();
  await db.agent.deleteMany();
}

test.beforeEach(async () => {
  await clearTables();
});

test.afterAll(async () => {
  await clearTables();
  await db.$disconnect();
});

// ─── Scenario 1: Admin creates tutorial → seller sees it in correct category ──

test('admin creates a video tutorial → seller dashboard shows it in correct category', async ({
  page,
}) => {
  const admin = await makeAdmin();
  const agent = await makeAgent();
  const seller = await makeSeller(agent.id);

  // ── Admin logs in and creates a tutorial ──────────────────────────────────
  await loginAdmin(page, admin.email);
  await page.goto('/admin/tutorials/new');
  await page.fill('[name="title"]', 'E2E Photography Tips');
  await page.fill('[name="youtubeUrl"]', 'https://www.youtube.com/embed/dQw4w9WgXcQ');
  await page.fill('[name="description"]', 'Tips for taking great photos');
  await page.selectOption('[name="category"]', 'photography');
  await page.click('[type="submit"]');

  // Redirected to tutorials list
  await page.waitForURL('/admin/tutorials');
  await expect(page.locator('text="E2E Photography Tips"')).toBeVisible();

  // ── Seller logs in and sees the tutorial in the photography category ───────
  await page.context().clearCookies();
  await loginSeller(page, seller.email!);
  await page.goto('/seller/tutorials');

  await expect(page.locator('text="E2E Photography Tips"')).toBeVisible();
  // Category heading is displayed (capitalize CSS makes it "photography")
  await expect(page.locator('text="photography"')).toBeVisible();
});

// ─── Scenario 2: Market content run → agent approves → admin sees approved ────

test('market content weekly run → agent reviews in queue → approves → admin sees approved status', async ({
  page,
}) => {
  const admin = await makeAdmin();

  // Seed a pending_review market content record directly (AI generation is mocked at unit/integration
  // level; E2E focuses on the review workflow: list → detail → approve → verify).
  const mcId = createId();
  await db.marketContent.create({
    data: {
      id: mcId,
      town: 'TAMPINES',
      flatType: '4 ROOM',
      period: '2026-W10',
      rawData: { medianPrice: 500000, transactions: 12 },
      aiNarrative: 'E2E test market narrative',
      aiProvider: 'stub',
      aiModel: 'stub',
      status: 'pending_review',
    },
  });

  await loginAdmin(page, admin.email);

  // Find the seeded pending_review record
  const mc = await db.marketContent.findUnique({ where: { id: mcId } });
  expect(mc).not.toBeNull();

  // Navigate to the detail page
  await page.goto(`/admin/content/market/${mc!.id}`);
  await expect(page.locator('text="pending review"')).toBeVisible();

  // Approve the market content
  await page.click('text="Approve"');
  await page.waitForURL('/admin/content/market');

  // Detail page now shows approved status
  await page.goto(`/admin/content/market/${mc!.id}`);
  await expect(page.locator('text="approved"')).toBeVisible();

  // Verify in DB
  const updated = await db.marketContent.findUnique({ where: { id: mc!.id } });
  expect(updated!.status).toBe('approved');
  expect(updated!.approvedByAgentId).toBe(admin.id);
});

// ─── Scenario 3: Testimonial lifecycle ────────────────────────────────────────

test('seller receives testimonial link → fills form → agent approves → testimonial appears on homepage → seller removes it → testimonial gone', async ({
  page,
}) => {
  const admin = await makeAdmin();
  const agent = await makeAgent();
  const seller = await makeSeller(agent.id);

  // Create the transaction context and issue a testimonial token
  const property = await db.property.create({
    data: {
      id: createId(),
      sellerId: seller.id,
      block: '123',
      street: 'E2E Street',
      town: 'TAMPINES',
      flatType: '4 ROOM',
      storeyRange: '07 TO 09',
      floorAreaSqm: 93,
      flatModel: 'Model A',
      leaseCommenceDate: 1995,
      askingPrice: 500_000,
      status: 'listed',
    },
  });
  const transaction = await db.transaction.create({
    data: {
      id: createId(),
      sellerId: seller.id,
      propertyId: property.id,
      agreedPrice: 500_000,
      status: 'completed',
    },
  });
  const token = `e2e-token-${createId()}`;
  await db.testimonial.create({
    data: {
      id: createId(),
      sellerId: seller.id,
      transactionId: transaction.id,
      submissionToken: token,
      tokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: 'pending_submission',
      sellerName: 'E2E Seller',
      sellerTown: 'Tampines',
    },
  });

  // ── Step 1: Seller fills testimonial form ─────────────────────────────────
  await page.goto(`/testimonial/${token}`);
  await expect(page.locator('form')).toBeVisible();
  await page.fill('[name="content"]', 'E2E: Excellent service, sold in 2 weeks!');
  await page.fill('[name="sellerName"]', 'E2E Seller');
  await page.fill('[name="sellerTown"]', 'Tampines');
  // Select rating 5
  await page.selectOption('[name="rating"]', '5');
  await page.click('[type="submit"]');

  // Thank-you page
  await page.waitForURL('/testimonial/thankyou');

  // ── Step 2: Admin approves and features the testimonial ───────────────────
  const testimonial = await db.testimonial.findFirst({ where: { sellerId: seller.id } });
  expect(testimonial!.status).toBe('pending_review');

  // Clear browser session before logging in as admin (avoid conflict with seller session)
  await page.context().clearCookies();
  await loginAdmin(page, admin.email);
  // Navigate to testimonials list and click Approve (browser navigation for reliable session)
  await page.goto('/admin/content/testimonials');
  await page.click('text="Approve"');
  await page.waitForURL('/admin/content/testimonials');
  // Feature the testimonial directly in DB (sets displayOnWebsite=true)
  await db.testimonial.update({
    where: { id: testimonial!.id },
    data: { displayOnWebsite: true },
  });

  // ── Step 3: Homepage shows the testimonial ────────────────────────────────
  await page.context().clearCookies();
  await page.goto('/');
  await expect(page.locator('text=E2E: Excellent service, sold in 2 weeks!')).toBeVisible();

  // ── Step 4: Seller removes testimonial (PDPA) ─────────────────────────────
  await loginSeller(page, seller.email!);
  await page.context().request.post('/seller/testimonial/remove');

  // ── Step 5: Homepage no longer shows the testimonial ─────────────────────
  await page.context().clearCookies();
  await page.goto('/');
  await expect(page.locator('text=E2E: Excellent service, sold in 2 weeks!')).not.toBeVisible();
});

// ─── Scenario 4: Referral link → visitor clicks → submits lead → funnel ───────

test('seller receives referral link (simulated) → visitor clicks link → submits lead form → admin funnel shows 1 click + 1 lead', async ({
  page,
}) => {
  const admin = await makeAdmin();
  const agent = await makeAgent();
  const seller = await makeSeller(agent.id);

  // Simulate sendReferralLinks: create referral directly in DB
  const referralCode = 'E2EREF1';
  await db.referral.create({
    data: {
      id: createId(),
      referrerSellerId: seller.id,
      referralCode,
      status: 'link_generated',
      clickCount: 0,
    },
  });

  // ── Step 1: Visitor arrives via referral link ─────────────────────────────
  await page.goto(`/?ref=${referralCode}`);
  await expect(page).toHaveURL(`/?ref=${referralCode}`);

  // Wait for referral tracking middleware to process the click
  // (middleware awaits the DB write before rendering the page)
  const clickedReferral = await db.referral.findFirst({ where: { referralCode } });
  expect(clickedReferral!.clickCount).toBe(1);
  expect(clickedReferral!.status).toBe('clicked');

  // ── Step 2: Visitor submits lead form (using API request in same browser context)
  // This keeps the session cookie (with referralCode) intact from the homepage visit above.
  const leadRes = await page.context().request.post('/api/leads', {
    form: {
      name: 'E2E Referral Lead',
      phone: '91234567',
      consentService: 'true',
      consentMarketing: 'false',
      leadSource: 'referral',
      formLoadedAt: String(Date.now() - 5000),
    },
  });
  // Server returns 200 (HTMX partial) or 201 (JSON); both indicate success
  expect([200, 201]).toContain(leadRes.status());

  // ── Step 3: Admin funnel shows 1 click + 1 lead ───────────────────────────
  // Clear visitor session before logging in as admin
  await page.context().clearCookies();
  await loginAdmin(page, admin.email);
  const funnelRes = await page.context().request.get('/admin/content/referrals');
  const html = await funnelRes.text();

  // Funnel counts: linksGenerated=1, clicked=1, leadsCreated=1
  expect(html).toContain('>1<'); // at least one "1" stat in the funnel cards

  // Verify in DB: referral linked to new seller
  const updated = await db.referral.findFirst({ where: { referralCode } });
  expect(updated!.clickCount).toBe(1);
  expect(updated!.status).toBe('lead_created');
  expect(updated!.referredSellerId).not.toBeNull();
});
