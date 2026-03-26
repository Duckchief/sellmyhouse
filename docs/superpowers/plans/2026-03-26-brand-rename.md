# Brand Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename all references from sellmyhomenow.sg → sellmyhouse.sg and smhn → smh across the entire codebase.

**Architecture:** Ordered find-and-replace (longest strings first to avoid partial matches), followed by one manual template edit, Docker recreation, and full verification. No feature code changes — purely string replacements.

**Tech Stack:** sed for bulk replacements, manual edits for the header template, Docker Compose for database recreation.

**Spec:** `docs/superpowers/specs/2026-03-26-brand-rename-design.md`

---

## Rename Rules (apply in this order)

| # | Find | Replace |
|---|------|---------|
| 1 | `sellmyhomenow-v2` | `sellmyhouse-v2` |
| 2 | `sellmyhomenow_dev` | `smh_dev` |
| 3 | `sellmyhomenow_test` | `smh_test` |
| 4 | `sellmyhomenow.sg` | `sellmyhouse.sg` |
| 5 | `SellMyHomeNow.sg` | `SellMyHouse.sg` |
| 6 | `SellMyHomeNow` | `SellMyHouse` |
| 7 | `SellMyHome` | `SellMyHouse` |
| 8 | `sellmyhomenow` | `sellmyhouse` |
| 9 | `smhn` | `smh` |

---

### Task 1: Stop Docker containers

**Why first:** Docker volumes hold the old database names. Must stop before changing compose files.

- [ ] **Step 1: Stop dev and test Docker containers**

```bash
docker compose -f docker/docker-compose.dev.yml down -v
docker compose -f docker/docker-compose.test.yml down -v
```

- [ ] **Step 2: Verify containers are stopped**

```bash
docker ps
```

Expected: no Postgres containers from this project listed.

---

### Task 2: Rename configuration files

**Files:**
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `.env` (not in git — must update manually)
- Modify: `playwright.config.ts`
- Modify: `public/manifest.json`
- Modify: `public/sw.js`

Apply all 9 rename rules to each file. Key changes:

- [ ] **Step 1: `package.json`** — Rule 1: `"name": "sellmyhomenow-v2"` → `"name": "sellmyhouse-v2"`

- [ ] **Step 2: `.env.example` and `.env`** — Rules 2, 3, 4, 9 (apply identical changes to both files):
  - `sellmyhomenow_dev` → `smh_dev`
  - `sellmyhomenow_test` → `smh_test`
  - `noreply@sellmyhomenow.sg` → `noreply@sellmyhouse.sg`
  - `smhn:smhn_dev` → `smh:smh_dev`
  - `smhn:smhn_test` → `smh:smh_test`

- [ ] **Step 3: `playwright.config.ts`** — Rules 3, 9:
  - `sellmyhomenow_test` → `smh_test`
  - `smhn:smhn_test` → `smh:smh_test`

- [ ] **Step 4: `public/manifest.json`** — Rules 5, 7:
  - `"name": "SellMyHomeNow.sg"` → `"name": "SellMyHouse.sg"`
  - `"short_name": "SellMyHome"` → `"short_name": "SellMyHouse"`

- [ ] **Step 5: `public/sw.js`** — Rule 9: `smhn-v2` → `smh-v2`

- [ ] **Step 6: Commit**

```bash
git add package.json .env.example playwright.config.ts public/manifest.json public/sw.js
git commit -m "chore: rename brand in configuration files (sellmyhomenow → sellmyhouse)"
```

---

### Task 3: Rename Docker & CI files

**Files:**
- Modify: `docker/docker-compose.yml`
- Modify: `docker/docker-compose.dev.yml`
- Modify: `docker/docker-compose.test.yml`
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: `docker/docker-compose.yml`** — Rule 8: `local/sellmyhomenow` → `local/sellmyhouse`

- [ ] **Step 2: `docker/docker-compose.dev.yml`** — Rule 9: all `smhn` → `smh` (user, password, pg_isready)

- [ ] **Step 3: `docker/docker-compose.test.yml`** — Rule 9: all `smhn` → `smh`

- [ ] **Step 4: `.github/workflows/deploy.yml`** — Rules 1, 3, 9:
  - `sellmyhomenow-v2` → `sellmyhouse-v2` (deploy directory)
  - `sellmyhomenow_test` → `smh_test` (POSTGRES_DB)
  - `smhn:smhn_test` → `smh:smh_test` (DATABASE_URL)
  - `smhn` → `smh` (POSTGRES_USER, POSTGRES_PASSWORD)

