# 401 Space Invader Error Page Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the boring 🚪 emoji on the 401 error page with a large animated pink Space Invader on a dark retro arcade background.

**Architecture:** Single template change — the 401 branch of `src/views/pages/error.njk` is replaced with a self-contained arcade-style layout. All styles and canvas pixel art are inline. No new files, no new dependencies.

**Tech Stack:** Nunjucks, HTML5 Canvas, vanilla CSS animations, `requestAnimationFrame`

**Spec:** `docs/superpowers/specs/2026-03-17-401-space-invader-design.md`

---

## Chunk 1: Update the 401 error page template

### Task 1: Replace the 401 branch in `error.njk`

**Files:**
- Modify: `src/views/pages/error.njk:9-17` (the `{% if statusCode == 401 %}` block)

The 401 branch currently renders a small 🚪 emoji. Replace it entirely with the arcade layout below. All other branches (403, 404, 500, fallback) are **untouched**.

- [ ] **Step 1: Open the file and locate the 401 branch**

Open `src/views/pages/error.njk`. The 401 branch starts at line 9:
```nunjucks
{% if statusCode == 401 %}
  <div class="text-6xl mb-4">🚪</div>
  ...
```
Everything between `{% if statusCode == 401 %}` and `{% elif statusCode == 403 %}` will be replaced.

- [ ] **Step 2: Replace the 401 branch with the arcade layout**

Replace the entire 401 branch (lines 9–17, up to but NOT including `{% elif statusCode == 403 %}`):

```nunjucks
{% if statusCode == 401 %}
  <style>
    .inv-body {
      background: #0a0a0a;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px 20px;
      overflow: hidden;
      position: relative;
      font-family: 'Courier New', monospace;
    }
    .inv-stars {
      position: fixed;
      inset: 0;
      overflow: hidden;
      z-index: 0;
      pointer-events: none;
    }
    .inv-star {
      position: absolute;
      background: #fff;
      border-radius: 50%;
      opacity: 0;
      animation: inv-twinkle linear infinite;
    }
    @keyframes inv-twinkle {
      0%   { opacity: 0; }
      50%  { opacity: 0.8; }
      100% { opacity: 0; }
    }
    .inv-scanline {
      position: fixed;
      inset: 0;
      background: repeating-linear-gradient(
        to bottom,
        transparent 0px, transparent 3px,
        rgba(0,0,0,0.12) 3px, rgba(0,0,0,0.12) 4px
      );
      pointer-events: none;
      z-index: 100;
    }
    .inv-content {
      position: relative;
      z-index: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .inv-code {
      font-size: 80px;
      font-weight: 900;
      color: #33ff55;
      letter-spacing: 12px;
      text-shadow: 0 0 10px #33ff55, 0 0 30px #33ff55, 0 0 60px rgba(51,255,85,0.5);
      margin-bottom: 6px;
      text-align: center;
    }
    .inv-subtitle {
      font-size: 12px;
      color: #33ff55;
      opacity: 0.6;
      letter-spacing: 5px;
      text-transform: uppercase;
      margin-bottom: 40px;
      text-align: center;
    }
    #inv-canvas {
      display: block;
      image-rendering: pixelated;
      image-rendering: crisp-edges;
      filter: drop-shadow(0 0 16px rgba(255,102,204,0.7)) drop-shadow(0 0 40px rgba(255,102,204,0.3));
    }
    .inv-message {
      margin-top: 40px;
      text-align: center;
    }
    .inv-message h1 {
      font-size: 20px;
      font-weight: 700;
      color: #e0e0e0;
      margin-bottom: 10px;
      letter-spacing: 2px;
      text-transform: uppercase;
    }
    .inv-message p {
      font-size: 13px;
      color: #666;
      margin-bottom: 32px;
      max-width: 380px;
      line-height: 1.7;
      margin-left: auto;
      margin-right: auto;
    }
    .inv-btn {
      display: inline-block;
      padding: 14px 36px;
      background: transparent;
      color: #33ff55;
      font-family: 'Courier New', monospace;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 3px;
      text-decoration: none;
      border: 2px solid #33ff55;
      text-transform: uppercase;
      box-shadow: 0 0 10px rgba(51,255,85,0.3);
      transition: background 0.15s, box-shadow 0.15s;
    }
    .inv-btn:hover {
      background: rgba(51,255,85,0.12);
      box-shadow: 0 0 20px rgba(51,255,85,0.6);
    }
  </style>

  {# Override the outer wrapper from error.njk so we get a full dark background #}
  <div class="inv-body" style="position:fixed;inset:0;overflow-y:auto;">
    <div class="inv-stars" id="inv-stars"></div>
    <div class="inv-scanline"></div>

    <div class="inv-content">
      <div class="inv-code">401</div>
      <div class="inv-subtitle">{{ "Session Expired" | t }}</div>

      <canvas id="inv-canvas"></canvas>

      <div class="inv-message">
        <h1>{{ "Looks like you wandered off!" | t }}</h1>
        <p>{{ "You've been away a while and your session expired. Totally normal — it happens to the best of us." | t }}</p>
        <a href="/auth/login" class="inv-btn">{{ "[ Log back in ]" | t }}</a>
      </div>
    </div>
  </div>

  <script nonce="{{ cspNonce }}">
  (function () {
    var X = true, _ = false;
    var FRAME_1 = [
      [_,_,_,X,_,_,_,_,_,X,_,_,_],
      [_,_,_,_,X,_,_,_,X,_,_,_,_],
      [_,_,X,X,X,X,X,X,X,X,X,_,_],
      [_,X,X,_,X,X,X,X,X,_,X,X,_],
      [X,X,X,X,X,X,X,X,X,X,X,X,X],
      [X,_,X,X,X,X,X,X,X,X,X,_,X],
      [X,_,X,_,_,_,_,_,_,_,X,_,X],
      [_,_,_,X,X,_,_,_,X,X,_,_,_],
      [_,_,X,X,_,_,_,_,_,X,X,_,_],
      [_,_,_,_,_,_,_,_,_,_,_,_,_]
    ];
    var FRAME_2 = [
      [_,_,_,X,_,_,_,_,_,X,_,_,_],
      [_,_,_,_,X,_,_,_,X,_,_,_,_],
      [_,_,X,X,X,X,X,X,X,X,X,_,_],
      [_,X,X,_,X,X,X,X,X,_,X,X,_],
      [X,X,X,X,X,X,X,X,X,X,X,X,X],
      [X,_,X,X,X,X,X,X,X,X,X,_,X],
      [X,_,X,_,_,_,_,_,_,_,X,_,X],
      [_,_,X,X,_,_,_,_,_,X,X,_,_],
      [_,_,_,X,X,_,_,_,X,X,_,_,_],
      [_,_,_,_,_,_,_,_,_,_,_,_,_]
    ];
    var FRAMES = [FRAME_1, FRAME_2];
    var COLOR = '#ff66cc';
    var PX = 18;
    var COLS = 13, ROWS = 10;

    var canvas = document.getElementById('inv-canvas');
    canvas.width  = COLS * PX;
    canvas.height = ROWS * PX;
    var ctx = canvas.getContext('2d');

    var frame = 0;
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      var grid = FRAMES[frame];
      for (var y = 0; y < ROWS; y++) {
        for (var x = 0; x < COLS; x++) {
          if (grid[y][x]) {
            ctx.fillStyle = COLOR;
            ctx.fillRect(x * PX, y * PX, PX, PX);
          }
        }
      }
    }
    draw();
    setInterval(function () { frame = 1 - frame; draw(); }, 600);

    var t = 0;
    (function float() {
      canvas.style.transform = 'translateY(' + Math.round(Math.sin(t) * 8) + 'px)';
      t += 0.04;
      requestAnimationFrame(float);
    })();

    var starsEl = document.getElementById('inv-stars');
    for (var i = 0; i < 80; i++) {
      var s = document.createElement('div');
      s.className = 'inv-star';
      var size = (Math.random() * 2 + 1).toFixed(1);
      s.style.cssText = 'width:' + size + 'px;height:' + size + 'px;' +
        'top:' + (Math.random() * 100).toFixed(1) + '%;' +
        'left:' + (Math.random() * 100).toFixed(1) + '%;' +
        'animation-duration:' + (2 + Math.random() * 4).toFixed(1) + 's;' +
        'animation-delay:' + (Math.random() * 4).toFixed(1) + 's;';
      starsEl.appendChild(s);
    }
  })();
  </script>
```

