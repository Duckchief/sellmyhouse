# Onboarding Tooltip Design

**Date:** 2026-03-20
**Status:** Approved

## Problem

The "Onboarding" label on the agent seller detail page shows the current step number and label but gives no indication of what all 5 steps are. Agents have to rely on memory to know what's ahead for a seller.

## Design

Single-file change to `src/views/pages/agent/seller-detail.njk` line 28.

Wrap the `<dt>` content in a flex row with a `?` icon. The icon uses Tailwind's `group`/`group-hover:` utilities to show a tooltip on hover — no JS, no backend changes.

```html
<dt class="text-gray-500 flex items-center gap-1">
  {{ "Onboarding" | t }}
  <span class="relative group">
    <span class="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-200 text-gray-500 text-[10px] cursor-default select-none">?</span>
    <span class="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 w-52 bg-gray-800 text-white text-xs rounded px-2 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10 whitespace-normal">
      <ol class="list-decimal list-inside space-y-0.5">
        <li>Accepts initial consent</li>
        <li>Enters property details</li>
        <li>Enters financial details</li>
        <li>Uploads property photos</li>
        <li>Signs EA Agreement</li>
      </ol>
    </span>
  </span>
</dt>
```

## Notes

- Tooltip anchors above the `?`, centred, fades in on hover
- `pointer-events-none` prevents tooltip from capturing mouse events
- `z-10` keeps it above sibling rows
- Steps use `<ol>` for automatic numbering
- No JS, no backend changes, no new dependencies
