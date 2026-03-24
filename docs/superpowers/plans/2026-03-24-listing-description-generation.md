# Listing Description Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agents can generate AI-powered listing descriptions from the seller-detail page, edit the draft, and approve through the existing review queue.

**Architecture:** New prompt builder reads a template from `SystemSetting`, calls `ai.facade.generateText`, saves to `listing.aiDescription` + `listing.description` (staging copy for review queue). Two new service functions in `property.service.ts`, two new repo functions in `property.repository.ts`, two new routes in `portal.router.ts`. Existing review approval extended to accept optional edited text.

**Tech Stack:** TypeScript, Express, Prisma, Nunjucks, HTMX, express-rate-limit

**Spec:** `docs/superpowers/specs/2026-03-24-listing-description-generation-design.md`

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/domains/shared/settings.types.ts` | Modify | Add `LISTING_DESCRIPTION_PROMPT` to `SETTING_KEYS` |
| `src/domains/admin/admin.validator.ts` | Modify | Add validator for `listing_description_prompt`; add `'textarea'` to `inputType` |
| `src/domains/admin/admin.types.ts` | Modify | Add `'textarea'` to `SettingWithMeta.inputType` union |
| `src/domains/admin/admin.service.ts` | Modify | Add setting to AI group; support `'textarea'` inputType in `getSettingsGrouped` |
| `src/views/pages/admin/settings.njk` | Modify | Render `<textarea>` for `inputType == 'textarea'` |
| `prisma/migrations/20260324100000_add_listing_description_prompt/migration.sql` | Create | Insert default prompt into `system_settings` |
| `src/infra/http/middleware/error-handler.ts` | Modify | Add `AIUnavailableError` → 502 branch before `AppError` branch |
| `src/domains/shared/ai/prompts/listing-description.ts` | Create | `buildListingDescriptionPrompt(template, property)` |
| `src/domains/shared/ai/prompts/__tests__/listing-description.test.ts` | Create | Unit tests for prompt builder |
| `src/domains/property/property.repository.ts` | Modify | Add `saveAiDescription`, `updateDescriptionDraft`, `findListingForDescriptionGeneration`, `findListingCardData` |
| `src/domains/property/property.service.ts` | Modify | Add `generateListingDescription`, `saveDescriptionDraft` |
| `src/domains/property/__tests__/property.service.test.ts` | Modify | Unit tests for new service functions |
| `src/infra/http/middleware/rate-limit.ts` | Modify | Add `descriptionGenerateLimiter` (10/hr per agent) |
| `src/domains/property/portal.router.ts` | Modify | Add `POST .../description/generate` and `.../description/draft` routes |
| `src/domains/review/review.validator.ts` | Modify | Add `validateApproveDescriptionBody` |
| `src/domains/review/review.service.ts` | Modify | Extend `approveItem` input with optional `text?` |
| `src/domains/review/__tests__/review.service.test.ts` | Modify | Tests for extended `approveItem` |
| `src/domains/review/review.router.ts` | Modify | Pass `req.body.text` + `validateApproveDescriptionBody` to approve route |
| `src/domains/agent/agent.service.ts` | Modify | Add `aiDescription` + `description` to listing object in `getSellerDetail` |
| `src/views/partials/agent/seller-listing-card.njk` | Modify | Four-state description UI + `id` on card div for HTMX targeting |
| `src/views/partials/agent/review-detail-listing-desc.njk` | Modify | Editable textarea + "Save + Approve" button |
| `src/domains/property/__tests__/property.integration.test.ts` | Create | Integration tests covering the 7 spec scenarios |

---

## Task 1: Settings infrastructure

Wire in the new `listing_description_prompt` setting end-to-end: type safety, validation, admin UI, and database seed.

**Files:**
- Modify: `src/domains/shared/settings.types.ts`
- Modify: `src/domains/admin/admin.validator.ts`
- Modify: `src/domains/admin/admin.types.ts`
- Modify: `src/domains/admin/admin.service.ts`
- Modify: `src/views/pages/admin/settings.njk`
- Create: `prisma/migrations/20260324100000_add_listing_description_prompt/migration.sql`

- [ ] **Step 1: Add key to SETTING_KEYS**

In `src/domains/shared/settings.types.ts`, add to the `SETTING_KEYS` object:
```typescript
LISTING_DESCRIPTION_PROMPT: 'listing_description_prompt',
```

- [ ] **Step 2: Add validator to SETTING_VALIDATORS**

`SETTING_VALIDATORS` is `Record<SettingKey, ...>` — adding to `SETTING_KEYS` causes a TS compile error until a validator is added. In `src/domains/admin/admin.validator.ts`:
```typescript
listing_description_prompt: (v) => v.trim().length > 0,
```

- [ ] **Step 3: Add `'textarea'` inputType to admin types**

In `src/domains/admin/admin.types.ts`, change:
```typescript
inputType: 'text' | 'cron';
```
to:
```typescript
inputType: 'text' | 'cron' | 'textarea';
```

- [ ] **Step 4: Add setting to AI group + textarea support in getSettingsGrouped**

In `src/domains/admin/admin.service.ts`:

Add `'listing_description_prompt'` to the `CRON_KEYS` equivalent — create a `TEXTAREA_KEYS` set:
```typescript
const TEXTAREA_KEYS = new Set(['listing_description_prompt']);
```

Update the `inputType` assignment in `group()`:
```typescript
inputType: CRON_KEYS.has(k) ? 'cron' : TEXTAREA_KEYS.has(k) ? 'textarea' : 'text',
```

Add `'listing_description_prompt'` to the `'AI'` group:
```typescript
group('AI', ['ai_provider', 'ai_model', 'ai_max_tokens', 'ai_temperature', 'listing_description_prompt']),
```

- [ ] **Step 5: Update settings.njk to render textarea**

In `src/views/pages/admin/settings.njk`, update the form block to handle `inputType == 'textarea'`:
```njk
{% if setting.inputType == 'cron' %}
  {% include "partials/admin/cron-picker.njk" %}
{% elif setting.inputType == 'textarea' %}
  <div class="flex flex-col items-start gap-2 w-full">
    <textarea name="value" rows="10"
      class="border rounded px-2 py-1 text-sm w-full font-mono text-xs"
    >{{ setting.value }}</textarea>
    <div class="text-xs text-gray-400">
      {{ "Placeholders:" | t }} {flatType} {town} {block} {street} {floorAreaSqm} {storey} {leaseCommencementDate}
    </div>
    <button type="submit" class="bg-indigo-600 text-white px-3 py-1 rounded text-sm hover:bg-indigo-700">{{ "Save" | t }}</button>
  </div>
{% else %}
  <input type="text" name="value" value="{{ setting.value }}" class="border rounded px-2 py-1 text-sm w-48" />
  <button type="submit" class="bg-indigo-600 text-white px-3 py-1 rounded text-sm hover:bg-indigo-700">{{ "Save" | t }}</button>
{% endif %}
```

Also update the form class to handle textarea layout:
```njk
class="{{ 'flex flex-col items-start gap-2' if setting.inputType == 'cron' or setting.inputType == 'textarea' else 'flex items-center gap-2' }}"
```

- [ ] **Step 6: Create migration to seed default prompt**

Create directory `prisma/migrations/20260324100000_add_listing_description_prompt/` and file `migration.sql`:

```sql
INSERT INTO system_settings (id, key, value, description, updated_at, created_at)
VALUES (
  gen_random_uuid(),
  'listing_description_prompt',
  'You are writing a property listing description for a Singapore HDB flat.
Write 2–3 short paragraphs suitable for PropertyGuru, 99.co, and SRX.
Be factual. Do not make claims you cannot verify from the data provided.
Do not mention price. Do not use superlatives like "rare" or "must-see".
Include a standard disclaimer: "Information is provided for reference only."

Property details:
- Flat type: {flatType}
- Town: {town}
- Address: Blk {block} {street}
- Floor area: {floorAreaSqm} sqm
- Storey: {storey}
- Lease commenced: {leaseCommencementDate}',
  'AI prompt template for generating listing descriptions. Available placeholders: {flatType} {town} {block} {street} {floorAreaSqm} {storey} {leaseCommencementDate}',
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 7: Apply migration**

```bash
npx prisma migrate deploy
npx prisma generate
```

Expected: migration applied, no errors.

- [ ] **Step 8: Run tests to confirm no breakage**

```bash
npm test -- --testPathPattern="admin"
```

Expected: all admin tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/domains/shared/settings.types.ts \
        src/domains/admin/admin.validator.ts \
        src/domains/admin/admin.types.ts \
        src/domains/admin/admin.service.ts \
        src/views/pages/admin/settings.njk \
        prisma/migrations/20260324100000_add_listing_description_prompt/
git commit -m "feat: add listing_description_prompt system setting with textarea UI"
```

---

## Task 2: AIUnavailableError handler

`AIUnavailableError` extends plain `Error` (not `AppError`) so it currently falls through to the generic 500 handler. Add a dedicated 502 branch.

**Files:**
- Modify: `src/infra/http/middleware/error-handler.ts`

- [ ] **Step 1: Import AIUnavailableError**

At the top of `src/infra/http/middleware/error-handler.ts`, add:
```typescript
import { AIUnavailableError } from '../../../domains/shared/ai/ai.facade';
```

- [ ] **Step 2: Add 502 branch before the AppError branch**

Insert before the existing `if (err instanceof AppError)` block:
```typescript
if (err instanceof AIUnavailableError) {
  logger.warn({ err, path: req.path }, 'AIUnavailableError: all providers failed');
  if (req.headers['hx-request']) {
    return res.status(502).render('partials/error-message', {
      message: 'AI service is temporarily unavailable. Please try again.',
    });
  }
  return res.status(502).json({
    error: { code: 'AI_UNAVAILABLE', message: 'AI service is temporarily unavailable. Please try again.' },
  });
}
```

- [ ] **Step 3: Run tests**

```bash
npm test -- --testPathPattern="error-handler"
```

Expected: all pass (or no existing error-handler tests — that is fine).

- [ ] **Step 4: Commit**

```bash
git add src/infra/http/middleware/error-handler.ts
git commit -m "feat: handle AIUnavailableError as 502 in error handler"
```

---

## Task 3: Prompt builder

Build and test the `buildListingDescriptionPrompt` function.

**Files:**
- Create: `src/domains/shared/ai/prompts/listing-description.ts`
- Create: `src/domains/shared/ai/prompts/__tests__/listing-description.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/domains/shared/ai/prompts/__tests__/listing-description.test.ts`:

```typescript
import { buildListingDescriptionPrompt } from '../listing-description';
import { ValidationError } from '../../../../domains/shared/errors';

const property = {
  flatType: '4 ROOM',
  town: 'ANG MO KIO',
  block: '123',
  street: 'Ang Mo Kio Ave 3',
  floorAreaSqm: 90,
  storey: '04',
  leaseCommencementDate: 1990,
};

const template =
  'Flat: {flatType}, Town: {town}, Blk {block} {street}, {floorAreaSqm}sqm, Storey {storey}, Lease {leaseCommencementDate}';

describe('buildListingDescriptionPrompt', () => {
  it('substitutes all placeholders', () => {
    const result = buildListingDescriptionPrompt(template, property);
    expect(result).toBe(
      'Flat: 4 ROOM, Town: ANG MO KIO, Blk 123 Ang Mo Kio Ave 3, 90sqm, Storey 04, Lease 1990',
    );
  });

  it('throws ValidationError when template is empty', () => {
    expect(() => buildListingDescriptionPrompt('', property)).toThrow(ValidationError);
  });

  it('throws ValidationError when template is blank whitespace', () => {
    expect(() => buildListingDescriptionPrompt('   ', property)).toThrow(ValidationError);
  });

  it('leaves unknown placeholders intact', () => {
    const result = buildListingDescriptionPrompt('Hello {unknown}', property);
    expect(result).toBe('Hello {unknown}');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern="listing-description"
```

Expected: FAIL — `buildListingDescriptionPrompt` not found.

- [ ] **Step 3: Implement the prompt builder**

Create `src/domains/shared/ai/prompts/listing-description.ts`:

```typescript
import { ValidationError } from '../../../domains/shared/errors';

export interface ListingDescriptionPropertyFields {
  flatType: string;
  town: string;
  block: string;
  street: string;
  floorAreaSqm: number;
  storey: string;      // maps to Property.level
  leaseCommencementDate: number;
}

export function buildListingDescriptionPrompt(
  template: string,
  property: ListingDescriptionPropertyFields,
): string {
  if (!template || !template.trim()) {
    throw new ValidationError(
      'Listing description prompt is not configured — update it in Settings',
    );
  }

  return template
    .replace(/{flatType}/g, property.flatType)
    .replace(/{town}/g, property.town)
    .replace(/{block}/g, property.block)
    .replace(/{street}/g, property.street)
    .replace(/{floorAreaSqm}/g, String(property.floorAreaSqm))
    .replace(/{storey}/g, property.storey)
    .replace(/{leaseCommencementDate}/g, String(property.leaseCommencementDate));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="listing-description"
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/domains/shared/ai/prompts/listing-description.ts \
        src/domains/shared/ai/prompts/__tests__/listing-description.test.ts
git commit -m "feat: add listing description prompt builder"
```

---

## Task 4: Repository functions

Add three new functions to `property.repository.ts`. The repository uses the `export const propertyRepository = { ... }` object pattern — add new methods inside the same object.

**Files:**
- Modify: `src/domains/property/property.repository.ts`

- [ ] **Step 1: Add imports**

At the top of `property.repository.ts`, ensure `AiDescriptionStatus` is imported from `@prisma/client`:
```typescript
import type { AiDescriptionStatus } from '@prisma/client';
```
(Add to the existing `import { $Enums } from '@prisma/client'` line if needed, or add a separate type import.)

- [ ] **Step 2: Add `saveAiDescription`**

Inside the `propertyRepository` object, add after the last listing function:
```typescript
async saveAiDescription(
  listingId: string,
  data: {
    aiDescription: string;
    aiDescriptionStatus: AiDescriptionStatus;
    aiDescriptionProvider: string;
    aiDescriptionModel: string;
    aiDescriptionGeneratedAt: Date;
    description: string;
    descriptionApprovedAt: null;
  },
) {
  return prisma.listing.update({
    where: { id: listingId },
    data,
  });
},
```

- [ ] **Step 3: Add `updateDescriptionDraft`**

```typescript
async updateDescriptionDraft(listingId: string, text: string) {
  return prisma.listing.update({
    where: { id: listingId },
    data: {
      aiDescription: text,
      description: text,
    },
  });
},
```

- [ ] **Step 4: Add `findListingForDescriptionGeneration`**

This fetches the property fields needed to build the prompt, plus the seller's agentId for ownership check:
```typescript
async findListingForDescriptionGeneration(listingId: string) {
  return prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      property: {
        select: {
          flatType: true,
          town: true,
          block: true,
          street: true,
          floorAreaSqm: true,
          level: true,             // mapped to 'storey' in the prompt
          leaseCommenceDate: true,
          seller: { select: { agentId: true } },
        },
      },
    },
  });
},
```

- [ ] **Step 5: Add `findListingCardData`**

This is what the generate route uses to re-fetch the listing to render the updated card partial after generation. Note: the spec's return type lists `photoCount` and `portalsPostedCount` as computed fields, but Prisma cannot compute `photoCount` from a JSON column inline. The repo returns `photos` (raw JSON string) and `portalListings` (array); the route handler in Task 6 computes both values.

```typescript
async findListingCardData(listingId: string) {
  return prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      status: true,
      photosApprovedAt: true,
      photos: true,            // JSON string; route computes photoCount from this
      descriptionApprovedAt: true,
      aiDescription: true,
      description: true,
      portalListings: { select: { status: true } },  // route counts posted ones for portalsPostedCount
      property: {
        select: {
          seller: { select: { agentId: true } },
        },
      },
    },
  });
},
```

- [ ] **Step 6: Run full test suite to confirm no breakage**

```bash
npm test -- --testPathPattern="property"
```

Expected: all property tests pass (no new tests needed for pure Prisma wrappers).

- [ ] **Step 7: Commit**

```bash
git add src/domains/property/property.repository.ts
git commit -m "feat: add saveAiDescription, updateDescriptionDraft, findListingCardData to property repo"
```

---

## Task 5: Service functions — generateListingDescription and saveDescriptionDraft

**Files:**
- Modify: `src/domains/property/property.service.ts`
- Modify: `src/domains/property/__tests__/property.service.test.ts`

- [ ] **Step 1: Write failing unit tests**

In `src/domains/property/__tests__/property.service.test.ts`, add a new `describe` block. The test file already mocks `'../property.repository'` and `'../../shared/audit.service'`. Add mocks for the AI facade and settings service:

```typescript
jest.mock('@/domains/shared/ai/ai.facade', () => ({
  generateText: jest.fn(),
  AIUnavailableError: class AIUnavailableError extends Error {},
}));
jest.mock('@/domains/shared/settings.service');
```

Add these imports at the top:
```typescript
import * as aiFacade from '@/domains/shared/ai/ai.facade';
import * as settingsService from '@/domains/shared/settings.service';
```

Then add the test block:

```typescript
describe('generateListingDescription', () => {
  const listingId = 'listing-1';
  const agentId = 'agent-1';

  const fakeListing = {
    id: listingId,
    property: {
      flatType: '4 ROOM',
      town: 'ANG MO KIO',
      block: '123',
      street: 'Ang Mo Kio Ave 3',
      floorAreaSqm: 90,
      level: '04',
      leaseCommenceDate: 1990,
      seller: { agentId },
    },
  };

  const fakeTemplate = 'Type: {flatType}, Town: {town}, {block} {street}, {floorAreaSqm}sqm, {storey}, {leaseCommencementDate}';

  beforeEach(() => {
    mockedRepo.findListingForDescriptionGeneration.mockResolvedValue(fakeListing as never);
    jest.mocked(settingsService.get).mockResolvedValue(fakeTemplate);
    jest.mocked(aiFacade.generateText).mockResolvedValue({
      text: 'Generated description text.',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      tokensUsed: 100,
    });
    mockedRepo.saveAiDescription.mockResolvedValue({} as never);
  });

  it('calls generateText and saves all aiDescription fields plus staging description', async () => {
    await propertyService.generateListingDescription(listingId, agentId, 'agent');

    expect(aiFacade.generateText).toHaveBeenCalledWith(
      expect.stringContaining('4 ROOM'),
    );
    expect(mockedRepo.saveAiDescription).toHaveBeenCalledWith(listingId, {
      aiDescription: 'Generated description text.',
      aiDescriptionStatus: 'ai_generated',
      aiDescriptionProvider: 'anthropic',
      aiDescriptionModel: 'claude-sonnet-4-6',
      aiDescriptionGeneratedAt: expect.any(Date),
      description: 'Generated description text.',
      descriptionApprovedAt: null,
    });
    expect(mockedAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'listing.description_generated' }),
    );
  });

  it('throws ValidationError when prompt setting is empty', async () => {
    jest.mocked(settingsService.get).mockResolvedValue('');
    await expect(
      propertyService.generateListingDescription(listingId, agentId, 'agent'),
    ).rejects.toThrow(ValidationError);
  });

  it('throws ForbiddenError when agent is not assigned', async () => {
    mockedRepo.findListingForDescriptionGeneration.mockResolvedValue({
      ...fakeListing,
      property: { ...fakeListing.property, seller: { agentId: 'other-agent' } },
    } as never);
    await expect(
      propertyService.generateListingDescription(listingId, agentId, 'agent'),
    ).rejects.toThrow(ForbiddenError);
  });

  it('admin bypasses ownership check', async () => {
    mockedRepo.findListingForDescriptionGeneration.mockResolvedValue({
      ...fakeListing,
      property: { ...fakeListing.property, seller: { agentId: 'other-agent' } },
    } as never);
    await expect(
      propertyService.generateListingDescription(listingId, agentId, 'admin'),
    ).resolves.not.toThrow();
  });

  it('always sets descriptionApprovedAt to null (handles regeneration after approval)', async () => {
    await propertyService.generateListingDescription(listingId, agentId, 'agent');
    expect(mockedRepo.saveAiDescription).toHaveBeenCalledWith(
      listingId,
      expect.objectContaining({ descriptionApprovedAt: null }),
    );
  });

  it('throws NotFoundError when listing does not exist', async () => {
    mockedRepo.findListingForDescriptionGeneration.mockResolvedValue(null);
    await expect(
      propertyService.generateListingDescription(listingId, agentId, 'agent'),
    ).rejects.toThrow(NotFoundError);
  });

  it('propagates AIUnavailableError (does not swallow it)', async () => {
    const { AIUnavailableError } = jest.requireMock('@/domains/shared/ai/ai.facade') as {
      AIUnavailableError: new (msg: string) => Error;
    };
    jest.mocked(aiFacade.generateText).mockRejectedValue(new AIUnavailableError('all providers failed'));
    await expect(
      propertyService.generateListingDescription(listingId, agentId, 'agent'),
    ).rejects.toThrow('all providers failed');
  });
});

