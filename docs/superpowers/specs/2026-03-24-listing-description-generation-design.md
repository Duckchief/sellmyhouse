# Listing Description Generation — Design Spec

**Date:** 2026-03-24
**Project:** SellMyHouse.sg v2

---

## Overview

Agents can generate AI-powered listing descriptions for HDB properties directly from the seller-detail page. The generated text is editable before it enters the review queue, and the agent gives final approval through the existing review queue. Approval is required before the listing becomes `approved` and portal listings are generated.

---

## Background

The `Listing` model already has `aiDescription`, `aiDescriptionStatus`, `aiDescriptionProvider`, `aiDescriptionModel`, and `aiDescriptionGeneratedAt` fields. The review queue in `review.repository.ts` surfaces `listing_description` items via the query `{ description: { not: null }, descriptionApprovedAt: null }` — it looks at the `description` field, not `aiDescription`. The AI facade exports `generateText(prompt, options?)` returning `AIGenerateResult { text, provider, model, tokensUsed }`, and throws `AIUnavailableError` (which extends plain `Error`, not `AppError`) when all providers fail. What is missing is: the prompt template, the generation service, the save-draft service, the routes, and the UI entry point.

---

## Data Flow

```
Agent clicks "Generate" on seller-listing-card
  → POST /agent/listings/:listingId/description/generate
  → property.service.generateListingDescription(listingId, agentId, callerRole)
      — verify ownership: if callerRole !== 'admin', check agentId is assigned
          (ForbiddenError if not)
      — fetch listing.property fields
      — fetch listing_description_prompt from SystemSetting
          (ValidationError if empty/missing: "Listing description prompt is not
           configured — update it in Settings")
      — buildListingDescriptionPrompt(template, propertyFields)
      — result = await aiFacade.generateText(prompt)
          result.text → aiDescription
          result.provider → aiDescriptionProvider
          result.model → aiDescriptionModel
      — property.repo.saveAiDescription(listingId, {
            aiDescription: result.text,
            aiDescriptionStatus: 'ai_generated',
            aiDescriptionProvider: result.provider,
            aiDescriptionModel: result.model,
            aiDescriptionGeneratedAt: new Date(),
            description: result.text,   // staging copy so review queue picks it up
            descriptionApprovedAt: null, // MUST clear in case of regeneration after approval
          })
      — auditService.log({ action: 'listing.description_generated', ... })
  → route re-fetches listing via property.repo.findListingCardData(listingId)
    and renders updated seller-listing-card partial

Agent edits text in listing-card textarea
  → POST /agent/listings/:listingId/description/draft
  → property.service.saveDescriptionDraft(listingId, text, agentId, callerRole)
      — verify ownership (ForbiddenError if not assigned and callerRole !== 'admin')
          callerRole undefined is treated as 'agent' (conservative default)
      — property.repo.updateDescriptionDraft(listingId, text)
          updates aiDescription AND description; aiDescriptionStatus stays 'ai_generated'
      — auditService.log({ action: 'listing.description_draft_saved', ... })
  → 204 No Content

Agent edits + approves in review queue
  → POST /agent/reviews/listing_description/:entityId/approve
  → body: { text?: string }  (validated by validateApproveDescriptionBody)
  → review.service.approveItem({ entityType, entityId, agentId, callerRole, text? })
      — callerRole comes from req.user.role (already passed in existing router)
      — if text present: propertyService.saveDescriptionDraft(entityId, text, agentId,
          callerRole ?? 'agent')
      — reviewRepo.approveListingDescription(entityId, agentId)
          reads aiDescription → copies to description, sets descriptionApprovedAt
          Note: if saveDescriptionDraft ran immediately before this, the copy is a no-op
          (aiDescription and description already match); both paths are safe
      — checkListingFullyApproved → if true:
          setListingStatus('approved')
          portalService.generatePortalListings()
      — existing audit log: listing.reviewed / decision: approved
```

Regeneration always clears `descriptionApprovedAt` via `saveAiDescription` (see above). This prevents a previously-approved listing from displaying "✓ Approved" with new unreviewed content.

---

## Prompt Template

Stored in `SystemSetting` under key `listing_description_prompt`. The key must be added to `SETTING_KEYS` in `src/domains/shared/settings.types.ts` as `LISTING_DESCRIPTION_PROMPT: 'listing_description_prompt'`. `settingsService.get()` accepts `SettingKey | string` so this is best-practice for consistency rather than a compile-time requirement.

Default value (used as the seed value when first inserted into the database — there is no code fallback; an empty or missing setting is an error):

```
You are writing a property listing description for a Singapore HDB flat.
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
- Lease commenced: {leaseCommencementDate}
```

