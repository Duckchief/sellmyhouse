# Date Filter Implementation Design

**Date:** 2026-03-16
**Status:** Approved

## Problem

The Nunjucks `| date` filter in `src/infra/http/app.ts` is a stub — it ignores the format argument and returns the raw value (ISO timestamp string). All table columns and date displays across the app are currently rendering raw strings.

## Goal

Implement a real `| date` filter using native `Intl.DateTimeFormat`, hardcoded to **Singapore Time (SGT, UTC+8)**, with support for all format modes already used in templates.

## Decisions

- **Timezone:** Asia/Singapore (UTC+8), hardcoded. All users are in Singapore; consistency matters more than locale detection.
- **Library:** None. Native `Intl.DateTimeFormat` handles timezone and formatting. No new dependency.
- **Structure:** Extract to `src/infra/http/filters/date.filter.ts` for testability, import into `app.ts`.

## Format Mode Behaviour

| Call | Output example |
|------|----------------|
| `\| date` (no arg) | `14 Mar 2026 09:30` |
| `\| date("DD MMM YYYY")` | `14 Mar 2026` |
| `\| date("D MMM YYYY HH:mm")` | `14 Mar 2026 09:30` |
| `\| date("YYYY")` | `2026` |
| `\| date('relative')` | `2 hours ago` / `3 days ago` |
| `\| date('short')` | `Mar 2026` |
| null / undefined input | `""` (empty string) |
| `'now'` input | current year (footer copyright) |

## Files

- **Create:** `src/infra/http/filters/date.filter.ts` — exported `dateFilter(value, format?)` function
- **Create:** `src/infra/http/filters/__tests__/date.filter.test.ts` — unit tests
- **Modify:** `src/infra/http/app.ts` — replace inline stub with import of `dateFilter`

## Out of Scope

- No template changes — all existing `| date(...)` calls already use the correct format strings
- No timezone selector — SGT only
- No moment.js / dayjs / date-fns
