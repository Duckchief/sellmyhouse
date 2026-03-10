# Phase 1C: Public Website, HDB Market Report, Lead Capture & PWA — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the public-facing website (homepage, HDB Market Report, lead capture, privacy, terms), cookie consent, and PWA support.

**Architecture:** Two new domain modules (`public` for page routing, `lead` for lead capture business logic), extending the existing `hdb` domain with `getDistinctStoreyRanges()`. Homepage extends `base.njk` directly for full-width sections; other public pages use `public.njk`. PWA via static manifest + service worker.

**Tech Stack:** Express + Nunjucks + HTMX + Tailwind, Prisma (Seller/ConsentRecord), express-rate-limit, existing notification service.

**Spec:** `docs/superpowers/specs/2026-03-10-phase-1c-public-website-pwa-design.md`

---

## Chunk 1: HDB Domain Extension + Lead Domain Backend

### Task 1: Add `getDistinctStoreyRanges()` to HDB domain

**Files:**
- Modify: `src/domains/hdb/repository.ts`
- Modify: `src/domains/hdb/service.ts`
- Modify: `src/domains/hdb/__tests__/service.test.ts`

- [ ] **Step 1: Write the failing test for `getDistinctStoreyRanges`**

Add to `src/domains/hdb/__tests__/service.test.ts` after the `getDistinctFlatTypes` describe block:

```typescript
describe('getDistinctStoreyRanges', () => {
  it('returns list of storey ranges', async () => {
    mockRepo.getDistinctStoreyRanges.mockResolvedValue(['01 TO 03', '04 TO 06', '07 TO 09']);

    const result = await service.getDistinctStoreyRanges();

    expect(result).toEqual(['01 TO 03', '04 TO 06', '07 TO 09']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/domains/hdb/__tests__/service.test.ts --verbose`
Expected: FAIL — `mockRepo.getDistinctStoreyRanges` is not a function

- [ ] **Step 3: Implement `getDistinctStoreyRanges` in repository and service**

Add to `src/domains/hdb/repository.ts` after `getDistinctFlatTypes()`:

```typescript
async getDistinctStoreyRanges(): Promise<string[]> {
  const results = await prisma.hdbTransaction.findMany({
    distinct: ['storeyRange'],
    select: { storeyRange: true },
    orderBy: { storeyRange: 'asc' },
  });
  return results.map((r) => r.storeyRange);
}
```

Add to `src/domains/hdb/service.ts` after `getDistinctFlatTypes()`:

```typescript
async getDistinctStoreyRanges(): Promise<string[]> {
  return this.repo.getDistinctStoreyRanges();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/domains/hdb/__tests__/service.test.ts --verbose`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/domains/hdb/repository.ts src/domains/hdb/service.ts src/domains/hdb/__tests__/service.test.ts
git commit -m "feat: add getDistinctStoreyRanges to HDB domain"
```

---

### Task 2: Create lead domain types and validator

**Files:**
- Create: `src/domains/lead/lead.types.ts`
- Create: `src/domains/lead/lead.validator.ts`
- Create: `src/domains/lead/__tests__/lead.validator.test.ts`

- [ ] **Step 1: Create `lead.types.ts`**

```typescript
// src/domains/lead/lead.types.ts

export type LeadSource = 'website' | 'tiktok' | 'instagram' | 'referral' | 'walkin' | 'other';

export interface LeadInput {
  name: string;
  phone: string;
  consentService: boolean;
  consentMarketing: boolean;
  leadSource: LeadSource;
  honeypot?: string;        // hidden field — must be empty
  formLoadedAt?: number;    // timestamp when form was loaded (ms)
  ipAddress?: string;
  userAgent?: string;
}

export interface LeadResult {
  sellerId: string;
}
```

- [ ] **Step 2: Write failing tests for the validator**

Create `src/domains/lead/__tests__/lead.validator.test.ts`:

```typescript
import { validateLeadInput } from '../lead.validator';