**Asking price is intentionally excluded** — portals have separate price fields and embedding price in narrative text creates maintenance risk when prices change.

**Prompt file:** `src/domains/shared/ai/prompts/listing-description.ts`
- Exports `buildListingDescriptionPrompt(template: string, property: PropertyFields): string`
- Substitutes all `{placeholder}` tokens with property values
- Throws `ValidationError` (imported from `src/domains/shared/errors.ts`) if template string is empty or blank

**No PII is sent to the AI provider.** The prompt contains only property data (flat type, location, area, storey, lease date). No NRIC, seller name, phone, or financial data.

---

## Routes

All routes behind `agentAuth` (`requireAuth + requireRole('agent','admin') + requireTwoFactor`).

### New routes

| Method | Path | Handler |
|--------|------|---------|
| `POST` | `/agent/listings/:listingId/description/generate` | Generate AI description; re-fetches listing via `findListingCardData`, returns updated listing-card partial. Rate limited: 10 generations per agent per hour (new limiter `descriptionGenerateLimiter` in `rate-limit.ts`, keyed by `user.id`) |
| `POST` | `/agent/listings/:listingId/description/draft` | Save edited draft to `aiDescription` + `description`; returns 204 |

### Extended route

| Method | Path | Change |
|--------|------|--------|
| `POST` | `/agent/reviews/listing_description/:entityId/approve` | Accepts optional `body.text` (validated by `validateApproveDescriptionBody`); if present, saves draft before approving |

### Admin settings (existing page extended)

| Method | Path | Change |
|--------|------|--------|
| `GET/POST` | `/admin/settings` | `listing_description_prompt` textarea added to settings form |

---

## Service Functions

**`property.service.ts`** (new functions):

```typescript
generateListingDescription(
  listingId: string,
  agentId: string,
  callerRole: string,
): Promise<void>
// Verifies ownership: if callerRole !== 'admin', ForbiddenError if agentId not assigned.
// Fetches prompt template from SystemSetting; throws ValidationError if empty/missing.
// Calls buildListingDescriptionPrompt(template, propertyFields).
// Calls aiFacade.generateText(prompt) → extracts result.text, result.provider, result.model.
// Calls property.repo.saveAiDescription() — always includes descriptionApprovedAt: null
// to handle the regeneration-after-approval case.
// Logs: listing.description_generated.

saveDescriptionDraft(
  listingId: string,
  text: string,
  agentId: string,
  callerRole: string,
): Promise<void>
// Verifies ownership: if callerRole !== 'admin', ForbiddenError if agentId not assigned.
// undefined callerRole treated as 'agent'.
// Calls property.repo.updateDescriptionDraft() to update aiDescription + description.
// aiDescriptionStatus is not changed (stays 'ai_generated').
// Does not change descriptionApprovedAt or listing.status.
// Logs: listing.description_draft_saved.
// Throws NotFoundError if listing not found.
```

**`review.service.approveItem`** (extended input type):

```typescript
approveItem(input: {
  entityType: EntityType;
  entityId: string;
  agentId: string;
  callerRole?: string;
  text?: string;        // ← new optional field
}): Promise<void>
```

For `listing_description`: if `text` is provided, calls `propertyService.saveDescriptionDraft(entityId, text, agentId, callerRole ?? 'agent')` before calling `reviewRepo.approveListingDescription`.

---

## Repository Functions

**`property.repository.ts`** (new functions):

```typescript
saveAiDescription(listingId: string, data: {
  aiDescription: string;
  aiDescriptionStatus: AiDescriptionStatus;
  aiDescriptionProvider: string;
  aiDescriptionModel: string;
  aiDescriptionGeneratedAt: Date;
  description: string;        // staging copy for review queue
  descriptionApprovedAt: null; // always null — clears prior approval on regeneration
}): Promise<Listing>

updateDescriptionDraft(listingId: string, text: string): Promise<Listing>
// Updates aiDescription and description fields only. Does not touch descriptionApprovedAt.

findListingCardData(listingId: string): Promise<{
  id: string;
  status: string;
  photosApprovedAt: Date | null;
  photoCount: number | null;
  descriptionApprovedAt: Date | null;
  aiDescription: string | null;
  description: string | null;
  portalsPostedCount: number;
  property: { seller: { agentId: string | null } };
} | null>
// Prisma include shape: listing → property (include) → seller (select agentId)
// portalsPostedCount derived from portalListings where status = 'posted'
```

---

## Error Handling

