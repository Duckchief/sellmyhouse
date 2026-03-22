# Lead Enrichment via Email Verification — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add email to the lead form, verify it via tokenised link, collect property details (HDB address, asking price, timeline, reason to sell) on a post-verification form, and update the agent leads page to group by Unassigned/Verified/Unverified.

**Architecture:** Email is collected at lead submission and stored on the Seller model. A verification token is generated, hashed (SHA-256), and stored. The system-mailer sends the link (falls back to logger stub when SMTP is not configured). Clicking the link verifies the email and renders a one-time public form. The form creates a Property record and sets selling intent fields on the Seller. The agent leads page groups assigned leads by `emailVerified`.

**Tech Stack:** TypeScript, Express, Prisma, PostgreSQL, Nunjucks, HTMX, Jest

---

## Task 1: Prisma Schema — Add Enums and Seller Fields

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_lead_enrichment/migration.sql`

**Step 1: Add enums and fields to schema.prisma**

Add the two enums at the end of the enum section (after the existing enums):

```prisma
enum SellingTimeline {
  one_to_three_months
  three_to_six_months
  just_thinking
}

enum SellingReason {
  upgrading
  downsizing
  relocating
  financial
  investment
  other
}
```

Add three fields to the Seller model, after `emailVerificationExpiry`:

```prisma
  sellingTimeline         SellingTimeline?        @map("selling_timeline")
  sellingReason           SellingReason?          @map("selling_reason")
  sellingReasonOther      String?                @map("selling_reason_other")
```

**Step 2: Generate migration using shadow DB approach**

Follow the shadow DB migration pattern from MEMORY.md:

```bash
PGPASSWORD=smhn_dev psql -U smhn -h localhost -p 5432 -d sellmyhomenow_dev -c "CREATE DATABASE smhn_shadow_tmp;"
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "postgresql://smhn:smhn_dev@localhost:5432/smhn_shadow_tmp" --script
```

Save the output SQL to `prisma/migrations/<timestamp>_lead_enrichment/migration.sql`. The SQL should create the two enums and add the three nullable columns.

```bash
npx prisma migrate deploy
npx prisma generate
PGPASSWORD=smhn_dev psql -U smhn -h localhost -p 5432 -d sellmyhomenow_dev -c "DROP DATABASE smhn_shadow_tmp;"
```

**Step 3: Verify migration**

Run: `npx prisma migrate status`
Expected: All migrations applied, no pending.

**Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(lead): add SellingTimeline/SellingReason enums and seller fields for lead enrichment"
```

---

## Task 2: System Mailer Stub Fallback

**Files:**
- Modify: `src/infra/email/system-mailer.ts`
- Modify: `src/infra/email/__tests__/system-mailer.test.ts`

**Step 1: Write the failing test**

Add a new test to `src/infra/email/__tests__/system-mailer.test.ts`:

```typescript
it('logs email via logger when SMTP is not configured', async () => {
  delete process.env.SMTP_HOST;
  // Re-import to get fresh module
  jest.resetModules();
  const loggerModule = await import('../../../infra/logger');
  const logSpy = jest.spyOn(loggerModule.logger, 'info');
  const { sendSystemEmail } = await import('../system-mailer');

  await sendSystemEmail('seller@example.com', 'Verify Email', '<p>Click here</p>');

  expect(logSpy).toHaveBeenCalledWith(
    expect.stringContaining('[EMAIL_STUB]'),
    expect.objectContaining({ to: 'seller@example.com', subject: 'Verify Email' }),
  );
  expect(mockSendMail).not.toHaveBeenCalled();
  logSpy.mockRestore();
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest src/infra/email/__tests__/system-mailer.test.ts --no-coverage`
Expected: FAIL — currently throws "System SMTP not configured"

**Step 3: Implement stub fallback in system-mailer.ts**

Replace `src/infra/email/system-mailer.ts` with:

```typescript
import nodemailer from 'nodemailer';
import { logger } from '../logger';

function isSmtpConfigured(): boolean {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.SMTP_FROM
  );
}

export async function sendSystemEmail(
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  if (!isSmtpConfigured()) {
    logger.info('[EMAIL_STUB] Email not sent — SMTP not configured', { to, subject, html });
    return;
  }

  const port = parseInt(process.env.SMTP_PORT!, 10);
  if (isNaN(port)) {
    logger.info('[EMAIL_STUB] Email not sent — SMTP_PORT invalid', { to, subject, html });
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST!,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
  });

  await transporter.sendMail({ from: process.env.SMTP_FROM!, to, subject, html });
}
```

**Step 4: Update the existing "throws if SMTP_HOST is missing" test**

The test that expects a throw now needs to expect the stub behaviour instead. Update it:

```typescript
it('logs via stub when SMTP_HOST is missing', async () => {
  delete process.env.SMTP_HOST;
  jest.resetModules();
  const loggerModule = await import('../../../infra/logger');
  const logSpy = jest.spyOn(loggerModule.logger, 'info');
  const { sendSystemEmail } = await import('../system-mailer');

  await sendSystemEmail('seller@example.com', 'Subject', 'body');

  expect(logSpy).toHaveBeenCalledWith(
    expect.stringContaining('[EMAIL_STUB]'),
    expect.objectContaining({ to: 'seller@example.com' }),
  );
  expect(mockSendMail).not.toHaveBeenCalled();
  logSpy.mockRestore();
});
```

**Step 5: Run tests to verify they pass**

Run: `npx jest src/infra/email/__tests__/system-mailer.test.ts --no-coverage`
Expected: All PASS

**Step 6: Commit**

```bash
git add src/infra/email/system-mailer.ts src/infra/email/__tests__/system-mailer.test.ts
git commit -m "feat(email): add stub fallback when SMTP not configured — logs with [EMAIL_STUB] prefix"
```

---

## Task 3: Lead Types and Validator — Add Email

**Files:**
- Modify: `src/domains/lead/lead.types.ts`
- Modify: `src/domains/lead/lead.validator.ts`
- Modify: `src/domains/lead/__tests__/lead.validator.test.ts`

**Step 1: Write the failing test**

Add to `src/domains/lead/__tests__/lead.validator.test.ts`:

```typescript
it('returns error when email is missing', () => {
  const input = { ...validInput, email: '' };
  expect(validateLeadInput(input)).toEqual({ email: 'Email is required' });
});

it('returns error when email format is invalid', () => {
  const input = { ...validInput, email: 'not-an-email' };
  expect(validateLeadInput(input)).toEqual({ email: 'Please enter a valid email address' });
});

it('accepts valid email', () => {
  const input = { ...validInput, email: 'grogu@example.com' };
  expect(validateLeadInput(input)).toBeNull();
});
```