describe('validateLeadInput', () => {
  const validInput = {
    name: 'John Tan',
    phone: '91234567',
    consentService: true,
    consentMarketing: false,
    leadSource: 'website' as const,
    formLoadedAt: Date.now() - 10000, // 10 seconds ago
  };

  it('accepts valid input', () => {
    const result = validateLeadInput(validInput);
    expect(result).toBeNull();
  });

  it('rejects empty name', () => {
    const result = validateLeadInput({ ...validInput, name: '' });
    expect(result).toEqual({ name: 'Name is required' });
  });

  it('rejects whitespace-only name', () => {
    const result = validateLeadInput({ ...validInput, name: '   ' });
    expect(result).toEqual({ name: 'Name is required' });
  });

  it('rejects phone not starting with 8 or 9', () => {
    const result = validateLeadInput({ ...validInput, phone: '61234567' });
    expect(result).toEqual({ phone: 'Please enter a valid Singapore mobile number' });
  });

  it('rejects phone with wrong length', () => {
    const result = validateLeadInput({ ...validInput, phone: '9123456' });
    expect(result).toEqual({ phone: 'Please enter a valid Singapore mobile number' });
  });

  it('rejects phone with non-digits', () => {
    const result = validateLeadInput({ ...validInput, phone: '9123abcd' });
    expect(result).toEqual({ phone: 'Please enter a valid Singapore mobile number' });
  });

  it('rejects missing service consent', () => {
    const result = validateLeadInput({ ...validInput, consentService: false });
    expect(result).toEqual({ consentService: 'Service consent is required' });
  });

  it('detects honeypot filled (bot)', () => {
    const result = validateLeadInput({ ...validInput, honeypot: 'spam' });
    expect(result).toEqual({ _bot: 'Submission rejected' });
  });

  it('rejects fast submissions (under 3 seconds)', () => {
    const result = validateLeadInput({ ...validInput, formLoadedAt: Date.now() - 1000 });
    expect(result).toEqual({ _bot: 'Submission rejected' });
  });

  it('allows submission without formLoadedAt (skip timing check)', () => {
    const { formLoadedAt, ...input } = validInput;
    const result = validateLeadInput(input);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest src/domains/lead/__tests__/lead.validator.test.ts --verbose`
Expected: FAIL — cannot find `../lead.validator`

- [ ] **Step 4: Implement the validator**

Create `src/domains/lead/lead.validator.ts`:

```typescript
// src/domains/lead/lead.validator.ts
import type { LeadInput } from './lead.types';

const SG_MOBILE_REGEX = /^[89]\d{7}$/;
const MIN_FORM_TIME_MS = 3000;

export function validateLeadInput(
  input: Omit<LeadInput, 'ipAddress' | 'userAgent'>,
): Record<string, string> | null {
  // Honeypot check — silent rejection
  if (input.honeypot) {
    return { _bot: 'Submission rejected' };
  }

  // Timing check — reject if submitted too fast
  if (input.formLoadedAt && Date.now() - input.formLoadedAt < MIN_FORM_TIME_MS) {
    return { _bot: 'Submission rejected' };
  }

  if (!input.name || !input.name.trim()) {
    return { name: 'Name is required' };
  }

  if (!SG_MOBILE_REGEX.test(input.phone)) {
    return { phone: 'Please enter a valid Singapore mobile number' };
  }

  if (!input.consentService) {
    return { consentService: 'Service consent is required' };
  }

  return null;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest src/domains/lead/__tests__/lead.validator.test.ts --verbose`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/domains/lead/lead.types.ts src/domains/lead/lead.validator.ts src/domains/lead/__tests__/lead.validator.test.ts
git commit -m "feat: add lead domain types and validator with tests"
```

---

### Task 3: Create lead repository

**Files:**
- Create: `src/domains/lead/lead.repository.ts`

- [ ] **Step 1: Create the repository**

```typescript
// src/domains/lead/lead.repository.ts
import { prisma } from '@/infra/database/prisma';
import { createId } from '@paralleldrive/cuid2';

export async function findActiveSellerByPhone(phone: string) {
  return prisma.seller.findFirst({
    where: {
      phone,
      status: { in: ['lead', 'engaged', 'active'] },
    },
  });
}

export async function createSellerLead(data: {
  name: string;
  phone: string;
  consentService: boolean;
  consentMarketing: boolean;
  leadSource: string;
}) {
  const id = createId();
  return prisma.seller.create({
    data: {
      id,
      name: data.name,
      phone: data.phone,
      consentService: data.consentService,
      consentMarketing: data.consentMarketing,
      consentTimestamp: new Date(),
      leadSource: data.leadSource as 'website' | 'tiktok' | 'instagram' | 'referral' | 'walkin' | 'other',
      status: 'lead',
    },
  });
}

export async function createConsentRecord(data: {
  subjectId: string;
  purposeService: boolean;
  purposeMarketing: boolean;
  ipAddress?: string;
  userAgent?: string;
}) {
  return prisma.consentRecord.create({
    data: {
      id: createId(),
      subjectType: 'seller',
      subjectId: data.subjectId,
      purposeService: data.purposeService,
      purposeMarketing: data.purposeMarketing,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
    },
  });
}

export async function findAdminAgents() {
  return prisma.agent.findMany({
    where: { role: 'admin', isActive: true },
    select: { id: true },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/domains/lead/lead.repository.ts
git commit -m "feat: add lead repository with seller and consent operations"
```

---

### Task 4: Create lead service with tests

**Files:**
- Create: `src/domains/lead/lead.service.ts`
- Create: `src/domains/lead/__tests__/lead.service.test.ts`

- [ ] **Step 1: Write failing tests for the service**

Create `src/domains/lead/__tests__/lead.service.test.ts`:

```typescript
import { submitLead } from '../lead.service';
import * as leadRepo from '../lead.repository';
import * as auditService from '../../shared/audit.service';
import * as notificationService from '../../notification/notification.service';

jest.mock('../lead.repository');
jest.mock('../../shared/audit.service');
jest.mock('../../notification/notification.service');

const mockLeadRepo = leadRepo as jest.Mocked<typeof leadRepo>;
const mockAudit = auditService as jest.Mocked<typeof auditService>;
const mockNotification = notificationService as jest.Mocked<typeof notificationService>;

describe('lead.service', () => {
  beforeEach(() => jest.clearAllMocks());

  const validInput = {
    name: 'John Tan',
    phone: '91234567',
    consentService: true,
    consentMarketing: false,
    leadSource: 'website' as const,
    ipAddress: '127.0.0.1',
    userAgent: 'test',
  };

  it('creates seller, consent record, audit log, and notifies admin', async () => {
    mockLeadRepo.findActiveSellerByPhone.mockResolvedValue(null);
    mockLeadRepo.createSellerLead.mockResolvedValue({
      id: 'seller-1',
      name: 'John Tan',
      phone: '91234567',
      email: null,
      passwordHash: null,
      agentId: null,
      status: 'lead',
      notificationPreference: 'whatsapp_and_email',
      consentService: true,
      consentMarketing: false,
      consentTimestamp: new Date(),
      consentWithdrawnAt: null,
      leadSource: 'website',
      twoFactorSecret: null,
      twoFactorEnabled: false,
      twoFactorBackupCodes: null,
      failedTwoFactorAttempts: 0,
      twoFactorLockedUntil: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockLeadRepo.createConsentRecord.mockResolvedValue({
      id: 'consent-1',
      subjectType: 'seller',
      subjectId: 'seller-1',
      purposeService: true,
      purposeMarketing: false,
      consentGivenAt: new Date(),
      consentWithdrawnAt: null,
      withdrawalChannel: null,
      ipAddress: '127.0.0.1',
      userAgent: 'test',
      createdAt: new Date(),
    });
    mockLeadRepo.findAdminAgents.mockResolvedValue([{ id: 'admin-1' }]);
    mockAudit.log.mockResolvedValue(undefined);
    mockNotification.send.mockResolvedValue(undefined);

    const result = await submitLead(validInput);

    expect(result.sellerId).toBe('seller-1');
    expect(mockLeadRepo.findActiveSellerByPhone).toHaveBeenCalledWith('91234567');
    expect(mockLeadRepo.createSellerLead).toHaveBeenCalledWith({
      name: 'John Tan',
      phone: '91234567',
      consentService: true,
      consentMarketing: false,
      leadSource: 'website',
    });
    expect(mockLeadRepo.createConsentRecord).toHaveBeenCalledWith({
      subjectId: 'seller-1',
      purposeService: true,
      purposeMarketing: false,
      ipAddress: '127.0.0.1',
      userAgent: 'test',
    });
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'lead.created',
        entityType: 'Seller',
        entityId: 'seller-1',
      }),
    );
    expect(mockNotification.send).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientType: 'agent',
        recipientId: 'admin-1',
        templateName: 'generic',
      }),
      'system',
    );
  });

  it('throws ConflictError for duplicate phone', async () => {
    mockLeadRepo.findActiveSellerByPhone.mockResolvedValue({
      id: 'existing',
      name: 'Existing',
      phone: '91234567',
    } as ReturnType<typeof mockLeadRepo.findActiveSellerByPhone> extends Promise<infer T> ? NonNullable<T> : never);

    await expect(submitLead(validInput)).rejects.toThrow('already exists');
  });

  it('logs warning when no admin agents exist', async () => {
    mockLeadRepo.findActiveSellerByPhone.mockResolvedValue(null);
    mockLeadRepo.createSellerLead.mockResolvedValue({
      id: 'seller-2',
      name: 'Jane',
      phone: '81234567',
      email: null,
      passwordHash: null,
      agentId: null,
      status: 'lead',
      notificationPreference: 'whatsapp_and_email',
      consentService: true,
      consentMarketing: false,
      consentTimestamp: new Date(),
      consentWithdrawnAt: null,
      leadSource: 'website',
      twoFactorSecret: null,
      twoFactorEnabled: false,
      twoFactorBackupCodes: null,
      failedTwoFactorAttempts: 0,
      twoFactorLockedUntil: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockLeadRepo.createConsentRecord.mockResolvedValue({
      id: 'consent-2',
      subjectType: 'seller',
      subjectId: 'seller-2',
      purposeService: true,
      purposeMarketing: false,
      consentGivenAt: new Date(),
      consentWithdrawnAt: null,
      withdrawalChannel: null,
      ipAddress: null,
      userAgent: null,
      createdAt: new Date(),
    });
    mockLeadRepo.findAdminAgents.mockResolvedValue([]);
    mockAudit.log.mockResolvedValue(undefined);

    const result = await submitLead({ ...validInput, phone: '81234567' });

    expect(result.sellerId).toBe('seller-2');
    // Notification should NOT be called when there are no admin agents
    expect(mockNotification.send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/domains/lead/__tests__/lead.service.test.ts --verbose`
Expected: FAIL — cannot find `../lead.service`

- [ ] **Step 3: Implement the service**

Create `src/domains/lead/lead.service.ts`:

```typescript
// src/domains/lead/lead.service.ts
import { ConflictError } from '../shared/errors';
import { logger } from '../../infra/logger';
import * as leadRepo from './lead.repository';
import * as auditService from '../shared/audit.service';
import * as notificationService from '../notification/notification.service';
import type { LeadInput, LeadResult } from './lead.types';

export async function submitLead(input: LeadInput): Promise<LeadResult> {
  // Check for duplicate
  const existing = await leadRepo.findActiveSellerByPhone(input.phone);
  if (existing) {
    throw new ConflictError('A lead with this phone number already exists');
  }

  // Create seller
  const seller = await leadRepo.createSellerLead({
    name: input.name.trim(),
    phone: input.phone,
    consentService: input.consentService,
    consentMarketing: input.consentMarketing,
    leadSource: input.leadSource,
  });

  // Create consent record (append-only)
  await leadRepo.createConsentRecord({
    subjectId: seller.id,
    purposeService: input.consentService,
    purposeMarketing: input.consentMarketing,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  // Audit log
  await auditService.log({
    action: 'lead.created',
    entityType: 'Seller',
    entityId: seller.id,
    details: { leadSource: input.leadSource, phone: input.phone },
  });

  // Notify admin agents
  const admins = await leadRepo.findAdminAgents();
  if (admins.length === 0) {
    logger.warn('No admin agents found to notify about new lead');
  } else {
    for (const admin of admins) {
      await notificationService.send(
        {
          recipientType: 'agent',
          recipientId: admin.id,
          templateName: 'generic',
          templateData: {
            message: `New lead: ${input.name} (${input.phone}) from ${input.leadSource}`,
          },
          preferredChannel: 'in_app',
        },
        'system',
      );
    }
  }

  return { sellerId: seller.id };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/domains/lead/__tests__/lead.service.test.ts --verbose`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/domains/lead/lead.service.ts src/domains/lead/__tests__/lead.service.test.ts
git commit -m "feat: add lead service with duplicate check, consent, audit, and admin notification"
```

---

### Task 5: Create lead router with rate limiter

**Files:**
- Create: `src/domains/lead/lead.router.ts`
- Modify: `src/infra/http/middleware/rate-limit.ts`

- [ ] **Step 1: Add lead rate limiter to rate-limit.ts**

Add to `src/infra/http/middleware/rate-limit.ts` after the `apiRateLimiter`:

```typescript
export const leadRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: 'RATE_LIMITED', message: 'Too many submissions. Please try again later.' },
  },
});
```

- [ ] **Step 2: Create the lead router**

Create `src/domains/lead/lead.router.ts`:

```typescript
// src/domains/lead/lead.router.ts
import { Router } from 'express';
import { validateLeadInput } from './lead.validator';
import { submitLead } from './lead.service';
import { leadRateLimiter } from '../../infra/http/middleware/rate-limit';
import { ValidationError } from '../shared/errors';
import type { LeadSource } from './lead.types';

export const leadRouter = Router();

const VALID_LEAD_SOURCES = ['website', 'tiktok', 'instagram', 'referral', 'walkin', 'other'];

leadRouter.post('/api/leads', leadRateLimiter, async (req, res, next) => {
  try {
    const leadSource = VALID_LEAD_SOURCES.includes(req.body.leadSource)
      ? (req.body.leadSource as LeadSource)
      : 'website';

    const input = {
      name: req.body.name ?? '',
      phone: req.body.phone ?? '',
      consentService: req.body.consentService === 'true' || req.body.consentService === true,
      consentMarketing: req.body.consentMarketing === 'true' || req.body.consentMarketing === true,
      leadSource,
      honeypot: req.body.website ?? '', // honeypot field named "website"
      formLoadedAt: req.body.formLoadedAt ? parseInt(req.body.formLoadedAt, 10) : undefined,
    };

    const errors = validateLeadInput(input);
    if (errors) {
      if (errors._bot) {
        // Silent rejection for bots — return success to avoid revealing detection
        if (req.headers['hx-request']) {
          return res.render('partials/public/lead-success');
        }
        return res.json({ success: true });
      }
      throw new ValidationError('Invalid input', errors);
    }

    await submitLead({
      ...input,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    if (req.headers['hx-request']) {
      return res.render('partials/public/lead-success');
    }
    return res.status(201).json({ success: true });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add src/domains/lead/lead.router.ts src/infra/http/middleware/rate-limit.ts
git commit -m "feat: add lead router with rate limiting and bot detection"
```

---

### ~~Task 6: SKIPPED — merged into Task 8~~

Router registration deferred to Task 8 (after public router is created in Task 7).

---

## Chunk 2: Public Router + Templates

### Task 7: Create public router

**Files:**
- Create: `src/domains/public/public.router.ts`

- [ ] **Step 1: Create the public router**

```typescript
// src/domains/public/public.router.ts
import { Router } from 'express';
import { HdbService } from '../hdb/service';

export const publicRouter = Router();

const hdbService = new HdbService();

publicRouter.get('/', (_req, res) => {
  res.render('pages/public/home');
});

publicRouter.get('/market-report', async (_req, res, next) => {
  try {
    const [towns, flatTypes, storeyRanges] = await Promise.all([
      hdbService.getDistinctTowns(),
      hdbService.getDistinctFlatTypes(),
      hdbService.getDistinctStoreyRanges(),
    ]);

    res.render('pages/public/market-report', { towns, flatTypes, storeyRanges });
  } catch (err) {
    next(err);
  }
});

publicRouter.get('/api/hdb/report', async (req, res, next) => {
  try {
    const town = req.query.town as string;
    const flatType = req.query.flatType as string;
    const storeyRange = (req.query.storeyRange as string) || undefined;
    const months = req.query.months ? parseInt(req.query.months as string, 10) : 24;

    if (!town || !flatType) {
      return res.status(400).render('partials/public/report-results', { error: 'Town and flat type are required' });
    }

    const report = await hdbService.getMarketReport({ town, flatType, storeyRange, months });

    if (req.headers['hx-request']) {
      return res.render('partials/public/report-results', { report });
    }
    return res.json({ report });
  } catch (err) {
    next(err);
  }
});

publicRouter.get('/privacy', (_req, res) => {
  res.render('pages/public/privacy');
});

publicRouter.get('/terms', (_req, res) => {
  res.render('pages/public/terms');
});
```

- [ ] **Step 2: Commit**

```bash
git add src/domains/public/public.router.ts
git commit -m "feat: add public router for homepage, market report, privacy, terms"
```

---

### Task 8: Register routers in app.ts and update CSP

**Files:**
- Modify: `src/infra/http/app.ts`

- [ ] **Step 1: Add imports and register routers**

Add to imports in `src/infra/http/app.ts`:

```typescript
import { publicRouter } from '../../domains/public/public.router';
import { leadRouter } from '../../domains/lead/lead.router';
```

Add `workerSrc: ["'self'"]` to the CSP `directives` object after the `frameSrc` line.

Add a `formatPrice` filter after the existing `date` filter:

```typescript
// Add price formatting filter (e.g., 500000 → "500,000")
env.addFilter('formatPrice', (val: unknown) => {
  const num = Number(val);
  return isNaN(num) ? String(val) : num.toLocaleString('en-SG');
});
```

Update the Routes section to:

```typescript
// Routes
app.use(healthRouter);
app.use(publicRouter);
app.use(leadRouter);
app.use(authRouter);
app.use(agentSettingsRouter);
app.use('/api', apiRateLimiter);
app.use(notificationRouter);
```

- [ ] **Step 2: Commit**

```bash
git add src/infra/http/app.ts
git commit -m "feat: register public and lead routers, add worker-src to CSP"
```

---

### Task 9: Create public header and footer partials

**Files:**
- Create: `src/views/partials/public/header.njk`
- Create: `src/views/partials/public/footer.njk`

- [ ] **Step 1: Create public header partial**

Create `src/views/partials/public/header.njk`:

```njk
<header class="bg-[#1a1a2e]">
  <div class="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
    <a href="/" class="text-xl font-bold text-white">
      {{ "SellMyHome" | t }}<span class="text-[#c8553d]">{{ "Now" | t }}</span>{{ ".sg" | t }}
    </a>
    <nav class="flex items-center gap-6">
      <a href="/market-report" class="text-white hover:text-gray-300 text-sm">{{ "Market Report" | t }}</a>
      <a href="/auth/login" class="text-white hover:text-gray-300 text-sm">{{ "Login" | t }}</a>
      <a href="#get-started" class="bg-[#c8553d] text-white px-5 py-2 rounded-full text-sm font-semibold hover:bg-[#b04a35] transition-colors">{{ "Get Started" | t }}</a>
    </nav>
  </div>
</header>
```

- [ ] **Step 2: Create public footer partial**

Create `src/views/partials/public/footer.njk`:

```njk
<footer class="bg-[#fafaf7] border-t border-gray-200">
  <div class="max-w-7xl mx-auto px-4 py-10 grid grid-cols-1 md:grid-cols-3 gap-8">
    <div>
      <div class="font-bold text-[#1a1a2e] mb-2">{{ "SellMyHomeNow.sg" | t }}</div>
      <p class="text-sm text-gray-500">{{ "AI-powered HDB resale platform. Sell your flat for a fixed fee of $1,499 + GST." | t }}</p>
    </div>
    <div>
      <div class="font-bold text-[#1a1a2e] mb-2">{{ "Quick Links" | t }}</div>
      <div class="space-y-1 text-sm text-gray-500">
        <div><a href="/market-report" class="hover:text-gray-700">{{ "HDB Market Report" | t }}</a></div>
        <div><a href="/privacy" class="hover:text-gray-700">{{ "Privacy Policy" | t }}</a></div>
        <div><a href="/terms" class="hover:text-gray-700">{{ "Terms of Service" | t }}</a></div>
      </div>
    </div>
    <div>
      <div class="font-bold text-[#1a1a2e] mb-2">{{ "Regulatory" | t }}</div>
      <div class="text-sm text-gray-500 space-y-1">
        <div>{{ "Operating under" | t }} <strong>{{ "Huttons Asia Pte Ltd" | t }}</strong></div>
        <div>{{ "CEA Licence No. L3008899K" | t }}</div>
        <div>{{ "(David) Ng Chun Fai" | t }}</div>
        <div>{{ "CEA Reg No. R011998B" | t }}</div>
      </div>
    </div>
  </div>
  <div class="border-t border-gray-200">
    <div class="max-w-7xl mx-auto px-4 py-4 text-center text-xs text-gray-400">
      {{ "© " | t }}{{ "now" | date("YYYY") }}{{ " SellMyHomeNow.sg. All rights reserved." | t }}
    </div>
  </div>
</footer>
```

- [ ] **Step 3: Update `public.njk` layout to use public partials**

Modify `src/views/layouts/public.njk` to:

```njk
{% extends "layouts/base.njk" %}

{% block body %}
  {% include "partials/public/header.njk" %}
  <main class="max-w-7xl mx-auto px-4 py-8">
    {% block content %}{% endblock %}
  </main>
  {% include "partials/public/footer.njk" %}
{% endblock %}
```

- [ ] **Step 4: Commit**

```bash
git add src/views/partials/public/header.njk src/views/partials/public/footer.njk src/views/layouts/public.njk
git commit -m "feat: add public header and footer partials with brand design"
```

---

### Task 10: Create homepage template

**Files:**
- Create: `src/views/pages/public/home.njk`
- Create: `src/views/partials/public/lead-success.njk`

- [ ] **Step 1: Create the homepage template**

The homepage extends `base.njk` directly (not `public.njk`) because it needs full-width sections.

Create `src/views/pages/public/home.njk`:

```njk
{% extends "layouts/base.njk" %}

{% block title %}{{ "SellMyHomeNow.sg — Sell Your HDB for $1,499" | t }}{% endblock %}

{% block body %}
{% include "partials/public/header.njk" %}

{# Hero #}
<section class="bg-[#1a1a2e] text-white py-20 px-4 text-center">
  <h1 class="text-4xl md:text-5xl font-bold mb-4">
    {{ "Sell Your HDB for " | t }}<span class="text-[#c8553d]">{{ "$1,499" | t }}</span>
  </h1>
  <p class="text-gray-400 text-lg mb-8 max-w-xl mx-auto">
    {{ "AI-powered platform with full agent guidance. Fixed fee, no percentage commission. You save thousands." | t }}
  </p>
  <div class="flex gap-4 justify-center flex-wrap">
    <a href="#get-started" class="bg-[#c8553d] text-white px-8 py-3 rounded-full font-semibold hover:bg-[#b04a35] transition-colors">{{ "Get Started" | t }}</a>
    <a href="/market-report" class="bg-[#333] text-white px-8 py-3 rounded-full font-semibold hover:bg-[#444] transition-colors">{{ "Free Market Report" | t }}</a>
  </div>
</section>
<div class="h-1 bg-[#c8553d]"></div>

{# How It Works #}
<section class="py-16 px-4 bg-white">
  <h2 class="text-2xl font-bold text-center mb-10">{{ "How It Works" | t }}</h2>
  <div class="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
    {% set steps = [
      { num: "1", title: "Tell Us About Your Flat", desc: "Share your HDB details and we'll provide a free market report with recent transaction data." },
      { num: "2", title: "We Guide You", desc: "AI-powered tools help with pricing, listing photos, and scheduling viewings. Your agent reviews everything." },
      { num: "3", title: "Sell & Save", desc: "Complete your sale with professional agent support. Pay only $1,499 + GST on completion." }
    ] %}
    {% for step in steps %}
    <div class="border border-gray-200 rounded-xl p-6 text-center">
      <div class="w-10 h-10 bg-[#c8553d] text-white rounded-full flex items-center justify-center font-bold mx-auto mb-4">{{ step.num }}</div>
      <h3 class="font-bold mb-2">{{ step.title | t }}</h3>
      <p class="text-sm text-gray-500">{{ step.desc | t }}</p>
    </div>
    {% endfor %}
  </div>
</section>

{# Why SellMyHomeNow.sg? #}
<section class="py-16 px-4 bg-[#fafaf7]">
  <h2 class="text-2xl font-bold text-center mb-10">{{ "Why SellMyHomeNow.sg?" | t }}</h2>
  <div class="max-w-3xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
    {% set benefits = [
      { icon: "$", title: "Fixed Fee: $1,499 + GST", desc: "No percentage commission. A flat selling for $500K? You save over $8,000 compared to 2% commission." },
      { icon: "🛡", title: "Licensed Agent Guidance", desc: "Every step reviewed by a CEA-registered agent. AI assists, humans decide." },
      { icon: "⚡", title: "AI-Powered Tools", desc: "Smart pricing analysis, auto-generated listings, viewing scheduler, and financial reports." },
      { icon: "✓", title: "Pay Only on Completion", desc: "No upfront fees. Pay only when your flat is successfully sold." }
    ] %}
    {% for b in benefits %}
    <div class="flex gap-4">
      <div class="w-10 h-10 bg-[#c8553d] text-white rounded-lg flex items-center justify-center font-bold flex-shrink-0">{{ b.icon }}</div>
      <div>
        <h3 class="font-bold text-sm mb-1">{{ b.title | t }}</h3>
        <p class="text-sm text-gray-500">{{ b.desc | t }}</p>
      </div>
    </div>
    {% endfor %}
  </div>
</section>

{# Lead Capture #}
<section id="get-started" class="py-16 px-4 bg-white">
  <h2 class="text-2xl font-bold text-center mb-2">{{ "Get Started" | t }}</h2>
  <p class="text-gray-500 text-center mb-8">{{ "Leave your details and we'll be in touch within 24 hours." | t }}</p>
  <div id="lead-form-container" class="max-w-md mx-auto">
    <form hx-post="/api/leads" hx-target="#lead-form-container" hx-swap="innerHTML" class="border border-gray-200 rounded-xl p-8">
      <input type="hidden" name="formLoadedAt" value="" id="formLoadedAt">
      <input type="hidden" name="leadSource" value="website">
      {# Honeypot — hidden from real users #}
      <div class="hidden" aria-hidden="true">
        <input type="text" name="website" tabindex="-1" autocomplete="off">
      </div>

      <div class="mb-4">
        <label for="name" class="block text-sm font-semibold mb-1">{{ "Full Name" | t }}</label>
        <input type="text" id="name" name="name" required class="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-[#c8553d] focus:border-transparent outline-none">
      </div>

      <div class="mb-4">
        <label for="phone" class="block text-sm font-semibold mb-1">{{ "Mobile Number" | t }}</label>
        <input type="tel" id="phone" name="phone" placeholder="91234567" required pattern="[89]\d{7}" class="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-[#c8553d] focus:border-transparent outline-none">
      </div>

      <div class="mb-3">
        <label class="flex items-start gap-2 text-xs text-gray-600">
          <input type="checkbox" name="consentService" value="true" required class="mt-0.5">
          <span>{{ "I consent to SellMyHomeNow.sg collecting and using my personal data to provide property selling services." | t }} <a href="/privacy" target="_blank" class="text-[#c8553d] hover:underline">{{ "Privacy Policy" | t }}</a> *</span>
        </label>
      </div>

      <div class="mb-6">
        <label class="flex items-start gap-2 text-xs text-gray-600">
          <input type="checkbox" name="consentMarketing" value="true" class="mt-0.5">
          <span>{{ "I consent to receiving marketing communications about property market updates. (Optional)" | t }}</span>
        </label>
      </div>

      <button type="submit" class="w-full bg-[#c8553d] text-white py-3 rounded-full font-semibold hover:bg-[#b04a35] transition-colors">{{ "Submit" | t }}</button>
    </form>
  </div>
</section>

{% include "partials/public/footer.njk" %}

{% endblock %}

{% block scripts %}
<script>
  document.getElementById('formLoadedAt').value = Date.now().toString();
</script>
{% endblock %}
```

- [ ] **Step 2: Create lead success partial**

Create `src/views/partials/public/lead-success.njk`:

```njk
<div class="border border-green-200 bg-green-50 rounded-xl p-8 text-center">
  <div class="text-3xl mb-3">✓</div>
  <h3 class="font-bold text-lg mb-2">{{ "Thank you!" | t }}</h3>
  <p class="text-sm text-gray-600">{{ "We've received your details and will be in touch within 24 hours." | t }}</p>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add src/views/pages/public/home.njk src/views/partials/public/lead-success.njk
git commit -m "feat: add homepage template with hero, how-it-works, benefits, and lead form"
```

---

### Task 11: Create market report page and results partial

**Files:**
- Create: `src/views/pages/public/market-report.njk`
- Create: `src/views/partials/public/report-results.njk`

- [ ] **Step 1: Create market report page**

Create `src/views/pages/public/market-report.njk`:

```njk
{% extends "layouts/public.njk" %}

{% block title %}{{ "HDB Market Report — SellMyHomeNow.sg" | t }}{% endblock %}

{% block content %}
<div class="max-w-4xl mx-auto">
  <h1 class="text-3xl font-bold text-center mb-2">{{ "HDB Market Report" | t }}</h1>
  <p class="text-gray-500 text-center mb-8">{{ "Check recent HDB resale prices in your area. Free, no login required." | t }}</p>

  {# Search form #}
  <div class="border border-gray-200 rounded-xl p-6 mb-8">
    <form hx-get="/api/hdb/report" hx-target="#report-results" hx-swap="innerHTML" hx-indicator="#search-spinner">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
        <div>
          <label for="town" class="block text-sm font-semibold mb-1">{{ "Town" | t }}</label>
          <select id="town" name="town" required class="w-full border border-gray-300 rounded-lg px-3 py-2.5 bg-white">
            <option value="">{{ "Select town" | t }}</option>
            {% for t in towns %}
            <option value="{{ t }}">{{ t }}</option>
            {% endfor %}
          </select>
        </div>
        <div>
          <label for="flatType" class="block text-sm font-semibold mb-1">{{ "Flat Type" | t }}</label>
          <select id="flatType" name="flatType" required class="w-full border border-gray-300 rounded-lg px-3 py-2.5 bg-white">
            <option value="">{{ "Select type" | t }}</option>
            {% for ft in flatTypes %}
            <option value="{{ ft }}">{{ ft }}</option>
            {% endfor %}
          </select>
        </div>
        <div>
          <label for="storeyRange" class="block text-sm font-semibold mb-1">{{ "Storey Range" | t }}</label>
          <select id="storeyRange" name="storeyRange" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 bg-white">
            <option value="">{{ "All storeys" | t }}</option>
            {% for sr in storeyRanges %}
            <option value="{{ sr }}">{{ sr }}</option>
            {% endfor %}
          </select>
        </div>
        <div class="flex items-end">
          <button type="submit" class="w-full bg-[#c8553d] text-white py-2.5 rounded-lg font-semibold hover:bg-[#b04a35] transition-colors">{{ "Search" | t }}</button>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <label class="text-sm font-semibold">{{ "Date Range:" | t }}</label>
        <select name="months" class="border border-gray-300 rounded-lg px-3 py-1.5 bg-white text-sm">
          <option value="6">{{ "6 Months" | t }}</option>
          <option value="12">{{ "1 Year" | t }}</option>
          <option value="24" selected>{{ "2 Years" | t }}</option>
          <option value="60">{{ "5 Years" | t }}</option>
          <option value="120">{{ "10 Years" | t }}</option>
          <option value="240">{{ "20 Years" | t }}</option>
          <option value="0">{{ "All" | t }}</option>
        </select>
      </div>
    </form>
  </div>

  {# Results area #}
  <div id="report-results">
    <p id="search-spinner" class="htmx-indicator text-center text-gray-400 py-8">{{ "Loading..." | t }}</p>
  </div>
</div>
{% endblock %}
```

- [ ] **Step 2: Create report results partial**

Create `src/views/partials/public/report-results.njk`:

```njk
{% if error %}
<div class="text-center py-8 text-red-600">{{ error }}</div>
{% elif not report %}
<div class="text-center py-8 text-gray-400">{{ "No transactions found for this criteria. Try adjusting your search." | t }}</div>
{% else %}

{# Stats cards #}
<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
  <div class="border border-gray-200 rounded-xl p-4 text-center">
    <div class="text-xs text-gray-400 mb-1">{{ "Transactions" | t }}</div>
    <div class="text-2xl font-bold">{{ report.count }}</div>
  </div>
  <div class="border border-gray-200 rounded-xl p-4 text-center">
    <div class="text-xs text-gray-400 mb-1">{{ "Min Price" | t }}</div>
    <div class="text-2xl font-bold">S${{ report.min | formatPrice }}</div>
  </div>
  <div class="border border-gray-200 rounded-xl p-4 text-center">
    <div class="text-xs text-gray-400 mb-1">{{ "Median Price" | t }}</div>
    <div class="text-2xl font-bold text-[#c8553d]">S${{ report.median | formatPrice }}</div>
  </div>
  <div class="border border-gray-200 rounded-xl p-4 text-center">
    <div class="text-xs text-gray-400 mb-1">{{ "Max Price" | t }}</div>
    <div class="text-2xl font-bold">S${{ report.max | formatPrice }}</div>
  </div>
</div>

{# Avg price per sqm #}
<div class="border border-gray-200 rounded-xl p-4 mb-6">
  <div class="text-xs text-gray-400 mb-1">{{ "Average Price per sqm" | t }}</div>
  <div class="text-xl font-bold">S${{ report.avgPricePerSqm | formatPrice }}/sqm</div>
</div>

{# Recent transactions table #}
{% if report.recentTransactions.length > 0 %}
<div class="border border-gray-200 rounded-xl p-4 mb-6">
  <h3 class="font-bold mb-4">{{ "Recent Transactions" | t }}</h3>
  <div class="overflow-x-auto">
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-gray-200 text-left">
          <th class="py-2 pr-4">{{ "Block" | t }}</th>
          <th class="py-2 pr-4">{{ "Street" | t }}</th>
          <th class="py-2 pr-4">{{ "Storey" | t }}</th>
          <th class="py-2 pr-4">{{ "Model" | t }}</th>
          <th class="py-2 text-right">{{ "Price" | t }}</th>
        </tr>
      </thead>
      <tbody>
        {% for txn in report.recentTransactions %}
        <tr class="border-b border-gray-100">
          <td class="py-2 pr-4">{{ txn.block }}</td>
          <td class="py-2 pr-4">{{ txn.streetName }}</td>
          <td class="py-2 pr-4">{{ txn.storeyRange }}</td>
          <td class="py-2 pr-4">{{ txn.flatModel }}</td>
          <td class="py-2 text-right text-[#c8553d] font-semibold">S${{ txn.resalePrice | formatPrice }}</td>
        </tr>
        {% endfor %}
      </tbody>
    </table>
  </div>
</div>
{% endif %}

<p class="text-xs text-gray-400 text-center">
  {{ "This is an indicative range based on publicly available HDB resale data and does not constitute a formal valuation. Data source: data.gov.sg." | t }}
</p>

{% endif %}
```

- [ ] **Step 3: Commit**

```bash
git add src/views/pages/public/market-report.njk src/views/partials/public/report-results.njk
git commit -m "feat: add HDB Market Report page with HTMX search and results"
```

---

### Task 12: Create privacy policy and terms pages

**Files:**
- Create: `src/views/pages/public/privacy.njk`
- Create: `src/views/pages/public/terms.njk`

- [ ] **Step 1: Create privacy policy page**

Create `src/views/pages/public/privacy.njk`:

```njk
{% extends "layouts/public.njk" %}

{% block title %}{{ "Privacy Policy — SellMyHomeNow.sg" | t }}{% endblock %}

{% block content %}
<div class="max-w-3xl mx-auto prose prose-sm">
  <p class="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-3 mb-6">{{ "DRAFT — This is placeholder content. Please replace with lawyer-reviewed text before going live." | t }}</p>

  <h1>{{ "Privacy Policy" | t }}</h1>
  <p class="text-gray-500">{{ "Last updated: March 2026" | t }}</p>

  <h2>{{ "1. Who We Are" | t }}</h2>
  <p>{{ "SellMyHomeNow.sg is a property selling platform operated by (David) Ng Chun Fai (CEA Reg No. R011998B) under Huttons Asia Pte Ltd (CEA Licence No. L3008899K)." | t }}</p>

  <h2>{{ "2. What We Collect" | t }}</h2>
  <p>{{ "We collect the following personal data:" | t }}</p>
  <ul>
    <li>{{ "Name and mobile number (when you submit the contact form)" | t }}</li>
    <li>{{ "Email address (during account registration)" | t }}</li>
    <li>{{ "HDB property details (address, flat type, floor area)" | t }}</li>
    <li>{{ "Identity documents for compliance purposes (NRIC — only last 4 characters stored in our database; full documents encrypted at rest)" | t }}</li>
  </ul>

  <h2>{{ "3. How We Use Your Data" | t }}</h2>
  <p>{{ "Your personal data is used to:" | t }}</p>
  <ul>
    <li>{{ "Provide property selling services as requested" | t }}</li>
    <li>{{ "Generate market reports and financial estimates" | t }}</li>
    <li>{{ "Communicate service updates via WhatsApp, email, or in-app notifications" | t }}</li>
    <li>{{ "Comply with regulatory requirements (CEA, AML/CFT)" | t }}</li>
  </ul>
  <p>{{ "If you give separate marketing consent, we may also send property market updates." | t }}</p>

  <h2>{{ "4. Your Rights Under PDPA" | t }}</h2>
  <p>{{ "Under the Personal Data Protection Act 2012 (PDPA), you have the right to:" | t }}</p>
  <ul>
    <li>{{ "Access your personal data held by us" | t }}</li>
    <li>{{ "Request correction of inaccurate data" | t }}</li>
    <li>{{ "Withdraw consent for data collection and use" | t }}</li>
    <li>{{ "Request deletion of your personal data (subject to legal retention requirements)" | t }}</li>
  </ul>

  <h2>{{ "5. Data Retention" | t }}</h2>
  <p>{{ "Transaction records and compliance documents are retained for a minimum of 5 years as required by AML/CFT regulations. Other personal data is deleted upon request or when no longer needed for the purpose it was collected." | t }}</p>

  <h2>{{ "6. Third-Party Sharing" | t }}</h2>
  <p>{{ "We may share your data with:" | t }}</p>
  <ul>
    <li>{{ "Huttons Asia Pte Ltd (our agency)" | t }}</li>
    <li>{{ "HDB and relevant government agencies (as required for transactions)" | t }}</li>
    <li>{{ "Property portals (listing information only, with your consent)" | t }}</li>
  </ul>

  <h2>{{ "7. Cookies" | t }}</h2>
  <p>{{ "We use essential cookies only for session management and security. We do not use tracking or advertising cookies." | t }}</p>

  <h2>{{ "8. Contact Us" | t }}</h2>
  <p>{{ "For data protection enquiries, contact us at the details provided on the platform." | t }}</p>
</div>
{% endblock %}
```

- [ ] **Step 2: Create terms of service page**

Create `src/views/pages/public/terms.njk`:

```njk
{% extends "layouts/public.njk" %}

{% block title %}{{ "Terms of Service — SellMyHomeNow.sg" | t }}{% endblock %}

{% block content %}
<div class="max-w-3xl mx-auto prose prose-sm">
  <p class="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-3 mb-6">{{ "DRAFT — This is placeholder content. Please replace with lawyer-reviewed text before going live." | t }}</p>

  <h1>{{ "Terms of Service" | t }}</h1>
  <p class="text-gray-500">{{ "Last updated: March 2026" | t }}</p>

  <h2>{{ "1. Service Description" | t }}</h2>
  <p>{{ "SellMyHomeNow.sg provides AI-powered HDB resale property selling services for a fixed fee of $1,499 + GST ($1,633.91 total). Services include market analysis, listing creation, viewing management, and transaction guidance." | t }}</p>

  <h2>{{ "2. Engagement" | t }}</h2>
  <p>{{ "Engagement with SellMyHomeNow.sg is on a non-exclusive basis unless otherwise agreed in writing via a separate Estate Agency Agreement." | t }}</p>

  <h2>{{ "3. Payment Terms" | t }}</h2>
  <p>{{ "The fee of $1,499 + GST is payable only upon successful completion of the property sale. No upfront fees are charged. The commission invoice is issued by Huttons Asia Pte Ltd." | t }}</p>

  <h2>{{ "4. Cancellation" | t }}</h2>
  <p>{{ "You may terminate the engagement at any time by providing written notice. No fees are charged if the sale is not completed." | t }}</p>

  <h2>{{ "5. Limitation of Liability" | t }}</h2>
  <ul>
    <li>{{ "All market reports and price estimates are indicative only, based on publicly available HDB resale data, and do not constitute formal property valuations." | t }}</li>
    <li>{{ "SellMyHomeNow.sg does not provide financial, legal, or investment advice." | t }}</li>
    <li>{{ "AI-generated content is reviewed by a licensed agent before being shared with clients." | t }}</li>
  </ul>

  <h2>{{ "6. Intellectual Property" | t }}</h2>
  <p>{{ "All content, designs, and AI-generated materials on the platform are the property of SellMyHomeNow.sg and Huttons Asia Pte Ltd." | t }}</p>

  <h2>{{ "7. Governing Law" | t }}</h2>
  <p>{{ "These terms are governed by the laws of the Republic of Singapore." | t }}</p>

  <h2>{{ "8. Dispute Resolution" | t }}</h2>
  <p>{{ "Any disputes shall first be resolved through good faith negotiation. If unresolved, disputes shall be submitted to the courts of Singapore." | t }}</p>
</div>
{% endblock %}
```

- [ ] **Step 3: Commit**

```bash
git add src/views/pages/public/privacy.njk src/views/pages/public/terms.njk
git commit -m "feat: add privacy policy and terms of service pages (draft content)"
```

---

## Chunk 3: PWA, Cookie Consent & Integration Tests

### Task 13: Add PWA support

**Files:**
- Create: `public/manifest.json`
- Create: `public/sw.js`
- Create: `public/offline.html`
- Create: `public/icons/icon-192.svg`
- Create: `public/icons/icon-512.svg`
- Modify: `src/views/layouts/base.njk`

- [ ] **Step 1: Create manifest.json**

Create `public/manifest.json`:

```json
{
  "name": "SellMyHomeNow.sg",
  "short_name": "SellMyHome",
  "description": "Sell your HDB for $1,499 — AI-powered, full agent guidance",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#fafaf7",
  "theme_color": "#1a1a2e",
  "orientation": "any",
  "icons": [
    { "src": "/icons/icon-192.svg", "sizes": "192x192", "type": "image/svg+xml" },
    { "src": "/icons/icon-512.svg", "sizes": "512x512", "type": "image/svg+xml" },
    { "src": "/icons/icon-512.svg", "sizes": "512x512", "type": "image/svg+xml", "purpose": "maskable" }
  ]
}
```

- [ ] **Step 2: Create service worker**

Create `public/sw.js`:

```javascript
const CACHE_NAME = 'smhn-v1';
const PRECACHE_URLS = [
  '/',
  '/market-report',
  '/offline.html',
  '/css/output.css',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
];

// Install — precache critical assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — network first, cache fallback
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip API requests and authenticated pages
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') ||
      url.pathname.startsWith('/seller/') || url.pathname.startsWith('/agent/') ||
      url.pathname.startsWith('/admin/')) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache successful responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || caches.match('/offline.html'))
      )
  );
});
```

- [ ] **Step 3: Create offline fallback page**

Create `public/offline.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Offline — SellMyHomeNow.sg</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #fafaf7; color: #1a1a2e; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; text-align: center; padding: 20px; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    p { color: #666; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div>
    <h1>You're offline</h1>
    <p>Please check your connection. Your data is safe — we'll sync when you're back online.</p>
  </div>
</body>
</html>
```

- [ ] **Step 4: Create placeholder SVG icons**

Create `public/icons/icon-192.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192">
  <rect width="192" height="192" rx="24" fill="#1a1a2e"/>
  <text x="96" y="110" text-anchor="middle" font-family="system-ui,sans-serif" font-size="64" font-weight="bold" fill="#c8553d">SMH</text>
</svg>
```

Create `public/icons/icon-512.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="64" fill="#1a1a2e"/>
  <text x="256" y="290" text-anchor="middle" font-family="system-ui,sans-serif" font-size="170" font-weight="bold" fill="#c8553d">SMH</text>
</svg>
```

- [ ] **Step 5: Update base.njk with PWA meta tags**

Add to the `<head>` section of `src/views/layouts/base.njk` before the `{% block head %}`:

```njk
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#1a1a2e">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="apple-touch-icon" href="/icons/icon-192.svg">
```

Add before `</body>` (before `{% block scripts %}`):

```njk
<script>
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
  }
</script>
```

- [ ] **Step 6: Commit**

```bash
git add public/manifest.json public/sw.js public/offline.html public/icons/ src/views/layouts/base.njk
git commit -m "feat: add PWA support with manifest, service worker, and offline fallback"
```

---

### Task 14: Add cookie consent banner

**Files:**
- Create: `src/views/partials/cookie-consent.njk`
- Modify: `src/views/layouts/base.njk`

- [ ] **Step 1: Create cookie consent partial**

Create `src/views/partials/cookie-consent.njk`:

```njk
<div id="cookie-banner" class="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 shadow-lg p-4 z-50 hidden">
  <div class="max-w-7xl mx-auto flex items-center justify-between gap-4">
    <p class="text-sm text-gray-600">{{ "This site uses essential cookies only for session management and security." | t }}</p>
    <button onclick="document.getElementById('cookie-banner').remove(); localStorage.setItem('cookieConsent','ok')" class="bg-[#1a1a2e] text-white px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-[#2d2d4a] flex-shrink-0">{{ "OK" | t }}</button>
  </div>
</div>
<script>
  if (!localStorage.getItem('cookieConsent')) {
    document.getElementById('cookie-banner').classList.remove('hidden');
  }
</script>
```

- [ ] **Step 2: Include in base.njk**

Add before the service worker script in `src/views/layouts/base.njk`:

```njk
{% include "partials/cookie-consent.njk" %}
```

- [ ] **Step 3: Commit**

```bash
git add src/views/partials/cookie-consent.njk src/views/layouts/base.njk
git commit -m "feat: add cookie consent banner with localStorage dismissal"
```

---

### Task 15: Integration tests for public routes

**Files:**
- Create: `tests/integration/public.test.ts`

- [ ] **Step 1: Write integration tests**

Create `tests/integration/public.test.ts`:

```typescript
import request from 'supertest';
import { createApp } from '../../src/infra/http/app';

const app = createApp();

describe('Public routes', () => {
  describe('GET /', () => {
    it('returns 200 with homepage', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.text).toContain('SellMyHomeNow');
    });
  });

  describe('GET /market-report', () => {
    it('returns 200 with market report page', async () => {
      const res = await request(app).get('/market-report');
      expect(res.status).toBe(200);
      expect(res.text).toContain('HDB Market Report');
    });
  });

  describe('GET /privacy', () => {
    it('returns 200 with privacy policy', async () => {
      const res = await request(app).get('/privacy');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Privacy Policy');
    });
  });

  describe('GET /terms', () => {
    it('returns 200 with terms of service', async () => {
      const res = await request(app).get('/terms');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Terms of Service');
    });
  });

  describe('GET /manifest.json', () => {
    it('returns valid PWA manifest', async () => {
      const res = await request(app).get('/manifest.json');
      expect(res.status).toBe(200);
      const manifest = JSON.parse(res.text);
      expect(manifest.name).toBe('SellMyHomeNow.sg');
      expect(manifest.start_url).toBe('/');
      expect(manifest.display).toBe('standalone');
    });
  });

  describe('GET /api/hdb/report', () => {
    it('returns report data for known town/type', async () => {
      const res = await request(app)
        .get('/api/hdb/report?town=ANG+MO+KIO&flatType=4+ROOM&months=24');
      // May return 200 with empty report if no data in test DB
      expect(res.status).toBe(200);
    });

    it('handles unknown town gracefully', async () => {
      const res = await request(app)
        .get('/api/hdb/report?town=NONEXISTENT&flatType=4+ROOM&months=24');
      expect(res.status).toBe(200);
    });

    it('requires town and flatType parameters', async () => {
      const res = await request(app).get('/api/hdb/report');
      expect(res.status).toBe(400);
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm run test:integration`
Expected: All public route tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/public.test.ts
git commit -m "test: add integration tests for public routes and PWA manifest"
```

---

### Task 16: Integration tests for lead capture

**Files:**
- Create: `tests/integration/lead.test.ts`

- [ ] **Step 1: Write integration tests**

Create `tests/integration/lead.test.ts`:

```typescript
import request from 'supertest';
import { createApp } from '../../src/infra/http/app';
import { testPrisma, cleanDatabase } from '../helpers/prisma';

const app = createApp();

describe('POST /api/leads', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await cleanDatabase();
    await testPrisma.$disconnect();
  });

  it('creates a lead with valid input and service consent', async () => {
    const res = await request(app).post('/api/leads').type('form').send({
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
    const res = await request(app).post('/api/leads').type('form').send({
      name: 'Jane Lim',
      phone: '81234567',
      consentService: 'false',
      formLoadedAt: (Date.now() - 10000).toString(),
    });

    expect(res.status).toBe(400);
  });

  it('rejects duplicate phone number', async () => {
    // Create first lead
    await request(app).post('/api/leads').type('form').send({
      name: 'John Tan',
      phone: '91234567',
      consentService: 'true',
      formLoadedAt: (Date.now() - 10000).toString(),
    });

    // Attempt duplicate
    const res = await request(app).post('/api/leads').type('form').send({
      name: 'Another Person',
      phone: '91234567',
      consentService: 'true',
      formLoadedAt: (Date.now() - 10000).toString(),
    });

    expect(res.status).toBe(409);
  });

  it('rejects invalid phone format', async () => {
    const res = await request(app).post('/api/leads').type('form').send({
      name: 'John Tan',
      phone: '61234567',
      consentService: 'true',
      formLoadedAt: (Date.now() - 10000).toString(),
    });

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `npm run test:integration`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/lead.test.ts
git commit -m "test: add integration tests for lead capture API"
```

---

### Task 17: Run full test suite and lint

**Files:** None — verification only.

- [ ] **Step 1: Run unit tests**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 2: Run integration tests**

Run: `npm run test:integration`
Expected: All tests PASS

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 4: Run format check**

Run: `npm run format:check`
If issues: `npx prettier --write "src/**/*.ts" "tests/**/*.ts"`

- [ ] **Step 5: Final commit if formatting was needed**

```bash
git add -A
git commit -m "style: format new files with Prettier"
```
