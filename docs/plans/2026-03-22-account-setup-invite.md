# Account Setup Invite on Lead→Engaged — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When an agent moves a seller from `lead` to `engaged`, automatically send an account setup email so the seller can set a password and access their dashboard.

**Architecture:** Hooks into the existing `updateSellerStatus` function. Reuses `passwordResetToken`/`passwordResetExpiry` fields (no migration). A new `/auth/setup-account` route renders a "Set Your Password" form with auto-login on success. The agent seller detail page shows account status and a resend button.

**Tech Stack:** TypeScript, Express, Prisma, Passport, bcrypt, Nunjucks, HTMX, Jest

---

## Task 1: Account Setup Service Function

**Files:**
- Modify: `src/domains/auth/auth.service.ts`
- Modify: `src/domains/auth/__tests__/auth.service.test.ts`

**Step 1: Write the failing test**

In `src/domains/auth/__tests__/auth.service.test.ts`, add a new describe block:

```typescript
describe('sendAccountSetupEmail', () => {
  it('generates token, stores hash, and sends setup email', async () => {
    mockAuthRepo.setSellerPasswordResetToken.mockResolvedValue(undefined as never);
    mockSystemMailer.sendSystemEmail.mockResolvedValue(undefined);

    await authService.sendAccountSetupEmail('seller-1', 'Peanuts Malone', 'peanuts@example.com');

    expect(mockAuthRepo.setSellerPasswordResetToken).toHaveBeenCalledWith(
      'seller-1',
      expect.any(String), // hashed token
      expect.any(Date),   // expiry
    );
    expect(mockSystemMailer.sendSystemEmail).toHaveBeenCalledWith(
      'peanuts@example.com',
      'Set up your SellMyHomeNow account',
      expect.stringContaining('/auth/setup-account?token='),
    );
    expect(mockAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'lead.account_setup_sent',
        entityId: 'seller-1',
      }),
    );
  });

  it('sets expiry to 24 hours from now', async () => {
    mockAuthRepo.setSellerPasswordResetToken.mockResolvedValue(undefined as never);
    mockSystemMailer.sendSystemEmail.mockResolvedValue(undefined);

    const before = Date.now();
    await authService.sendAccountSetupEmail('seller-1', 'Test', 'test@example.com');
    const after = Date.now();

    const expiry = mockAuthRepo.setSellerPasswordResetToken.mock.calls[0][2] as Date;
    const expiryMs = expiry.getTime();
    // Should be approximately 24 hours from now (within 5 seconds tolerance)
    expect(expiryMs).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000 - 5000);
    expect(expiryMs).toBeLessThanOrEqual(after + 24 * 60 * 60 * 1000 + 5000);
  });
});
```

Note: Ensure `mockSystemMailer` is set up in the test file. The existing test file already mocks `system-mailer` — check if it does, and if not, add:

```typescript
jest.mock('../../../infra/email/system-mailer');
import * as systemMailer from '../../../infra/email/system-mailer';
const mockSystemMailer = systemMailer as jest.Mocked<typeof systemMailer>;
```

**Step 2: Run test to verify it fails**

Run: `npx jest src/domains/auth/__tests__/auth.service.test.ts --no-coverage -t "sendAccountSetupEmail"`
Expected: FAIL — function doesn't exist

**Step 3: Implement in auth.service.ts**

Add this function after the existing `sendVerificationEmail` function:

```typescript
export async function sendAccountSetupEmail(
  sellerId: string,
  name: string,
  email: string,
): Promise<void> {
  const rawToken = crypto.randomBytes(64).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  await authRepo.setSellerPasswordResetToken(sellerId, hashedToken, expiry);

  const appUrl = process.env.APP_URL || 'https://sellmyhomenow.sg';
  const setupUrl = `${appUrl}/auth/setup-account?token=${rawToken}`;

  await sendSystemEmail(
    email,
    'Set up your SellMyHomeNow account',
    `<p>Hi ${name},</p>
