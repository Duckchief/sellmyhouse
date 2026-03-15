# Error Page Design

**Date:** 2026-03-16
**Status:** Approved

## Problem

The current `error-handler.ts` returns raw JSON for full-page (non-HTMX) requests. When a session expires (401 UNAUTHORIZED), users see `{"error":{"code":"UNAUTHORIZED","message":"Authentication required"}}` instead of a helpful page. The fix renders a proper HTML error page for browser navigation requests.

## Approach

Single universal error page (`pages/error.njk`) using `layouts/base.njk` (no sidebar, no nav chrome). Clean and neutral — appropriate since auth errors mean the session is already gone. The error handler detects browser requests via the absence of `hx-request` header and the presence of `text/html` in the `Accept` header, and renders the page instead of JSON.

JSON responses are preserved for API clients (`Accept: application/json`).

## Error Messages

Tone: warm, friendly, lightly humorous. Each error has a headline, subtext, and a primary CTA.

| HTTP Code | Emoji | Headline | Subtext | CTA |
|-----------|-------|----------|---------|-----|
| 401 | 🚪 | Looks like you wandered off! | You've been away a while and your session expired. Totally normal — it happens to the best of us. | Log back in → `/auth/login` |
| 403 | 🔒 | Nothing to see here! | You don't have permission to view this page. If you think that's a mistake, give us a shout. | Go to dashboard → `/` |
| 404 | 🏠 | This page seems to have moved out already. | We can't find what you're looking for — it may have been removed or the link is wrong. | Go home → `/` |
| 500 | 🔧 | Oops, we tripped over something. | An unexpected error occurred on our end. We've been notified and we're on it. | Go home → `/` |
| Other | 😬 | Something went a bit sideways. | An error occurred. The status code is shown; technical message is not exposed to users. | Go home → `/` |

## Page Structure

- Extends `layouts/base.njk`
- Vertically and horizontally centred card, `min-h-screen` flex layout
- Large emoji (text-6xl) at top of card
- Muted status code label above headline
- Headline (`text-2xl font-bold`)
- Subtext paragraph (`text-gray-500`)
- Single CTA button in brand red (`bg-[#c8553d]`)
- No stack traces, no raw error messages exposed to the user

## Error Handler Changes

**File:** `src/infra/http/middleware/error-handler.ts`

Current behaviour: non-HTMX requests always get JSON.

New behaviour:
- If `req.headers['hx-request']` → render `partials/error-message` (unchanged)
- Else if `req.headers['accept']` includes `text/html` → render `pages/error.njk` with `{ statusCode, code, message }`
- Else → return JSON (unchanged, preserves API client compatibility)

## Files Touched

- `src/views/pages/error.njk` — new file
- `src/infra/http/middleware/error-handler.ts` — update full-page branch