Make sure the `validInput` fixture in the test file includes `email: 'test@example.com'`.

**Step 2: Run tests to verify they fail**

Run: `npx jest src/domains/lead/__tests__/lead.validator.test.ts --no-coverage`
Expected: FAIL — `email` not in type / not validated

**Step 3: Add email to LeadInput type**

In `src/domains/lead/lead.types.ts`, add `email` field:

```typescript
export interface LeadInput {
  name: string;
  email: string;
  countryCode: string;
  nationalNumber: string;
  phone: string; // E.164 format, constructed by router
  consentService: boolean;
  consentMarketing: boolean;
  leadSource: LeadSource;
  honeypot?: string;
  formLoadedAt?: number;
  ipAddress?: string;
  userAgent?: string;
}
```

**Step 4: Add email validation to lead.validator.ts**

Add this after the name validation block (line 24) and before the country code check:

```typescript
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// inside validateLeadInput, after name check:
if (!input.email || !input.email.trim()) {
  return { email: 'Email is required' };
}

if (!EMAIL_REGEX.test(input.email.trim())) {
  return { email: 'Please enter a valid email address' };
}
```

Note: The `EMAIL_REGEX` constant should be declared at module level (alongside `SG_MOBILE_REGEX`). The input type for `validateLeadInput` needs updating — change `Omit<LeadInput, 'ipAddress' | 'userAgent'>` (it already includes email since LeadInput now has it).

**Step 5: Run tests to verify they pass**

Run: `npx jest src/domains/lead/__tests__/lead.validator.test.ts --no-coverage`
Expected: All PASS

**Step 6: Commit**

```bash
git add src/domains/lead/lead.types.ts src/domains/lead/lead.validator.ts src/domains/lead/__tests__/lead.validator.test.ts
git commit -m "feat(lead): add email field to LeadInput type and validator"
```

---

## Task 4: Lead Repository — Pass Email Through

**Files:**
- Modify: `src/domains/lead/lead.repository.ts`
- Modify: `src/domains/lead/__tests__/lead.repository.test.ts`

**Step 1: Write the failing test**

In `src/domains/lead/__tests__/lead.repository.test.ts`, update the test for `submitLeadAtomically` to include email in the input and verify it's passed to `seller.create`:

```typescript
it('passes email to seller.create', async () => {
  const input = {
    ...validInput,
    email: 'grogu@example.com',
  };

  await leadRepo.submitLeadAtomically(input);

  expect(prisma.seller.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ email: 'grogu@example.com' }),
    }),
  );
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest src/domains/lead/__tests__/lead.repository.test.ts --no-coverage`
Expected: FAIL — email not in create data

**Step 3: Update repository to pass email through**

In `src/domains/lead/lead.repository.ts`:

1. Add `email: string;` to the `createSellerLead` parameter type (the `data` object).
2. Add `email: data.email,` to the `tx.seller.create({ data: { ... } })` call.
3. Add `email: string;` to the `submitLeadAtomically` parameter type.
4. Pass `email: data.email,` in the `createSellerLead` call inside `submitLeadAtomically`.

**Step 4: Run tests to verify they pass**

Run: `npx jest src/domains/lead/__tests__/lead.repository.test.ts --no-coverage`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/domains/lead/lead.repository.ts src/domains/lead/__tests__/lead.repository.test.ts
git commit -m "feat(lead): pass email through lead repository to seller creation"
```

---

## Task 5: Lead Service — Email, Token Generation, Verification Email

**Files:**
- Modify: `src/domains/lead/lead.service.ts`
- Modify: `src/domains/lead/lead.repository.ts` (add token storage function)
- Modify: `src/domains/lead/__tests__/lead.service.test.ts`

**Step 1: Add repo function for setting verification token**

In `src/domains/lead/lead.repository.ts`, add:

```typescript
export async function setEmailVerificationToken(
  sellerId: string,
  hashedToken: string,
  expiry: Date,
): Promise<void> {
  await prisma.seller.update({
    where: { id: sellerId },
    data: {
      emailVerificationToken: hashedToken,
      emailVerificationExpiry: expiry,
    },
  });
}
```

**Step 2: Write the failing test for lead.service**

In `src/domains/lead/__tests__/lead.service.test.ts`, add at the top of the file:

```typescript
jest.mock('../../../infra/email/system-mailer');
```

And import:

```typescript
import * as systemMailer from '../../../infra/email/system-mailer';
const mockMailer = systemMailer as jest.Mocked<typeof systemMailer>;
```

Update `validInput` to include `email: 'grogu@example.com'`.

Update `sellerFixture` to include `email: 'grogu@example.com'`.

Add test:

```typescript
it('generates verification token and sends verification email after lead creation', async () => {
  mockLeadRepo.findActiveSellerByPhone.mockResolvedValue(null);
  mockLeadRepo.submitLeadAtomically.mockResolvedValue(sellerFixture as never);
  mockLeadRepo.findAdminAgents.mockResolvedValue([]);
  mockMailer.sendSystemEmail.mockResolvedValue(undefined);

  await submitLead(validInput);

  expect(mockLeadRepo.setEmailVerificationToken).toHaveBeenCalledWith(
    'seller-1',
    expect.any(String), // hashed token
    expect.any(Date),   // expiry ~72 hours from now
  );
  expect(mockMailer.sendSystemEmail).toHaveBeenCalledWith(
    'grogu@example.com',
    'Verify your SellMyHomeNow email address',
    expect.stringContaining('/verify-email?token='),
  );
});
```

**Step 3: Run test to verify it fails**

Run: `npx jest src/domains/lead/__tests__/lead.service.test.ts --no-coverage`
Expected: FAIL

**Step 4: Implement in lead.service.ts**

Add imports at top:

```typescript
import crypto from 'crypto';
import { sendSystemEmail } from '../../infra/email/system-mailer';
```

After the `submitLeadAtomically` call and before audit logs, add:

```typescript
// Generate email verification token
const rawToken = crypto.randomBytes(32).toString('hex');
const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
const verificationExpiry = new Date();
verificationExpiry.setHours(verificationExpiry.getHours() + 72);

await leadRepo.setEmailVerificationToken(seller.id, hashedToken, verificationExpiry);

// Send verification email
const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
const verificationUrl = `${appUrl}/verify-email?token=${rawToken}`;
await sendSystemEmail(
  input.email,
  'Verify your SellMyHomeNow email address',
  `<p>Click the link below to verify your email and complete your submission:</p><p><a href="${verificationUrl}">${verificationUrl}</a></p><p>This link expires in 72 hours.</p><p>If you did not submit a lead on SellMyHomeNow, please ignore this email.</p>`,
);