<p>Your agent has invited you to set up your SellMyHomeNow account. Click the link below to create your password and access your dashboard:</p>
<p><a href="${setupUrl}">${setupUrl}</a></p>
<p>This link expires in 24 hours.</p>
<p>If you did not expect this email, please ignore it.</p>`,
  );

  await auditService.log({
    action: 'lead.account_setup_sent',
    entityType: 'seller',
    entityId: sellerId,
    details: { email: maskEmail(email) },
    actorType: 'system' as const,
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npx jest src/domains/auth/__tests__/auth.service.test.ts --no-coverage -t "sendAccountSetupEmail"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/domains/auth/auth.service.ts src/domains/auth/__tests__/auth.service.test.ts
git commit -m "feat(auth): add sendAccountSetupEmail service function"
```

---

## Task 2: Hook into updateSellerStatus — Auto-Send on lead→engaged

**Files:**
- Modify: `src/domains/seller/seller.service.ts`
- Modify: `src/domains/seller/__tests__/seller.service.test.ts`

**Step 1: Write the failing test**

In `src/domains/seller/__tests__/seller.service.test.ts`, add these tests inside the existing `describe('updateSellerStatus')` block:

```typescript
it('sends account setup email when transitioning lead→engaged with verified email', async () => {
  mockedSellerRepo.findById.mockResolvedValue({
    id: 'seller-1',
    status: 'lead',
    email: 'peanuts@example.com',
    emailVerified: true,
    name: 'Peanuts Malone',
  } as Seller);
  mockedSellerRepo.updateSellerStatus = jest.fn().mockResolvedValue({
    id: 'seller-1',
    status: 'engaged',
    consultationCompletedAt: new Date(),
  } as Seller);

  await sellerService.updateSellerStatus('seller-1', 'engaged', 'agent-1', 'Contacted');

  expect(mockedAuthService.sendAccountSetupEmail).toHaveBeenCalledWith(
    'seller-1',
    'Peanuts Malone',
    'peanuts@example.com',
  );
});

it('does not send account setup email when email is not verified', async () => {
  mockedSellerRepo.findById.mockResolvedValue({
    id: 'seller-1',
    status: 'lead',
    email: 'peanuts@example.com',
    emailVerified: false,
    name: 'Peanuts Malone',
  } as Seller);
  mockedSellerRepo.updateSellerStatus = jest.fn().mockResolvedValue({
    id: 'seller-1',
    status: 'engaged',
  } as Seller);

  await sellerService.updateSellerStatus('seller-1', 'engaged', 'agent-1', 'Contacted');

  expect(mockedAuthService.sendAccountSetupEmail).not.toHaveBeenCalled();
});

it('does not send account setup email for non lead→engaged transitions', async () => {
  mockedSellerRepo.findById.mockResolvedValue({
    id: 'seller-1',
    status: 'engaged',
    email: 'peanuts@example.com',
    emailVerified: true,
    name: 'Peanuts Malone',
  } as Seller);
  mockedSellerRepo.updateSellerStatus = jest.fn().mockResolvedValue({
    id: 'seller-1',
    status: 'active',
  } as Seller);

  await sellerService.updateSellerStatus('seller-1', 'active', 'agent-1', 'Activating');

  expect(mockedAuthService.sendAccountSetupEmail).not.toHaveBeenCalled();
});
```

Note: You'll need to add the auth service mock to the test file. At the top:

```typescript
import * as authService from '../../auth/auth.service';
jest.mock('../../auth/auth.service');
const mockedAuthService = authService as jest.Mocked<typeof authService>;
```

And in `beforeEach`:

```typescript
mockedAuthService.sendAccountSetupEmail.mockResolvedValue(undefined);
```

**Step 2: Run tests to verify they fail**

Run: `npx jest src/domains/seller/__tests__/seller.service.test.ts --no-coverage -t "sends account setup email"`
Expected: FAIL

**Step 3: Implement in seller.service.ts**

At the top, add import:

```typescript
import * as authService from '../auth/auth.service';
```

In `updateSellerStatus`, after the audit log (line 574) and before the `return updated;`, add:

```typescript
  // Send account setup email when transitioning lead→engaged with verified email
  if (seller.status === 'lead' && newStatus === 'engaged' && seller.emailVerified && seller.email) {
    try {
      await authService.sendAccountSetupEmail(seller.id, seller.name, seller.email);
    } catch (err) {
      logger.warn({ sellerId, err }, 'Failed to send account setup email');
    }
  }
```

