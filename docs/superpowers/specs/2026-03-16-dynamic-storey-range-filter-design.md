# Dynamic Storey Range Filter — Design Spec
Date: 2026-03-16

## Problem
The Storey Range dropdown on the HDB Market Report page shows all distinct storey ranges across the entire dataset. Many options are irrelevant for a given town/flat type combination (e.g., a town with no high-rise blocks shows floor ranges that don't exist there).

## Solution
Filter the Storey Range dropdown dynamically using HTMX whenever the user changes Town or Flat Type. A new server endpoint returns only the storey ranges that exist for that combination.

## Architecture

### New endpoint
`GET /api/hdb/storey-ranges?town=X&flatType=Y`

- Protected by existing `hdbRateLimiter`
- Returns an HTML partial (`storey-range-options.njk`) containing `<option>` elements
- If either param is missing, falls back to returning all storey ranges (same as current behaviour)

### Backend changes

**Repository** (`src/domains/hdb/repository.ts`)
- Add `getDistinctStoreyRangesByTownAndFlatType(town: string, flatType: string): Promise<string[]>`
- Same query as `getDistinctStoreyRanges()` with added `where: { town, flatType }`

**Service** (`src/domains/hdb/service.ts`)
- Add `getDistinctStoreyRangesByTownAndFlatType(town, flatType)` — thin wrapper over repo method

**Router** (`src/domains/public/public.router.ts`)
- Add `GET /api/hdb/storey-ranges` handler
- Reads `town` and `flatType` from query params
- Calls filtered or unfiltered service method depending on param presence
- Renders `partials/public/storey-range-options.njk`

### Frontend changes

**New partial** (`src/views/partials/public/storey-range-options.njk`)
- Renders `<option value="">All storeys</option>` followed by `{% for sr in storeyRanges %}<option>` items
- Used on initial page load (via `{% include %}`) and as the HTMX swap target

**`market-report.njk`**
- `town` and `flatType` selects gain HTMX attributes:
  - `hx-get="/api/hdb/storey-ranges"`
  - `hx-include="#market-report-form"`
  - `hx-target="#storey-range-select"`
  - `hx-trigger="change"`
- Storey range `<select>` gains `id="storey-range-select"`
- Initial options rendered via `{% include "partials/public/storey-range-options.njk" %}`

## UX Behaviour
- On town or flat type change: storey range dropdown refreshes with filtered options, selection resets to "All storeys"
- If town or flat type is cleared/unset: storey range shows all options
- No loading state needed — response is fast (indexed query)

## Testing
- Unit test: `getDistinctStoreyRangesByTownAndFlatType` returns only ranges matching town+flatType
- Router test: endpoint returns correct HTML options for valid params
- Router test: endpoint falls back to all storey ranges when params are missing