describe('saveDescriptionDraft', () => {
  const listingId = 'listing-1';
  const agentId = 'agent-1';

  beforeEach(() => {
    mockedRepo.findListingForDescriptionGeneration.mockResolvedValue({
      id: listingId,
      property: { seller: { agentId } },
    } as never);
    mockedRepo.updateDescriptionDraft.mockResolvedValue({} as never);
  });

  it('updates aiDescription and description via repo', async () => {
    await propertyService.saveDescriptionDraft(listingId, 'Edited text.', agentId, 'agent');
    expect(mockedRepo.updateDescriptionDraft).toHaveBeenCalledWith(listingId, 'Edited text.');
    expect(mockedAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'listing.description_draft_saved' }),
    );
  });

  it('throws ForbiddenError when agent is not assigned', async () => {
    mockedRepo.findListingForDescriptionGeneration.mockResolvedValue({
      id: listingId,
      property: { seller: { agentId: 'other-agent' } },
    } as never);
    await expect(
      propertyService.saveDescriptionDraft(listingId, 'text', agentId, 'agent'),
    ).rejects.toThrow(ForbiddenError);
  });

  it('treats undefined callerRole as agent (conservative default)', async () => {
    mockedRepo.findListingForDescriptionGeneration.mockResolvedValue({
      id: listingId,
      property: { seller: { agentId: 'other-agent' } },
    } as never);
    await expect(
      propertyService.saveDescriptionDraft(listingId, 'text', agentId, undefined as never),
    ).rejects.toThrow(ForbiddenError);
  });

  it('throws NotFoundError when listing does not exist', async () => {
    mockedRepo.findListingForDescriptionGeneration.mockResolvedValue(null);
    await expect(
      propertyService.saveDescriptionDraft(listingId, 'text', agentId, 'agent'),
    ).rejects.toThrow(NotFoundError);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPattern="property.service"
```

Expected: FAIL — `generateListingDescription` not found.

- [ ] **Step 3: Implement the service functions**

Add these imports to `src/domains/property/property.service.ts`:
```typescript
import * as settingsService from '@/domains/shared/settings.service';
import * as aiFacade from '@/domains/shared/ai/ai.facade';
import { buildListingDescriptionPrompt } from '@/domains/shared/ai/prompts/listing-description';
```

Add at the bottom of `property.service.ts`:

```typescript
export async function generateListingDescription(
  listingId: string,
  agentId: string,
  callerRole: string,
): Promise<void> {
  const listing = await propertyRepo.findListingForDescriptionGeneration(listingId);
  if (!listing) throw new NotFoundError('Listing', listingId);

  if (callerRole !== 'admin') {
    const assignedAgentId = listing.property?.seller?.agentId ?? null;
    if (assignedAgentId !== agentId) {
      throw new ForbiddenError('You are not authorised to generate a description for this listing');
    }
  }

  const template = await settingsService.get('listing_description_prompt');
  // buildListingDescriptionPrompt throws ValidationError if template is empty
  const prompt = buildListingDescriptionPrompt(template, {
    flatType: listing.property.flatType,
    town: listing.property.town,
    block: listing.property.block,
    street: listing.property.street,
    floorAreaSqm: listing.property.floorAreaSqm,
    storey: listing.property.level,
    leaseCommencementDate: listing.property.leaseCommenceDate,
  });

  const result = await aiFacade.generateText(prompt);

  await propertyRepo.saveAiDescription(listingId, {
    aiDescription: result.text,
    aiDescriptionStatus: 'ai_generated',
    aiDescriptionProvider: result.provider,
    aiDescriptionModel: result.model,
    aiDescriptionGeneratedAt: new Date(),
    description: result.text,
    descriptionApprovedAt: null,
  });

  await auditService.log({
    agentId,
    action: 'listing.description_generated',
    entityType: 'listing',
    entityId: listingId,
    details: { provider: result.provider, model: result.model },
  });
}

export async function saveDescriptionDraft(
  listingId: string,
  text: string,
  agentId: string,
  callerRole: string,
): Promise<void> {
  const listing = await propertyRepo.findListingForDescriptionGeneration(listingId);
  if (!listing) throw new NotFoundError('Listing', listingId);

  const effectiveRole = callerRole ?? 'agent';
  if (effectiveRole !== 'admin') {
    const assignedAgentId = listing.property?.seller?.agentId ?? null;
    if (assignedAgentId !== agentId) {
      throw new ForbiddenError('You are not authorised to edit this listing description');
    }
  }

  await propertyRepo.updateDescriptionDraft(listingId, text);

  await auditService.log({
    agentId,
    action: 'listing.description_draft_saved',
    entityType: 'listing',
    entityId: listingId,
    details: {},
  });
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --testPathPattern="property.service"
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/domains/property/property.service.ts \
        src/domains/property/__tests__/property.service.test.ts
git commit -m "feat: add generateListingDescription and saveDescriptionDraft service functions"
```

---

## Task 6: Rate limiter + generate/draft routes

**Files:**
- Modify: `src/infra/http/middleware/rate-limit.ts`
- Modify: `src/domains/property/portal.router.ts`

- [ ] **Step 1: Add descriptionGenerateLimiter**

In `src/infra/http/middleware/rate-limit.ts`, add:
```typescript
export const descriptionGenerateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 generations per agent per hour
  keyGenerator: (req) =>
    (req.user as { id?: string } | undefined)?.id ?? ipKeyGenerator(req.ip ?? ''),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: 'RATE_LIMITED', message: 'Too many description generation requests. Please try again later.' },
  },
  skip: () => process.env.NODE_ENV === 'test',
});
```

- [ ] **Step 2: Add routes to portal.router.ts**

In `src/domains/property/portal.router.ts`, add these imports:
```typescript
import * as propertyService from './property.service';
import { descriptionGenerateLimiter } from '@/infra/http/middleware/rate-limit';
```

Add after the existing routes:

```typescript
// POST /agent/listings/:listingId/description/generate
portalRouter.post(
  '/agent/listings/:listingId/description/generate',
  ...agentAuth,
  descriptionGenerateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const { listingId } = req.params as { listingId: string };

      await propertyService.generateListingDescription(listingId, user.id, user.role);

      const listingData = await propertyRepo.findListingCardData(listingId);
      if (!listingData) return res.status(404).end();

      const photoCount = (() => {
        if (!listingData.photos) return null;
        try {
          const p = JSON.parse(listingData.photos as string);
          return Array.isArray(p) ? p.length : null;
        } catch { return null; }
      })();

      const listing = {
        id: listingData.id,
        status: listingData.status,
        photosApprovedAt: listingData.photosApprovedAt,
        photoCount,
        descriptionApprovedAt: listingData.descriptionApprovedAt,
        aiDescription: listingData.aiDescription,
        description: listingData.description,
        portalsPostedCount: listingData.portalListings.filter((pl) => pl.status === 'posted').length,
      };

      res.render('partials/agent/seller-listing-card.njk', { seller: { property: { listing } } });
    } catch (err) {
      next(err);
    }
  },
);

