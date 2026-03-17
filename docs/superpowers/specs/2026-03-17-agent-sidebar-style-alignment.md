# Spec: Agent Sidebar Style Alignment

**Date:** 2026-03-17
**Status:** Approved
**Scope:** `src/views/layouts/agent.njk` only

## Problem

The agent sidebar is visually inconsistent with the admin sidebar. Both use the same `bg-ink` dark shell but the agent layout is missing several styling details present in the admin layout.

## Changes Required

All changes are in `src/views/layouts/agent.njk`.

### 1. Active state
Add `text-accent border-l-2 border-accent` to the active class on every nav link.

**Before:** `{% if currentPath == '/agent/...' %}bg-white/10{% endif %}`
**After:** `{% if currentPath == '/agent/...' %}bg-white/10 text-accent border-l-2 border-accent{% endif %}`

### 2. Text size
Add `text-sm` to every nav link `<a>` tag.

### 3. Nav flex
Add `flex-1` to `<nav>` so it fills available space and pushes the sign-out footer to the bottom.

### 4. Sign out footer
Add a footer block inside `<aside>` after `</nav>`:

```html
<div class="mt-auto pt-4 border-t border-white/10">
  <a href="/auth/logout" class="flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:text-red-300">{{ icon('arrow-right-on-rectangle') }}{{ "Sign Out" | t }}</a>
</div>
```

### 5. Main overflow
Add `overflow-auto` to `<main>` (retain existing `bg-bg` class).

### 6. Template formatting (cosmetic)
Inline icon + label onto one line per link to match admin template style.

## Out of Scope
- No changes to `admin.njk`
- No Nunjucks macro or shared partial extraction
- No changes to nav items, routes, or section labels in agent sidebar
