# Remove Cover Photo Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the "Cover" badge and cover hint text from the seller photos page, replacing the hint with a neutral drag-to-reorder prompt.

**Architecture:** Single Nunjucks template change — no backend, no data model, no JS changes. The first-photo-as-cover convention continues to apply internally for the agent portal; it is simply no longer surfaced to sellers.

**Tech Stack:** Nunjucks templates, Tailwind CSS

---

### Task 1: Remove cover badge and update hint text

**Files:**
- Modify: `src/views/partials/seller/photo-grid.njk:13-15, 40-44`

- [ ] **Step 1: Remove the "Cover" badge block**

In `src/views/partials/seller/photo-grid.njk`, delete lines 13–15:

```nunjucks
    {% if loop.first %}
    <span class="absolute top-2 left-2 bg-yellow-400 text-yellow-900 text-xs font-semibold px-2 py-0.5 rounded-full">{{ "Cover" | t }}</span>
    {% endif %}
```

The `<img>` tag on line 11 should be immediately followed by the `<div class="p-2">` block.

- [ ] **Step 2: Replace the cover hint text**

Replace the hint block (currently lines 40–44):

```nunjucks
{% if photos.length > 1 %}
<div class="mt-4">
  <p class="text-sm text-gray-500">{{ "The first photo will be the cover image." | t }}</p>
</div>
{% endif %}
```

With:

```nunjucks
{% if photos.length > 1 %}
<div class="mt-4">
  <p class="text-sm text-gray-500">{{ "Drag to reorder your photos." | t }}</p>
</div>
{% endif %}
```

- [ ] **Step 3: Verify the page renders correctly**

Start the dev server (`npm run dev`) and navigate to `/seller/photos` with at least 2 photos uploaded. Confirm:
- No yellow "Cover" badge appears on any photo
- The hint text reads "Drag to reorder your photos."
- Drag-to-reorder still works (photos can be dragged to new positions)
- Single-photo view: no hint text shown (unchanged behaviour)

- [ ] **Step 4: Commit**

```bash
git add src/views/partials/seller/photo-grid.njk
git commit -m "feat: remove cover photo indicator from seller photos page"
```
