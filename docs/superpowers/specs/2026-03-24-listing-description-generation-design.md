# Listing Description Generation — Design Spec

**Date:** 2026-03-24
**Project:** SellMyHomeNow.sg v2

---

## Overview

Agents can generate AI-powered listing descriptions for HDB properties directly from the seller-detail page. The generated text is editable before it enters the review queue, and the agent gives final approval through the existing review queue. Approval is required before the listing becomes `approved` and portal listings are generated.

---

## Background

The `Listing` model already has `aiDescription`, `aiDescriptionStatus`, `aiDescriptionProvider`, `aiDescriptionModel`, and `aiDescriptionGeneratedAt` fields. The review queue already surfaces `listing_description` items (listings where `description IS NOT NULL AND descriptionApprovedAt IS NULL`). The AI facade and provider infrastructure exist. What is missing is: the prompt template, the generation service, the save-draft service, the routes, and the UI entry point.

---

## Data Flow

```
Agent clicks "Generate" on seller-listing-card
  → POST /agent/listings/:listingId/description/generate
  → property.service.generateListingDescription(listingId, agentId)
      — fetch listing.property fields
      — fetch listing_description_prompt from SystemSetting (error if missing/empty)
      — substitute placeholders into template
      — ai.facade.generate(prompt)
      — save result to listing.aiDescription, aiDescriptionStatus='ai_generated',
         aiDescriptionProvider, aiDescriptionModel, aiDescriptionGeneratedAt=now
  → return updated seller-listing-card partial (textarea now visible)

Agent edits text in listing-card textarea
  → POST /agent/listings/:listingId/description/draft
  → property.service.saveDescriptionDraft(listingId, text)
      — updates listing.aiDescription only
      — does not touch descriptionApprovedAt or listing.status
  → 204 No Content

Agent edits + approves in review queue
  → POST /agent/reviews/listing_description/:entityId/approve
  → extended: if body.text present, updates listing.aiDescription first
  → then existing approveListingDescription() runs:
      copies aiDescription → description, sets descriptionApprovedAt
      checkListingFullyApproved → if true, setListingStatus('approved')
        + portalService.generatePortalListings()
```

Regeneration (clicking "Generate" again) overwrites `aiDescription` unconditionally.

---

## Prompt Template

Stored in `SystemSetting` under key `listing_description_prompt`. Default value:

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
- Throws `ValidationError` if template string is empty or missing required placeholders

**No PII is sent to the AI provider.** The prompt contains only property data (flat type, location, area, storey, lease date). No NRIC, seller name, phone, or financial data.

---

## Routes

All routes behind `agentAuth` (`requireAuth + requireRole('agent','admin') + requireTwoFactor`).

### New routes

| Method | Path | Handler |
|--------|------|---------|
| `POST` | `/agent/listings/:listingId/description/generate` | Generate AI description; returns updated listing-card partial |
| `POST` | `/agent/listings/:listingId/description/draft` | Save edited draft to `aiDescription`; returns 204 |

### Extended route

| Method | Path | Change |
|--------|------|--------|
| `POST` | `/agent/reviews/listing_description/:entityId/approve` | Accepts optional `body.text`; if present, saves to `aiDescription` before approving |

### Admin settings (existing page extended)

| Method | Path | Change |
|--------|------|--------|
| `GET/POST` | `/admin/settings` | `listing_description_prompt` textarea added to settings form |

---

## Service Functions

**`property.service.ts`** (new functions):

```typescript
generateListingDescription(listingId: string, agentId: string): Promise<void>
// Fetches prompt from settings, calls AI facade, saves to listing.aiDescription.
// Throws ValidationError if listing_description_prompt setting is empty/missing.
// Idempotent — regenerates unconditionally if called again.

saveDescriptionDraft(listingId: string, text: string, agentId: string): Promise<void>
// Saves text to listing.aiDescription only. Does not change descriptionApprovedAt.
// Throws NotFoundError if listing not found.
// Throws ForbiddenError if agentId is not assigned to this listing (non-admin).
```

**`review.service.approveItem`** (extended):
- Accepts optional `text?: string` in input
- For `listing_description`: if `text` is provided, calls `saveDescriptionDraft` before approval

---

## UI Changes

### `partials/agent/seller-listing-card.njk`

Description cell behaviour by state:

| State | UI |
|-------|----|
| No `aiDescription`, no `descriptionApprovedAt` | "Pending" badge + "Generate description" button |
| `aiDescription` exists, not approved | Editable textarea + "Save draft" button + "Regenerate" link + "Pending review" badge |
| `descriptionApprovedAt` set | "✓ Approved" badge only |

The "Generate" and "Regenerate" buttons use `hx-post` → swap the listing card partial.
The "Save draft" button uses `hx-post` → shows inline "Saved" confirmation.

### `partials/agent/review-detail-listing-desc.njk`

Extended from read-only text display to:
- Editable textarea pre-filled with `aiDescription`
- "Save + Approve" button (posts `text` + triggers approve in one action)
- "Reject" button unchanged

### Admin settings page

New textarea labelled **"Listing description prompt"** with helper text below:
> Available placeholders: `{flatType}` `{town}` `{block}` `{street}` `{floorAreaSqm}` `{storey}` `{leaseCommencementDate}`

Saving an empty value returns a validation error (no silent fallback).

---

## Error Handling

| Scenario | Response |
|----------|----------|
| `listing_description_prompt` setting missing or empty | 400 `ValidationError`: "Listing description prompt is not configured — update it in Settings" |
| AI provider call fails | 502 propagated from AI facade |
| Agent not assigned to listing | 403 `ForbiddenError` |
| Listing not found | 404 `NotFoundError` |

---

## Testing

### Unit tests

- `buildListingDescriptionPrompt` — substitutes all placeholders; throws `ValidationError` when template is empty
- `generateListingDescription` — fetches setting, calls AI facade with substituted prompt, saves `aiDescription` fields; throws when setting is empty
- `generateListingDescription` — overwrites existing `aiDescription` (idempotent)
- `saveDescriptionDraft` — updates `aiDescription` only; does not change `descriptionApprovedAt`
- `approveItem('listing_description', { text })` — calls `saveDescriptionDraft` before approving
- `approveItem('listing_description')` without text — existing behaviour unchanged (no regression)

### Integration tests

- Generate → edit draft → approve: `listing.description` = edited text, `descriptionApprovedAt` set
- Generate when `listing_description_prompt` missing → 400 with error message
- Regenerate overwrites existing `aiDescription`
- Approve with `text` → `aiDescription` updated, then `descriptionApprovedAt` set
- Both photos and description approved → listing status becomes `approved`, portal listings generated

---

## Out of Scope

- Seller-facing description preview
- Description versioning / history
- Multi-language generation
- Tone/style selector per listing
