# Seller Sidebar Alignment Design

## Goal

Align the seller sidebar with the agent/admin sidebar so all three roles share the same layout pattern: shared top-header, dark `bg-ink` sidebar with icons, and desktop collapse-to-icon-rail toggle.

## Current State

The seller layout (`seller.njk`) has a custom mobile hamburger bar, a light-themed sidebar (`bg-white dark:bg-panel`), text-only nav links (no icons), a duplicate dark-mode toggle, and a logout form in the sidebar footer. Agent and admin layouts use the shared `top-header.njk`, a dark `bg-ink` sidebar with icons, and a desktop collapse toggle button (`panel-left` icon).

## Changes

### 1. Structural — `seller.njk`

- **Remove** the custom mobile hamburger bar (lines 4-25) and its duplicate dark-mode toggle.
- **Add** `{% from "partials/shared/icons.njk" import icon %}` import.
- **Add** `{% include "partials/shared/top-header.njk" %}` to use the shared header (hamburger, user dropdown, dark-mode toggle).
- **Remove** the logout form from the sidebar footer (now handled by the top-header user dropdown).
- **Keep** the Privacy Policy link in the sidebar footer.

### 2. Sidebar Theme — `seller.njk`

- Switch sidebar from `bg-white dark:bg-panel border-r border-gray-200 dark:border-gray-700` to `bg-ink text-white`.
- Switch active nav link from `bg-accent/10 text-accent` to `bg-white/10 text-accent border-l-2 border-accent`.
- Switch inactive nav link hover from `hover:bg-gray-100 dark:hover:bg-gray-800` to `hover:bg-white/10`.
- Switch dividers from `border-gray-200 dark:border-gray-700` to `border-white/10`.
- Footer link colour from `text-gray-400 dark:text-gray-500` to `text-white/40`.

### 3. Sidebar Header — `seller.njk`

Replace the current header (branding link + dark-mode toggle) with:

```njk
<div class="sidebar-header flex items-center mb-6 min-w-0">
  <div class="sidebar-title text-lg font-bold flex-1 min-w-0">{{ "Seller Portal" | t }}</div>
  <button class="sidebar-toggle hidden md:flex items-center justify-center p-1 rounded hover:bg-white/10 text-white/60 hover:text-white flex-shrink-0"
    title="{{ 'Toggle sidebar' | t }}"
    data-action="toggle-sidebar-collapse"
    aria-label="{{ 'Toggle sidebar' | t }}">
    {{ icon('panel-left') }}
  </button>
</div>
```

### 4. Nav Links — `seller.njk`

Add icons and the `sidebar-tooltip` / `sidebar-label` span pattern to each link, plus `title` attributes. Add `sidebar-divider` between the main nav and the settings section.

Icon mapping:

| Nav Item | Icon |
|----------|------|
| Overview | `home` |
| Property | `building-office-2` |
| Photos | `camera` (new) |
| Viewings | `calendar` (new) |
| Documents | `document-text` (new) |
| Financial Report | `banknotes` (new) |
| Video Tutorials | `academic-cap` |
| Notifications | `bell` |
| Settings | `cog-6-tooth` |
| My Data | `shield-check` |

### 5. New Icons — `icons.njk`

Add 4 Heroicons outline SVG paths:

- `camera`
- `banknotes`
- `calendar`
- `document-text`

### 6. CSS & JS

No changes required. Existing styles in `input.css` and handlers in `app.js` are keyed off `#sidebar` by ID and will apply automatically once the seller sidebar uses the same class structure.

## Files Changed

| File | Change |
|------|--------|
| `src/views/layouts/seller.njk` | Full rewrite of sidebar to match agent/admin pattern |
| `src/views/partials/shared/icons.njk` | Add 4 new icon definitions |

## Files Not Changed

`app.js`, `input.css`, `top-header.njk`, `agent.njk`, `admin.njk`.