await auditService.log({
  action: 'lead.verification_sent',
  entityType: 'Seller',
  entityId: seller.id,
  details: { email: input.email },
  actorType: 'system' as const,
});
```

Also update the `submitLeadAtomically` call to pass `email: input.email.trim()`.

**Step 5: Run tests to verify they pass**

Run: `npx jest src/domains/lead/__tests__/lead.service.test.ts --no-coverage`
Expected: All PASS

**Step 6: Commit**

```bash
git add src/domains/lead/lead.service.ts src/domains/lead/lead.repository.ts src/domains/lead/__tests__/lead.service.test.ts
git commit -m "feat(lead): generate verification token and send verification email on lead submission"
```

---

## Task 6: Lead Router — Pass Email From Form

**Files:**
- Modify: `src/domains/lead/lead.router.ts`

**Step 1: Update lead router to extract email from request body**

In `src/domains/lead/lead.router.ts`, add `email` to the input object (around line 23):

```typescript
const input = {
  name: req.body.name ?? '',
  email: req.body.email ?? '',
  countryCode,
  // ... rest stays the same
};
```

**Step 2: Run existing tests to verify nothing breaks**

Run: `npx jest src/domains/lead/ --no-coverage`
Expected: All PASS

**Step 3: Commit**

```bash
git add src/domains/lead/lead.router.ts
git commit -m "feat(lead): pass email from form body through lead router"
```

---

## Task 7: Lead Form UI — Add Email Field

**Files:**
- Modify: `src/views/pages/public/home.njk`
- Modify: `src/views/partials/public/lead-success.njk`

**Step 1: Add email input to lead form**

In `src/views/pages/public/home.njk`, after the name field `</div>` (after line 81) and before the mobile number field, add:

```nunjucks
      <div class="mb-4">
        <label for="email" class="block text-sm font-semibold mb-1">{{ "Email" | t }}</label>
        <input type="email" id="email" name="email" required placeholder="you@example.com"
          class="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-[#c8553d] focus:border-transparent outline-none">
      </div>
```

**Step 2: Update lead-success partial**

Replace `src/views/partials/public/lead-success.njk` content:

```nunjucks
<div class="border border-green-200 bg-green-50 rounded-xl p-8 text-center">
  <div class="text-3xl mb-3">✓</div>
  <h3 class="font-bold text-lg mb-2">{{ "Thank you!" | t }}</h3>
  <p class="text-sm text-gray-600 mb-4">{{ "We've sent a verification email to your inbox. Click the link to complete your submission." | t }}</p>
  <p class="text-xs text-gray-400">{{ "Didn't receive the email?" | t }}
    <button type="button" id="resend-verification-btn"
      class="text-[#c8553d] hover:underline ml-1"
      hx-post="/api/leads/resend-verification"
      hx-vals='js:{"email": document.getElementById("email")?.value || ""}'
      hx-target="#resend-feedback"
      hx-swap="innerHTML">{{ "Resend" | t }}</button>
  </p>
  <div id="resend-feedback" class="mt-2 text-xs"></div>
</div>
```

**Step 3: Verify by running the app manually**

Run: `npm run dev`
Visit the homepage, verify the email field appears between name and phone.

**Step 4: Commit**

```bash
git add src/views/pages/public/home.njk src/views/partials/public/lead-success.njk
git commit -m "feat(lead): add email field to lead form and update success message"
```

---

## Task 8: Verification Router — GET /verify-email and POST /verify-email/details

**Files:**
- Create: `src/domains/lead/verification.router.ts`
- Create: `src/domains/lead/verification.service.ts`
- Create: `src/domains/lead/__tests__/verification.service.test.ts`
- Create: `src/domains/lead/verification.types.ts`

**Step 1: Create verification types**

Create `src/domains/lead/verification.types.ts`:

```typescript
export interface LeadDetailsInput {
  sellerId: string;
  block: string;
  street: string;
  town: string;
  askingPrice?: number;
  sellingTimeline: 'one_to_three_months' | 'three_to_six_months' | 'just_thinking';
  sellingReason: 'upgrading' | 'downsizing' | 'relocating' | 'financial' | 'investment' | 'other';
  sellingReasonOther?: string;
}
```

**Step 2: Write failing tests for verification.service**

Create `src/domains/lead/__tests__/verification.service.test.ts`:

```typescript
import * as verificationService from '../verification.service';
import * as leadRepo from '../lead.repository';
import * as auditService from '../../shared/audit.service';
import * as notificationService from '../../notification/notification.service';
import { propertyRepository } from '../../property/property.repository';

jest.mock('../lead.repository');
jest.mock('../../shared/audit.service');
jest.mock('../../notification/notification.service');
jest.mock('../../property/property.repository');

const mockLeadRepo = leadRepo as jest.Mocked<typeof leadRepo>;
const mockAudit = auditService as jest.Mocked<typeof auditService>;
const mockPropertyRepo = propertyRepository as jest.Mocked<typeof propertyRepository>;

