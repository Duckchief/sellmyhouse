# Sidebar Polish Design Spec

**Date:** 2026-03-18
**Status:** Approved

## Goal

Fix three visual defects in the collapsed icon-rail sidebar on admin and agent dashboards:
1. Icons are left-aligned when collapsed — they should be centred in the 44px rail.
2. No custom tooltip — browser `title` tooltips appear with a delay and look inconsistent. Replace with a Claude.ai-style dark pill that appears immediately to the right of the icon.
3. Item spacing is tight — increase vertical padding to match Claude.ai's sidebar feel.

## Scope

Admin and agent sidebar layouts only (`admin.njk`, `agent.njk`). Seller sidebar is unchanged.

## Design

### 1. Icon Centering

**Problem:** Nav links use `flex items-center gap-2 px-3`. When the `sidebar-label` collapses to 0-width, the icon remains at the left edge. Additionally, the `border-l-2` active indicator shifts the icon 2px right.

**Fix (CSS):** When collapsed, override the link layout:

```css
#sidebar.sidebar-collapsed nav a {
  justify-content: center;
  padding-left: 0;
  padding-right: 0;
  border-left-width: 0;
}
```

The `border-l-2` active indicator is hidden in collapsed state — it is decorative only and doesn't need to appear when the label is hidden.

### 2. Claude.ai-Style Tooltips

**Appearance:** A dark pill (`background: #111827`, white text, `border-radius: 6px`, `padding: 4px 10px`) positioned absolutely to the right of the icon with a 10px gap. Appears immediately on hover (no delay). Only shown when the sidebar is collapsed.

**Overflow problem:** `#sidebar` uses `overflow: hidden` during the collapse animation to prevent text spilling outside the narrowing sidebar. A tooltip positioned with `left: calc(100% + 10px)` would be clipped by this.

**Solution — `sidebar-settled` class:** After the width transition completes, add `sidebar-settled` to `#sidebar`, which sets `overflow: visible`. This allows the tooltip to render outside the 44px boundary. The class is removed before each toggle so `overflow: hidden` is restored for the next animation.

**HTML change:** Each nav link gets a `<span class="sidebar-tooltip">` immediately after the icon SVG and before the `sidebar-label` span. The span is `position: absolute` so it does not affect flex layout or icon centering.

```html
{{ icon('home') }}
<span class="sidebar-tooltip">{{ "Dashboard" | t }}</span>
<span class="sidebar-label">{{ "Dashboard" | t }}</span>
```

**CSS:**
```css
#sidebar nav a {
  position: relative;
}
#sidebar nav a .sidebar-tooltip {
  display: none;
  position: absolute;
  left: calc(100% + 10px);
  top: 50%;
  transform: translateY(-50%);
  background: #111827;
  color: #f9fafb;
  font-size: 12px;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: 6px;
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(0,0,0,0.4);
  z-index: 200;
  pointer-events: none;
}
#sidebar.sidebar-settled.sidebar-collapsed nav a:hover .sidebar-tooltip {
  display: block;
}
#sidebar.sidebar-settled {
  overflow: visible;
}
```

**JS changes to `app.js`:**

1. **IIFE (before-first-paint restore):** If restoring to collapsed state on page load, also add `sidebar-settled` immediately (no animation occurred, so overflow can be visible right away).

2. **Toggle handler:** Remove `sidebar-settled` before toggling, so `overflow: hidden` is in effect for the animation.

3. **`transitionend` listener:** After the width transition finishes (when collapsing), add `sidebar-settled`.

```js
// (1) IIFE update:
if (sidebar && localStorage.getItem('sidebar:collapsed') === 'true') {
  sidebar.classList.add('sidebar-collapsed');
  sidebar.classList.add('sidebar-settled');
}

// (2) Toggle handler update:
if (action === 'toggle-sidebar-collapse') {
  var sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.classList.remove('sidebar-settled');
    var isCollapsed = sidebar.classList.toggle('sidebar-collapsed');
    localStorage.setItem('sidebar:collapsed', isCollapsed ? 'true' : 'false');
  }
}

// (3) New transitionend listener (added once on DOMContentLoaded):
var sidebar = document.getElementById('sidebar');
if (sidebar) {
  sidebar.addEventListener('transitionend', function (e) {
    if (e.propertyName === 'width' && sidebar.classList.contains('sidebar-collapsed')) {
      sidebar.classList.add('sidebar-settled');
    }
  });
}
```

### 3. Spacing

All nav links in `admin.njk` and `agent.njk`: change `py-2` to `py-2.5`. This increases item height from ~32px to ~36px, consistent with Claude.ai's collapsed rail feel. No changes to `space-y-1` gap between items.

## Files Changed

| File | Change |
|------|--------|
| `src/views/styles/input.css` | Add icon-centering rules, tooltip CSS, `sidebar-settled` overflow rule |
| `src/views/layouts/admin.njk` | Add `sidebar-tooltip` spans to all 15 nav links; `py-2` → `py-2.5` |
| `src/views/layouts/agent.njk` | Add `sidebar-tooltip` spans to all 5 nav links; `py-2` → `py-2.5` |
| `public/js/app.js` | Update IIFE, update toggle handler, add `transitionend` listener |

## No Tests Required

These are pure CSS/HTML/JS presentation changes with no server-side logic, routing, or data access. Visual verification in the browser is sufficient.
