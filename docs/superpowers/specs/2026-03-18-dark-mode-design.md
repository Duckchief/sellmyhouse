# Dark Mode — Design Spec
**Date:** 2026-03-18
**Project:** SellMyHouse.sg v2
**Status:** Approved

## Summary

Add a light/dark mode toggle to all three authenticated portals (seller, agent, admin). Uses Tailwind `darkMode: 'class'` with CSS custom properties for backgrounds and explicit `dark:` overrides for text/borders. Preference persisted in `localStorage`; defaults to system `prefers-color-scheme`.

Inspired by the CRM project's implementation but adapted for Express + Nunjucks (no React/next-themes).

---

## Scope

- **In scope:** Seller dashboard, agent portal, admin portal
- **Out of scope:** Public pages (login, register, landing)

---

## Approach: Hybrid CSS vars + targeted `dark:` overrides

Five files change; everything else gets dark mode for free via CSS inheritance.

---

## Section 1: Architecture

| File | Change |
|---|---|
| `tailwind.config.ts` | Add `darkMode: 'class'`; remap `bg` colors to CSS vars; add `panel` color token |
| `src/views/styles/input.css` | Define CSS vars on `:root` + `.dark`; add `dark:` variants to component classes |
| `src/views/layouts/base.njk` | FOUC-prevention inline script (CSP nonce); `dark:text-gray-100` on `<body>` |
| `src/views/partials/shared/top-header.njk` | Add toggle button; `dark:` variants on header + dropdown |
| `public/js/app.js` | `toggle-dark-mode` action handler + system preference live listener |

The seller sidebar (white background) also gets targeted `dark:` overrides in `seller.njk`. Agent/admin sidebars are already dark navy (`bg-ink`) — no changes needed.

---

## Section 2: CSS Token System

Defined in `input.css` under `@layer base` (or as plain `:root` / `.dark` rules before `@tailwind` directives).

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--color-surface` | `#fafaf7` | `#111111` | Page background |
| `--color-surface-alt` | `#f0efe9` | `#161616` | Alt sections |
| `--color-panel` | `#ffffff` | `#1e1e1e` | Header, cards, dropdowns, seller sidebar |

Borders are handled with Tailwind `dark:border-gray-700` overrides rather than a CSS var — keeps things simple and consistent with how the rest of the codebase uses gray-scale border utilities.

`tailwind.config.ts` remaps the existing `bg` color tokens to CSS vars and adds a new `panel` token:

```ts
darkMode: 'class',
// extend.colors:
bg: {
  DEFAULT: 'var(--color-surface)',
  alt: 'var(--color-surface-alt)',
},
panel: 'var(--color-panel)',
```

`ink` (navy) and `accent` (burnt orange) remain hardcoded — they work in both modes as-is.

---

## Section 3: FOUC Prevention

An inline script with CSP nonce in `base.njk` `<head>` applies the `dark` class to `<html>` synchronously before the CSS paints:

```html
<script nonce="{{ cspNonce }}">
  (function() {
    var stored = localStorage.getItem('theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (stored === 'dark' || (!stored && prefersDark)) {
      document.documentElement.classList.add('dark');
    }
  })();
</script>
```

Uses the same CSP nonce pattern already established in the project.

**`app.js` toggle handler** (added to event delegation switch):

```js
case 'toggle-dark-mode':
  var isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  // update button icon via data-theme attribute on <html>
  break;
```

A `matchMedia` change listener added at init time responds to live OS preference changes when no manual override is stored. If the user has explicitly toggled (i.e. `localStorage` has a value), the stored value always wins and OS changes are ignored.

**Toggle icon:** The button holds both a sun SVG and a moon SVG. Whichever is active is shown via CSS:
```css
.dark #theme-sun { display: none; }
#theme-moon { display: none; }
.dark #theme-moon { display: block; }
```

---

## Section 4: Component Dark Styling

### `input.css` component classes (no template edits needed)

| Class | Addition |
|---|---|
| `.card` | `dark:bg-panel dark:border-gray-700` |
| `.input-field` | `dark:bg-panel dark:border-gray-600 dark:text-gray-100` |
| `.page-section-title` | `dark:text-gray-100` |

### `top-header.njk` (targeted edits)

- Header: `dark:bg-panel dark:border-gray-700`
- Dropdown panel: `dark:bg-panel dark:border-gray-700`
- Dropdown dividers: `dark:border-gray-700`
- Dropdown text: `dark:text-gray-100` / `dark:text-gray-400`
- Hover states: `dark:hover:bg-gray-800`

### `src/views/layouts/seller.njk` sidebar only

- Sidebar: `dark:bg-panel dark:border-gray-700`
- Nav link text/hover: `dark:text-gray-300 dark:hover:bg-gray-800`

### Toggle button (added to `top-header.njk`)

- Position: right section of header, to the left of the user dropdown
- `data-action="toggle-dark-mode"` — hooks into existing event delegation
- 36×36px ghost button, inline sun + moon SVGs
- Accessible `aria-label`

---

## Testing

- Unit: none needed (purely presentational)
- Manual: verify light → dark → light toggle; verify localStorage persistence across refresh; verify system preference respected on first load; verify no FOUC on hard reload in dark mode
- Verify all three portals: seller, agent, admin
- Manual pass to confirm no hardcoded `bg-white` / `bg-gray-50` utilities remain in authenticated layout areas (these are Tailwind built-ins and won't pick up the CSS var automatically)
