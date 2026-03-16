# Transaction Funnel Graphic — Design Spec

**Date:** 2026-03-16
**Status:** Approved
**Scope:** Admin analytics dashboard — Transaction Funnel section only

---

## Problem

The Transaction Funnel section on the admin dashboard renders a blank Chart.js canvas. Chart.js is a heavy dependency for a single chart, and a horizontal bar chart does not visually communicate a pipeline funnel shape.

## Solution

Replace the `<canvas>` + `<script>` block with a pure HTML/CSS trapezoid funnel built inline in the Nunjucks template. Zero JS dependency for this section.

---

## Data

Source: `analytics.funnel` — a `Record<string, number>` keyed by seller status.

Pipeline stages in order:
1. `lead`
2. `engaged`
3. `active`
4. `completed`

Additional: `archived` — displayed separately, not in the funnel tiers.

---

## Visual Design

### Funnel Tiers

Four trapezoid `<div>` tiers, each narrowing from top to bottom:

| Tier | Stage | clip-path (approx) | Color opacity |
|------|-------|--------------------|---------------|
| 1 | lead | `polygon(5% 0%, 95% 0%, 88% 100%, 12% 100%)` | 100% |
| 2 | engaged | `polygon(12% 0%, 88% 0%, 78% 100%, 22% 100%)` | 80% |
| 3 | active | `polygon(22% 0%, 78% 0%, 65% 100%, 35% 100%)` | 60% |
| 4 | completed | `polygon(35% 0%, 65% 0%, 55% 100%, 45% 100%)` | 40% |

Each tier: `3.5rem` tall, color `#c8553d` at the specified opacity, text centered vertically.

### Tier Content

Each tier displays:
- **Stage name** and **Count** (both centred together as a flex row — left/right alignment is impractical for the narrowest completed tier which is only ~20% wide at the bottom edge)
- **Conversion %** from the previous stage (small muted text below tier, right-aligned)
  - Formula: `round(current / previous * 100)`
  - Shows `—` when previous stage count is 0

### Archived Indicator

Below the funnel, a single muted row:
```
→  N archived
```
Uses a small icon and `text-gray-400` colouring. Not part of the funnel shape.

---

## Template Changes

**File:** `src/views/partials/admin/analytics.njk`

**Remove:**
- `<canvas id="funnelChart" height="200"></canvas>`
- `<noscript>` fallback block
- `<script nonce="...">` Chart.js initialisation block for funnelChart

**Add:**
- Nunjucks variable assignments for conversion percentages (with 0-guards)
- Four trapezoid `<div>` tiers with inline `clip-path` styles
- Archived indicator row

No backend changes required. `analytics.funnel` data shape is unchanged.

---

## Constraints

- `clip-path` applied via inline `style=` attribute (not Tailwind utility — not in default config)
- Text must be positioned away from clipped corners (centre-safe padding)
- Conversion % computed in template, not backend
- No JavaScript