describe('verification.service', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('verifyEmailToken', () => {
    it('returns seller when token is valid and not expired', async () => {
      const seller = {
        id: 'seller-1',
        emailVerificationExpiry: new Date(Date.now() + 3600000),
        emailVerified: false,
      };
      mockLeadRepo.findSellerByVerificationToken.mockResolvedValue(seller as never);
      mockLeadRepo.markEmailVerified.mockResolvedValue(undefined);

      const result = await verificationService.verifyEmailToken('raw-token-hex');

      expect(result).toEqual({ sellerId: 'seller-1' });
      expect(mockLeadRepo.markEmailVerified).toHaveBeenCalledWith('seller-1');
    });

    it('throws ValidationError when token not found', async () => {
      mockLeadRepo.findSellerByVerificationToken.mockResolvedValue(null);

      await expect(verificationService.verifyEmailToken('bad-token')).rejects.toThrow(
        'Invalid or expired verification link',
      );
    });

    it('throws ValidationError when token is expired', async () => {
      const seller = {
        id: 'seller-1',
        emailVerificationExpiry: new Date(Date.now() - 1000),
        emailVerified: false,
      };
      mockLeadRepo.findSellerByVerificationToken.mockResolvedValue(seller as never);

      await expect(verificationService.verifyEmailToken('expired-token')).rejects.toThrow(
        'Invalid or expired verification link',
      );
    });
  });

  describe('submitLeadDetails', () => {
    it('creates property and updates seller selling intent', async () => {
      const seller = { id: 'seller-1', emailVerified: true, agentId: 'agent-1' };
      mockLeadRepo.findSellerById.mockResolvedValue(seller as never);
      mockPropertyRepo.create.mockResolvedValue({ id: 'prop-1' } as never);
      mockLeadRepo.updateSellingIntent.mockResolvedValue(undefined);

      await verificationService.submitLeadDetails({
        sellerId: 'seller-1',
        block: '123',
        street: 'Ang Mo Kio Ave 3',
        town: 'ANG MO KIO',
        sellingTimeline: 'one_to_three_months',
        sellingReason: 'upgrading',
      });

      expect(mockPropertyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sellerId: 'seller-1',
          block: '123',
          street: 'Ang Mo Kio Ave 3',
          town: 'ANG MO KIO',
        }),
      );
      expect(mockLeadRepo.updateSellingIntent).toHaveBeenCalledWith('seller-1', {
        sellingTimeline: 'one_to_three_months',
        sellingReason: 'upgrading',
        sellingReasonOther: undefined,
      });
    });
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `npx jest src/domains/lead/__tests__/verification.service.test.ts --no-coverage`
Expected: FAIL — modules don't exist yet

**Step 4: Add repo helper functions**

In `src/domains/lead/lead.repository.ts`, add:

```typescript
import crypto from 'crypto';

export async function findSellerByVerificationToken(rawToken: string) {
  const hashed = crypto.createHash('sha256').update(rawToken).digest('hex');
  return prisma.seller.findFirst({
    where: { emailVerificationToken: hashed },
    select: {
      id: true,
      emailVerified: true,
      emailVerificationExpiry: true,
      agentId: true,
    },
  });
}

export async function markEmailVerified(sellerId: string): Promise<void> {
  await prisma.seller.update({
    where: { id: sellerId },
    data: {
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpiry: null,
    },
  });
}

export async function findSellerById(sellerId: string) {
  return prisma.seller.findUnique({
    where: { id: sellerId },
    select: { id: true, emailVerified: true, agentId: true },
  });
}

export async function updateSellingIntent(
  sellerId: string,
  data: {
    sellingTimeline: string;
    sellingReason: string;
    sellingReasonOther?: string;
  },
): Promise<void> {
  await prisma.seller.update({
    where: { id: sellerId },
    data: {
      sellingTimeline: data.sellingTimeline as 'one_to_three_months' | 'three_to_six_months' | 'just_thinking',
      sellingReason: data.sellingReason as 'upgrading' | 'downsizing' | 'relocating' | 'financial' | 'investment' | 'other',
      sellingReasonOther: data.sellingReasonOther ?? null,
    },
  });
}
```

**Step 5: Implement verification.service.ts**

Create `src/domains/lead/verification.service.ts`:

```typescript
import { ValidationError } from '../shared/errors';
import * as leadRepo from './lead.repository';
import * as auditService from '../shared/audit.service';
import * as notificationService from '../notification/notification.service';
import { propertyRepository as propertyRepo } from '../property/property.repository';
import type { LeadDetailsInput } from './verification.types';

export async function verifyEmailToken(rawToken: string): Promise<{ sellerId: string }> {
  const seller = await leadRepo.findSellerByVerificationToken(rawToken);

  if (!seller || !seller.emailVerificationExpiry || seller.emailVerificationExpiry < new Date()) {
    throw new ValidationError('Invalid or expired verification link');
  }

  await leadRepo.markEmailVerified(seller.id);

  await auditService.log({
    action: 'lead.email_verified',
    entityType: 'Seller',
    entityId: seller.id,
    details: {},
    actorType: 'system' as const,
  });

  return { sellerId: seller.id };
}

export async function submitLeadDetails(input: LeadDetailsInput): Promise<void> {
  const seller = await leadRepo.findSellerById(input.sellerId);
  if (!seller || !seller.emailVerified) {
    throw new ValidationError('Email must be verified before submitting details');
  }

  // Create property with minimal required fields — lead-stage property
  await propertyRepo.create({
    sellerId: input.sellerId,
    block: input.block,
    street: input.street,
    town: input.town,
    flatType: 'Unknown',       // will be updated during onboarding
    storeyRange: 'Unknown',    // will be updated during onboarding
    floorAreaSqm: 0,           // will be updated during onboarding
    flatModel: 'Unknown',      // will be updated during onboarding
    leaseCommenceDate: 0,      // will be updated during onboarding
    askingPrice: input.askingPrice,
  });

  await leadRepo.updateSellingIntent(input.sellerId, {
    sellingTimeline: input.sellingTimeline,
    sellingReason: input.sellingReason,
    sellingReasonOther: input.sellingReasonOther,
  });

  await auditService.log({
    action: 'lead.details_submitted',
    entityType: 'Seller',
    entityId: input.sellerId,
    details: {
      town: input.town,
      sellingTimeline: input.sellingTimeline,
      sellingReason: input.sellingReason,
    },
    actorType: 'seller' as const,
    actorId: input.sellerId,
  });

  // Notify assigned agent if any
  if (seller.agentId) {
    await notificationService.send(
      {
        recipientType: 'agent',
        recipientId: seller.agentId,
        templateName: 'generic',
        templateData: {
          message: `Lead details submitted: ${input.block} ${input.street}, ${input.town}. Timeline: ${input.sellingTimeline}. Ready for follow-up.`,
        },
      },
      'system',
    );
  }
}
```

**Step 6: Run tests to verify they pass**

Run: `npx jest src/domains/lead/__tests__/verification.service.test.ts --no-coverage`
Expected: All PASS

**Step 7: Commit**

```bash
git add src/domains/lead/verification.types.ts src/domains/lead/verification.service.ts src/domains/lead/lead.repository.ts src/domains/lead/__tests__/verification.service.test.ts
git commit -m "feat(lead): add verification service — verifyEmailToken and submitLeadDetails"
```

---

## Task 9: Verification Router and Views

**Files:**
- Create: `src/domains/lead/verification.router.ts`
- Create: `src/views/pages/public/verify-email.njk`
- Create: `src/views/pages/public/verify-email-error.njk`
- Create: `src/views/pages/public/verify-email-success.njk`
- Modify: `src/infra/http/app.ts` (register router)

**Step 1: Create HMAC signing utility**

Add to `src/domains/lead/verification.router.ts` at the top (private to this module):

```typescript
import crypto from 'crypto';

function signSellerId(sellerId: string): string {
  const secret = process.env.SESSION_SECRET ?? 'dev-secret';
  return crypto.createHmac('sha256', secret).update(sellerId).digest('hex');
}

function verifySellerId(sellerId: string, signature: string): boolean {
  const expected = signSellerId(sellerId);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
```

**Step 2: Create the verification router**

Create `src/domains/lead/verification.router.ts`:

```typescript
import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import * as verificationService from './verification.service';
import { ValidationError } from '../shared/errors';
import { HDB_TOWNS } from '../property/property.types';
import { leadRateLimiter } from '../../infra/http/middleware/rate-limit';

export const verificationRouter = Router();

const VALID_TIMELINES = ['one_to_three_months', 'three_to_six_months', 'just_thinking'];
const VALID_REASONS = ['upgrading', 'downsizing', 'relocating', 'financial', 'investment', 'other'];

function signSellerId(sellerId: string): string {
  const secret = process.env.SESSION_SECRET ?? 'dev-secret';
  return crypto.createHmac('sha256', secret).update(sellerId).digest('hex');
}

function verifySellerId(sellerId: string, signature: string): boolean {
  const expected = signSellerId(sellerId);
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// GET /verify-email?token=xxx — verify email and show details form
verificationRouter.get('/verify-email', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.query['token'] as string;
    if (!token) {
      return res.render('pages/public/verify-email-error', {
        pageTitle: 'Verification Failed',
        message: 'No verification token provided.',
      });
    }

    const { sellerId } = await verificationService.verifyEmailToken(token);
    const signature = signSellerId(sellerId);

    res.render('pages/public/verify-email', {
      pageTitle: 'Complete Your Submission',
      sellerId,
      signature,
      towns: HDB_TOWNS,
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.render('pages/public/verify-email-error', {
        pageTitle: 'Verification Failed',
        message: err.message,
      });
    }
    next(err);
  }
});

// POST /verify-email/details — submit lead details
verificationRouter.post(
  '/verify-email/details',
  leadRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sellerId, signature, block, street, town, askingPrice, sellingTimeline, sellingReason, sellingReasonOther } = req.body;

      if (!sellerId || !signature || !verifySellerId(sellerId, signature)) {
        throw new ValidationError('Invalid form submission');
      }

      if (!block?.trim() || !street?.trim()) {
        throw new ValidationError('Block and street are required');
      }

      if (!HDB_TOWNS.includes(town)) {
        throw new ValidationError('Please select a valid HDB town');
      }

      if (!VALID_TIMELINES.includes(sellingTimeline)) {
        throw new ValidationError('Please select a timeline');
      }

      if (!VALID_REASONS.includes(sellingReason)) {
        throw new ValidationError('Please select a reason');
      }

      const parsedPrice = askingPrice ? parseFloat(askingPrice) : undefined;
      if (askingPrice && (isNaN(parsedPrice!) || parsedPrice! < 0)) {
        throw new ValidationError('Please enter a valid asking price');
      }

      await verificationService.submitLeadDetails({
        sellerId,
        block: block.trim(),
        street: street.trim(),
        town,
        askingPrice: parsedPrice,
        sellingTimeline,
        sellingReason,
        sellingReasonOther: sellingReason === 'other' ? sellingReasonOther?.trim() : undefined,
      });

      res.render('pages/public/verify-email-success', {
        pageTitle: 'Submission Complete',
      });
    } catch (err) {
      if (err instanceof ValidationError) {
        return res.render('pages/public/verify-email-error', {
          pageTitle: 'Submission Error',
          message: err.message,
        });
      }
      next(err);
    }
  },
);
```

**Step 3: Create the Nunjucks views**

Create `src/views/pages/public/verify-email.njk`:

```nunjucks
{% extends "layouts/public.njk" %}

{% block content %}
<section class="py-16 px-4 bg-white">
  <div class="max-w-md mx-auto">
    <div class="text-center mb-8">
      <div class="text-3xl mb-3">✓</div>
      <h2 class="text-2xl font-bold mb-2">{{ "Email Verified!" | t }}</h2>
      <p class="text-gray-500">{{ "Complete your submission by providing your property details." | t }}</p>
    </div>

    <form method="POST" action="/verify-email/details" class="border border-gray-200 rounded-xl p-8 space-y-4">
      <input type="hidden" name="sellerId" value="{{ sellerId }}">
      <input type="hidden" name="signature" value="{{ signature }}">

      <div>
        <label for="block" class="block text-sm font-semibold mb-1">{{ "Block Number" | t }} *</label>
        <input type="text" id="block" name="block" required placeholder="123"
          class="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-[#c8553d] focus:border-transparent outline-none">
      </div>

      <div>
        <label for="street" class="block text-sm font-semibold mb-1">{{ "Street Name" | t }} *</label>
        <input type="text" id="street" name="street" required placeholder="Ang Mo Kio Ave 3"
          class="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-[#c8553d] focus:border-transparent outline-none">
      </div>

      <div>
        <label for="town" class="block text-sm font-semibold mb-1">{{ "Town" | t }} *</label>
        <select id="town" name="town" required
          class="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-[#c8553d] focus:border-transparent outline-none bg-white">
          <option value="">{{ "Select a town" | t }}</option>
          {% for t in towns %}
          <option value="{{ t }}">{{ t }}</option>
          {% endfor %}
        </select>
      </div>

      <div>
        <label for="askingPrice" class="block text-sm font-semibold mb-1">{{ "Indicative Asking Price ($)" | t }}</label>
        <input type="number" id="askingPrice" name="askingPrice" min="0" step="1000" placeholder="500000"
          class="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-[#c8553d] focus:border-transparent outline-none">
        <p class="text-xs text-gray-400 mt-1">{{ "Optional. This is not a formal valuation." | t }}</p>
      </div>

      <div>
        <label class="block text-sm font-semibold mb-2">{{ "Timeline to Sell" | t }} *</label>
        <div class="space-y-2">
          <label class="flex items-center gap-2 text-sm">
            <input type="radio" name="sellingTimeline" value="one_to_three_months" required> {{ "1-3 months" | t }}
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input type="radio" name="sellingTimeline" value="three_to_six_months"> {{ "3-6 months" | t }}
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input type="radio" name="sellingTimeline" value="just_thinking"> {{ "Just thinking about it" | t }}
          </label>
        </div>
      </div>

      <div>
        <label for="sellingReason" class="block text-sm font-semibold mb-1">{{ "Reason to Sell" | t }} *</label>
        <select id="sellingReason" name="sellingReason" required
          class="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-[#c8553d] focus:border-transparent outline-none bg-white">
          <option value="">{{ "Select a reason" | t }}</option>
          <option value="upgrading">{{ "Upgrading" | t }}</option>
          <option value="downsizing">{{ "Downsizing" | t }}</option>
          <option value="relocating">{{ "Relocating" | t }}</option>
          <option value="financial">{{ "Financial reasons" | t }}</option>
          <option value="investment">{{ "Investment" | t }}</option>
          <option value="other">{{ "Other" | t }}</option>
        </select>
      </div>

      <div id="other-reason-container" class="hidden">
        <label for="sellingReasonOther" class="block text-sm font-semibold mb-1">{{ "Please specify" | t }}</label>
        <input type="text" id="sellingReasonOther" name="sellingReasonOther" maxlength="200"
          class="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-[#c8553d] focus:border-transparent outline-none">
      </div>

      <button type="submit" class="w-full bg-[#c8553d] text-white py-3 rounded-full font-semibold hover:bg-[#b04a35] transition-colors">{{ "Submit" | t }}</button>
    </form>
  </div>
</section>

<script nonce="{{ cspNonce }}">
(function() {
  var sel = document.getElementById('sellingReason');
  var container = document.getElementById('other-reason-container');
  sel.addEventListener('change', function() {
    container.classList.toggle('hidden', sel.value !== 'other');
  });
})();
</script>
{% endblock %}
```

Create `src/views/pages/public/verify-email-error.njk`:

```nunjucks
{% extends "layouts/public.njk" %}

{% block content %}
<section class="py-16 px-4 bg-white">
  <div class="max-w-md mx-auto text-center">
    <div class="text-3xl mb-3">✗</div>
    <h2 class="text-2xl font-bold mb-2">{{ "Verification Failed" | t }}</h2>
    <p class="text-gray-600 mb-6">{{ message }}</p>
    <p class="text-sm text-gray-400">{{ "If your link has expired, you can request a new one." | t }}</p>
    <form class="mt-4" method="POST" action="/api/leads/resend-verification">
      <input type="email" name="email" required placeholder="your@email.com"
        class="w-full border border-gray-300 rounded-lg px-4 py-2.5 mb-3 focus:ring-2 focus:ring-[#c8553d] focus:border-transparent outline-none">
      <button type="submit" class="w-full bg-[#c8553d] text-white py-3 rounded-full font-semibold hover:bg-[#b04a35] transition-colors">{{ "Resend Verification Email" | t }}</button>
    </form>
  </div>
</section>
{% endblock %}
```

Create `src/views/pages/public/verify-email-success.njk`:

```nunjucks
{% extends "layouts/public.njk" %}

{% block content %}
<section class="py-16 px-4 bg-white">
  <div class="max-w-md mx-auto text-center">
    <div class="text-3xl mb-3">✓</div>
    <h2 class="text-2xl font-bold mb-2">{{ "All Done!" | t }}</h2>
    <p class="text-gray-600">{{ "Thank you for completing your submission. Your agent will be in touch shortly." | t }}</p>
  </div>
</section>
{% endblock %}
```

**Step 4: Register the verification router in app.ts**

In `src/infra/http/app.ts`, import and register:

```typescript
import { verificationRouter } from '../../domains/lead/verification.router';
```

Add `app.use(verificationRouter);` right after `app.use(leadRouter);` (around line 192).

**Step 5: Run the full test suite**

Run: `npm test`
Expected: All PASS

**Step 6: Commit**

```bash
git add src/domains/lead/verification.router.ts src/views/pages/public/verify-email.njk src/views/pages/public/verify-email-error.njk src/views/pages/public/verify-email-success.njk src/infra/http/app.ts
git commit -m "feat(lead): add email verification route, details form, and views"
```

---

## Task 10: Resend Verification Endpoints

**Files:**
- Modify: `src/domains/lead/verification.router.ts`
- Modify: `src/domains/lead/verification.service.ts`
- Modify: `src/domains/lead/lead.repository.ts`
- Modify: `src/domains/agent/agent.router.ts`
- Modify: `src/infra/http/middleware/rate-limit.ts`

**Step 1: Add resend rate limiter**

In `src/infra/http/middleware/rate-limit.ts`, add:

```typescript
export const resendVerificationRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  keyGenerator: (req) => req.body?.email ?? req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many resend attempts. Please try again later.' } },
  skip: () => process.env.NODE_ENV === 'test',
});
```

**Step 2: Add repo function for resend**

In `src/domains/lead/lead.repository.ts`, add:

```typescript
export async function findUnverifiedSellerByEmail(email: string) {
  return prisma.seller.findFirst({
    where: {
      email,
      emailVerified: false,
      status: 'lead',
    },
    select: { id: true, email: true },
  });
}
```

**Step 3: Add resend service function**

In `src/domains/lead/verification.service.ts`, add:

```typescript
import crypto from 'crypto';
import { sendSystemEmail } from '../../infra/email/system-mailer';

export async function resendVerificationEmail(email: string): Promise<void> {
  const seller = await leadRepo.findUnverifiedSellerByEmail(email);
  if (!seller) return; // Don't leak existence

  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + 72);

  await leadRepo.setEmailVerificationToken(seller.id, hashedToken, expiry);

  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const verificationUrl = `${appUrl}/verify-email?token=${rawToken}`;
  await sendSystemEmail(
    email,
    'Verify your SellMyHomeNow email address',
    `<p>Click the link below to verify your email and complete your submission:</p><p><a href="${verificationUrl}">${verificationUrl}</a></p><p>This link expires in 72 hours.</p><p>If you did not submit a lead on SellMyHomeNow, please ignore this email.</p>`,
  );

  await auditService.log({
    action: 'lead.verification_resent',
    entityType: 'Seller',
    entityId: seller.id,
    details: { triggeredBy: 'seller' },
    actorType: 'system' as const,
  });
}

export async function agentResendVerification(sellerId: string, agentId: string): Promise<void> {
  const seller = await leadRepo.findSellerById(sellerId);
  if (!seller) throw new ValidationError('Seller not found');

  // Get seller email
  const fullSeller = await leadRepo.findSellerWithEmail(sellerId);
  if (!fullSeller?.email) throw new ValidationError('Seller has no email');
  if (fullSeller.emailVerified) throw new ValidationError('Email is already verified');

  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + 72);

  await leadRepo.setEmailVerificationToken(sellerId, hashedToken, expiry);

  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const verificationUrl = `${appUrl}/verify-email?token=${rawToken}`;
  await sendSystemEmail(
    fullSeller.email,
    'Verify your SellMyHomeNow email address',
    `<p>Click the link below to verify your email and complete your submission:</p><p><a href="${verificationUrl}">${verificationUrl}</a></p><p>This link expires in 72 hours.</p>`,
  );

  await auditService.log({
    action: 'lead.verification_resent',
    entityType: 'Seller',
    entityId: sellerId,
    details: { triggeredBy: 'agent', agentId },
    actorType: 'agent' as const,
    actorId: agentId,
  });
}
```

Add the missing repo function in `lead.repository.ts`:

```typescript
export async function findSellerWithEmail(sellerId: string) {
  return prisma.seller.findUnique({
    where: { id: sellerId },
    select: { id: true, email: true, emailVerified: true },
  });
}
```

**Step 4: Add seller-initiated resend route**

In `src/domains/lead/verification.router.ts`, add:

```typescript
import { resendVerificationRateLimiter } from '../../infra/http/middleware/rate-limit';

// POST /api/leads/resend-verification — seller-initiated resend
verificationRouter.post(
  '/api/leads/resend-verification',
  resendVerificationRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const email = req.body.email?.trim();
      if (!email) {
        throw new ValidationError('Email is required');
      }

      await verificationService.resendVerificationEmail(email);

      if (req.headers['hx-request']) {
        return res.send('<span class="text-green-600 text-xs">Verification email sent!</span>');
      }
      res.json({ success: true });
    } catch (err) {
      if (err instanceof ValidationError) {
        if (req.headers['hx-request']) {
          return res.send(`<span class="text-red-600 text-xs">${err.message}</span>`);
        }
        return res.status(400).json({ error: err.message });
      }
      next(err);
    }
  },
);
```

**Step 5: Add agent-initiated resend route**

In `src/domains/agent/agent.router.ts`, add a new route after the existing seller routes:

```typescript
import * as verificationService from '../lead/verification.service';

// POST /agent/sellers/:id/resend-verification — agent resends verification email
agentRouter.post(
  '/agent/sellers/:id/resend-verification',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const sellerId = req.params['id'] as string;
      await verificationService.agentResendVerification(sellerId, user.id);

      if (req.headers['hx-request']) {
        return res.send('<span class="text-green-600 text-sm">Verification email resent!</span>');
      }
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);
```

**Step 6: Run the full test suite**

Run: `npm test`
Expected: All PASS

**Step 7: Commit**

```bash
git add src/domains/lead/verification.router.ts src/domains/lead/verification.service.ts src/domains/lead/lead.repository.ts src/domains/agent/agent.router.ts src/infra/http/middleware/rate-limit.ts
git commit -m "feat(lead): add seller and agent resend verification endpoints"
```

---

## Task 11: Agent Leads Page — Three-Group Layout

**Files:**
- Modify: `src/domains/agent/agent.types.ts`
- Modify: `src/domains/agent/agent.service.ts`
- Modify: `src/domains/agent/agent.repository.ts`
- Modify: `src/domains/agent/agent.router.ts`
- Modify: `src/views/partials/agent/lead-queue.njk`
- Modify: `src/domains/agent/__tests__/agent.service.test.ts`

**Step 1: Update types**

In `src/domains/agent/agent.types.ts`, update `LeadQueueItem`:

```typescript
export interface LeadQueueItem {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  emailVerified: boolean;
  leadSource: LeadSource | null;
  createdAt: Date;
  timeSinceCreation: number;
  welcomeNotificationSent: boolean;
  agentId: string | null;
}
```

Update `LeadQueueResult`:

```typescript
export interface LeadQueueResult {
  unassigned: LeadQueueItem[];
  verified: LeadQueueItem[];
  unverified: LeadQueueItem[];
}
```

**Step 2: Update repository to select email fields**

In `src/domains/agent/agent.repository.ts`, update `getLeadQueue` to select email fields:

```typescript
export async function getLeadQueue(agentId?: string) {
  return prisma.seller.findMany({
    where: {
      status: 'lead',
      ...(agentId ? { agentId } : {}),
    },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      emailVerified: true,
      leadSource: true,
      createdAt: true,
      agentId: true,
    },
    orderBy: { createdAt: 'asc' },
  });
}
```

**Step 3: Update service to split into three groups**

In `src/domains/agent/agent.service.ts`, update `getLeadQueue`:

```typescript
export async function getLeadQueue(agentId?: string): Promise<LeadQueueResult> {
  const leads = await agentRepo.getLeadQueue(agentId);
  const sellerIds = leads.map((l) => l.id);
  const notificationMap = await agentRepo.getWelcomeNotificationStatus(sellerIds);

  const now = Date.now();
  const all: LeadQueueItem[] = leads.map((lead) => ({
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    emailVerified: lead.emailVerified,
    leadSource: lead.leadSource,
    createdAt: lead.createdAt,
    timeSinceCreation: now - lead.createdAt.getTime(),
    welcomeNotificationSent: notificationMap.get(lead.id) ?? false,
    agentId: lead.agentId,
  }));

  const unassigned = all.filter((l) => l.agentId === null);
  const assigned = all.filter((l) => l.agentId !== null);
  const verified = assigned.filter((l) => l.emailVerified);
  const unverified = assigned.filter((l) => !l.emailVerified);

  return { unassigned, verified, unverified };
}
```

**Step 4: Update router to pass three groups**

In `src/domains/agent/agent.router.ts`, update the `/agent/leads` route. Change:

```typescript
const { unassigned, all } = await agentService.getLeadQueue(getAgentFilter(user));
```

to:

```typescript
const { unassigned, verified, unverified } = await agentService.getLeadQueue(getAgentFilter(user));
```

And update both render calls to pass `{ unassigned, verified, unverified }` instead of `{ unassigned, all }`.

**Step 5: Update the Nunjucks template**

Replace `src/views/partials/agent/lead-queue.njk`:

```nunjucks
{% macro leadTable(leads) %}
<div class="bg-white rounded-lg shadow overflow-hidden">
  <table class="min-w-full divide-y divide-gray-200">
    <thead class="bg-gray-50">
      <tr>
        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Name" | t }}</th>
        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Phone" | t }}</th>
        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Email" | t }}</th>
        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Source" | t }}</th>
        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Verified" | t }}</th>
        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Time" | t }}</th>
        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{{ "Notified" | t }}</th>
      </tr>
    </thead>
    <tbody class="divide-y divide-gray-200">
      {% for lead in leads %}
      <tr class="hover:bg-gray-50 cursor-pointer" data-action="navigate" data-url="/agent/sellers/{{ lead.id }}">
        <td class="px-4 py-3 text-sm font-medium">{{ lead.name }}</td>
        <td class="px-4 py-3 text-sm text-gray-500">{{ lead.phone }}</td>
        <td class="px-4 py-3 text-sm text-gray-500">{{ lead.email or "—" }}</td>
        <td class="px-4 py-3 text-sm text-gray-500">{{ lead.leadSource or "—" }}</td>
        <td class="px-4 py-3 text-sm">
          {% if lead.emailVerified %}
          <span class="text-green-600">✓</span>
          {% else %}
          <span class="text-gray-300">—</span>
          {% endif %}
        </td>
        <td class="px-4 py-3 text-sm text-gray-500">{{ lead.createdAt | date("relative") }}</td>
        <td class="px-4 py-3 text-sm">
          {% if lead.welcomeNotificationSent %}
          <span class="text-green-600">✓</span>
          {% else %}
          <span class="text-gray-300">—</span>
          {% endif %}
        </td>
      </tr>
      {% endfor %}
    </tbody>
  </table>
  <div class="px-4 py-2 text-xs text-gray-500">{{ leads.length }} {{ "leads" | t }}</div>
</div>
{% endmacro %}

{% set totalLeads = unassigned.length + verified.length + unverified.length %}

{% if totalLeads == 0 %}
<div class="text-gray-500 py-8 text-center">{{ "No new leads" | t }}</div>

{% else %}
<div class="space-y-6">
  {% if unassigned.length > 0 %}
  <div>
    <h2 class="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">{{ "Unassigned Leads" | t }}</h2>
    {{ leadTable(unassigned) }}
  </div>
  {% endif %}

  {% if verified.length > 0 %}
  <div>
    <h2 class="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">{{ "Verified Leads" | t }}</h2>
    {{ leadTable(verified) }}
  </div>
  {% endif %}

  {% if unverified.length > 0 %}
  <div>
    <h2 class="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">{{ "Unverified Leads" | t }}</h2>
    {{ leadTable(unverified) }}
  </div>
  {% endif %}
</div>
{% endif %}
```

**Step 6: Update agent service tests**

In `src/domains/agent/__tests__/agent.service.test.ts`, update `getLeadQueue` tests to use `{ unassigned, verified, unverified }` instead of `{ unassigned, all }`. Add `email` and `emailVerified` to lead fixtures.

**Step 7: Run tests**

Run: `npx jest src/domains/agent/ --no-coverage`
Expected: All PASS

**Step 8: Commit**

```bash
git add src/domains/agent/agent.types.ts src/domains/agent/agent.service.ts src/domains/agent/agent.repository.ts src/domains/agent/agent.router.ts src/views/partials/agent/lead-queue.njk src/domains/agent/__tests__/agent.service.test.ts
git commit -m "feat(lead): group agent leads page into Unassigned/Verified/Unverified"
```

---

## Task 12: Seller Detail Page — Show Contact Info, Timeline, Reason, Resend Button

**Files:**
- Modify: `src/domains/agent/agent.types.ts`
- Modify: `src/domains/agent/agent.service.ts`
- Modify: `src/domains/agent/agent.repository.ts`
- Modify: `src/views/pages/agent/seller-detail.njk`

**Step 1: Update SellerDetail type**

In `src/domains/agent/agent.types.ts`, add to `SellerDetail`:

```typescript
export interface SellerDetail {
  // ... existing fields ...
  emailVerified: boolean;
  sellingTimeline: string | null;
  sellingReason: string | null;
  sellingReasonOther: string | null;
}
```

**Step 2: Update repository to select new fields**

In `src/domains/agent/agent.repository.ts`, find the `getSellerDetail` function and add `emailVerified`, `sellingTimeline`, `sellingReason`, `sellingReasonOther` to the select clause.

**Step 3: Update service to map new fields**

In `src/domains/agent/agent.service.ts`, in the `getSellerDetail` function, add to the return object:

```typescript
emailVerified: seller.emailVerified,
sellingTimeline: seller.sellingTimeline,
sellingReason: seller.sellingReason,
sellingReasonOther: seller.sellingReasonOther,
```

**Step 4: Update seller-detail.njk**

In the "Seller Info" `<dl>` section of `src/views/pages/agent/seller-detail.njk`, add after the Status row:

```nunjucks
          <div class="flex justify-between"><dt class="text-gray-500">{{ "Phone" | t }}</dt><dd>{{ seller.phone }}</dd></div>
          <div class="flex justify-between"><dt class="text-gray-500">{{ "Email" | t }}</dt><dd>{% if seller.email %}{{ seller.email }} {% if seller.emailVerified %}<span class="px-1.5 py-0.5 text-xs rounded bg-green-100 text-green-700">{{ "Verified" | t }}</span>{% else %}<span class="px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-500">{{ "Unverified" | t }}</span>{% endif %}{% else %}{{ "—" }}{% endif %}</dd></div>
```

Add after Lead Source row:

```nunjucks
          <div class="flex justify-between"><dt class="text-gray-500">{{ "Timeline" | t }}</dt><dd>{% if seller.sellingTimeline == 'one_to_three_months' %}{{ "1-3 months" | t }}{% elif seller.sellingTimeline == 'three_to_six_months' %}{{ "3-6 months" | t }}{% elif seller.sellingTimeline == 'just_thinking' %}{{ "Just thinking about it" | t }}{% else %}{{ "—" }}{% endif %}</dd></div>
          <div class="flex justify-between"><dt class="text-gray-500">{{ "Reason to Sell" | t }}</dt><dd>{% if seller.sellingReason == 'other' and seller.sellingReasonOther %}{{ "Other: " | t }}{{ seller.sellingReasonOther }}{% elif seller.sellingReason %}{{ seller.sellingReason | capitalize }}{% else %}{{ "—" }}{% endif %}</dd></div>
```

Add a resend button after the email row (conditionally shown):

```nunjucks
          {% if seller.email and not seller.emailVerified %}
          <div class="flex justify-between items-center">
            <dt class="text-gray-500"></dt>
            <dd>
              <button class="text-xs text-[#c8553d] hover:underline"
                hx-post="/agent/sellers/{{ seller.id }}/resend-verification"
                hx-target="#resend-feedback-{{ seller.id }}"
                hx-swap="innerHTML">{{ "Resend Verification Email" | t }}</button>
              <span id="resend-feedback-{{ seller.id }}" class="ml-2"></span>
            </dd>
          </div>
          {% endif %}
```

**Step 5: Run the full test suite**

Run: `npm test`
Expected: All PASS

**Step 6: Commit**

```bash
git add src/domains/agent/agent.types.ts src/domains/agent/agent.service.ts src/domains/agent/agent.repository.ts src/views/pages/agent/seller-detail.njk
git commit -m "feat(lead): show contact info, timeline, reason, and resend button on seller detail page"
```

---

## Task 13: Final Integration Test and Cleanup

**Step 1: Run the full test suite**

Run: `npm test && npm run test:integration`
Expected: All PASS

**Step 2: Run the linter**

Run: `npm run lint`
Expected: No errors

**Step 3: Build check**

Run: `npm run build`
Expected: Build succeeds with no TypeScript errors

**Step 4: Manual smoke test**

Run: `npm run dev`

1. Visit homepage — verify email field appears in lead form
2. Submit a lead — check server logs for `[EMAIL_STUB]` with verification URL
3. Copy the verification URL from logs, visit it — verify email confirmed, details form renders
4. Fill out details form — verify success page
5. Visit `/agent/leads` — verify three-group layout (log in as agent first)
6. Visit seller detail page — verify phone, email (with badge), timeline, reason show up

**Step 5: Commit any fixes from smoke test if needed**