- [ ] **Step 5: Commit**

```bash
git add docker/docker-compose.yml docker/docker-compose.dev.yml docker/docker-compose.test.yml .github/workflows/deploy.yml
git commit -m "chore: rename brand in Docker and CI config (sellmyhomenow → sellmyhouse)"
```

---

### Task 4: Rename source code files

**Files (apply all 9 rules to each):**
- Modify: `src/infra/http/middleware/session.ts` — cookie name `smhn.sid` → `smh.sid`
- Modify: `src/infra/email/__tests__/system-mailer.test.ts`
- Modify: `src/domains/auth/auth.service.ts`
- Modify: `src/domains/auth/auth.login.router.ts`
- Modify: `src/domains/auth/__tests__/auth.service.test.ts`
- Modify: `src/domains/admin/admin.service.ts`
- Modify: `src/domains/admin/admin.router.ts`
- Modify: `src/domains/lead/lead.service.ts`
- Modify: `src/domains/lead/verification.service.ts`
- Modify: `src/domains/lead/__tests__/lead.service.test.ts`
- Modify: `src/domains/content/content.service.ts`
- Modify: `src/domains/content/content.service.test.ts`
- Modify: `src/domains/content/content.types.ts`
- Modify: `src/domains/offer/offer.service.ts`
- Modify: `src/domains/viewing/viewing.service.ts`
- Modify: `src/domains/transaction/transaction.jobs.ts`
- Modify: `src/domains/transaction/__tests__/transaction.jobs.test.ts`
- Modify: `src/domains/notification/notification.service.ts`
- Modify: `src/domains/notification/notification.templates.ts`
- Modify: `src/domains/notification/__tests__/notification.service.test.ts`
- Modify: `src/domains/notification/providers/email.provider.ts`
- Modify: `src/domains/shared/ai/prompts/financial-narrative.ts`

- [ ] **Step 1: Apply all 9 rename rules** to every file listed above. For each file, apply rules in order (1→9) to avoid partial matches.

- [ ] **Step 2: Verify no `sellmyhomenow` or `smhn` remain in `src/`**

```bash
grep -ri "sellmyhomenow\|smhn" --include="*.ts" src/
```

Expected: zero hits.

- [ ] **Step 3: Commit**

```bash
git add src/
git commit -m "chore: rename brand in source code (sellmyhomenow → sellmyhouse)"
```

---

### Task 5: Rename template files

**Files (apply all 9 rules, plus one manual edit):**
- Modify: `src/views/layouts/base.njk`
- Modify: `src/views/partials/header.njk`
- Modify: `src/views/partials/public/header.njk` **(manual edit required)**
- Modify: `src/views/partials/footer.njk`
- Modify: `src/views/partials/public/footer.njk`
- Modify: `src/views/partials/seller/onboarding-step-1.njk`
- Modify: `src/views/partials/admin/referral-top-table.njk`
- Modify: `src/views/emails/base.njk`
- Modify: `src/views/public/viewing-booking.njk`
- Modify: `src/views/pages/public/home.njk`
- Modify: `src/views/pages/public/privacy.njk`
- Modify: `src/views/pages/public/terms.njk`
- Modify: `src/views/pages/public/market-report.njk`
- Modify: `src/views/pages/public/maintenance.njk`
- Modify: `src/views/pages/public/testimonial-form.njk`
- Modify: `src/views/pages/public/testimonial-thankyou.njk`
- Modify: `src/views/pages/public/testimonial-expired.njk`
- Modify: `src/views/pages/auth/login.njk`
- Modify: `src/views/pages/auth/register.njk`
- Modify: `src/views/pages/auth/setup-account.njk`
- Modify: `src/views/pages/auth/setup-account-error.njk`
- Modify: `src/views/pages/auth/forgot-password.njk`
- Modify: `src/views/pages/auth/reset-password.njk`
- Modify: `src/views/pages/auth/verify-email-error.njk`
- Modify: `src/views/pages/auth/2fa-setup.njk`
- Modify: `src/views/pages/auth/2fa-verify.njk`
- Modify: `src/views/pages/seller/dashboard.njk`
- Modify: `src/views/pages/seller/onboarding.njk`
- Modify: `src/views/pages/seller/documents.njk`
- Modify: `src/views/pages/seller/financial.njk`
- Modify: `src/views/pages/seller/notifications.njk`
- Modify: `src/views/pages/seller/referral.njk`
- Modify: `src/views/pages/seller/tutorials.njk`
- Modify: `src/views/pages/profile/index.njk`
- Modify: `src/views/pages/profile/index-admin.njk`
- Modify: `src/views/pages/agent/settings.njk`
- Modify: `src/views/pages/error.njk`
- Modify: `src/views/pages/placeholder.njk`
- Modify: `src/views/pages/unsubscribe-confirmed.njk`
- Modify: `public/offline.html`

