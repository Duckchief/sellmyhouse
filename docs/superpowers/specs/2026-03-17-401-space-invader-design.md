# 401 Error Page — Space Invader Redesign

**Date:** 2026-03-17
**Status:** Approved

## Goal

Replace the small 🚪 emoji on the 401 error page with a large, animated Space Invader in the style of the 1978 arcade game. The page should feel like a retro arcade screen — dark, glowing, atmospheric.

## Scope

- **Only the 401 branch** of `src/views/pages/error.njk` is changed.
- 403, 404, 500, and fallback error pages are unchanged.

## Visual Design

### Page

| Property | Value |
|---|---|
| Background | `#0a0a0a` |
| Starfield | ~80 randomly placed twinkling white dots (CSS animation) |
| CRT scanlines | `repeating-linear-gradient` overlay, 4px pitch, 12% opacity |

### "401" Heading

| Property | Value |
|---|---|
| Color | `#33ff55` (arcade green) |
| Size | `80px`, bold, `Courier New` |
| Letter spacing | `12px` |
| Glow | `text-shadow` at 10px / 30px / 60px, same green |

### "Session Expired" subtitle

| Property | Value |
|---|---|
| Color | `#33ff55`, opacity 0.6 |
| Size | `12px`, `5px` letter spacing, uppercase |

### Space Invader sprite

- **Style:** Classic Type-2 "crab" invader from the 1978 arcade game
- **Colour:** `#ff66cc` (pink) with `drop-shadow` glow
- **Scale:** 18px per pixel — renders ~234px wide × ~180px tall
- **Grid:** 13 columns × 10 rows
- **Animation:**
  - 2-frame leg toggle at 600ms intervals (matches original game timing)
  - Gentle sinusoidal float (±8px vertical, period ~6s)
- **Rendering:** `<canvas>` element, `image-rendering: pixelated`

### Copy & CTA

| Element | Value |
|---|---|
| Heading | *"Looks like you wandered off!"* (existing, unchanged) |
| Body | *"You've been away a while and your session expired…"* (existing, unchanged) |
| Button | `[ Log back in ]` → `/auth/login`, outlined green border, hover glow |

## Implementation Notes

- All styles are inline in the Nunjucks template (no new CSS file needed).
- The canvas pixel art is rendered by a small inline `<script>` block — no external JS dependency.
- The starfield and float animation use `requestAnimationFrame` / CSS `@keyframes` — no libraries.
- The `{% block head %}` extension point in `base.njk` is not needed; everything is self-contained in the 401 branch.
- All user-facing strings remain wrapped in `{{ "..." | t }}` for i18n compliance.
