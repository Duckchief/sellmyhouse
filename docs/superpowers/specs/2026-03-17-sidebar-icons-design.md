# Sidebar Icons Design

**Date:** 2026-03-17
**Scope:** Agent Portal and Admin Portal sidebars

## Overview

Add Heroicons outline SVG icons to every navigation item in the Agent and Admin sidebars. Icons are delivered via a Nunjucks macro — no CDN dependency, no new JS or CSS.

## Icon Library

**Heroicons v2 — outline variant.**
- Made by the Tailwind team; style matches the existing UI perfectly.
- Already consistent with the hamburger menu SVG in both sidebars.
- Zero runtime cost: pure inline SVG, works offline.

## Implementation

### New file: `src/views/partials/shared/icons.njk`

A Nunjucks macro `icon(name, cls?)` that renders the correct Heroicons outline SVG for a given name. Default size class: `w-[17px] h-[17px] flex-shrink-0`.

```nunjucks
{% from "partials/shared/icons.njk" import icon %}
```

Usage in a nav link:
```nunjucks
<a href="/agent/dashboard" class="flex items-center gap-2 ...">
  {{ icon('home') }}
  {{ "Dashboard" | t }}
</a>
```

### Updated: `src/views/layouts/agent.njk`

Import the macro at the top. Add `flex items-center gap-2` to each `<a>` tag. Insert `{{ icon(name) }}` before the label text.

### Updated: `src/views/layouts/admin.njk`

Same pattern. All 16 nav items updated including the Sign Out link in the sticky footer.

## Icon Mapping

### Agent sidebar

| Menu item | Icon name |
|-----------|-----------|
| Dashboard | `home` |
| Leads | `user-plus` |
| Sellers | `users` |
| Reviews | `clipboard-document-check` |
| Settings | `cog-6-tooth` |

### Admin sidebar

| Menu item | Icon name |
|-----------|-----------|
| Dashboard | `home` |
| Pipeline | `funnel` |
| Leads | `user-plus` |
| All Sellers | `users` |
| Compliance | `shield-check` |
| Market Content | `chart-bar` |
| Testimonials | `star` |
| Referrals | `share` |
| Review Queue | `queue-list` |
| Team | `user-group` |
| Tutorials | `academic-cap` |
| HDB Data | `building-office-2` |
| Notifications | `bell` |
| Audit Log | `clipboard-document-list` |
| Settings | `cog-6-tooth` |
| Sign Out | `arrow-right-on-rectangle` |

## Constraints

- No new dependencies, CDN links, or build steps.
- Icon size fixed at 17×17px via Tailwind — matches the existing text-sm nav label height.
- `flex-shrink-0` prevents icons from collapsing when labels are long.
- No changes to active-state logic, badge counts, or i18n wrappers.