- [ ] **Step 1: Apply all 9 rename rules** to every file listed above.

- [ ] **Step 2: Manual edit — public header brand treatment**

The public header at `src/views/partials/public/header.njk:26` currently renders:

```njk
{{ "SellMyHome" | t }}<span class="text-[#c8553d]">{{ "Now" | t }}</span>{{ ".sg" | t }}
```

After Rule 7, `SellMyHome` becomes `SellMyHouse`. But the `{{ "Now" | t }}` token and the coloured span are leftover from the old brand. The new brand is "SellMyHouse.sg" — decide how to style it.

**Replace with:**
```njk
{{ "SellMy" | t }}<span class="text-[#c8553d]">{{ "House" | t }}</span>{{ ".sg" | t }}
```

This keeps the same visual pattern (coloured accent on the differentiating word) but for the new brand.

- [ ] **Step 3: Verify no `sellmyhomenow` or `smhn` remain in views**

```bash
grep -ri "sellmyhomenow\|smhn" src/views/ public/offline.html
```

Expected: zero hits.

- [ ] **Step 4: Commit**

```bash
git add src/views/ public/offline.html
git commit -m "chore: rename brand in templates (sellmyhomenow → sellmyhouse)"
```

---

### Task 6: Rename test files

**Files:**
- Modify: `tests/helpers/set-test-env.ts`
- Modify: `tests/helpers/setup.ts`
- Modify: `tests/helpers/prisma.ts`
- Modify: `tests/integration/public.test.ts`
- Modify: `tests/integration/content.test.ts`
- Modify: `tests/integration/financial.test.ts`
- Modify: `tests/integration/compliance-sp1.test.ts`
- Modify: `tests/integration/compliance-sp2.test.ts`
- Modify: `tests/integration/compliance-sp3.test.ts`
- Modify: `tests/e2e/content.spec.ts`

- [ ] **Step 1: Apply all 9 rename rules** to every file listed above.

- [ ] **Step 2: Verify no `sellmyhomenow` or `smhn` remain in tests**

```bash
grep -ri "sellmyhomenow\|smhn" tests/
```

Expected: zero hits.

- [ ] **Step 3: Commit**

```bash
git add tests/
git commit -m "chore: rename brand in test files (sellmyhomenow → sellmyhouse)"
```

---

### Task 7: Rename seeds & scripts

**Files:**
- Modify: `scripts/devseed.ts` — agent email addresses (`david@sellmyhomenow.sg` etc.)
- Modify: `prisma/seeds/system-settings.ts` — `platform_name`, `support_email`

- [ ] **Step 1: Apply rules 4 and 5** to both files (domain and branded display name).

- [ ] **Step 2: Verify**

```bash
grep -ri "sellmyhomenow\|smhn" scripts/ prisma/seeds/
```

Expected: zero hits.

- [ ] **Step 3: Commit**

```bash
git add scripts/devseed.ts prisma/seeds/system-settings.ts
git commit -m "chore: rename brand in seeds and scripts (sellmyhomenow → sellmyhouse)"
```

---

### Task 8: Rename documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/phase-0-shared-context.md`
- Modify: `docs/phase-1-foundation.md`
- Modify: `docs/phase-2-seller-dashboard.md`
- Modify: `docs/phase-3-agent-admin-dashboard.md`
- Modify: `docs/phase-4-transaction-management.md`
- Modify: `docs/phase-5-pdpa-compliance.md`
- Modify: `docs/phase-6-content-referrals.md`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `docs/superpowers/specs/2026-03-10-v2-rewrite-design.md`
- Modify: `docs/superpowers/specs/2026-03-10-phase-1a-schema-hdb-design.md`
- Modify: `docs/superpowers/specs/2026-03-10-phase-1c-public-website-pwa-design.md`
- Modify: `docs/superpowers/specs/2026-03-12-phase-5-pdpa-compliance-design.md`
- Modify: `docs/superpowers/specs/2026-03-12-phase-6-content-referrals-design.md`
- Modify: `docs/superpowers/specs/2026-03-15-referral-message-view-design.md`
- Modify: `docs/superpowers/specs/2026-03-18-maintenance-mode.md`
- Modify: `docs/superpowers/specs/2026-03-18-dark-mode-design.md`
- Modify: `docs/superpowers/specs/2026-03-24-listing-description-generation-design.md`
- Modify: `docs/superpowers/specs/2026-03-26-brand-rename-design.md`
- Modify: all `docs/superpowers/plans/*.md` files that contain matches
- Modify: all `docs/plans/*.md` files that contain matches