**Important implementation notes:**
- The `<style>` block goes inside the `{% if statusCode == 401 %}` branch — it only loads on 401 pages.
- The `<script>` tag uses `nonce="{{ cspNonce }}"` — this is required by the app's Content Security Policy (see `src/infra/http/app.ts` for how `cspNonce` is set on `res.locals`).
- The outer `div.min-h-screen.bg-bg` wrapper from the parent template will still render, but the `position:fixed;inset:0` on `inv-body` overrides the visual appearance — the dark background fills the viewport.
- All user-facing strings are wrapped in `{{ "..." | t }}` per the i18n convention in CLAUDE.md.
- Use `var` (not `const`/`let`) in the inline script for broadest compatibility, or confirm Babel/transpilation is not needed for inline scripts (it isn't — inline scripts run in the browser directly).

- [ ] **Step 3: Verify the existing tests still pass**

Run:
```bash
npm test -- --testPathPattern="error-handler"
```
Expected: all 5 tests pass. The tests only check that `res.render` is called with `'pages/error'` and `{ statusCode: 401 }` — they don't inspect template content, so no test changes needed.

- [ ] **Step 4: Start the dev server and manually verify the 401 page**

```bash
npm run dev
```

Then trigger a 401 by visiting any authenticated route while logged out, e.g. `http://localhost:3000/seller/dashboard`. You should see:
- Dark background with twinkling stars
- CRT scanlines
- Green glowing "401" heading
- Green "SESSION EXPIRED" subtitle
- Large pink Space Invader with animated legs and floating movement
- "LOOKS LIKE YOU WANDERED OFF!" heading
- Body copy and green outlined `[ Log back in ]` button

- [ ] **Step 5: Commit**

```bash
git add src/views/pages/error.njk
git commit -m "feat: replace 401 error door emoji with animated Space Invader"
```
