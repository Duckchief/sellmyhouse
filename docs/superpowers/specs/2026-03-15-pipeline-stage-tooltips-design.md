# Pipeline Stage Card Tooltips

**Date:** 2026-03-15
**Status:** Approved

## Problem

Stage cards on `/agent/dashboard` and `/admin/pipeline` show counts with no explanation of what each stage means. New agents or admins have no in-context guidance.

## Solution

Add a `?` badge to each stage card that reveals a tooltip on hover, explaining the stage in one sentence.

## Approach

Pure CSS using Tailwind `group` / `group-hover:` utility classes. No JS, no new dependencies.

## Affected Files

- `src/views/partials/agent/pipeline-cards.njk` — agent dashboard cards
- `src/views/pages/admin/pipeline.njk` — admin pipeline cards (All + 5 stages)

## Component Structure

Each card's outer `<a>` element gains `relative group` classes. Inside:

1. A `?` badge — `absolute top-2 right-2`, small circle, `w-4 h-4 rounded-full bg-gray-100 text-gray-400 text-xs flex items-center justify-center`
2. A tooltip `<div>` — `absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 ...`, toggled via `invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-opacity`

## Tooltip Copy

| Stage    | Text |
|----------|------|
| All      | All sellers currently in your pipeline |
| Lead     | New enquiry received. Not yet contacted or assigned to an agent |
| Engaged  | In active consultation. EAA being prepared or signed |
| Active   | Property listed and transaction in progress. Viewings, offers, OTP |
| Completed | Transaction closed. Commission paid |
| Archived | Case closed without a completed transaction, or past retention period |

All strings wrapped in `| t` filter for i18n readiness.

## Constraints

- No JS required
- No new dependencies
- Tooltip text via inline Nunjucks, no backend changes
- Consistent styling with existing `card` component
