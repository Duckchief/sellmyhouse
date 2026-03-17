# 403 Error Page — Space Invaders Formation

**Date:** 2026-03-17
**Status:** Approved

## Overview

Replace the existing plain-emoji 403 error page with an arcade-style full-screen experience matching the 401 page aesthetic, featuring a 2×3 Space Invaders formation patrolling the full viewport width.

## Visual Design

### Layout (same structure as 401)

```
[fixed full-screen dark overlay: #0a0a0a]
[80 twinkling stars — position: fixed, z-index: 0]
[CRT scanline overlay — position: fixed, z-index: 100]

[inv-content — flex column, centered vertically and horizontally]
  403                        ← green glowing code, same as 401
  ACCESS DENIED              ← green subtitle, same style as 401
  [40px gap]
  [full-width canvas band]   ← 100vw, formation patrols inside
  [40px gap]
  "This sector is off limits."
  "You don't have permission to access this page..."
  [ Return to base ]         ← green border button, same style as 401
```

### Canvas Band

- `width: 100vw`, positioned with `left: 50%; transform: translateX(-50%)` to break out of the centered content column
- Canvas height = formation height + 80px internal glow padding (40px top + 40px bottom)
- Glow is drawn **inside** the canvas using `ctx.shadowBlur` (not CSS `filter: drop-shadow`, which clips at element bounds)

### Formation

- **Grid:** 2 rows × 3 columns of Space Invaders
- **Sprite:** same 11×8 pixel art as the 401 invader, 2-frame animation alternating every 600ms
- **Pixel size:** PX = 10 (twice the 401 page's PX = 5, so invaders are large and readable)
- **Gap between invaders:** 28px horizontal, 20px vertical
- **Formation size:** 386px wide × 180px tall

### Patrol Behaviour

- **Classic formation:** all 6 invaders move as one unit, bouncing left-to-right across the full viewport width
- Speed: 1.8px per frame
- Bounces at 40px from each edge (matches glow padding)
- Pixel frame toggles at 600ms interval (same as 401)

### Colours

- **Top row:** pink `#ff66cc` (same as 401 invader)
- **Bottom row:** amber `#ff9933`
- Each row rendered with matching `ctx.shadowColor` glow (blur radius 32)
- Two-pass draw: glow pass (shadowBlur = 32) then crisp solid pass (shadowBlur = 0)

### Copy

| Element | Text |
|---|---|
| Status code | `403` |
| Subtitle | `Access Denied` |
| Heading | `This sector is off limits.` |
| Body | `You don't have permission to access this page. If you think that's a mistake, contact your administrator.` |
| Button | `[ Return to base ]` → links to `/` |

## Implementation

### File to edit

`src/views/pages/error.njk` — replace the existing `{% elif statusCode == 403 %}` block.

### Pattern

Identical to the `{% if statusCode == 401 %}` block:
- Inline `<style>` block with scoped `.inv-*` classes
- `<div class="inv-body" style="position:fixed;inset:0;overflow-y:auto;">` override
- Stars, scanline, inv-content, canvas, message
- `<script nonce="{{ cspNonce }}">` for all animation logic

### No new files

Everything lives inside the existing `error.njk` conditional block. No new routes, no new templates.

## What Stays the Same as 401

- `inv-body`, `inv-stars`, `inv-star`, `inv-scanline`, `inv-content`, `inv-code`, `inv-subtitle`, `inv-message`, `inv-btn` — identical CSS
- `@keyframes inv-twinkle` — identical
- 80-star generation loop — identical
- `FRAME_1` / `FRAME_2` sprite data — identical pixel art
- Button style and hover state — identical

## What Is Different from 401

| | 401 | 403 |
|---|---|---|
| Canvas | Centred, fixed size | Full-width band (100vw) |
| Invader count | 1 | 6 (2 rows × 3) |
| Pixel size | PX = 5 | PX = 10 |
| Colours | Single pink | Top row pink, bottom row amber |
| Glow | CSS `filter: drop-shadow` | `ctx.shadowBlur` (canvas-internal) |
| Float animation | Vertical sine wave | None (formation patrols horizontally) |
| Subtitle | "Session Expired" | "Access Denied" |
| Button target | `/auth/login` | `/` |