- [ ] **Step 1: Apply all 9 rename rules** to every documentation file listed above.

**IMPORTANT:** Exclude these two files from bulk replacement — they contain old names in "Find" columns and rule descriptions that must be preserved as-is:
- `docs/superpowers/specs/2026-03-26-brand-rename-design.md`
- `docs/superpowers/plans/2026-03-26-brand-rename.md` (this plan)

Edit these manually: update only the prose/summary sections (e.g. title, headers) while preserving the rename rules tables and their "Find" column values.

- [ ] **Step 2: Verify no `sellmyhomenow` or `smhn` remain in docs**

```bash
grep -ri "sellmyhomenow\|smhn" CLAUDE.md docs/ | grep -v "2026-03-26-brand-rename"
```

Expected: zero hits. The grep excludes the rename spec and plan files which intentionally preserve old names in their rules tables.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/
git commit -m "chore: rename brand in documentation (sellmyhomenow → sellmyhouse)"
```

---

### Task 9: Full grep verification

- [ ] **Step 1: Check for any remaining `sellmyhomenow` references**

```bash
grep -ri "sellmyhomenow" --exclude-dir=node_modules --exclude-dir=.git . | grep -v "2026-03-26-brand-rename"
```

Expected: zero hits. The grep excludes the rename spec/plan which intentionally preserve old names.

- [ ] **Step 2: Check for any remaining `smhn` references**

```bash
grep -ri "smhn" --exclude-dir=node_modules --exclude-dir=.git . | grep -v "2026-03-26-brand-rename"
```

Expected: zero hits.

- [ ] **Step 3: If any hits found**, fix them and amend the relevant commit.

---

### Task 10: Regenerate package-lock.json and build

- [ ] **Step 1: Regenerate package-lock.json**

```bash
npm install
```

Expected: `package-lock.json` updates with new package name `sellmyhouse-v2`.

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: TypeScript compiles and Tailwind builds successfully with zero errors.

- [ ] **Step 3: Commit package-lock.json**

```bash
git add package-lock.json
git commit -m "chore: regenerate package-lock.json with new package name"
```

---

### Task 11: Recreate Docker databases

- [ ] **Step 1: Start dev database**

```bash
docker compose -f docker/docker-compose.dev.yml up -d
```

Wait for healthy status. The new compose file creates user `smh` with database `smh_dev`.

- [ ] **Step 2: Start test database**

```bash
docker compose -f docker/docker-compose.test.yml up -d
```

Wait for healthy status. Creates user `smh` with database `smh_test`.

- [ ] **Step 3: Verify databases are running**

```bash
PGPASSWORD=smh_dev psql -U smh -h localhost -p 5432 -d smh_dev -c "SELECT 1;"
PGPASSWORD=smh_test psql -U smh -h localhost -p 5433 -d smh_test -c "SELECT 1;"
```

Expected: both return `1`.

- [ ] **Step 4: Run migrations on dev database**

```bash
npx prisma migrate deploy
```

Expected: all migrations applied successfully.

- [ ] **Step 5: Seed dev database**

```bash
npx prisma db seed
```

Expected: seed data inserted.

---

### Task 12: Run tests and final verification

- [ ] **Step 1: Run unit tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run integration tests**

```bash
npm run test:integration
```

Expected: all tests pass.

- [ ] **Step 3: Manual spot-check**

Start the dev server (`npm run dev`) and verify:
- Home page title shows "SellMyHouse.sg"
- Header shows "SellMyHouse.sg" with coloured accent on "House"
- Footer shows "SellMyHouse.sg — Huttons Asia Pte Ltd"
- Privacy page references "sellmyhouse.sg" and "dpo@sellmyhouse.sg"

- [ ] **Step 4: Final commit (if any manual fixes needed)**

```bash
git add -A
git commit -m "chore: fix remaining brand references after verification"
```
