# Lead Form: Country Code Picker + Validation Fixes

**Date:** 2026-03-20
**Status:** Approved

## Problem

The `#get-started` lead capture form on the homepage has two bugs that make the Submit button appear broken:

1. **Silent validation failure:** HTMX uses `checkValidity()` (not `reportValidity()`), so when a required field is empty or a phone number doesn't match the pattern, users get zero feedback — no browser tooltip, no error, nothing.
2. **Silent server errors:** HTMX only swaps 2xx responses by default. If the server returns 4xx/5xx (CSRF failure, validation error, server error), the error-message partial is rendered but silently dropped by HTMX. Users see nothing.

Additionally, the phone field enforces Singapore format (`[89]\d{7}`) with no way to enter international numbers, which is unnecessarily restrictive.

## Design

### 1. Country Code Selector

A combo/dropdown placed inline before the phone input field.

**UI:** Flag emoji + dial code (e.g. `+65`), searchable by country name or code. Default: Singapore.

**Country list (ASEAN curated):**

| Country | Code | Flag |
|---------|------|------|
| Singapore | +65 | `\u{1F1F8}\u{1F1EC}` |
| Malaysia | +60 | `\u{1F1F2}\u{1F1FE}` |
| Indonesia | +62 | `\u{1F1EE}\u{1F1E9}` |
| Thailand | +66 | `\u{1F1F9}\u{1F1ED}` |
| Philippines | +63 | `\u{1F1F5}\u{1F1ED}` |
| Vietnam | +84 | `\u{1F1FB}\u{1F1F3}` |
| Myanmar | +95 | `\u{1F1F2}\u{1F1F2}` |
| Cambodia | +855 | `\u{1F1F0}\u{1F1ED}` |
| Laos | +856 | `\u{1F1F1}\u{1F1E6}` |
| Brunei | +673 | `\u{1F1E7}\u{1F1F3}` |

**Implementation:** Pure HTML/CSS/JS custom dropdown with text filter in `app.js`. No external library. Clicking outside closes it. Hidden input stores the selected country code value.

### 2. Phone Validation

**Frontend (HTML5 + JS):**
- Singapore selected: `pattern="[89]\d{7}"`, placeholder `91234567`
- Other country selected: `pattern="\d{7,15}"`, placeholder `Phone number`
- Pattern updates dynamically when country changes
- On HTMX `htmx:validation:failed` event: call `form.reportValidity()` to show the browser's native validation tooltip

**Backend (`lead.validator.ts`):**
- Accept new fields: `countryCode`, `nationalNumber`
- Singapore: strict `[89]\d{7}` regex
- Others: digits only, 7-15 length
- Construct `fullE164` on the server: `countryCode + nationalNumber`
- Existing `phone` field stores `fullE164` format for backward compatibility

**Database (Seller model):**
- Add `countryCode` (`String`, default `"+65"`)
- Add `nationalNumber` (`String`)
- Keep existing `phone` field, now stores E.164 format
- Migration populates `countryCode = "+65"` and `nationalNumber = phone` for existing records

### 3. HTMX Error Response Handling

Global handler in `app.js`:
- Listen for `htmx:beforeOnLoad` event
- If response status is 4xx/5xx, set `evt.detail.shouldSwap = true` and `evt.detail.isError = false`
- HTMX then swaps the server-rendered error partial into the target element
- Benefits all HTMX forms across the app

## Files Affected

- `src/views/pages/public/home.njk` — country picker UI, updated phone field
- `public/js/app.js` — country picker logic, validation:failed handler, error response handler
- `src/domains/lead/lead.validator.ts` — accept countryCode/nationalNumber, country-aware validation
- `src/domains/lead/lead.router.ts` — pass new fields to validator/service
- `src/domains/lead/lead.service.ts` — construct fullE164
- `src/domains/lead/lead.types.ts` — updated LeadInput type
- `prisma/schema.prisma` — Seller: add countryCode, nationalNumber
- Migration — add columns, backfill existing records
- Tests — unit + integration updates