Note: The `logger` import should already exist in the file. If not, add `import { logger } from '../../infra/logger';`.

**Step 4: Run tests to verify they pass**

Run: `npx jest src/domains/seller/__tests__/seller.service.test.ts --no-coverage -t "updateSellerStatus"`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/domains/seller/seller.service.ts src/domains/seller/__tests__/seller.service.test.ts
git commit -m "feat(seller): auto-send account setup email on lead→engaged transition"
```

---

## Task 3: Setup Account Route — GET and POST

**Files:**
- Create: `src/domains/auth/auth.setup-account.router.ts`
- Create: `src/domains/auth/__tests__/auth.setup-account.router.test.ts`
- Modify: `src/infra/http/app.ts` (register router)

**Step 1: Write the failing tests**

Create `src/domains/auth/__tests__/auth.setup-account.router.test.ts`:

```typescript
import request from 'supertest';
import express from 'express';

const mockAuthService = {
  resetPassword: jest.fn(),
  findSellerByResetToken: jest.fn(),
};

const mockAuthRepo = {
  findSellerByResetToken: jest.fn(),
  updateSellerPasswordHash: jest.fn(),
  clearSellerPasswordResetToken: jest.fn(),
  invalidateUserSessions: jest.fn(),
};

jest.mock('../auth.service', () => mockAuthService);
jest.mock('../auth.repository', () => mockAuthRepo);

// Mock passport
jest.mock('passport', () => ({
  authenticate: jest.fn(() => (req: any, res: any, next: any) => {
    req.logIn = jest.fn((user: any, cb: any) => cb(null));
    req.user = { id: 'seller-1', role: 'seller' };
    next();
  }),
}));

import { setupAccountRouter } from '../auth.setup-account.router';

function createApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.set('view engine', 'njk');
  app.use((req, _res, next) => {
    (req as any).logIn = jest.fn((user: any, cb: any) => cb(null));
    next();
  });
  app.use(setupAccountRouter);
  return app;
}

