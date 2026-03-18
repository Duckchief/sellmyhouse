# Collapsible Sidebar — Admin & Agent Dashboards

**Date:** 2026-03-18
**Status:** Approved
**Scope:** Admin and Agent dashboards only (seller dashboard unchanged)

## Summary

Add a collapsible icon-rail sidebar to the admin and agent dashboards. When collapsed, the sidebar shrinks from 256px to 44px, showing only icons with native tooltip labels. The expanded/collapsed state persists via `localStorage`. No new dependencies required.

## Behaviour

- **Toggle:** A panel/layout icon button at the top of the sidebar (right-aligned when expanded, centred when collapsed) toggles the state. Click to collapse; click again to expand.
- **Collapsed state:** Sidebar width is 44px. Text labels are hidden (opacity 0, width 0). Icons remain centred. Dividers collapse to a short centred rule.
- **Tooltips:** Native `title` attribute on each `<a>` provides label on hover — no JS tooltip library needed.
- **Transition:** `transition: width 200ms ease` on the sidebar; `transition: opacity 150ms ease` on text labels.
- **Persistence:** State saved to `localStorage` key `sidebar:collapsed` (`"true"` / `"false"`). On `DOMContentLoaded`, `app.js` reads the key and applies the collapsed class before first paint to avoid a flash.
- **Desktop-only:** Collapse behaviour is disabled below the `md` breakpoint (768px). Mobile retains the existing hamburger/overlay behaviour unchanged.

## Technical Design

### CSS (`public/css/input.css` or a new `src/styles/sidebar.css` compiled via PostCSS)

```css
/* Sidebar collapse */
#sidebar {
  width: 16rem; /* 256px — matches w-64 */
  transition: width 200ms ease;
  overflow: hidden;
}

#sidebar.sidebar-collapsed {
  width: 2.75rem; /* 44px */
}

#sidebar .sidebar-label {
  opacity: 1;
  max-width: 200px;
  transition: opacity 150ms ease, max-width 150ms ease;
  white-space: nowrap;
  overflow: hidden;
}

#sidebar.sidebar-collapsed .sidebar-label {
  opacity: 0;
  max-width: 0;
}

#sidebar .sidebar-title {
  transition: opacity 150ms ease;
}

#sidebar.sidebar-collapsed .sidebar-title {
  opacity: 0;
  pointer-events: none;
}

/* Dividers collapse gracefully */
#sidebar.sidebar-collapsed .sidebar-divider {
  width: 24px;
  margin-left: auto;
  margin-right: auto;
}

/* Toggle button alignment */
#sidebar .sidebar-toggle {
  margin-left: auto;
}

#sidebar.sidebar-collapsed .sidebar-toggle {
  margin-left: 0;
  margin-right: 0;
}

/* Only apply collapse on desktop */
@media (max-width: 767px) {
  #sidebar.sidebar-collapsed {
    width: 16rem;
  }
}
```

### HTML changes — `admin.njk` and `agent.njk`

1. Add `sidebar-label` class to every nav link text `<span>`.
2. Add `sidebar-title` class to the portal title div.
3. Add `sidebar-divider` class to each `<div>` divider.
4. Add toggle button to the sidebar header:

```html
<div class="flex items-center justify-between mb-6">
  <div class="sidebar-title text-lg font-bold">{{ "Admin Portal" | t }}</div>
  <button id="sidebar-toggle-btn" class="sidebar-toggle p-1 rounded hover:bg-white/10 text-white/60 hover:text-white" title="{{ 'Toggle sidebar' | t }}" data-action="toggle-sidebar-collapse">
    {% include "partials/shared/icons.njk" %}
    {# panel-left icon — or reuse existing icon set #}
  </button>
</div>
```

5. Ensure every nav `<a>` wraps its label in `<span class="sidebar-label">...</span>`.

### JavaScript — `public/js/app.js`

Add two functions:

```js
// Persist and apply sidebar collapse state
function initSidebarCollapse() {
  var sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  var collapsed = localStorage.getItem('sidebar:collapsed') === 'true';
  if (collapsed) sidebar.classList.add('sidebar-collapsed');
}

// Toggle handler
if (action === 'toggle-sidebar-collapse') {
  var sidebar = document.getElementById('sidebar');
  if (sidebar) {
    var isCollapsed = sidebar.classList.toggle('sidebar-collapsed');
    localStorage.setItem('sidebar:collapsed', isCollapsed ? 'true' : 'false');
  }
}
```

Call `initSidebarCollapse()` on `DOMContentLoaded` (before first paint).

### Icon

Use the existing SVG icon set (`icons.njk`). The panel/layout icon (`squares-2x2` or a custom panel icon) is added to the icon partial if not already present. Fallback: any two-rectangle layout icon from Heroicons.

## Files to Change

| File | Change |
|------|--------|
| `src/views/layouts/admin.njk` | Add toggle button, `sidebar-label` spans, `sidebar-title` div, `sidebar-divider` classes |
| `src/views/layouts/agent.njk` | Same as admin |
| `src/views/partials/shared/icons.njk` | Add panel-left icon if not present |
| `public/js/app.js` | Add `initSidebarCollapse()` + toggle handler |
| `public/css/input.css` (or equivalent) | Add sidebar collapse CSS rules |

## Out of Scope

- Seller dashboard (unchanged)
- Hover-to-expand behaviour
- Animated icon transition (icons stay static, only text hides)
- Server-side persistence (localStorage is sufficient)
- Mobile breakpoints (existing hamburger behaviour unchanged)
