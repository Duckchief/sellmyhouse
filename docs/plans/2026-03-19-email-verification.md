# Email Verification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Gate listing creation behind email verification — sellers register, receive a 24-hour verification link, and cannot create a listing until verified.

**Architecture:** New fields on `Seller` (emailVerified, emailVerificationToken, emailVerificationExpiry). A small `system-mailer.ts` sends transactional email via env-var SMTP. Service functions follow the password-reset token pattern. The listing gate lives in `property.service.createProperty()`. Dashboard shows a banner with a resend button for unverified sellers.

**Tech Stack:** TypeScript, Express, Prisma (PostgreSQL), nodemailer, crypto (built-in), Jest

**Design doc:** `docs/plans/2026-03-19-email-verification-design.md`

---

## Task 1: Prisma schema + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260319120000_email_verification/migration.sql`

**Step 1: Add fields to Seller model in schema.prisma**

Find the `Seller` model. Add after the existing `passwordResetExpiry` field:

```prisma
  emailVerified           Boolean   @default(false)
  emailVerificationToken  String?
  emailVerificationExpiry DateTime?
```

**Step 2: Create the migration directory and SQL file**

```bash
mkdir -p prisma/migrations/20260319120000_email_verification
```

Create `prisma/migrations/20260319120000_email_verification/migration.sql`:

```sql
ALTER TABLE "Seller" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Seller" ADD COLUMN "emailVerificationToken" TEXT;
ALTER TABLE "Seller" ADD COLUMN "emailVerificationExpiry" TIMESTAMP(3);
```

**Step 3: Apply the migration using the shadow DB approach**

> ⚠️ `prisma migrate dev` is blocked by the session table. Use the deploy workflow instead.

```bash
# 1. Create shadow DB
PGPASSWORD=smh_dev psql -U smh -h localhost -p 5432 -d smh_dev \
  -c "CREATE DATABASE smh_shadow_tmp;"

# 2. Apply migration
npx prisma migrate deploy

# 3. Regenerate client
npx prisma generate

# 4. Drop shadow DB
PGPASSWORD=smh_dev psql -U smh -h localhost -p 5432 -d smh_dev \
  -c "DROP DATABASE smh_shadow_tmp;"
```

Expected: `1 migration applied`, no errors.

**Step 4: Verify TypeScript sees the new fields**

```bash
npm run build 2>&1 | head -20
```

Expected: no TypeScript errors about missing Seller fields.

**Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260319120000_email_verification/
git commit -m "feat(auth): add email verification fields to Seller schema"
```

---

## Task 2: System mailer

**Files:**
- Create: `src/infra/email/system-mailer.ts`
- Create: `src/infra/email/__tests__/system-mailer.test.ts`

**Step 1: Write the failing test**

Create `src/infra/email/__tests__/system-mailer.test.ts`:

```ts
import nodemailer from 'nodemailer';

jest.mock('nodemailer');

const mockSendMail = jest.fn();
const mockCreateTransport = nodemailer.createTransport as jest.Mock;