describe('setup-account router', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('GET /auth/setup-account', () => {
    it('returns 400 when no token provided', async () => {
      const app = createApp();
      const res = await request(app).get('/auth/setup-account');
      expect(res.status).toBe(400);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest src/domains/auth/__tests__/auth.setup-account.router.test.ts --no-coverage`
Expected: FAIL — module doesn't exist

**Step 3: Create the setup account router**

Create `src/domains/auth/auth.setup-account.router.ts`:

```typescript
import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import passport from 'passport';
import { validationResult } from 'express-validator';
import * as authRepo from './auth.repository';
import * as auditService from '../shared/audit.service';
import { ValidationError } from '../shared/errors';
import { resetPasswordRules } from './auth.validator';
import { authRateLimiter } from '../../infra/http/middleware/rate-limit';
import type { AuthenticatedUser } from './auth.types';
import bcrypt from 'bcrypt';

export const setupAccountRouter = Router();

const BCRYPT_ROUNDS = 12;

// GET /auth/setup-account?token=xxx — render "Set Your Password" form
setupAccountRouter.get(
  '/auth/setup-account',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawToken = req.query['token'] as string;
      if (!rawToken) {
        return res.status(400).render('pages/auth/setup-account-error', {
          pageTitle: 'Invalid Link',
          message: 'No setup token provided.',
        });
      }

      const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
      const seller = await authRepo.findSellerByResetToken(hashedToken);

      if (!seller || !seller.passwordResetExpiry || seller.passwordResetExpiry < new Date()) {
        return res.render('pages/auth/setup-account-error', {
          pageTitle: 'Link Expired',
          message: 'This setup link has expired or is invalid. Please ask your agent to resend it.',
        });
      }

      res.render('pages/auth/setup-account', {
        pageTitle: 'Set Up Your Account',
        token: rawToken,
        sellerName: seller.name,
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /auth/setup-account — set password and auto-login
setupAccountRouter.post(
  '/auth/setup-account',
  authRateLimiter,
  resetPasswordRules,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        if (req.headers['hx-request']) {
          return res.render('partials/auth/form-error', {
            message: 'Password does not meet requirements',
          });
        }
        return res.status(400).render('pages/auth/setup-account', {
          pageTitle: 'Set Up Your Account',
          token: req.body.token,
          error: 'Password does not meet requirements',
        });
      }

      const rawToken = req.body.token as string;
      if (!rawToken) {
        throw new ValidationError('Invalid form submission');
      }

      const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
      const seller = await authRepo.findSellerByResetToken(hashedToken);

      if (!seller || !seller.passwordResetExpiry || seller.passwordResetExpiry < new Date()) {
        throw new ValidationError('This setup link has expired or is invalid');
      }

      // Set the password
      const passwordHash = await bcrypt.hash(req.body.password, BCRYPT_ROUNDS);
      await authRepo.updateSellerPasswordHash(seller.id, passwordHash);
      await authRepo.clearSellerPasswordResetToken(seller.id);
      await authRepo.invalidateUserSessions(seller.id);

      await auditService.log({
        action: 'auth.account_setup_completed',
        entityType: 'seller',
        entityId: seller.id,
        details: {},
        actorType: 'seller' as const,
        actorId: seller.id,
      });

      // Auto-login
      passport.authenticate(
        'seller-local',
        (err: Error | null, user: AuthenticatedUser | false) => {
          if (err || !user) {
            // Fallback: redirect to login if auto-login fails
            if (req.headers['hx-request']) {
              res.set('HX-Redirect', '/auth/login?setup=success');
              return res.sendStatus(200);
            }
            return res.redirect('/auth/login?setup=success');
          }
          req.logIn(user, (loginErr) => {
            if (loginErr) return next(loginErr);
            if (req.headers['hx-request']) {
              res.set('HX-Redirect', '/seller/dashboard');
              return res.sendStatus(200);
            }
            return res.redirect('/seller/dashboard');
          });
        },
      )(req, res, next);
    } catch (err) {
      if (err instanceof ValidationError) {
        if (req.headers['hx-request']) {
          return res.render('partials/auth/form-error', { message: err.message });
        }
        return res.render('pages/auth/setup-account-error', {
          pageTitle: 'Setup Failed',
          message: err.message,
        });
      }
      next(err);
    }
  },
);
```

**Step 4: Register in app.ts**

In `src/infra/http/app.ts`, add import:

```typescript
import { setupAccountRouter } from '../../domains/auth/auth.setup-account.router';
```

Add `app.use(setupAccountRouter);` right after the `authRouter` registration.

**Step 5: Run test to verify it passes**

Run: `npx jest src/domains/auth/__tests__/auth.setup-account.router.test.ts --no-coverage`
Expected: PASS

**Step 6: Commit**

```bash
git add src/domains/auth/auth.setup-account.router.ts src/domains/auth/__tests__/auth.setup-account.router.test.ts src/infra/http/app.ts
git commit -m "feat(auth): add /auth/setup-account route with auto-login"
```

---

## Task 4: Setup Account Views

**Files:**
- Create: `src/views/pages/auth/setup-account.njk`
- Create: `src/views/pages/auth/setup-account-error.njk`

**Step 1: Create the setup account page**

Create `src/views/pages/auth/setup-account.njk`:

```nunjucks
{% extends "layouts/public.njk" %}

{% block title %}{{ "Set Up Your Account" | t }} — SellMyHomeNow{% endblock %}

{% block content %}
<div class="max-w-md mx-auto mt-10">
  <h1 class="text-2xl font-bold mb-2">{{ "Welcome to SellMyHomeNow" | t }}{% if sellerName %}, {{ sellerName }}{% endif %}!</h1>
  <p class="text-sm text-gray-600 mb-6">
    {{ "Create a password to access your seller dashboard. Your password must be at least 8 characters and contain at least one number." | t }}
  </p>

  {% if error %}
  <div class="mb-4 rounded-md bg-red-50 p-4">
    <p class="text-sm text-red-700">{{ error }}</p>
  </div>
  {% endif %}

  <div id="setup-messages"></div>

  <form
    action="/auth/setup-account"
    method="POST"
    hx-post="/auth/setup-account"
    hx-target="#setup-messages"
    hx-swap="innerHTML"
    data-action="check-passwords"
    class="space-y-4"
  >
    <input type="hidden" name="token" value="{{ token }}">

    <div>
      <label for="password" class="block text-sm font-medium text-gray-700">
        {{ "Password" | t }}
      </label>
      <input type="password" id="password" name="password" required
             minlength="8" autocomplete="new-password"
             class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-[#c8553d] focus:ring-[#c8553d]">
    </div>

    <div>
      <label for="confirmPassword" class="block text-sm font-medium text-gray-700">
        {{ "Confirm Password" | t }}
      </label>
      <input type="password" id="confirmPassword" name="confirmPassword" required
             minlength="8" autocomplete="new-password"
             class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-[#c8553d] focus:ring-[#c8553d]">
      <p id="password-mismatch" class="hidden mt-1 text-xs text-red-600">
        {{ "Passwords do not match." | t }}
      </p>
    </div>

    <button type="submit"
            class="w-full bg-[#c8553d] text-white py-3 rounded-full font-semibold hover:bg-[#b04a35] transition-colors">
      {{ "Create Account" | t }}
    </button>
  </form>
</div>
{% endblock %}
```

**Step 2: Create the error page**

Create `src/views/pages/auth/setup-account-error.njk`:

```nunjucks
{% extends "layouts/public.njk" %}

{% block title %}{{ pageTitle }} — SellMyHomeNow{% endblock %}

{% block content %}
<section class="py-16 px-4 bg-white">
  <div class="max-w-md mx-auto text-center">
    <div class="text-3xl mb-3">✗</div>
    <h2 class="text-2xl font-bold mb-2">{{ pageTitle }}</h2>
    <p class="text-gray-600 mb-6">{{ message }}</p>
    <a href="/auth/login" class="text-[#c8553d] hover:underline text-sm">{{ "Go to login" | t }}</a>
  </div>
</section>
{% endblock %}
```

**Step 3: Verify by running the app**

Run: `npm run dev`
Visit `/auth/setup-account` (without token) — verify error page renders.

**Step 4: Commit**

```bash
git add src/views/pages/auth/setup-account.njk src/views/pages/auth/setup-account-error.njk
git commit -m "feat(auth): add setup-account and error Nunjucks views"
```

---

## Task 5: Seller Detail — Account Status & Resend Button

**Files:**
- Modify: `src/domains/agent/agent.types.ts`
- Modify: `src/domains/agent/agent.service.ts`
- Modify: `src/domains/agent/agent.repository.ts`
- Modify: `src/views/pages/agent/seller-detail.njk`

**Step 1: Add `hasPassword` to SellerDetail type**

In `src/domains/agent/agent.types.ts`, add to `SellerDetail`:

```typescript
  hasPassword: boolean;
```

**Step 2: Update repository to select passwordHash**

In `src/domains/agent/agent.repository.ts`, in the `getSellerDetail` function, the current query uses `include: { properties: ... }` which returns all seller fields. Since it returns the full seller object, `passwordHash` is already available. No repo change needed.

**Step 3: Update service to map hasPassword**

In `src/domains/agent/agent.service.ts`, in the `getSellerDetail` function return object, add:

```typescript
    hasPassword: !!seller.passwordHash,
```

**Step 4: Update seller-detail.njk**

In `src/views/pages/agent/seller-detail.njk`, after the email verification resend button block (after line 39), add an account status indicator:

```nunjucks
          {% if seller.emailVerified %}
          <div class="flex justify-between"><dt class="text-gray-500">{{ "Account" | t }}</dt><dd>{% if seller.hasPassword %}<span class="px-1.5 py-0.5 text-xs rounded bg-green-100 text-green-700">{{ "Active" | t }}</span>{% else %}<span class="px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-500">{{ "Not yet set up" | t }}</span>{% endif %}</dd></div>
          {% if not seller.hasPassword %}
          <div class="flex justify-between items-center">
            <dt class="text-gray-500"></dt>
            <dd>
              <button class="text-xs text-[#c8553d] hover:underline"
                hx-post="/agent/sellers/{{ seller.id }}/resend-account-setup"
                hx-target="#account-setup-feedback-{{ seller.id }}"
                hx-swap="innerHTML">{{ "Resend Account Setup Email" | t }}</button>
              <span id="account-setup-feedback-{{ seller.id }}" class="ml-2"></span>
            </dd>
          </div>
          {% endif %}
          {% endif %}
```

**Step 5: Run tests**

Run: `npx jest src/domains/agent/ --no-coverage`
Expected: All PASS (may need to update test fixtures to include `hasPassword`)

**Step 6: Commit**

```bash
git add src/domains/agent/agent.types.ts src/domains/agent/agent.service.ts src/views/pages/agent/seller-detail.njk
git commit -m "feat(agent): show account status and resend setup button on seller detail page"
```

---

## Task 6: Agent Resend Account Setup Endpoint

**Files:**
- Modify: `src/domains/agent/agent.router.ts`
- Modify: `src/domains/auth/auth.service.ts` (add resend function)

**Step 1: Add resendAccountSetup to auth.service.ts**

In `src/domains/auth/auth.service.ts`, add after `sendAccountSetupEmail`:

```typescript
export async function resendAccountSetup(sellerId: string, agentId: string): Promise<void> {
  const seller = await authRepo.findSellerById(sellerId);
  if (!seller) throw new NotFoundError('Seller', sellerId);
  if (!seller.email) throw new ValidationError('Seller has no email');
  if (!seller.emailVerified) throw new ValidationError('Seller email is not verified');
  if (seller.passwordHash) throw new ValidationError('Seller already has an account');

  await sendAccountSetupEmail(sellerId, seller.name, seller.email);

  await auditService.log({
    action: 'lead.account_setup_resent',
    entityType: 'seller',
    entityId: sellerId,
    details: { agentId },
    actorType: 'agent' as const,
    actorId: agentId,
  });
}
```

Note: Check if `authRepo.findSellerById` exists. If not, add it to `auth.repository.ts`:

```typescript
export function findSellerById(id: string) {
  return prisma.seller.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, emailVerified: true, passwordHash: true },
  });
}
```

**Step 2: Add the resend route to agent.router.ts**

In `src/domains/agent/agent.router.ts`, add after the existing resend-verification route:

```typescript
// POST /agent/sellers/:id/resend-account-setup — agent resends account setup email
agentRouter.post(
  '/agent/sellers/:id/resend-account-setup',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const sellerId = req.params['id'] as string;
      await authService.resendAccountSetup(sellerId, user.id);

      if (req.headers['hx-request']) {
        return res.send('<span class="text-green-600 text-sm">Account setup email sent!</span>');
      }
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);
```

Note: Ensure `authService` is imported in `agent.router.ts`:

```typescript
import * as authService from '../auth/auth.service';
```

**Step 3: Run tests**

Run: `npm test`
Expected: All PASS

**Step 4: Commit**

```bash
git add src/domains/auth/auth.service.ts src/domains/auth/auth.repository.ts src/domains/agent/agent.router.ts
git commit -m "feat(agent): add resend account setup endpoint for agent-initiated resend"
```

---

## Task 7: Final Integration Test and Cleanup

**Step 1: Run the full test suite**

Run: `npm test`
Expected: All PASS

**Step 2: Run the linter**

Run: `npm run lint`
Expected: No new errors

**Step 3: Build check**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Manual smoke test**

Run: `npm run dev`

1. Find Peanuts Malone in `/agent/sellers` — click into detail page
2. Verify "Account: Not yet set up" badge appears (if email verified and no password)
3. Click "Resend Account Setup Email" — verify flash message
4. Check server logs for `[EMAIL_STUB]` with setup URL
5. Copy the setup URL from logs, visit it — verify "Set Your Password" form renders with "Welcome, Peanuts Malone!"
6. Set a password — verify auto-redirect to `/seller/dashboard`
7. Return to agent seller detail — verify "Account: Active" green badge, resend button gone

**Step 5: Commit any fixes from smoke test if needed**