| Scenario | Response |
|----------|----------|
| `listing_description_prompt` setting missing or empty | 400 `ValidationError`: "Listing description prompt is not configured — update it in Settings" |
| AI provider call fails (`AIUnavailableError`) | 502 — add explicit `instanceof AIUnavailableError` branch to `src/infra/http/middleware/error-handler.ts` *before* the `AppError` branch, returning 502 with the error message. `AIUnavailableError` extends plain `Error` (not `AppError`) so a new branch is required. |
| Agent not assigned to listing | 403 `ForbiddenError` |
| Listing not found | 404 `NotFoundError` |
| `body.text` present but empty string | 400 from `validateApproveDescriptionBody` |
| Rate limit exceeded on generate | 429 from `descriptionGenerateLimiter` |

---

## Validators

**New validator `validateApproveDescriptionBody`** (in `review.validator.ts`):
```typescript
body('text').optional().isString().trim().notEmpty()
  .withMessage('text must be a non-empty string if provided')
```

Applied to the approve route. For entity types other than `listing_description`, `text` is ignored by the service.

---

## Audit Log

| Action | When |
|--------|------|
| `listing.description_generated` | After successful AI generation |
| `listing.description_draft_saved` | After agent saves a draft edit |
| `listing.reviewed` (existing) | After agent approves or rejects — already in place |

---

## UI Changes

### `partials/agent/seller-listing-card.njk`

Description cell behaviour by state:

| State | Condition | UI |
|-------|-----------|-----|
| Not generated | `aiDescription` null | "Pending" badge + "Generate description" button |
| Generated / draft | `aiDescription` set, `description` set, `descriptionApprovedAt` null | Editable textarea + "Save draft" button + "Regenerate" link + "Pending review" badge |
| Post-rejection | `aiDescription` set, `description` null, `descriptionApprovedAt` null | "Rejected — regenerate?" label + "Regenerate" button (no textarea until regenerated) |
| Approved | `descriptionApprovedAt` set | "✓ Approved" badge only (no textarea) |

Note: regeneration after approval clears `descriptionApprovedAt` (via `saveAiDescription`), so the listing moves back to the "Generated / draft" state.

The "Generate" and "Regenerate" buttons use `hx-post` → swap the listing card partial.
The "Save draft" button uses `hx-post` → shows inline "Saved ✓" confirmation.

### `partials/agent/review-detail-listing-desc.njk`

Extended from read-only text display to:
- Editable textarea pre-filled with `aiDescription`
- "Save + Approve" button (posts `text` in body + triggers approve in one action)
- "Reject" button unchanged

### Admin settings page

New textarea labelled **"Listing description prompt"** with helper text below:
> Available placeholders: `{flatType}` `{town}` `{block}` `{street}` `{floorAreaSqm}` `{storey}` `{leaseCommencementDate}`

Saving an empty value returns a validation error (no silent fallback).

---

## Testing

### Unit tests

- `buildListingDescriptionPrompt` — substitutes all placeholders; throws `ValidationError` when template is empty
- `generateListingDescription` — fetches setting, calls `aiFacade.generateText`, maps `result.text/provider/model` to correct fields; sets `description` = generated text; sets `descriptionApprovedAt: null`; logs `listing.description_generated`
- `generateListingDescription` — throws `ValidationError` when `listing_description_prompt` setting is empty
- `generateListingDescription` — throws `ForbiddenError` when callerRole is `'agent'` and agent is not assigned to listing
- `generateListingDescription` — admin (callerRole `'admin'`) bypasses ownership check
- `generateListingDescription` — overwrites existing `aiDescription` and clears `descriptionApprovedAt` (idempotent regeneration)
- `saveDescriptionDraft` — updates `aiDescription` and `description`; does not change `descriptionApprovedAt` or `aiDescriptionStatus`; logs `listing.description_draft_saved`
- `saveDescriptionDraft` — throws `ForbiddenError` when callerRole is `'agent'` and agent is not assigned
- `saveDescriptionDraft` — undefined callerRole treated as `'agent'`
- `approveItem('listing_description', { text })` — calls `saveDescriptionDraft` before approving
- `approveItem('listing_description')` without text — existing behaviour unchanged (no regression)

### Integration tests

- Generate → edit draft → approve: `listing.description` = edited text, `descriptionApprovedAt` set
- Generate when `listing_description_prompt` missing → 400 with error message
- Regenerate after approval: clears `descriptionApprovedAt`, listing re-enters review queue
- Regenerate after rejection: `description` and `aiDescription` restored, listing re-enters review queue
- Approve with `text` → `aiDescription` + `description` updated, then `descriptionApprovedAt` set
- Both photos and description approved → listing status becomes `approved`, portal listings generated
- Generated description appears in review queue immediately after generation

---

## Out of Scope

- Seller-facing description preview
- Description versioning / history
- Multi-language generation
- Tone/style selector per listing