describe('sendSystemEmail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateTransport.mockReturnValue({ sendMail: mockSendMail });
    mockSendMail.mockResolvedValue({ messageId: 'test-id' });

    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'user@example.com';
    process.env.SMTP_PASS = 'secret';
    process.env.SMTP_FROM = 'noreply@sellmyhouse.sg';
  });

  afterEach(() => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM;
  });

  it('sends email with correct parameters', async () => {
    const { sendSystemEmail } = await import('../system-mailer');
    await sendSystemEmail('seller@example.com', 'Test Subject', '<p>Hello</p>');

    expect(mockCreateTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'user@example.com', pass: 'secret' },
    });
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'noreply@sellmyhouse.sg',
        to: 'seller@example.com',
        subject: 'Test Subject',
        html: '<p>Hello</p>',
      }),
    );
  });

  it('throws if SMTP_HOST is missing', async () => {
    delete process.env.SMTP_HOST;
    jest.resetModules();
    const { sendSystemEmail } = await import('../system-mailer');
    await expect(
      sendSystemEmail('seller@example.com', 'Subject', 'body'),
    ).rejects.toThrow('System SMTP not configured');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest src/infra/email/__tests__/system-mailer.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '../system-mailer'`

**Step 3: Implement `src/infra/email/system-mailer.ts`**

```ts
import nodemailer from 'nodemailer';

export async function sendSystemEmail(
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM;

  if (!host || !port || !user || !pass || !from) {
    throw new Error('System SMTP not configured');
  }

  const portNum = parseInt(port, 10);
  const transporter = nodemailer.createTransport({
    host,
    port: portNum,
    secure: portNum === 465,
    auth: { user, pass },
  });

  await transporter.sendMail({ from, to, subject, html });
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest src/infra/email/__tests__/system-mailer.test.ts --no-coverage
```

Expected: PASS (2 tests)

**Step 5: Commit**

```bash
git add src/infra/email/
git commit -m "feat(infra): add system-mailer for env-var SMTP"
```

---

## Task 3: Auth repository — email verification functions

**Files:**
- Modify: `src/domains/auth/auth.repository.ts`
- Modify: `src/domains/auth/__tests__/auth.repository.test.ts`

**Step 1: Write failing tests**

In `src/domains/auth/__tests__/auth.repository.test.ts`, add a new `describe` block inside the existing `describe('AuthRepository')`:

```ts
describe('email verification', () => {
  it('setSellerEmailVerificationToken updates token and expiry', async () => {
    prisma.seller.update.mockResolvedValue({});
    const expiry = new Date('2026-03-20T00:00:00Z');
    await authRepo.setSellerEmailVerificationToken('seller-1', 'hashed-token', expiry);
    expect(prisma.seller.update).toHaveBeenCalledWith({
      where: { id: 'seller-1' },
      data: { emailVerificationToken: 'hashed-token', emailVerificationExpiry: expiry },
    });
  });

  it('findSellerByEmailVerificationToken queries by hashed token', async () => {
    prisma.seller.findFirst.mockResolvedValue(null);
    await authRepo.findSellerByEmailVerificationToken('hashed-token');
    expect(prisma.seller.findFirst).toHaveBeenCalledWith({
      where: { emailVerificationToken: 'hashed-token' },
    });
  });

  it('markSellerEmailVerified sets emailVerified and clears token fields', async () => {
    prisma.seller.update.mockResolvedValue({});
    await authRepo.markSellerEmailVerified('seller-1');
    expect(prisma.seller.update).toHaveBeenCalledWith({
      where: { id: 'seller-1' },
      data: {
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpiry: null,
      },
    });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx jest src/domains/auth/__tests__/auth.repository.test.ts --no-coverage
```

Expected: FAIL — `authRepo.setSellerEmailVerificationToken is not a function`

**Step 3: Add functions to `auth.repository.ts`**

Add at the end of the `// ─── Seller ─────` section (after `clearSellerPasswordResetToken`):

```ts
export function setSellerEmailVerificationToken(id: string, hashedToken: string, expiry: Date) {
  return prisma.seller.update({
    where: { id },
    data: { emailVerificationToken: hashedToken, emailVerificationExpiry: expiry },
  });
}

export function findSellerByEmailVerificationToken(hashedToken: string) {
  return prisma.seller.findFirst({
    where: { emailVerificationToken: hashedToken },
  });
}

export function markSellerEmailVerified(id: string) {
  return prisma.seller.update({
    where: { id },
    data: {
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpiry: null,
    },
  });
}
```

**Step 4: Run tests to verify they pass**

```bash
npx jest src/domains/auth/__tests__/auth.repository.test.ts --no-coverage
```

Expected: PASS (all existing + 3 new tests)

**Step 5: Commit**

```bash
git add src/domains/auth/auth.repository.ts src/domains/auth/__tests__/auth.repository.test.ts
git commit -m "feat(auth): add email verification repo functions"
```

---

## Task 4: Auth service — sendVerificationEmail and verifyEmail

**Files:**
- Modify: `src/domains/auth/auth.service.ts`
- Modify: `src/domains/auth/__tests__/auth.service.test.ts`

**Step 1: Write failing tests**

Add to `src/domains/auth/__tests__/auth.service.test.ts`, at the top with other mocks:

```ts
jest.mock('../../../infra/email/system-mailer');
const systemMailer = jest.requireMock('../../../infra/email/system-mailer');
```

Then add a new describe block:

```ts
describe('sendVerificationEmail', () => {
  it('sets verification token and sends email', async () => {
    authRepo.setSellerEmailVerificationToken = jest.fn().mockResolvedValue({});
    systemMailer.sendSystemEmail = jest.fn().mockResolvedValue(undefined);

    await authService.sendVerificationEmail('seller-1', 'seller@example.com');

    expect(authRepo.setSellerEmailVerificationToken).toHaveBeenCalledWith(
      'seller-1',
      expect.any(String), // hashed token
      expect.any(Date),   // expiry
    );
    expect(systemMailer.sendSystemEmail).toHaveBeenCalledWith(
      'seller@example.com',
      expect.stringContaining('Verify'),
      expect.stringContaining('/auth/verify-email/'),
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.email_verification_sent' }),
    );
  });
});

describe('verifyEmail', () => {
  it('marks seller email as verified when token is valid', async () => {
    const expiry = new Date(Date.now() + 60 * 60 * 1000);
    authRepo.findSellerByEmailVerificationToken = jest.fn().mockResolvedValue({
      id: 'seller-1',
      emailVerificationExpiry: expiry,
    });
    authRepo.markSellerEmailVerified = jest.fn().mockResolvedValue({});

    await authService.verifyEmail('raw-token');

    expect(authRepo.markSellerEmailVerified).toHaveBeenCalledWith('seller-1');
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.email_verified' }),
    );
  });

  it('throws ValidationError when token is not found', async () => {
    authRepo.findSellerByEmailVerificationToken = jest.fn().mockResolvedValue(null);
    await expect(authService.verifyEmail('bad-token')).rejects.toThrow('Invalid or expired');
  });

  it('throws ValidationError when token is expired', async () => {
    authRepo.findSellerByEmailVerificationToken = jest.fn().mockResolvedValue({
      id: 'seller-1',
      emailVerificationExpiry: new Date(Date.now() - 1000),
    });
    await expect(authService.verifyEmail('raw-token')).rejects.toThrow('Invalid or expired');
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx jest src/domains/auth/__tests__/auth.service.test.ts --no-coverage
```

Expected: FAIL — functions not defined

**Step 3: Add imports + functions to `auth.service.ts`**

At the top, add import:
```ts
import { sendSystemEmail } from '../../infra/email/system-mailer';
```

Add these functions before the `// ─── Helpers ───` section:

```ts
export async function sendVerificationEmail(sellerId: string, email: string): Promise<void> {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  await authRepo.setSellerEmailVerificationToken(sellerId, hashedToken, expiry);

  const appUrl = process.env.APP_URL || 'https://sellmyhouse.sg';
  const verifyUrl = `${appUrl}/auth/verify-email/${rawToken}`;

  await sendSystemEmail(
    email,
    'Verify your SellMyHouse email address',
    `<p>Click the link below to verify your email address:</p>
<p><a href="${verifyUrl}">${verifyUrl}</a></p>
<p>This link expires in 24 hours.</p>
<p>If you did not register on SellMyHouse, please ignore this email.</p>`,
  );

  await auditService.log({
    action: 'auth.email_verification_sent',
    entityType: 'seller',
    entityId: sellerId,
    details: { email: maskEmail(email) },
    actorType: 'system' as const,
  });
}

export async function verifyEmail(rawToken: string): Promise<void> {
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  const seller = await authRepo.findSellerByEmailVerificationToken(hashedToken);

  if (!seller) {
    throw new ValidationError('Invalid or expired verification link');
  }

  if (!seller.emailVerificationExpiry || seller.emailVerificationExpiry < new Date()) {
    throw new ValidationError('Invalid or expired verification link');
  }

  await authRepo.markSellerEmailVerified(seller.id);

  await auditService.log({
    action: 'auth.email_verified',
    entityType: 'seller',
    entityId: seller.id,
    details: {},
    actorType: 'seller' as const,
    actorId: seller.id,
  });
}
```

**Step 4: Run tests to verify they pass**

```bash
npx jest src/domains/auth/__tests__/auth.service.test.ts --no-coverage
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/domains/auth/auth.service.ts src/domains/auth/__tests__/auth.service.test.ts
git commit -m "feat(auth): add sendVerificationEmail and verifyEmail service functions"
```

---

## Task 5: Auth service — resendVerificationEmail + hook into registerSeller

**Files:**
- Modify: `src/domains/auth/auth.service.ts`
- Modify: `src/domains/auth/__tests__/auth.service.test.ts`

**Step 1: Write failing tests**

Add to `auth.service.test.ts`:

```ts
describe('resendVerificationEmail', () => {
  it('calls sendVerificationEmail with seller id and email', async () => {
    authRepo.findSellerById = jest.fn().mockResolvedValue({
      id: 'seller-1',
      email: 'seller@example.com',
      emailVerified: false,
    });
    authRepo.setSellerEmailVerificationToken = jest.fn().mockResolvedValue({});
    systemMailer.sendSystemEmail = jest.fn().mockResolvedValue(undefined);

    await authService.resendVerificationEmail('seller-1');

    expect(authRepo.setSellerEmailVerificationToken).toHaveBeenCalledWith(
      'seller-1',
      expect.any(String),
      expect.any(Date),
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.email_verification_resent' }),
    );
  });

  it('throws ValidationError if seller not found', async () => {
    authRepo.findSellerById = jest.fn().mockResolvedValue(null);
    await expect(authService.resendVerificationEmail('bad-id')).rejects.toThrow();
  });
});

describe('registerSeller — sends verification email', () => {
  it('calls sendVerificationEmail after creating seller', async () => {
    authRepo.findSellerByEmail = jest.fn().mockResolvedValue(null);
    authRepo.createSeller = jest.fn().mockResolvedValue({ id: 'new-seller', email: 'test@example.com' });
    authRepo.createConsentRecord = jest.fn().mockResolvedValue({});
    authRepo.setSellerEmailVerificationToken = jest.fn().mockResolvedValue({});
    systemMailer.sendSystemEmail = jest.fn().mockResolvedValue(undefined);

    await authService.registerSeller({
      name: 'Test',
      email: 'test@example.com',
      phone: '91234567',
      password: 'pass',
      consentService: true,
      consentMarketing: false,
      ipAddress: '127.0.0.1',
      userAgent: 'Test',
    });

    expect(authRepo.setSellerEmailVerificationToken).toHaveBeenCalled();
    expect(systemMailer.sendSystemEmail).toHaveBeenCalledWith(
      'test@example.com',
      expect.stringContaining('Verify'),
      expect.any(String),
    );
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx jest src/domains/auth/__tests__/auth.service.test.ts --no-coverage
```

Expected: FAIL — `resendVerificationEmail is not a function`, and the registerSeller test fails (no call to setSellerEmailVerificationToken)

**Step 3: Add `resendVerificationEmail` and update `registerSeller`**

Add after `verifyEmail`:

```ts
export async function resendVerificationEmail(sellerId: string): Promise<void> {
  const seller = await authRepo.findSellerById(sellerId);
  if (!seller) throw new ValidationError('Seller not found');

  await sendVerificationEmail(sellerId, seller.email);

  await auditService.log({
    action: 'auth.email_verification_resent',
    entityType: 'seller',
    entityId: sellerId,
    details: { email: maskEmail(seller.email) },
    actorType: 'seller' as const,
    actorId: sellerId,
  });
}
```

In `registerSeller`, after `await authRepo.createConsentRecord(...)` and before the audit log, add:

```ts
  // Best-effort: send verification email; failure should not block registration
  try {
    await sendVerificationEmail(seller.id, seller.email);
  } catch (err) {
    // Log but don't surface — seller can resend from dashboard
    await auditService.log({
      action: 'auth.email_verification_send_failed',
      entityType: 'seller',
      entityId: seller.id,
      details: { error: err instanceof Error ? err.message : String(err) },
      actorType: 'system' as const,
    });
  }
```

**Step 4: Run tests to verify they pass**

```bash
npx jest src/domains/auth/__tests__/auth.service.test.ts --no-coverage
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/domains/auth/auth.service.ts src/domains/auth/__tests__/auth.service.test.ts
git commit -m "feat(auth): send verification email on registration + add resend function"
```

---

## Task 6: Verification + resend routes

**Files:**
- Modify: `src/domains/auth/auth.registration.router.ts`
- Modify: `src/domains/auth/__tests__/auth.router.test.ts`

**Step 1: Write failing tests**

In `auth.router.test.ts`, find the section that tests the registration router and add:

```ts
// At top of file, ensure these mocks exist:
// jest.mock('../auth.service');
// const authService = jest.requireMock('../auth.service');

describe('GET /auth/verify-email/:token', () => {
  it('redirects to /seller/dashboard?verified=1 on success', async () => {
    authService.verifyEmail = jest.fn().mockResolvedValue(undefined);
    const res = await request(app).get('/auth/verify-email/valid-token');
    expect(authService.verifyEmail).toHaveBeenCalledWith('valid-token');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/seller/dashboard?verified=1');
  });

  it('renders error page on invalid token', async () => {
    authService.verifyEmail = jest
      .fn()
      .mockRejectedValue(new ValidationError('Invalid or expired verification link'));
    const res = await request(app).get('/auth/verify-email/bad-token');
    expect(res.status).toBe(400);
  });
});

describe('POST /auth/resend-verification', () => {
  it('returns 200 for authenticated seller', async () => {
    authService.resendVerificationEmail = jest.fn().mockResolvedValue(undefined);
    // Requires seller session — use the authenticated agent in your test app setup
    const res = await authenticatedSellerRequest(app)
      .post('/auth/resend-verification')
      .set('X-CSRF-Token', csrfToken);
    expect(res.status).toBe(200);
  });
});
```

> **Note on test setup:** Check `auth.router.test.ts` for how the test `app` is configured and how seller sessions are simulated. Follow the same pattern (likely a `createTestApp()` helper or similar).

**Step 2: Run tests to verify they fail**

```bash
npx jest src/domains/auth/__tests__/auth.router.test.ts --no-coverage
```

Expected: FAIL — routes not defined

**Step 3: Add routes to `auth.registration.router.ts`**

Add imports at top:
```ts
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { requireAuth, requireRole } from '../../infra/http/middleware/require-auth';
import { ValidationError } from '../shared/errors';
```

Add rate limiter:
```ts
const resendVerificationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  keyGenerator: (req) => (req.user as { id?: string })?.id ?? ipKeyGenerator(req.ip ?? 'unknown'),
  skip: () => process.env.NODE_ENV === 'test',
});
```

Add routes after the registration POST:

```ts
// ─── Email Verification ────────────────────────────────────

registrationRouter.get(
  '/auth/verify-email/:token',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await authService.verifyEmail(req.params.token as string);
      return res.redirect('/seller/dashboard?verified=1');
    } catch (err) {
      if (err instanceof ValidationError) {
        return res.status(400).render('pages/auth/verify-email-error', {
          message: 'This verification link is invalid or has expired.',
        });
      }
      next(err);
    }
  },
);

registrationRouter.post(
  '/auth/resend-verification',
  requireAuth(),
  requireRole('seller'),
  resendVerificationLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as { id: string };
      await authService.resendVerificationEmail(user.id);
      if (req.headers['hx-request']) {
        return res.render('partials/auth/form-success', {
          message: 'Verification email sent. Please check your inbox.',
        });
      }
      return res.redirect('/seller/dashboard?resent=1');
    } catch (err) {
      next(err);
    }
  },
);
```

**Step 4: Create the error view**

Create `src/views/pages/auth/verify-email-error.njk`:

```nunjucks
{% extends "layouts/public.njk" %}
{% block title %}{{ "Email Verification Failed" | t }} — SellMyHouse.sg{% endblock %}
{% block content %}
<div class="max-w-md mx-auto mt-16 text-center">
  <h1 class="text-2xl font-bold mb-4">{{ "Verification Failed" | t }}</h1>
  <p class="text-gray-600 mb-6">{{ message | t }}</p>
  <a href="/auth/login" class="btn-primary">{{ "Back to Login" | t }}</a>
</div>
{% endblock %}
```

**Step 5: Run tests to verify they pass**

```bash
npx jest src/domains/auth/__tests__/auth.router.test.ts --no-coverage
```

Expected: PASS

**Step 6: Commit**

```bash
git add src/domains/auth/auth.registration.router.ts \
        src/domains/auth/__tests__/auth.router.test.ts \
        src/views/pages/auth/verify-email-error.njk
git commit -m "feat(auth): add email verification and resend routes"
```

---

## Task 7: Property service — email verification gate

**Files:**
- Modify: `src/domains/property/property.service.ts`
- Modify: `src/domains/property/__tests__/property.service.test.ts`

**Step 1: Write failing test**

In `src/domains/property/__tests__/property.service.test.ts`, find the existing `createProperty` describe block and add:

```ts
it('throws ValidationError if seller email is not verified', async () => {
  mockedRepo.create.mockResolvedValue({ id: 'prop-1' } as Property);
  mockedRepo.createListing.mockResolvedValue({ id: 'listing-1' } as unknown as Listing);
  mockedAudit.log.mockResolvedValue(undefined);
  mockedCaseFlagService.hasActiveMopFlag.mockResolvedValue(false);
  // Mock auth repo to return unverified seller
  const authRepo = jest.requireMock('@/domains/auth/auth.repository');
  authRepo.findSellerById = jest.fn().mockResolvedValue({ id: 'seller-1', emailVerified: false });

  await expect(
    propertyService.createProperty({
      sellerId: 'seller-1',
      agentId: 'agent-1',
      town: 'Ang Mo Kio',
      street: 'ANG MO KIO AVE 3',
      block: '123',
      flatType: 'four_room',
      storeyRange: '07 TO 09',
      floorAreaSqm: 90,
      flatModel: 'Improved',
      leaseCommenceDate: 1985,
      askingPrice: 450000,
    }),
  ).rejects.toThrow('Please verify your email address');
});
```

Add mock at the top of the test file where other mocks are defined:
```ts
jest.mock('@/domains/auth/auth.repository');
```

**Step 2: Run test to verify it fails**

```bash
npx jest src/domains/property/__tests__/property.service.test.ts --no-coverage
```

Expected: FAIL — no email verification check

**Step 3: Add gate to `property.service.ts`**

Add import at top:
```ts
import * as authRepo from '../auth/auth.repository';
```

In `createProperty`, after the MOP check and before slug generation, add:

```ts
  const seller = await authRepo.findSellerById(input.sellerId);
  if (!seller?.emailVerified) {
    throw new ValidationError(
      'Please verify your email address before creating a listing.',
    );
  }
```

**Step 4: Run tests to verify they pass**

```bash
npx jest src/domains/property/__tests__/property.service.test.ts --no-coverage
```

Expected: PASS. Also update existing passing tests to mock the seller as verified:
```ts
authRepo.findSellerById = jest.fn().mockResolvedValue({ id: 'seller-1', emailVerified: true });
```
(Add this line in each existing `createProperty` test's setup.)

**Step 5: Commit**

```bash
git add src/domains/property/property.service.ts \
        src/domains/property/__tests__/property.service.test.ts
git commit -m "feat(property): gate listing creation behind email verification"
```

---

## Task 8: Dashboard — expose emailVerified + add banner

**Files:**
- Modify: `src/domains/seller/seller.types.ts`
- Modify: `src/domains/seller/seller.service.ts`
- Modify: `src/views/pages/seller/dashboard.njk`

**Step 1: Update `DashboardOverview` type**

In `src/domains/seller/seller.types.ts`, change:

```ts
// Before:
seller: Pick<Seller, 'id' | 'name' | 'email' | 'phone' | 'status' | 'onboardingStep'>;

// After:
seller: Pick<Seller, 'id' | 'name' | 'email' | 'phone' | 'status' | 'onboardingStep' | 'emailVerified'>;
```

**Step 2: Expose `emailVerified` in `getDashboardOverview`**

In `src/domains/seller/seller.service.ts`, in `getDashboardOverview`, find the `return` statement's `seller:` object and add `emailVerified`:

```ts
    seller: {
      id: seller.id,
      name: seller.name,
      email: seller.email,
      phone: seller.phone,
      status: seller.status,
      onboardingStep: seller.onboardingStep,
      emailVerified: seller.emailVerified,   // add this line
    },
```

**Step 3: Verify TypeScript compiles**

```bash
npm run build 2>&1 | head -20
```

Expected: no errors

**Step 4: Add banner to `dashboard.njk`**

In `src/views/pages/seller/dashboard.njk`, add the following block **above** the existing `{% if overview.caseFlags.length > 0 %}` block:

```nunjucks
{# Email verification banner #}
{% if not overview.seller.emailVerified %}
<div class="bg-blue-50 border-l-4 border-blue-400 p-4 mb-6">
  <div class="flex">
    <div class="flex-1">
      <p class="text-sm font-medium text-blue-800">
        {{ "Please verify your email to start listing your property." | t }}
      </p>
      <form method="POST" action="/auth/resend-verification" class="mt-2"
            hx-post="/auth/resend-verification"
            hx-target="this"
            hx-swap="outerHTML">
        <input type="hidden" name="_csrf" value="{{ csrfToken }}">
        <button type="submit" class="text-sm text-blue-700 underline hover:text-blue-900">
          {{ "Resend verification email" | t }}
        </button>
      </form>
    </div>
  </div>
</div>
{% endif %}
```

**Step 5: Run full test suite**

```bash
npm test
```

Expected: all tests pass (or pre-existing failures only — do not introduce new failures)

**Step 6: Commit**

```bash
git add src/domains/seller/seller.types.ts \
        src/domains/seller/seller.service.ts \
        src/views/pages/seller/dashboard.njk
git commit -m "feat(seller): show email verification banner on dashboard"
```

---

## Final: Run full test suite and verify

```bash
npm test && npm run build
```

Expected: all unit tests pass, TypeScript compiles cleanly.

If integration tests are available and the test DB is running:

```bash
npm run test:integration
```

---

## Environment Variables Required

Add to `.env` (and production environment):

```
SMTP_HOST=<your SMTP host>
SMTP_PORT=587
SMTP_USER=<your SMTP username>
SMTP_PASS=<your SMTP password>
SMTP_FROM=noreply@sellmyhouse.sg
APP_URL=https://sellmyhouse.sg
```