// POST /agent/listings/:listingId/description/draft
portalRouter.post(
  '/agent/listings/:listingId/description/draft',
  ...agentAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AuthenticatedUser;
      const { listingId } = req.params as { listingId: string };
      const text = req.body.text as string;

      if (!text || !text.trim()) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'text is required' } });
      }

      await propertyService.saveDescriptionDraft(listingId, text, user.id, user.role);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
```

Note: `findListingCardData` was added to `property.repository.ts` in Task 4. Import it via `propertyRepo`:

```typescript
import * as propertyRepo from './property.repository';
```

(The file already imports `portalRepo` from `./portal.repository` for other portal-specific functions — keep both. `findListingCardData` returns raw `photos` (JSON string) and `portalListings` (array) which the route handler transforms into `photoCount` and `portalsPostedCount` as shown above.)

- [ ] **Step 3: Run tests**

```bash
npm test -- --testPathPattern="portal.router"
```

Expected: all pass (existing tests unaffected).

- [ ] **Step 4: Commit**

```bash
git add src/infra/http/middleware/rate-limit.ts \
        src/domains/property/portal.router.ts
git commit -m "feat: add description generate/draft routes with rate limiting"
```

---

## Task 7: Extend review service and router for optional text on approve

**Files:**
- Modify: `src/domains/review/review.validator.ts`
- Modify: `src/domains/review/review.service.ts`
- Modify: `src/domains/review/__tests__/review.service.test.ts`
- Modify: `src/domains/review/review.router.ts`

- [ ] **Step 1: Add validateApproveDescriptionBody to review.validator.ts**

```typescript
export const validateApproveDescriptionBody = [
  body('text')
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage('text must be a non-empty string if provided'),
];
```

- [ ] **Step 2: Write failing tests for extended approveItem**

In `src/domains/review/__tests__/review.service.test.ts`, add a mock for `propertyService` and new test cases:

```typescript
jest.mock('@/domains/property/property.service', () => ({
  saveDescriptionDraft: jest.fn(),
}));
import * as propertyService from '@/domains/property/property.service';
```

Then add tests in the existing `approveItem` describe block:

```typescript
describe('approveItem — listing_description with optional text', () => {
  beforeEach(() => {
    mockRepo.getListingAgentId.mockResolvedValue('agent-1');
    mockRepo.approveListingDescription.mockResolvedValue(undefined);
    mockRepo.checkListingFullyApproved.mockResolvedValue(false);
    jest.mocked(propertyService.saveDescriptionDraft).mockResolvedValue(undefined);
  });

  it('calls saveDescriptionDraft before approving when text is provided', async () => {
    await reviewService.approveItem({
      entityType: 'listing_description',
      entityId: 'listing-1',
      agentId: 'agent-1',
      callerRole: 'agent',
      text: 'Edited description text.',
    });

    expect(propertyService.saveDescriptionDraft).toHaveBeenCalledWith(
      'listing-1',
      'Edited description text.',
      'agent-1',
      'agent',
    );
    expect(mockRepo.approveListingDescription).toHaveBeenCalledWith('listing-1', 'agent-1');
  });

  it('does not call saveDescriptionDraft when text is absent', async () => {
    await reviewService.approveItem({
      entityType: 'listing_description',
      entityId: 'listing-1',
      agentId: 'agent-1',
      callerRole: 'agent',
    });

    expect(propertyService.saveDescriptionDraft).not.toHaveBeenCalled();
    expect(mockRepo.approveListingDescription).toHaveBeenCalledWith('listing-1', 'agent-1');
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
npm test -- --testPathPattern="review.service"
```

Expected: FAIL — `propertyService.saveDescriptionDraft` mock not called as expected.

- [ ] **Step 4: Extend approveItem in review.service.ts**

Add import at top:
```typescript
import * as propertyService from '@/domains/property/property.service';
```

Change the `approveItem` input type:
```typescript
export async function approveItem(input: {
  entityType: EntityType;
  entityId: string;
  agentId: string;
  callerRole?: string;
  text?: string;
}): Promise<void> {
  const { entityType, entityId, agentId, callerRole = 'agent', text } = input;
```

In the `listing_description` case:
```typescript
case 'listing_description': {
  if (text) {
    await propertyService.saveDescriptionDraft(entityId, text, agentId, callerRole);
  }
  await reviewRepo.approveListingDescription(entityId, agentId);
  const isFullyApprovedDesc = await reviewRepo.checkListingFullyApproved(entityId);
  if (isFullyApprovedDesc) {
    await reviewRepo.setListingStatus(entityId, 'approved');
    await portalService.generatePortalListings(entityId);
  }
  break;
}
```

- [ ] **Step 5: Extend review.router.ts approve route**

In `src/domains/review/review.router.ts`, import:
```typescript
import { validateApproveDescriptionBody } from './review.validator';
```

Update the approve route to include the validator and pass `text`:
```typescript
reviewRouter.post(
  '/agent/reviews/:entityType/:entityId/approve',
  ...reviewAuth,
  ...validateEntityParams,
  ...validateApproveDescriptionBody,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const user = req.user as AuthenticatedUser;
      const entityType = req.params['entityType'] as EntityType;
      const entityId = req.params['entityId'] as string;
      const text = req.body.text as string | undefined;

      await reviewService.approveItem({
        entityType,
        entityId,
        agentId: user.id,
        callerRole: user.role,
        text,
      });

      res.render('partials/agent/review-row', {
        item: null,
        entityType,
        entityId,
        approved: true,
      });
    } catch (err) {
      next(err);
    }
  },
);
```

- [ ] **Step 6: Run tests**

```bash
npm test -- --testPathPattern="review"
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/domains/review/review.validator.ts \
        src/domains/review/review.service.ts \
        src/domains/review/__tests__/review.service.test.ts \
        src/domains/review/review.router.ts
git commit -m "feat: extend review approve to save optional edited text before approving"
```

---

## Task 8: Pass aiDescription through agent.service → seller-listing-card

The `seller-listing-card.njk` template uses `seller.property.listing`. Currently `getSellerDetail` in `agent.service.ts` does not include `aiDescription`. Fix this.

**Files:**
- Modify: `src/domains/agent/agent.service.ts`

- [ ] **Step 1: Add aiDescription to the agent.repository.ts listing select**

`agent.repository.ts` uses a `select` on `listings` (around line 272). Add `aiDescription: true` to that select:

```typescript
// Before (existing fields):
title: true,
description: true,
photos: true,
photosApprovedAt: true,
descriptionApprovedAt: true,
portalListings: { select: { id: true, status: true } },

// After (add aiDescription):
title: true,
description: true,
aiDescription: true,
photos: true,
photosApprovedAt: true,
descriptionApprovedAt: true,
portalListings: { select: { id: true, status: true } },
```

- [ ] **Step 2: Add aiDescription to the listing mapping in agent.service.ts**

In `src/domains/agent/agent.service.ts`, in the listing object inside `getSellerDetail` (around line 143), add after `descriptionApprovedAt`:
```typescript
aiDescription: property.listings[0].aiDescription,
```

- [ ] **Step 3: Run tests**

```bash
npm test -- --testPathPattern="agent"
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/domains/agent/agent.service.ts src/domains/agent/agent.repository.ts
git commit -m "feat: include aiDescription in seller detail listing data"
```

---

## Task 9: Listing card UI — four-state description section

**Files:**
- Modify: `src/views/partials/agent/seller-listing-card.njk`

- [ ] **Step 1: Add id to the card div and update description cell**

Replace the current content of `seller-listing-card.njk` with:

```njk
{# partials/agent/seller-listing-card.njk — listing status card on seller-detail page #}
{% if seller.property and seller.property.listing %}
{% set listing = seller.property.listing %}
<div class="card" id="listing-card">
  <h2 class="page-section-title">{{ "Listing" | t }}</h2>
  <dl class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
    <div>
      <dt class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{{ "Photos" | t }}</dt>
      <dd>
        {% if listing.photosApprovedAt and not listing.photoCount %}
        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">{{ "Downloaded" | t }}</span>
        {% elif listing.photosApprovedAt and listing.photoCount %}
        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-800">✓ {{ "Approved" | t }} · {{ listing.photoCount }} {{ "photos" | t }}</span>
        {% else %}
        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-800">{{ "Pending" | t }}</span>
        {% endif %}
      </dd>
    </div>
    <div>
      <dt class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{{ "Description" | t }}</dt>
      <dd>
        {% if listing.descriptionApprovedAt %}
          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-800">✓ {{ "Approved" | t }}</span>
        {% elif listing.aiDescription and not listing.description %}
          {# Post-rejection: aiDescription exists but description was cleared by rejection #}
          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700 mb-2">{{ "Rejected" | t }}</span>
          <button
            hx-post="/agent/listings/{{ listing.id }}/description/generate"
            hx-target="#listing-card"
            hx-swap="outerHTML"
            class="text-xs text-purple-600 hover:underline ml-2">{{ "Regenerate" | t }}</button>
        {% elif listing.aiDescription and listing.description %}
          {# Generated / draft — show editable textarea #}
          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-800 mb-2">{{ "Pending review" | t }}</span>
          <div id="desc-draft-{{ listing.id }}" class="mt-2 space-y-2">
            <textarea
              id="desc-text-{{ listing.id }}"
              name="text"
              rows="6"
              class="w-full border border-gray-300 rounded px-2 py-1 text-sm resize-y font-mono text-xs"
            >{{ listing.aiDescription }}</textarea>
            <div class="flex items-center gap-3">
              <button
                hx-post="/agent/listings/{{ listing.id }}/description/draft"
                hx-include="#desc-text-{{ listing.id }}"
                hx-on::after-request="if(event.detail.successful){var s=document.getElementById('desc-saved-{{ listing.id }}');s.classList.remove('hidden');setTimeout(function(){s.classList.add('hidden')},2000)}"
                class="text-xs bg-indigo-600 text-white px-3 py-1 rounded hover:bg-indigo-700">{{ "Save draft" | t }}</button>
              <span id="desc-saved-{{ listing.id }}" class="text-xs text-green-600 hidden">{{ "Saved ✓" | t }}</span>
              <button
                hx-post="/agent/listings/{{ listing.id }}/description/generate"
                hx-target="#listing-card"
                hx-swap="outerHTML"
                class="text-xs text-gray-500 hover:underline">{{ "Regenerate" | t }}</button>
            </div>
          </div>
        {% else %}
          {# Not yet generated #}
          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-800 mb-2">{{ "Pending" | t }}</span>
          <button
            hx-post="/agent/listings/{{ listing.id }}/description/generate"
            hx-target="#listing-card"
            hx-swap="outerHTML"
            class="text-xs bg-purple-600 text-white px-3 py-1 rounded hover:bg-purple-700 ml-2">{{ "Generate description" | t }}</button>
        {% endif %}
      </dd>
    </div>
    <div>
      <dt class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{{ "Status" | t }}</dt>
      <dd class="text-gray-700">{{ listing.status }}</dd>
    </div>
    <div>
      <dt class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{{ "Portals" | t }}</dt>
      <dd class="text-gray-700">{{ listing.portalsPostedCount }} / 3 {{ "posted" | t }}</dd>
    </div>
  </dl>
  <div class="mt-4 pt-4 border-t border-gray-100">
    <a href="/agent/listings/{{ listing.id }}/portals"
       class="inline-block bg-purple-600 text-white text-sm px-4 py-2 rounded font-medium hover:bg-purple-700">
      {{ "Go to Portals →" | t }}
    </a>
  </div>
</div>

{% endif %}
```

Note: The "Save draft" button uses HTMX's `hx-post` with `hx-include` to send the textarea value as `name=text` form body. HTMX handles CSRF automatically when the app sets the CSRF token header via `hx-headers` on a parent element (check `agent.njk` layout for the `hx-headers` attribute — if present, all HTMX requests will include it automatically). No manual CSRF code needed in the template.

- [ ] **Step 2: Commit**

```bash
git add src/views/partials/agent/seller-listing-card.njk
git commit -m "feat: add description generation UI to seller listing card"
```

---

## Task 10: Review detail UI — editable textarea + save+approve

**Files:**
- Modify: `src/views/partials/agent/review-detail-listing-desc.njk`

- [ ] **Step 1: Replace the static description display with editable textarea**

Replace the content of `review-detail-listing-desc.njk`:

```njk
<div class="bg-white border-l-2 border-yellow-500 h-full flex flex-col">
  <div class="p-4 border-b border-gray-200">
    <div class="font-bold text-gray-900">{{ "Listing Description" | t }}</div>
    <div class="text-sm text-gray-500 mt-1">{{ detail.property.seller.name }} · {{ detail.property.town }}</div>
  </div>
  <div class="flex-1 overflow-y-auto p-4">
    <h4 class="text-xs font-semibold text-gray-500 uppercase mb-2">{{ "Description" | t }}</h4>
    <textarea
      id="review-desc-text-{{ detail.id }}"
      rows="12"
      class="w-full border border-gray-300 rounded px-3 py-2 text-sm resize-y font-mono text-xs"
    >{{ detail.aiDescription or detail.description or "" }}</textarea>
    <p class="text-xs text-gray-400 mt-1">{{ "Edit above before approving, or approve as-is." | t }}</p>
  </div>
  <div class="p-4 border-t border-gray-200 space-y-3">
    <button
      type="button"
      onclick="saveAndApprove('{{ detail.id }}')"
      class="w-full bg-green-600 text-white py-2 rounded font-medium hover:bg-green-700">
      {{ "Save + Approve Description" | t }}
    </button>
    <form hx-post="/agent/reviews/listing_description/{{ detail.id }}/reject"
          hx-target="#review-row-{{ detail.id }}-desc"
          hx-swap="outerHTML"
         >
      <textarea name="reviewNotes" required rows="3"
                class="w-full border border-gray-300 rounded px-3 py-2 text-sm resize-none"
                placeholder="{{ 'Rejection notes (required)...' | t }}"></textarea>
      <button type="submit" class="w-full mt-2 bg-red-600 text-white py-2 rounded font-medium hover:bg-red-700">
        {{ "Reject Description" | t }}
      </button>
    </form>
  </div>
</div>

<script nonce="{{ cspNonce }}">
function saveAndApprove(listingId) {
  var text = document.getElementById('review-desc-text-' + listingId).value;
  var target = document.getElementById('review-row-' + listingId + '-desc');
  var formData = new FormData();
  formData.append('text', text);
  // Get CSRF token — adjust to match how other forms in this app send it
  var csrfInput = document.querySelector('[name="_csrf"]');
  if (csrfInput) formData.append('_csrf', csrfInput.value);

  htmx.ajax('POST', '/agent/reviews/listing_description/' + listingId + '/approve', {
    target: '#review-row-' + listingId + '-desc',
    swap: 'outerHTML',
    values: { text: text }
  });
}
</script>
```

Note: `htmx.ajax` with `values` sends the data as form-encoded. If CSRF is required check how HTMX handles it in this app (look for `hx-headers` with CSRF in other templates). Use the same approach here.

- [ ] **Step 2: Check HTMX CSRF approach**

```bash
grep -rn "hx-headers\|csrf\|htmx.ajax" src/views/ | grep -i "csrf" | head -10
```

Adjust the `saveAndApprove` function accordingly.

- [ ] **Step 3: Commit**

```bash
git add src/views/partials/agent/review-detail-listing-desc.njk
git commit -m "feat: editable description textarea in review detail panel with save+approve"
```

---

## Task 11: Integration tests

Write the 7 integration test scenarios from the spec.

**Files:**
- Create: `src/domains/property/__tests__/property.integration.test.ts`

- [ ] **Step 1: Write the integration tests**

Create `src/domains/property/__tests__/property.integration.test.ts` (use the existing integration test pattern — real DB via `npm run test:integration`, test-scoped transactions or cleanup in `afterEach`):

```typescript
// Pattern: use factory helpers to seed data, call routes via supertest, assert DB state

describe('Listing description generation — integration', () => {
  it('Generate → edit draft → approve: description = edited text, descriptionApprovedAt set', async () => {
    // seed: listing with assigned agent, system_setting listing_description_prompt
    // POST /agent/listings/:id/description/generate
    // POST /agent/listings/:id/description/draft { text: 'Edited.' }
    // POST /agent/reviews/listing_description/:id/approve
    // assert: listing.description === 'Edited.', listing.descriptionApprovedAt !== null
  });

  it('Generate when listing_description_prompt missing → 400 ValidationError', async () => {
    // seed: listing, NO system_setting for listing_description_prompt
    // POST /agent/listings/:id/description/generate
    // assert: 400, body.error contains 'not configured'
  });

  it('Regenerate after approval: clears descriptionApprovedAt, re-enters review queue', async () => {
    // seed: listing with descriptionApprovedAt set
    // POST /agent/listings/:id/description/generate
    // assert: listing.descriptionApprovedAt === null
    // assert: review queue query returns this listing
  });

  it('Regenerate after rejection: description and aiDescription restored, re-enters review queue', async () => {
    // seed: listing with aiDescription set, description null (post-rejection state)
    // POST /agent/listings/:id/description/generate
    // assert: listing.aiDescription set, listing.description set (not null)
    // assert: review queue query returns this listing (description != null && descriptionApprovedAt == null)
  });

  it('Approve with text → aiDescription + description updated, then descriptionApprovedAt set', async () => {
    // seed: listing with aiDescription set, description set
    // POST /agent/reviews/listing_description/:id/approve { text: 'Override.' }
    // assert: listing.aiDescription === 'Override.', listing.description === 'Override.'
    // assert: listing.descriptionApprovedAt !== null
  });

  it('Both photos and description approved → listing status becomes approved, portal listings generated', async () => {
    // seed: listing with photosApprovedAt set, aiDescription set, description set
    // POST /agent/reviews/listing_description/:id/approve
    // assert: listing.status === 'approved'
    // assert: portalListings created
  });

  it('Generated description appears in review queue immediately after generation', async () => {
    // seed: listing
    // POST /agent/listings/:id/description/generate
    // GET /agent/reviews (or review queue query)
    // assert: listing appears in listing_description items
  });
});
```

Fill in each test body using `factory.seller()`, `factory.property()`, `factory.listing()`, `factory.systemSetting({ key: 'listing_description_prompt', value: '...' })` and the existing supertest agent pattern. Mock the AI facade to return deterministic text (`aiFacade.generateText` → `{ text: 'Test description.', provider: 'anthropic', model: 'test', tokensUsed: 0 }`).

- [ ] **Step 2: Run integration tests to verify they fail before implementation**

```bash
npm run test:integration -- --testPathPattern="property.integration"
```

Expected: FAIL — functions/routes not yet wired up (if running before Tasks 5–10), or pass if running after.

- [ ] **Step 3: Commit**

```bash
git add src/domains/property/__tests__/property.integration.test.ts
git commit -m "test: add integration tests for listing description generation"
```

---

## Task 12: Full test run

- [ ] **Step 1: Run all unit tests**

```bash
npm test
```

Expected: all tests pass. Count should be higher than before (new tests added in Tasks 3, 5, 7, 11).

- [ ] **Step 2: Run integration tests**

```bash
npm run test:integration
```

Expected: all pass, including the 7 new scenarios from Task 11.

- [ ] **Step 3: Fix any failures before proceeding**

Do not skip failures. Each failure indicates a real bug introduced in this work.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -p
git commit -m "fix: address test failures from description generation feature"
```
